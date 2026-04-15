---
name: quickfix
description: 小さなバグ修正・軽微な変更を最初から最後まで一気通貫で行うスキル。原因調査 → 影響範囲調査 → 修正方針確認 → 実装 → テスト → コミット → PR作成まで面倒を見る。
user-invocable: true
disable-model-invocation: true
argument-hint: 修正内容を自然言語で記述（例: ○○画面の△△ボタンが反応しない）
allowed-tools: Read, Edit, Write, Bash, Grep, Glob, Agent, AskUserQuestion, Skill
---

# QuickFix - 小さな修正・バグ修正の一気通貫スキル

**ユーザーとの対話はすべて日本語で行うこと。**

引数: `<arg1>` — 修正内容の自然言語説明

## 実行手順

### Step 1: 原因調査

`<arg1>` の内容を元に、以下を調査する:

- 関連するファイル・コンポーネント・エンドポイントを特定する
- Grep / Glob / Read を使ってコードを読み、原因を突き止める
- バックエンドとフロントエンドの両方を確認する（プロジェクト内の該当ディレクトリを特定すること）

### Step 2: 影響範囲調査

CLAUDE.md の「影響範囲の調査義務」に従い、以下を調査する:

- 変更対象を呼び出している箇所（上流）
- 変更対象が呼び出している箇所（下流）
- フロントエンド ⇔ バックエンド間の API 連携への影響
- DB スキーマの変更が必要か
- 共通コンポーネントやユーティリティへの影響

### Step 3: 修正方針の提示と確認

**ここで必ずユーザーに確認を取ること。実装に着手してはならない。**

以下の形式で修正方針を提示する:

```
## 修正方針

**原因:** <原因の説明>

**修正内容:**
- <変更ファイル1>: <何をどう変えるか>
- <変更ファイル2>: <何をどう変えるか>

**影響範囲:** <影響の有無と内容>

**ドキュメント更新:** 必要 / 不要
```

ユーザーの承認を得てから次に進む。

### Step 4: Worktreeの作成（並行作業のための隔離環境）

**修正に着手する前に**、worktreeを使って隔離された作業環境を作成する。
これにより、他のセッションの作業を妨げずに修正を進められる。

1. 修正内容からケバブケースの英語サマリーを生成する（例: `cancel-button-not-responding`）
2. worktreeを作成する:

```bash
git worktree add /tmp/fix-<summary> -b fix/<summary> origin/main
```

3. **以降のすべてのファイル操作（Read, Edit, Write, Bash）は `/tmp/fix-<summary>/` 配下のパスで行うこと**
   - 例: `/tmp/fix-<summary>/<バックエンドディレクトリ>/src/main/java/...`
   - メインの作業ディレクトリには一切触れない

### Step 5: 修正の実装

承認された方針に沿って、**worktree内で**修正を実装する。

- Edit ツールを使って既存ファイルを修正する（新規ファイル作成は最小限に）
- 方針にない変更を勝手に加えない
- **パスは必ず `/tmp/fix-<summary>/` プレフィックスを使うこと**

### Step 6: テスト実行

以下のテストを**worktree内で**実行する:

**バックエンドに変更がある場合:**
```bash
cd /tmp/fix-<summary>/<バックエンドディレクトリ> && <テストコマンド>  # 例: ./gradlew test, npm test 等
```

**フロントエンドに変更がある場合:**
```bash
cd /tmp/fix-<summary>/<フロントエンドディレクトリ> && npm run lint
cd /tmp/fix-<summary>/<フロントエンドディレクトリ> && npm run build
```

**テストが失敗した場合:**
- `test-automator` エージェントを使って失敗内容を分析・修正する
- 修正後に再度テストを実行する
- 成功するまで繰り返す

**修正内容がセキュリティに関わる場合（認証・認可・入力バリデーション・APIエンドポイント等）:**
- `security-auditor` エージェントを使って修正後のコードにセキュリティ上の問題がないか確認する

### Step 7: ドキュメント更新（必要な場合のみ）

修正内容が以下のドキュメントに影響する場合のみ、**worktree内で**更新する:

- `docs/SPECIFICATION.md` — 仕様書
- `docs/SCREEN_LIST.md` — 画面一覧
- `docs/DESIGN.md` — 設計書

UIの見た目・動作の変更や、API仕様の変更がなければスキップしてよい。

### Step 8: コミット

worktree内で変更をコミットする:

```bash
git -C /tmp/fix-<summary> add <対象ファイル>
git -C /tmp/fix-<summary> commit -m "$(cat <<'EOF'
<変更内容の日本語要約>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

- 関連ファイルをすべて1つのコミットに含める（ドキュメント更新も同じコミット）

### Step 9: Push・PR作成

#### 9a. Push

```bash
git -C /tmp/fix-<summary> push -u origin fix/<summary>
```

#### 9b. PR作成

```bash
gh pr create --base main --head fix/<summary> --title "fix: <修正タイトル>" --body "$(cat <<'EOF'
## Summary
<修正内容の箇条書き>

## Test plan
- [ ] 動作確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

#### 9c. Worktreeの保持

**Worktreeは削除しない。** `/ship` でPRがマージされるまで `/tmp/fix-<summary>/` を保持する。

### Step 10: レビュープロンプト生成

PR作成後、自動的に `/review` スキルを呼び出してレビュープロンプトを生成する。

Skillツールで `review` スキルを呼び出す。引数にはPR番号を渡す。

### Step 11: 完了報告

最後に以下を簡潔に報告する:

- 何を修正したか
- 変更したファイル一覧
- テスト結果
- コミットハッシュ
- PR URL
- Worktreeの場所（`/tmp/fix-<summary>/`）
- 生成されたレビュープロンプトファイルのパス
- 「このファイルの内容をレビュー担当AI（Codex or Claude Code）に貼り付けてください」

---

## Step 12: claude-mem への記録

完了報告の後、claude-mem の `create_observations` ツールを使って以下の情報を記録する：

- **修正したバグ**: バグの概要と症状
- **根本原因**: なぜバグが発生していたか
- **変更ファイル一覧**: 修正したファイルのパスと変更内容
- **PR番号・URL**: 作成したPRの番号とURL
- **コミットハッシュ**: 修正コミットのハッシュ

記録のカテゴリは `quickfix` とし、修正内容の英語サマリーをタグとして付与する。
