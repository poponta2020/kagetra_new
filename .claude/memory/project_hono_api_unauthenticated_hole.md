---
name: project_hono_api_unauthenticated_hole
description: 本番の Hono API /hono-api/* が完全無認証で LINE ログインを迂回できる重大な穴（未修正）
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

**How to apply:** 修正方針の候補 = ①最短: nginx から `/hono-api/` location を削除 + `kagetra-api.service` を stop/disable（フロント未使用なので影響なし）。②筋: Hono に Auth.js JWT を検証する認証ミドルウェアを追加してから CRUD を role ゲート。どちらか要決定。関連 [[project_self_identify_verification_pending]]（self-identify は本人性検証なし＝別軸の受容リスク）。
