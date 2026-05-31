---
name: auto-review-loop
description: Codex CLI を使って PR の差分レビュー→/fix による修正→再レビュー…を自動ループするスキル。指摘がなくなったら停止（--auto-ship 指定時は /ship まで自動）。/auto-review-loop で使用する。
user-invocable: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill
argument-hint: "[PR番号(任意)] [--max-rounds N(default 3)] [--max-tokens N(default 500000)] [--effort auto|medium|high|xhigh(default auto)] [--auto-ship]"
---

# /auto-review-loop - Codex 自動レビュー&修正ループ

PR の差分を `codex exec` で構造化レビュー(JSON)し、blockers/should_fix があれば `/fix` を呼んで修正→再レビュー…を上限ラウンド数まで繰り返す。
**前提**: `codex` CLI がインストール済みで `~/.codex/auth.json` で ChatGPT サブスク認証済みであること。

**ユーザーとの対話はすべて日本語で行うこと。**

## 引数のパース

- 数字単独 → PR 番号
- `--max-rounds N` → 最大ラウンド数（未指定なら **3**）
- `--max-tokens N` → 累計トークン上限（未指定なら **500000**）。ラウンド完了時点で累計がこの値以上になっていたら次ラウンドを開始せずに中断する。サブスククォータ保護用のソフトキャップ
- `--effort auto|medium|high|xhigh` → Codex の reasoning effort（未指定なら **auto**）。`auto` は差分内容からオーケストレーター（Claude）が medium/high を自動判定する（3-a.5 のルーブリック）。medium/high/xhigh を明示指定するとルーブリックを無視してそれを全ラウンド固定で使う。`xhigh` は手動指定時のみ（auto では選ばれない）
- `--auto-ship` → 成功時に `/ship` を自動呼び出し（未指定なら成功報告のみ）

変数名:
- `MAX_ROUNDS`: 最大ラウンド数
- `MAX_TOKENS`: トークン上限
- `EFFORT_MODE`: `auto`|`medium`|`high`|`xhigh`（既定 `auto`）
- `ESCALATED`: auto 時のエスカレーション状態（初期値 false）。true になると以降の auto ラウンドは high 固定
- `AUTO_SHIP`: true/false
- `CUMULATIVE_TOKENS`: ラウンド毎の使用トークンを加算（初期値 0）

## Step 1: PR 番号とブランチを特定

1. 引数で PR 番号が指定されていればそれを使う。なければ `gh pr view --json number -q '.number'` で現在のブランチの PR を検出する
2. `gh pr view {PR番号} --json url,title,headRefName,baseRefName` で PR 情報を取得し、`headRefName` をブランチ名として保持する
3. **baseRefName が `main` 以外の場合**は、メッセージを出してユーザーに継続可否を確認する（main 前提でフローが組まれているため）

## Step 2: Worktree を用意

既存 `/fix` と同じ判定ロジックを使う:

1. `git worktree list` で対象ブランチ（headRefName）を持つ worktree があるか確認
2. ある場合 → そのパスで作業（`git -C {既存worktree} fetch origin {ブランチ名} && git -C {既存worktree} reset --hard origin/{ブランチ名}` でリモート最新化）
3. ない場合 → 新規作成:
   ```bash
   git fetch origin {ブランチ名}
   git worktree add /tmp/fix-pr{番号} origin/{ブランチ名}
   ```
4. 以降の `git` / `codex exec` はすべて `--cd {worktree}` または `git -C {worktree}` で実行する

**worktree パス変数**: `WT={worktreeパス}` として後続で参照する。

## Step 3: ループ開始（最大 MAX_ROUNDS 回）

各ラウンド R (1..MAX_ROUNDS) について以下を実行する。

### 3-0. トークン上限の事前チェック

R >= 2 のときのみ実施（R=1 は無条件で実行する）。

- `CUMULATIVE_TOKENS >= MAX_TOKENS` の場合: 「累計トークンが上限 `MAX_TOKENS` に到達したためループ中断（実績: {CUMULATIVE_TOKENS}）」と報告して **ループ中断**（Step 4 の失敗系へ。理由 = `token-budget`）

### 3-a. ブランチを最新化して差分を取得

```bash
git -C "$WT" fetch origin {ブランチ名}
git -C "$WT" reset --hard origin/{ブランチ名}
git -C "$WT" diff main...HEAD > /tmp/auto-review-diff-pr{番号}-r{R}.txt
DIFF_LINES=$(wc -l < /tmp/auto-review-diff-pr{番号}-r{R}.txt)
```

- `DIFF_LINES == 0` の場合: 「差分がありません」と報告してループ終了（**成功扱い**）

### 3-a.5. このラウンドの reasoning effort を決定

`codex exec` に渡す effort を `ROUND_EFFORT` として決める。判断はオーケストレーター（Claude）が行い、決まった値はこのラウンドのサマリーに残す。

1. **手動指定が優先**: `EFFORT_MODE != auto`（medium/high/xhigh を明示）なら `ROUND_EFFORT = EFFORT_MODE`。以降の判定はスキップ
2. **エスカレーション済み**: `EFFORT_MODE == auto` かつ `ESCALATED == true` なら `ROUND_EFFORT = high`（一度上げたら据え置き）
3. **auto ルーブリック**（`EFFORT_MODE == auto` かつ `ESCALATED == false`）: 変更パスと差分規模から判定する

   ```bash
   git -C "$WT" diff --name-only main...HEAD > /tmp/auto-review-files-pr{番号}-r{R}.txt
   CHANGED_FILES=$(wc -l < /tmp/auto-review-files-pr{番号}-r{R}.txt)
   ```

   `DIFF_LINES`（3-a で取得済み）・`CHANGED_FILES`・変更パス一覧（Read で確認）を見て、**次のいずれかに該当すれば `high`、どれにも当てはまらなければ `medium`**。判断に迷う境界ケースは安全側 = `high` に倒す。

   **high トリガ（OR 条件）**:
   - 認証・認可: パスが `auth` / `permission` / `middleware` を含む（例 `apps/web/**/auth*`, `**/*permission*`, `**/middleware*`）
   - LINE 一斉配信: パスが `line` を含み、かつ `broadcast` / `notify` / `bot` のいずれかを含む。または Bot プール・招待コード関連
   - メールワーカー / AI 振り分け: `apps/mail-worker/**`
   - DB スキーマ / マイグレーション: `packages/shared/**/schema*`, `**/drizzle/**`, `**/migrations/**`
   - P3 課金・外部API: パスが `amadeus` / `agoda` / `rakuten` / `travel` / `payment` を含む
   - 規模が大きい: `DIFF_LINES > 400` または `CHANGED_FILES > 8`

   どれにも該当しない（UI/CSS/コンポーネント/docs/テストのみ等）→ `medium`

4. `xhigh` は auto では選ばない（手動 `--effort xhigh` 指定時のみ）

> ルーブリックの閾値（400 行 / 8 ファイル）と対象パスは初期値。運用しながら調整してよい。

### 3-b. Codex で構造化レビュー

```bash
mkdir -p scripts/review/output
RESULT_FILE=scripts/review/output/codex-result-pr{番号}-r{R}.json

cat /tmp/auto-review-diff-pr{番号}-r{R}.txt | codex exec --ephemeral \
  -c model_reasoning_effort="$ROUND_EFFORT" \
  --output-schema scripts/review/codex-review.schema.json \
  -o "$RESULT_FILE" \
  --skip-git-repo-check \
  "$(cat scripts/review/codex-review-prompt.md)" \
  > /tmp/auto-review-stdout-pr{番号}-r{R}.log 2> /tmp/auto-review-stderr-pr{番号}-r{R}.log
CODEX_EXIT=$?
```

- `CODEX_EXIT != 0` の場合: stderr の末尾 50 行を表示して **ユーザーに引き継ぎ**（ループ中断）
- `--skip-git-repo-check` を付ける理由: diff を stdin で渡しているので、Codex 側のリポジトリ検査は不要
- `-c model_reasoning_effort=$ROUND_EFFORT`: 3-a.5 で決めた effort をグローバル `config.toml` に依存せず明示指定する。codex の `-c` は値を TOML としてパースし、失敗時は生文字列として扱うため `medium`/`high`/`xhigh` の裸トークンでそのまま渡せる
- **作業ディレクトリは元のリポジトリルートのまま**で OK（Codex はリポジトリを直接読まない。stdin の diff だけを材料にレビューする）

### 3-c. 結果 JSON を読む

Read ツールで `$RESULT_FILE` を読み込み、Claude が直接 JSON をパースする（jq は使わない。Windows Git Bash 環境では未インストールのため）。

抽出する値:
- `verdict`（"pass" or "needs_changes"）
- `blockers.length`、`should_fix.length`、`nits.length`
- 各 issue の `file` + `title` のリスト（指紋用）
- `summary`（ユーザー報告用）

### 3-d. 終了判定

- `verdict == "pass"` かつ `blockers.length == 0` かつ `should_fix.length == 0` → **成功でループ終了**
- それ以外は次の修正フェーズへ
- **（auto 時）エスカレーション**: `EFFORT_MODE == auto` かつ `ROUND_EFFORT == medium` かつ `blockers.length > 0` の場合 → `ESCALATED = true` を立てる（medium が重大問題を検出した＝より深く見る価値があるため、次ラウンド以降を high で再レビュー）

### 3-e. Ping-pong 検出

各 issue の `file + "::" + title` を sort / unique で結合した文字列を `FINGERPRINT` とする。
これを `/tmp/auto-review-fingerprint-pr{番号}-r{R}.txt` に保存する。

R >= 2 のラウンドで、前ラウンドのファイル内容と完全一致した場合（=同じ指摘が解消されない膠着）:

- **`EFFORT_MODE == auto` かつ `ESCALATED == false`（まだ medium で回っていた）**: `ESCALATED = true` を立てて **ループは中断せず次ラウンドへ**。「medium で膠着 → high に格上げして再試行する」と報告する（high で膠着を破れるか一度だけ試す）
- **それ以外（既に high で回っている / 手動 effort 指定 / 既にエスカレーション済み）**: **「同じ指摘が解消されません」と報告してループ中断**（ユーザー判断仰ぐ）

### 3-f. /fix を呼んで修正

`/fix` スキルを呼び出す。引数は PR 番号のみ。`/fix` 側で `scripts/review/output/codex-result-pr{番号}-r{R}.json` を **JSON 形式**として読み込み、CRITICAL=blockers / WARNING=should_fix / INFO=nits にマップして対応する（`/fix` の JSON 対応分岐を使用）。

`/fix` は worktree 内で修正・commit・push まで実行し、最後に `/review` を自動呼び出ししようとするが、**ここでは `/review` の自動呼び出しを抑制したい**。

→ Skill ツールで `/fix` を呼ぶ際、引数に `--no-followup-review` を付ける（`/fix` 側で対応）。**未対応の場合は素の `/fix {PR番号}` で呼び、生成された `/review` のプロンプト出力は無視する**。

### 3-g. トークン使用量の集計

stderr ログ（`/tmp/auto-review-stderr-pr{番号}-r{R}.log`）の末尾付近にある `tokens used` 行の直後の数値（カンマ区切り。例: `25,725`）を抽出する。

```bash
ROUND_TOKENS=$(grep -A1 "^tokens used" /tmp/auto-review-stderr-pr{番号}-r{R}.log | tail -1 | tr -d ',')
# 数値でなければ 0 として扱う
if ! [[ "$ROUND_TOKENS" =~ ^[0-9]+$ ]]; then ROUND_TOKENS=0; fi
CUMULATIVE_TOKENS=$((CUMULATIVE_TOKENS + ROUND_TOKENS))
```

- パースに失敗（行が無い・数値でない）した場合は `ROUND_TOKENS=0` として続行。トークン上限チェックは値が取れた範囲でのみ機能する（取れない時は実質無効）

### 3-h. ラウンド境界の記録

claude-mem に observation を 1 件記録:

- `pr`: PR 番号
- `round`: R
- `verdict`: VERDICT
- `counts`: { blockers, should_fix, nits }
- `round_tokens`: ROUND_TOKENS
- `cumulative_tokens`: CUMULATIVE_TOKENS
- `effort`: ROUND_EFFORT（このラウンドで使った reasoning effort）
- `escalated`: ESCALATED
- カテゴリ: `auto-review-round`

## Step 4: ループ終了後の処理

### 成功（verdict=pass）

1. サマリーを表示:
   ```
   ## /auto-review-loop 結果: ✅ PASS
   - 総ラウンド数: {R} / {MAX_ROUNDS}
   - 各ラウンドの指摘件数と effort: 例 R1(effort=medium) blockers=2 / R2(effort=high) blockers=0
   - 累計トークン: {CUMULATIVE_TOKENS} / {MAX_TOKENS}
   - 最終サマリー（最新 JSON の summary フィールドを表示）
   ```
2. **`--auto-ship` 指定時**:
   - `gh pr checks {PR番号}` を実行
   - 全て成功（`PASS`）なら `/ship {PR番号}` を呼ぶ
   - 失敗ありなら ship せず、「CI が green ではないため ship を中断しました」と報告
3. **`--auto-ship` 未指定時**: 「pass を確認しました。マージは `/ship {PR番号}` を手動で実行してください」と案内

### 失敗（max-rounds 到達 / ping-pong / token-budget / codex error）

1. サマリーを表示:
   ```
   ## /auto-review-loop 結果: ❌ 未収束（理由: {max-rounds 到達 | ping-pong | token-budget | codex-error}）
   - 各ラウンドの effort: 例 R1=medium / R2=high / R3=high
   - 累計トークン: {CUMULATIVE_TOKENS} / {MAX_TOKENS}
   - 残った指摘:
     - [BLOCKER] file:line — title
     - ...
   - 最新の結果ファイル: scripts/review/output/codex-result-pr{番号}-r{最終R}.json
   ```
2. ユーザーに手動対応を促す

## Step 5: docs/worklog.md に追記

成否によらず、最後にセッション履歴として 1 行追記する:

```
- {日付} /auto-review-loop PR #{番号}: {ラウンド数}R, verdict={最終verdict}, effort={各ラウンドのeffort 例 m→h}, tokens={CUMULATIVE_TOKENS}/{MAX_TOKENS}, result={pass|stuck|max-reached|token-budget|codex-error}
```

## Step 6: 一時ファイルの掃除

- `/tmp/auto-review-diff-pr{番号}-*.txt`
- `/tmp/auto-review-files-pr{番号}-*.txt`
- `/tmp/auto-review-stdout-pr{番号}-*.log`
- `/tmp/auto-review-stderr-pr{番号}-*.log`

は削除する。`scripts/review/output/codex-result-pr*.json` は **残す**（`/ship` が後でまとめて掃除する想定）。

## 注意点

- **コスト**: 1 ラウンドあたり 20k〜50k トークン消費する想定（差分サイズ・effort 次第）。reasoning effort は medium を基準に high で概ね 3〜5x のトークンを使うため、effort を上げると線形以上にコストが増える。`MAX_ROUNDS=3` で最大 150k 程度（medium 基準）。既定 `MAX_TOKENS=500000` は余裕を持たせたソフトキャップ（暴走防止用）。タイトに絞りたければ `--max-tokens 100000` 等を指定。
- **reasoning effort**: 3-a.5 で差分内容から auto 判定（既定）。サブスク認証（`auth_mode=chatgpt`）ではコスト=クォータ消費なので、グローバル `config.toml` を一律 high にせず medium 既定にしておき、このスキルが必要なラウンドだけ `-c model_reasoning_effort=high` を明示する設計。手動で固定したいときは `--effort high` 等。モデル自体を変えたいときは同様に `-c model="..."` または `-m <model>` を 3-b の codex exec に足せる。
- **シェル**: Windows (Git Bash) 環境で動かす想定。JSON のパースは Claude が Read ツール経由で直接行う（`jq` 依存なし）。
- **`/fix` のフォロー up**: 現状 `/fix` は最後に `/review` を呼ぼうとする。`/fix` 側に **「JSON 結果ファイルを使った場合は /review の自動呼び出しをスキップする」** という分岐を追加すること（このスキルとセットで /fix を改修する）。
- **トークン抽出の壊れやすさ**: Codex CLI の stderr フォーマット（`tokens used\n{N,N}`）に依存している。CLI のバージョンアップで壊れる可能性がある。壊れた場合は `ROUND_TOKENS=0` で続行するので **無限ループにはならない**（MAX_ROUNDS で必ず止まる）が、コストガードは効かなくなる。
