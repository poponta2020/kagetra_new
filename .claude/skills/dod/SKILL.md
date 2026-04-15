---
name: dod
description: Definition of Done チェックリスト。fix完了後、/ship前に全項目を確認する。DoD確認したいとき、/dodで使用する。
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep
argument-hint: [PR番号（任意。省略時は現在のブランチのPRを検出）]
---

# /dod - Definition of Done チェック

fix完了後、shipする前にDoDの全項目を自動チェックする。

## 手順

1. PR番号を特定する
   - 引数が指定されていればそれを使う: `$ARGUMENTS`
   - なければ `gh pr view --json number -q '.number'` で現在のブランチのPRを検出

2. PR情報を取得する
   - `gh pr view {PR番号} --json number,url,title,headRefName,body` でPR情報を取得

3. 以下のチェックを順番に実行し、結果を収集する

### チェック項目

#### A. テスト（自動チェック）
- [ ] `pnpm test` が全パス
- [ ] `pnpm typecheck` が全パス
- [ ] `pnpm lint` が全パス

#### B. CI（自動チェック）
- [ ] GitHub Actions のステータスを確認: `gh pr checks {PR番号}`
- [ ] 全チェックがpass

#### C. レビュー対応（自動チェック）
- [ ] `scripts/review/output/review-result-pr{番号}-*.md` の最新ファイルを読み込む
- [ ] CRITICAL指摘が0件、または全て対応済み（対応後の `/review` 結果で確認）

#### D. claude-mem記録（自動チェック）
- [ ] claude-memにこのPRに関する記録があるか確認（任意: claude-memが利用可能な場合のみ）

#### E. スマホ実機確認（手動チェック — ユーザーに確認）
- [ ] UIの変更がある場合: 「スマホ実機で確認しましたか？」とユーザーに質問する
- [ ] UIの変更がない場合（API only等）: このチェックをスキップする

4. 結果をレポートとして出力する

```
## DoD チェック結果 — PR #{番号}: {タイトル}

### 自動チェック
| # | 項目 | 結果 | 詳細 |
|---|------|------|------|
| A1 | テスト | PASS/FAIL | 失敗テストがあれば表示 |
| A2 | 型チェック | PASS/FAIL | エラーがあれば表示 |
| A3 | lint | PASS/FAIL | エラーがあれば表示 |
| B1 | CI | PASS/FAIL/PENDING | 各ジョブのステータス |
| C1 | レビュー指摘 | PASS/FAIL | 未対応CRITICALがあれば表示 |
| D1 | claude-mem記録 | PASS/SKIP | 記録の有無 |

### 手動チェック
| # | 項目 | 結果 | 詳細 |
|---|------|------|------|
| E1 | スマホ実機確認 | 要確認/スキップ | UI変更の有無に応じて |

### 判定
- **SHIP可能** — 全項目PASS（手動チェックはユーザー確認待ち）
- **SHIP不可** — FAIL項目あり。修正してから再度 `/dod` を実行してください
```

5. FAIL項目がある場合、修正が必要な箇所を具体的に指摘する

6. 全自動チェックがPASSで手動チェックのみ残っている場合、ユーザーに確認を求め、OKなら「`/ship` で出荷できます」と案内する
