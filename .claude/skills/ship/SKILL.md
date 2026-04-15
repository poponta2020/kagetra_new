---
name: ship
description: レビュー完了後の変更をコミット・push・PRマージ・ブランチ削除・親Issueクローズまで行うスキル。PRを出荷したいとき、/shipで使用する。
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep
argument-hint: [PR番号（任意。省略時は現在のブランチのPRを検出）]
---

# /ship - コミット＆push＆マージ

レビュー完了後の変更をコミットしてpushし、PRをマージする。
**PR番号を指定すれば、ブランチ切り替え不要で操作できます。**

## 手順

1. PR番号を特定する
   - 引数が指定されていればそれを使う: `$ARGUMENTS`
   - なければ `gh pr view --json number -q '.number'` で現在のブランチのPRを検出

2. PR情報を取得する
   - `gh pr view {PR番号} --json number,url,title,headRefName` でPR情報を取得
   - **headRefName** からブランチ名を取得する

3. 作業方式を判定する
   - **現在のブランチとPR対象ブランチが同じ場合** → カレントディレクトリで作業
   - **異なる場合** → リモートブランチベースで操作（後述）

4. 変更の確認とコミット

   **【現在のブランチで作業する場合】**
   - `git status` で未ステージの変更を確認
   - `git diff HEAD` で差分を確認
   - 変更がなければスキップしてpush + mergeへ進む
   - `.claude/settings.json`、`.claude/settings.local.json`、`scripts/review/output/` はコミット対象外
   - PR関連の実装ファイル・テストファイル・SQLファイルのみをステージ
   - `git log --oneline -5` でコミットスタイルを確認
   - prefix: fix / feat / refactor / test / docs / chore から適切なものを選択
   - `git add` → `git commit`（Co-Authored-By を付与）→ `git push`

   **【別ブランチの場合】**
   - ローカルに未コミットの変更はないはずなので（`/fix`がworktreeでcommit+push済み）、コミットステップはスキップ
   - 未pushのコミットがある場合: `git push origin {ブランチ名}`

5. PRをマージする
   - `gh pr merge {PR番号} --merge --delete-branch` でマージを実行（リモートブランチも削除）
   - マージ後、ローカルの `main` を更新する: `git fetch origin main && git merge origin/main --ff-only` （mainにいる場合のみ）

6. ローカルブランチを削除する
   - PRのブランチ（headRefName）が `main` でなければ削除を試みる
   - **まず `git worktree list` でそのブランチを使っているworktreeがないか確認する**
   - worktreeが存在する場合は、先に `git worktree remove {worktreeパス}` で削除する
   - 現在そのブランチにいる場合は、先に `git checkout main` してから削除する
   - `git branch -d {ブランチ名}` でローカルブランチを削除する

7. 親Issueのクローズ（該当する場合のみ）
   - PRの本文やコミットメッセージから親Issue番号を探す（`[Feature]` や `[Fix]` プレフィックスのIssue）
   - 見つかった場合、`gh issue view {Issue番号} --json state -q '.state'` で未クローズか確認する
   - 未クローズであれば `gh issue close {Issue番号}` でクローズする
   - 該当するIssueがなければスキップする

8. レビュー関連資料を削除する
   - `scripts/review/output/review-prompt-pr{番号}-*.md` を削除する
   - `scripts/review/output/review-result-pr{番号}-*.md` を削除する

9. Worktreeのクリーンアップ
   - `git worktree list` で一覧を取得する
   - PRのブランチ名（headRefName）に対応するworktreeがあれば削除する:
     ```bash
     git worktree remove /tmp/<worktree-dir> 2>/dev/null || true
     ```
   - 該当するworktreeがなければスキップする

10. セッション終了プロトコル（マシン間同期）
    - `docs/worklog.md` に完了記録を追記する（出荷内容、PR番号、日付）
    - ローカルのClaude memoryファイルをリポジトリ内の `.claude/memory/` にコピーして同期する
    - `docs/worklog.md` と `.claude/memory/` の変更をコミットする:
      ```bash
      git add docs/worklog.md .claude/memory/
      git commit -m "docs: update worklog and memory after shipping PR #{PR番号}"
      ```
    - `git push` でリモートに反映する

11. claude-memに出荷記録を保存する
    - claude-memのobservation記録機能を使い、以下の情報を記録する:
      - PRタイトル、番号、URL
      - マージ結果（成功/失敗）
      - クローズしたIssue（あれば）
      - カテゴリは `ship` とする
    - claude-memが利用できない場合はスキップしてよい

12. 完了したらPR URLとマージ結果を報告する
