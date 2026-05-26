---
name: do-plan
description: /claude-mem:make-plan で作成した計画を、worktree 隔離環境で /claude-mem:do を呼んで実行するスキル。並行作業の衝突を pre-flight で検出し、subagent には作業パスを強制する。計画を実装に移したいとき、/do-plan <plan-slug> で使用する。
user-invocable: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob, Agent, Skill
argument-hint: <plan-slug> — kebab-case 英語サマリー（例: phase-1v-attendance-api）
---

# /do-plan - 計画を worktree 隔離環境で実行

`/claude-mem:make-plan` で作成した計画を、worktree 隔離環境で `/claude-mem:do` を呼んで実行する。
並行作業の衝突を pre-flight で検出し、subagent にはすべての作業を worktree 配下で行わせる。

**ユーザーとの対話はすべて日本語で行うこと。**

---

## Step 1: 引数パース

- `$ARGUMENTS` から `<plan-slug>` を取得する（kebab-case 英語サマリー）
- 未指定の場合:
  - 直前の `/claude-mem:make-plan` の出力が会話コンテキストにあれば、計画タイトルから slug 候補を生成してユーザーに確認する
  - なければ「`/do-plan <plan-slug>` の形で slug を指定してください」と伝えて終了する

slug は worktree パス（`/tmp/impl-<slug>/`）と branch 名（`feature/<slug>`）の両方に使われるため、英小文字とハイフンのみに正規化する。

---

## Step 2: 並行作業の衝突検知（pre-flight）

以下を **並列で** 実行し、結果をまとめて判定する。

### 2a. worktree / branch の重複確認

```bash
git worktree list
git fetch origin
git branch -r --no-merged origin/main
```

- `/tmp/impl-<slug>/` が既に存在する場合 → **再利用するか確認**（タスク 2 回目以降の着手の可能性）
- `feature/<slug>` が既に存在する場合 → 既存ブランチに追加 commit する方針で確認

### 2b. 影響範囲の重複確認

計画の "変更対象ファイル" 一覧と、進行中の他ブランチが触っているファイルを比較する：

```bash
# 進行中ブランチ一覧
git branch -r --no-merged origin/main | grep -v HEAD

# 各ブランチが触ったファイル
git diff --name-only origin/main...origin/<他ブランチ>
```

特に以下のディレクトリが他ブランチと重なる場合は **警告して確認** する：

- `packages/shared/` 配下（共有スキーマ・型定義）
- `apps/web/drizzle/migrations/` または同等のマイグレーションディレクトリ（番号衝突）
- `apps/api/src/db/schema/` 配下
- `.github/workflows/` 配下（CI 設定）

### 2c. マイグレーション番号の衝突

新規マイグレーションを生成する計画なら、現時点の最大番号を表示する：

```bash
ls -1 apps/web/drizzle/migrations/ 2>/dev/null | sort | tail -3
```

他ブランチが同じ番号を生成済みでないかユーザーと擦り合わせる。

### 2d. 判定

- 重大な衝突なし → Step 3 へ
- 警告あり → 内容を提示してユーザーに継続可否を確認
- ユーザーが NG → 中断（worktree は作らずに終了）

---

## Step 3: Worktree の準備

### 既存 worktree がある場合（再利用）

未 commit の変更がないことを `git -C /tmp/impl-<slug> status` で確認してから：

```bash
git -C /tmp/impl-<slug> fetch origin feature/<slug>
git -C /tmp/impl-<slug> reset --hard origin/feature/<slug>
```

### 新規作成の場合

```bash
git fetch origin main

# 初回（branch も新規）
git worktree add /tmp/impl-<slug> -b feature/<slug> origin/main

# branch は既にリモートにある場合（worktree だけ作り直し）
git fetch origin feature/<slug>
git worktree add /tmp/impl-<slug> feature/<slug>
```

worktree path を変数 `WT=/tmp/impl-<slug>` として後続で参照する。

---

## Step 4: /claude-mem:do を実行

Skill ツールで `claude-mem:do` を呼び出す。

呼び出し時、**全 subagent への前提条件として以下を冒頭に明示する**：

```
【作業ディレクトリの強制】
- 全 subagent は cwd = /tmp/impl-<slug>/ で動作すること
- git 操作はすべて `git -C /tmp/impl-<slug>` 経由
- Read / Edit / Write のパスは `/tmp/impl-<slug>/` プレフィックス必須
- メインの作業ディレクトリ（リポジトリルート）には一切触れない
- Branch/Sync subagent は `git -C /tmp/impl-<slug> push origin feature/<slug>` でリモートに反映する

【プロジェクトルール】
- CLAUDE.md および .claude/memory/ の規約に従う
- マイグレーション追加時は番号を pre-flight で確認済みの値から開始
- packages/shared/ への変更は最小限に抑える（他ブランチとの競合源）
- テストファースト: 実装前に該当範囲のテストを書く（CLAUDE.md ルール 2）
```

`/claude-mem:do` の通常フロー（Documentation Discovery → 各 Phase の Implementation → Verification → Anti-pattern check → Code Quality → Commit → Branch/Sync）はそのまま走る。

---

## Step 5: 完了確認と次ステップ

`/claude-mem:do` が完了したら：

```bash
git -C /tmp/impl-<slug> log --oneline origin/main..HEAD
git -C /tmp/impl-<slug> status
git -C /tmp/impl-<slug> branch -vv
```

確認項目：
- 全フェーズの commit が積まれているか
- 未 commit 変更が残っていないか
- リモート（`origin/feature/<slug>`）に push 済みか

問題なければ、**自動で `/prepare-pr feature/<slug>` を呼び出して PR 作成 → `/auto-review-loop` に橋渡しする**。

未 push のコミットがあれば push を行ってから `/prepare-pr` へ進む。

---

## Step 6: claude-mem への記録

以下の observation を 1 件記録する：

- plan-slug
- worktree path（`/tmp/impl-<slug>/`）
- branch 名（`feature/<slug>`）
- 完了したフェーズ数 / 計画の総フェーズ数
- 検出された衝突警告（あれば）
- カテゴリ: `do-plan`
- タグ: plan-slug、関連するフェーズ名

---

## Step 7: 完了報告

ユーザーに以下を簡潔に報告する：

- 実行した plan-slug
- worktree パス（`/tmp/impl-<slug>/`）
- branch 名（`feature/<slug>`）
- commit ハッシュ一覧
- PR URL（`/prepare-pr` 完了後）
- 次ステップ: `/auto-review-loop` が起動済みであることを案内

worktree は **`/ship` でマージされるまで保持する**（既存スキル群と同じ規約）。

---

## 注意点

- **/claude-mem:do の内部仕様変更に注意**: 外部プラグイン（thedotmack/claude-mem）の更新で subagent 起動形式が変わる可能性がある。動作が壊れた場合は Step 4 の前提条件文を調整する
- **衝突検知は heuristic**: pre-flight ですべてを保証はできない。最終判断はユーザーに委ねる
- **緊急時の bypass**: pre-flight をスキップしたい場合は素の `/claude-mem:do` を直接呼ぶ。ただし worktree 作成は手動で行うこと（CLAUDE.md ルール 11 の対象）
- **Windows パス注意**: `/tmp/impl-<slug>` は Git Bash 上のパスで、Windows 実体は別。Bash ツール経由で操作する限り透過的だが、PowerShell から触る場合はパスの読み替えが必要
