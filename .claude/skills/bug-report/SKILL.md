---
name: bug-report
description: バグ発見時にGitHub Issueを作成し、原因調査・修正・記録までを一括で行うスキル。バグを見つけたとき、バグ対応を記録したいときに使用する。
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob, Agent, Skill
argument-hint: [バグの概要（任意）]
---

# バグ対応・記録スキル

バグの発見から修正・記録までを一貫して行う。GitHub Issueで全てのバグ対応を追跡可能にする。

**ユーザーとの対話はすべて日本語で行うこと。**

## Step 1: バグ内容のヒアリング

`$ARGUMENTS` または会話のコンテキストからバグの内容を把握する。

以下の情報を収集する。不足があればユーザーに質問する：
- **バグの概要**: 何が起きているか
- **再現手順**: どうすれば再現できるか（わかる範囲で）
- **期待される動作**: 本来どうなるべきか
- **実際の動作**: 実際にはどうなっているか

会話の流れでバグが発見された場合、そのコンテキストから上記を推測し、ユーザーに確認を取る。

## Step 2: GitHub Issue の作成

以下のコマンドでIssueを作成する：

```bash
gh issue create --title "<簡潔なバグタイトル>" --label "bug" --body "$(cat <<'EOF'
## バグの概要
<概要>

## 再現手順
<手順>

## 期待される動作
<期待動作>

## 実際の動作
<実際の動作>
EOF
)"
```

作成されたIssue番号を記録し、ユーザーにIssueのURLを伝える。

## Step 3: 原因調査・影響範囲分析

1. コードベースを調査し、バグの原因を特定する
2. 変更が必要なファイル・影響を受ける既存機能を洗い出す
3. CLAUDE.mdの「影響範囲の調査義務」に従い、上流・下流の依存関係を確認する

**バグが以下に関わる場合は `security-auditor` エージェントを使って調査する：**
- 認証・認可（`@RequireRole`、インターセプター、トークン処理）
- 入力バリデーション不足・SQLインジェクションリスク
- APIエンドポイントの不正アクセス
- 機密データの露出

## Step 4: 修正規模の判断

調査結果をもとに、修正規模を判断しユーザーに提示する：

### 軽微と判断する目安
- 変更ファイルが1〜2個
- 修正箇所が明確で限定的
- 他機能への影響がほぼない

### 大規模と判断する目安
- 変更ファイルが3個以上
- 複数のレイヤー（controller/service/repository等）にまたがる
- 他機能への副作用がありうる
- DBスキーマの変更が必要

判断結果をユーザーに提示し、最終判断はユーザーに委ねる。

## Step 5: Worktree作成と修正の実施

### Worktreeの作成（並行作業のための隔離環境）

修正に着手する前に、worktreeを使って隔離された作業環境を作成する。
これにより、他のセッションの作業を妨げずにバグ修正を進められる。

1. バグ内容からケバブケースの英語サマリーを生成する（例: `null-pointer-in-match-service`）
2. worktreeを作成する:

```bash
git worktree add /tmp/fix-<summary> -b fix/<summary> origin/main
```

3. **以降のすべてのファイル操作（Read, Edit, Write, Bash）は `/tmp/fix-<summary>/` 配下のパスで行うこと**
   - 例: `/tmp/fix-<summary>/<バックエンドディレクトリ>/src/main/java/...`
   - メインの作業ディレクトリには一切触れない

### 軽微な場合

1. 修正方針をユーザーに提示し、確認を取る
2. worktree内で修正を実装する
3. worktree内でコミットする（メッセージに `Fixes #<Issue番号>` を含める）:

```bash
git -C /tmp/fix-<summary> add <対象ファイル>
git -C /tmp/fix-<summary> commit -m "fix: <修正内容>"
```

4. Issueに原因と修正内容をコメントとして追記する：

```bash
gh issue comment <Issue番号> --body "$(cat <<'EOF'
## 原因
<原因の説明>

## 修正内容
<何をどう修正したか>
EOF
)"
```

### 大規模な場合

1. 修正手順書をIssueコメントに記載する：

```bash
gh issue comment <Issue番号> --body "$(cat <<'EOF'
## 修正手順書

### 原因
<原因の詳細な説明>

### 修正方針
<どのようなアプローチで修正するか>

### 修正ステップ
- [ ] ステップ1: <内容>
- [ ] ステップ2: <内容>
- [ ] ステップ3: <内容>
...

### 影響範囲
<影響を受けるファイル・機能のリスト>

### 確認事項
<修正後に確認すべきこと>
EOF
)"
```

2. ユーザーに手順書を確認してもらい、承認を得る
3. 手順書に沿ってworktree内で修正を実装する
4. 各ステップ完了時にIssueコメントで進捗を更新する（チェックボックスを更新）
5. すべての修正が完了したらworktree内でコミットする（メッセージに `Fixes #<Issue番号>` を含める）
6. Issueに最終的な修正サマリーをコメントとして追記する

## Step 6: Push・PR作成

### 6a. Push

```bash
git -C /tmp/fix-<summary> push -u origin fix/<summary>
```

### 6b. PR作成

既にPRが存在する場合（`gh pr view fix/<summary> --json number,url` が成功）はスキップする。

```bash
gh pr create --base main --head fix/<summary> --title "fix: <バグタイトル>" --body "$(cat <<'EOF'
## Summary
<修正内容の箇条書き>

## Bug
Fixes #<Issue番号>

## Test plan
- [ ] 動作確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 6c. Worktreeの保持

**Worktreeは削除しない。** `/ship` でPRがマージされるまで `/tmp/fix-<summary>/` を保持する。
後続の `/fix`（レビュー指摘修正）もこのworktree上で作業する。

## Step 7: レビュープロンプト生成

PR作成後、自動的に `/review` スキルを呼び出してレビュープロンプトを生成する。

Skillツールで `review` スキルを呼び出す。引数にはPR番号を渡す。

## Step 8: 完了報告

ユーザーに以下を報告する：
- 修正内容のサマリー
- コミットハッシュ
- Issue URL
- PR URL
- Worktreeの場所（`/tmp/fix-<summary>/`）
- 生成されたレビュープロンプトファイルのパス
- 「このファイルの内容をレビュー担当AI（Codex or Claude Code）に貼り付けてください」

---

## Step 9: claude-mem への記録

完了報告の後、claude-mem の `create_observations` ツールを使って以下の情報を記録する：

- **バグの概要**: バグの説明と症状
- **深刻度**: 軽微 / 大規模（Step 4 での判断結果）
- **根本原因**: バグの原因の説明
- **適用した修正**: 何をどう修正したか
- **PR番号・URL**: 作成したPRの番号とURL
- **Issue番号・URL**: 作成したバグIssueの番号とURL

記録のカテゴリは `bug-fix` とし、バグ内容の英語サマリーをタグとして付与する。
