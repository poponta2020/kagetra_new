---
name: fix
description: レビュー結果ファイルを読み込み、指摘事項に基づいてコードを修正するスキル。CRITICAL/WARNING/INFOを分類して対応し、修正後に自動で/reviewを再呼び出しする。レビュー指摘の修正時に使用する。
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob, Agent, Skill
argument-hint: [PR番号（任意。省略時は現在のブランチのPRを検出）]
---

# /fix - レビュー指摘に基づく修正依頼

レビュー結果を読み込み、指摘事項に基づいてコードを修正します。
**別ブランチのPRでも、git worktreeを使ってブランチ切り替え不要で修正できます。**

## 手順

1. PR番号を特定する
   - 引数が指定されていればそれを使う: `$ARGUMENTS`
   - なければ `gh pr view --json number -q '.number'` で現在のブランチのPRを検出

2. 最新のレビュー結果ファイルを読み込む
   - `scripts/review/output/review-result-pr{番号}-*.md` のうち、最大番号のファイルを読む
   - 該当ファイルが存在しない場合、またはユーザーが会話内でレビューフィードバックを直接提供した場合（例: VS CodeのCodexからコピー＆ペーストされたもの）、そのフィードバックを修正の根拠として使用する。ユーザーのメッセージからCRITICAL/WARNING/INFOの指摘項目をパースして分類すること。
   - ファイルとユーザー提供の両方がある場合は、ユーザー提供のフィードバックを優先する（より新しい指摘である可能性が高いため）

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

9. 修正サマリーをユーザーに表示した後、「commit + push済みです」と伝え、自動で `/review {PR番号}` スキルを呼び出して再レビュープロンプトを生成する

10. **claude-memに修正記録を保存する**
    - claude-memのobservation記録機能を使い、以下の内容を記録する:
      - 修正したファイルと内容の概要
      - 対応したレビュー指摘（CRITICAL/WARNING/INFO別に列挙）
      - 対応しなかった指摘がある場合、その項目とスキップした理由
      - PR番号とブランチ名
    - 記録のカテゴリは "fix-review" とし、後から検索しやすくする
