---
name: fix
description: レビュー結果ファイルを読み込み、指摘事項に基づいてコードを修正するスキル。CRITICAL/WARNING/INFOを分類して対応し、修正後に自動で/reviewを再呼び出しする。レビュー指摘の修正時に使用する。
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob, Agent, Skill
argument-hint: "[PR番号(任意)] [--no-followup-review]"
---

# /fix - レビュー指摘に基づく修正依頼

レビュー結果を読み込み、指摘事項に基づいてコードを修正します。
**別ブランチのPRでも、git worktreeを使ってブランチ切り替え不要で修正できます。**

## 手順

1. 引数をパースする
   - 数字単独 → PR 番号として扱う。なければ `gh pr view --json number -q '.number'` で現在のブランチの PR を検出
   - `--no-followup-review` フラグの有無を `RUN_FOLLOWUP_REVIEW` 変数に記録する（`/auto-review-loop` から呼ばれた場合に渡される。指定があれば最終手順の `/review` 自動呼び出しをスキップ）

2. 最新のレビュー結果ファイルを読み込む
   - **優先順位 1**: `scripts/review/output/codex-result-pr{番号}-r*.json` のうち最大ラウンド番号のファイル（`/auto-review-loop` が生成する構造化 JSON）
     - JSON を読んで以下にマップする:
       - `blockers` → **CRITICAL**（必ず修正）
       - `should_fix` → **WARNING**（原則修正）
       - `nits` → **INFO**（任意）
     - 各 issue の `file` / `line` / `title` / `rationale` / `suggestion` を Step 5 で参照する
   - **優先順位 2**: `scripts/review/output/review-result-pr{番号}-*.md` のうち最大番号のファイル（旧形式: Codex 手動レビュー結果）
   - **優先順位 3**: ユーザーが会話内でレビューフィードバックを直接提供した場合（例: VS Code の Codex からコピー＆ペースト）。ユーザーのメッセージから CRITICAL/WARNING/INFO の指摘項目をパースする
   - 複数該当する場合は、**会話内のユーザー提供 > JSON > 旧形式 .md** の順で優先（新しい指摘ほど優先）

3. レビュー指摘を分析する
   - CRITICAL / WARNING / INFO に分類された指摘を把握する

4. **Worktreeで作業環境を用意する**（常にworktreeを使い、カレントディレクトリは一切触らない）
   - `gh pr view {PR番号} --json headRefName -q '.headRefName'` でPR対象ブランチを取得する
   - 既存のworktreeを確認する:
     - `git worktree list` で一覧を取得し、PR対象ブランチに対応するworktreeが既にあるか確認する
     - **既にworktreeがある場合**（`/bug-report`, `/quickfix`, `/implement` が作成済み）→ そのworktreeのパスで作業する（`git -C {既存worktreeパス} pull` で最新化）
     - **worktreeがない場合** → 新たに作成する:
       1. `git fetch origin {ブランチ名}`
       2. `git worktree add /tmp/fix-pr{番号} origin/{ブランチ名}`
   - **以降のすべてのファイル操作は worktree 配下のパスで行うこと**

5. 修正を実施する
   - **CRITICAL** の指摘は必ず修正する
   - **WARNING** の指摘は原則修正する。修正しない場合は理由を説明する
   - **INFO** の指摘は任意。対応するかどうか判断する
   - 各指摘の「ファイル」「問題」「修正案」を参考に修正する
   - **ファイルパスはworktreeのルートからの相対パスに読み替えること**

6. テストを実行する
   - バックエンドの変更がある場合: `cd {worktreeパス}/<バックエンドディレクトリ>` でテストを実行（例: `./gradlew test`, `npm test` 等、プロジェクトに応じたコマンド）
   - フロントエンドの変更がある場合: `cd {worktreeパス}/<フロントエンドディレクトリ>` でlint/ビルドを実行（例: `npm run lint`, `npm run build` 等）

7. **修正をcommit + pushする**
   1. 修正ファイルを `git -C {worktreeパス} add` でステージ（review output や .claude 設定は除外）
   2. `git -C {worktreeパス} commit` でコミット（Co-Authored-By を付与）
   3. `git -C {worktreeパス} push origin {ブランチ名}` でリモートに反映
   - ※ worktreeは削除しない（後続の `/fix` や `/ship` で再利用するため）
   - ※ pushまで完了することで、後続の `/review` が `git diff main...{ブランチ}` で修正済みの差分を取得できる

8. 修正サマリーを出力する
   ```
   ## 修正サマリー
   ### 対応した指摘
   - [CRITICAL] 指摘タイトル → 修正内容
   ### 対応しなかった指摘（あれば）
   - [INFO] 指摘タイトル → 理由
   ### テスト結果
   - 既存テスト: PASS / FAIL
   ### 作業環境
   - worktreeパス: /tmp/fix-pr{番号}/ or 既存worktreeパス
   ```

9. 修正サマリーをユーザーに表示した後、「commit + push済みです」と伝える。
   - **`RUN_FOLLOWUP_REVIEW` が false（`--no-followup-review` 指定あり）の場合**: ここで終了。`/review` の自動呼び出しはしない（呼び出し元の `/auto-review-loop` 側で次ラウンドのレビューが回るため）
   - **指定なし（既定）**: 自動で `/review {PR番号}` スキルを呼び出して再レビュープロンプトを生成する

10. **claude-memに修正記録を保存する**
    - claude-memのobservation記録機能を使い、以下の内容を記録する:
      - 修正したファイルと内容の概要
      - 対応したレビュー指摘（CRITICAL/WARNING/INFO別に列挙）
      - 対応しなかった指摘がある場合、その項目とスキップした理由
      - PR番号とブランチ名
    - 記録のカテゴリは "fix-review" とし、後から検索しやすくする
