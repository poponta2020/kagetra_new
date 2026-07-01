---
name: feedback_no_prettier_config_repo_style
description: リポジトリに prettier 設定は無い。素の npx prettier はスタイルを壊す（double-quote+semi 化）
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 54d8b809-675e-4236-85c6-e581c48c22ab
---

kagetra_new には **prettier 設定ファイルが一切無い**（`.prettierrc*` / `prettier.config.*` / package.json の `prettier` キー すべて無し・prettier は devDeps にも無い）。コードスタイル（**single-quote・セミコロン無し**・2space・trailing comma・print width ~80）は **手書き規約**で、ESLint（`apps/web/eslint.config.mjs` は `next/core-web-vitals` のみ）は quotes/semi を強制しない＝lint も CI も自動整形しない。

**Why:** 素の `npx prettier --write`（未インストール→prettier@3.x を一時取得）を走らせると、リポの規約を読めず **prettier 既定（double-quote＋セミコロン）** に全ファイルを書き換えてしまう。lint/型チェックは通る（eslint が quotes/semi を見ない）ので気づきにくいが、diff が全面 style churn になり既存コードと不整合＝レビュー指摘・ノイズの原因。2026-07-01 senseki-stats PR-2 で13ファイルを一度壊した。

**How to apply:** 整形が必要なら prettier を素で流さない。どうしても使うなら `npx prettier@3.9.4 --single-quote --no-semi --write <files>`（この2オプションだけで手書き規約と一致＝リポ style は「prettier single-quote no-semi」と等価）。基本は手で single-quote・no-semi で書けば整形不要。既に壊したら同オプションで再整形すれば復元できる。関連＝[[project_senseki_stats_tab]]。
