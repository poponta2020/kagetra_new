---
name: review
description: クロスレビュー用プロンプトを生成するスキル。PRの差分からレビュー依頼プロンプトを作成し、外部レビューアー（Codex等）に渡せる形にする。レビューを依頼したいとき、/reviewで使用する。
user-invocable: true
allowed-tools: Bash, Read, Write, Glob, Grep
argument-hint: [PR番号（任意。省略時は現在のブランチのPRを検出）]
---

# /review - クロスレビュー用プロンプト生成

現在のブランチ（またはPR番号 $ARGUMENTS）に対するレビュー依頼プロンプトを生成します。
**別ブランチのPRでも、ブランチ切り替え不要で実行できます。**

## 手順

1. PR番号を特定する
   - 引数が指定されていればそれを使う: `$ARGUMENTS`
   - なければ `gh pr view --json number -q '.number'` で現在のブランチのPRを検出

2. レビュー回数を決定する
   - `scripts/review/output/` 内の `review-prompt-pr{番号}-*.md` ファイル数をカウントする
   - 次のレビュー回数 = カウント + 1

3. PR情報を取得する
   - `gh pr view {PR番号} --json url,title,headRefName,baseRefName` でPR情報を取得
   - **headRefName** からブランチ名を取得する（現在のブランチに依存しない）

4. 差分を取得する
   - PR情報から取得した**ブランチ名**を使い、`git diff main...{ブランチ名}` で差分を取得する
   - ※ 現在のブランチとPR対象ブランチが同じ場合も、この方法で統一する
   - ローカルにブランチがない場合は `git fetch origin {ブランチ名}` してから `git diff main...origin/{ブランチ名}` を使う

5. `scripts/review/review-template.md` を読み込み、以下のプレースホルダーを置換する:
   - `{{PR_URL}}` → PRのURL
   - `{{PR_TITLE}}` → PRのタイトル
   - `{{PR_NUMBER}}` → PR番号（数字のみ）
   - `{{REVIEW_ROUND}}` → レビュー回数（数字のみ）
   - `{{BRANCH}}` → ブランチ名
   - `{{DIFF}}` → PR差分
   - `{{BASE_BRANCH}}` → ベースブランチ名（`baseRefName`から取得）
   - `{{RESULT_FILE}}` → レビュー結果ファイルのパス（`scripts/review/output/review-result-pr{番号}-{レビュー回数}.md`）

6. 生成結果を `scripts/review/output/review-prompt-pr{番号}-{レビュー回数}.md` に保存する

7. レビュー結果の受け皿ファイルを空で作成する
   - `scripts/review/output/review-result-pr{番号}-{レビュー回数}.md` を空ファイルとして作成する（レビュー担当がここに結果を貼り付ける）

8. レビュープロンプトを会話内に表示する（Codex VS Code対応）
   - 保存したプロンプトファイルの内容を**会話内にそのまま表示**する（ユーザーがコピーしてCodexに貼り付けられるようにする）
   - 表示前に以下のメッセージを出す: 「レビュープロンプトを生成しました。VS CodeでCodexを開き、以下のプロンプトを渡してください。」

9. claude-memにレビュー依頼を記録する
   - claude-memのobservation記録機能を使い、以下の情報を記録する:
     - PR番号、レビュー回数、PRタイトル
     - カテゴリは `review-request` とする
   - claude-memが利用できない場合はスキップしてよい

10. ユーザーに以下を案内する:
   - 生成されたプロンプトファイルのパス
   - 「上記のプロンプトをVS CodeのCodex拡張に貼り付けてください」
   - 「Codexのレビュー結果は、`/fix` にそのまま伝えるか、`scripts/review/output/review-result-pr{番号}-{レビュー回数}.md` に貼り付けてください」
   - 「`/fix` で修正依頼できます」
