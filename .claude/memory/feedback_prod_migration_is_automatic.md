---
name: prod-migration-is-automatic
description: 本番migrationはdeployジョブが自動適用
type: feedback
---

本番 migration は **CI の deploy ジョブが自動適用**する。手で `pnpm db:migrate` を流さない。

- `.github/workflows/ci.yml` の `deploy` job（main への push のみ・`needs: [ci]`）が SSH で `scripts/deploy/auto-deploy.sh` を本番へ流し込む
- auto-deploy.sh は `CHANGED=$(git diff --name-only OLD NEW)` に `packages/shared/drizzle/[0-9]*.sql` があるときだけ `apply-migrations.sh` を **restart 前に**実行する（新コードが新 schema に出会える順序。失敗時は restart せず中断＝旧コード+旧 schema で整合）
- `apply-migrations.sh` は **psql 直実行 + journal(hash) 照合で冪等**。★冒頭に「drizzle-kit migrate は TTY 必須で本番不適（Phase A Discovery 結果）」と明記されている
- したがって **`pnpm db:migrate` は本番向けではない**。ローカルの `.env`（localhost:5433）に当たるだけ

**★CI が cancelled になると deploy も走らない**（deploy は `needs: [ci]`）。main へ連続 push すると先行 run が cancel され、その push に含まれる migration は適用されないまま残る。**マージ直後に別の push を重ねたときは、最後に成功した run が対象 migration を含むかを `gh run list --branch main` の conclusion=success と `git diff <その sha>..origin/main` で必ず確認する**（CHANGED は「本番サーバの HEAD」と origin/main の差分なので、後続 run が拾い直してくれることが多いが、cancel が続くと取り残される）

ローカル開発 DB（docker `kagetra-db`・:5433）は 2026-09 時点で **テーブル14個・journal が migration 3 まで**という古い状態。dev で最新 schema が要るときは migrate を流さず作り直すか push する（migrate だと 60本以上を順に流すことになる）
