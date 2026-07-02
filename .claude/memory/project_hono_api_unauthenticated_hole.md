---
name: project_hono_api_unauthenticated_hole
description: 本番の Hono API /hono-api/events が完全無認証で LINE ログインを迂回できた穴。PR#252 で events ルート撤去＝修正済み（/events は 404、/health のみ残す）
metadata: 
  node_type: memory
  type: project
  originSessionId: 37f16ee5-f2cc-431e-a771-315a0d93792d
---

**Why:** 「登録した LINE アカウントでしかログインできない」設計の唯一の実質的な穴。2026-07-02 の認証設計監査で発見。

apps/api (Hono) は `apps/api/src/app.ts` に logger と cors しか噛ませておらず**認証ミドルウェアが一切ない**（コメントで「Phase 1-V で再実装」と自認）。`routes/events.ts` は GET/POST/PUT/DELETE のフル CRUD。nginx (`docker/nginx/kagetra.conf.example`) が `/hono-api/*` を **Next.js middleware を経由せず** 直接 port 3001 に proxy_pass するため、`src/middleware.ts` の LINE ゲートが一切効かない。`kagetra-api.service` は本番で enable 済み・稼働（worklog に `/hono-api/health` = ok の検証ログ複数、sudoers 登録済み）。

結果: `https://new.hokudaicarta.com/hono-api/events` を誰でも無認証で GET（全イベント漏洩）/POST/PUT/DELETE（改竄・削除）できる。CORS は origin 制限しているがブラウザ限定の防御で curl 等の直接リクエストには無力。

`apiClient` (apps/web/src/lib/api.ts) は定義のみでフロントからは未使用＝この API はフロントに使われていない死にコードだが、公開はされている。

Web 側（Auth.js / middleware / self-identify / register / Server Actions / admin route / token route）は堅牢で穴なし。

**修正済み（2026-07-02・PR#252 merge `2fceb79`）:** 最短方針で解決。app.ts から `/events` ルート撤去＋`routes/events.ts` 削除し、Hono は `/health` のみ公開に縮小。フロント未使用（apiClient 呼び出し元ゼロ）なので web 影響なし。auto-deploy が `apps/api` 変更を検知して `kagetra-api` を再ビルド・再起動。**本番 read-back 済み: `/hono-api/health`=200 / `/hono-api/events`=404**。api/web 型チェック緑・CI 緑。今後 Hono にルートを再追加する場合は Auth.js JWT 検証ミドルウェア＋role ゲートを先に噛ませること（nginx が middleware を迂回する構造は不変）。

関連 [[project_self_identify_verification_pending]]（self-identify は本人性検証なし＝別軸の受容リスク・今回は未対応の設計判断）。
