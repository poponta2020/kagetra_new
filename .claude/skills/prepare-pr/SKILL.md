---
name: prepare-pr
description: 実装完了後にpush・PR作成を行い、/reviewスキルによるレビューへつなげるスキル。/implement、/quickfix、/bug-report の後に使用する。
user-invocable: true
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Skill
---

# /prepare-pr - 実装完了後のPR作成

`/implement`、`/quickfix`、`/bug-report` で実装・コミット済みの変更をpushし、PRを作成する。
完了後は `/review` でクロスレビューに進む。

**前提**: 各スキルがworktree内でfeatureブランチ作成・コミット・push済みであること。
各スキル（`/implement`, `/quickfix`, `/bug-report`）は実装完了時にpushまで行うため、このスキルは主に**PRがまだ作成されていない場合**に使用する。

**ユーザーとの対話はすべて日本語で行うこと。**

## Step 1: 対象ブランチの特定

1. `$ARGUMENTS` が指定されている場合、それをブランチ名として使う
2. 指定がない場合:
   - `git worktree list` で現在アクティブなworktreeを一覧表示する
   - `git branch -r --no-merged origin/main` でまだマージされていないリモートブランチを確認する
   - 候補が複数ある場合はユーザーに選択させる

## Step 2: 状態の確認

以下のコマンドを**並列で**実行する:

```bash
git log --oneline origin/main..origin/<ブランチ名>
gh pr list --head <ブランチ名> --json number,url
```

収集した情報をもとに、以下のいずれかに分類する:

| 状態 | 条件 | 実行するステップ |
|------|------|-----------------|
| A. push済み、PRなし | リモートにブランチがあるがPRが存在しない | PR作成 |
| B. PR作成済み | `gh pr list` でPRが見つかる | PR URLを表示して終了 |
| C. ブランチがリモートにない | `origin/<ブランチ名>` が存在しない | エラー（先にpushが必要） |

### 異常状態の検出
- **リモートにブランチがない場合**: 「ブランチがリモートにpushされていません。各実装スキルが正常に完了したか確認してください。」と伝える
- **コミットがない場合**: 「mainとの差分がありません。先に実装スキルを実行してください。」と伝える

## Step 3: PR作成

1. `git log --oneline origin/main..origin/<ブランチ名>` でコミット内容を確認する
2. コミット内容からPRタイトルと本文を生成する

```bash
gh pr create --base main --head <ブランチ名> --title "<タイトル>" --body "$(cat <<'EOF'
## Summary
<変更内容の箇条書き>

## Test plan
- [ ] 動作確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Step 4: 完了報告とレビュー自動開始

以下を表示する:
- 作成されたPRのURL

表示後、**自動で `/review <PR番号>` スキルを呼び出し、クロスレビュープロンプトを生成する。**
