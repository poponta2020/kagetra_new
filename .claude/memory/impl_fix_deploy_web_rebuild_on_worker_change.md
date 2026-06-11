---
name: impl_fix_deploy_web_rebuild_on_worker_change
description: PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 4e413d19-50b2-4f8b-a44d-50d4a61bb149
---

PR #137 merge `f6da7a1` (2026-06-11)、Issue #135 を Fixes で自動クローズ。ユーザー報告「AI再抽出を押下しても処理が走りません」の根本対応。

根本原因（コード変更なしで本番だけ壊れる型）:
- ドラフト詳細の「再抽出」(`reextractDraft` Server Action) は `@kagetra/mail-worker` の classifier/prompt を **transpilePackages で web の Next.js バンドルにビルド時に焼き込み**、web プロセス内で同期実行する
- PR #134 は `apps/mail-worker/**` + `pnpm-lock.yaml` のみの変更 → auto-deploy.sh の判定が `targets: web=0 worker=1`（デプロイログで確証）→ web 未再ビルド・未再起動
- 結果、worker timer 経路は新コード・web 内再抽出経路は旧 classifier (prompt 2.0.0 / .doc fallback なし) という**非対称**が発生。再抽出しても結果が変わらず「処理が走らない」ように見えた

修正（2 ファイル、Codex R1 pass / 28,914 tokens / effort=high）:
- WEB 判定を `^apps/(web|mail-worker)/` に拡張、`pnpm-lock.yaml` 変更は SHARED=1（依存追加はアプリのファイルを変えずにバンドルを変える）
- `apps/web/next.config.ts` の transpilePackages にデプロイ連動制約コメントを追記 — **この apps/web 配下の変更自体が今回のデプロイで WEB=1 を誘発し、マージだけで本番 web が #134 込みで再ビルドされる即時修復を兼ねる**（手動本番操作なし）

非自明ポイント:
- transpilePackages に package を追加するときは auto-deploy.sh の WEB 判定も同時に更新する（next.config.ts のコメントに明文化済み）
- deploy 修正だけの PR は `scripts/` のみ変更 = SKIPPED_NOCODE になり本番修復されない。修復を同梱するには web 配下の実ファイル（今回はコメント）を含める
- マージ直後の main push CI が Docker Hub pull timeout で flake（コード無関係）→ `gh run rerun --failed` で復旧。並行 merge の PR #136 (apps/web 変更) の deploy も同じ origin/main HEAD を deploy するため、どちらが先に green でも web は f6da7a1 で再ビルドされる収束構造だった

残 DoD: 本番デプロイログで web rebuild 確認後、[[impl_fix_doc_attachment_extraction]] の残 DoD（多摩 draft #29 再抽出 → 締切 prefill 確認 → 承認）をユーザー実機で消化する。[[project_auto_deploy]] [[feedback_ship_dod_residual_check]]
