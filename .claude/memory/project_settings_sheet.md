---
name: project-settings-sheet
description: 設定画面への導線（ヘッダ→設定シート）SHIPPED。設定にどこから行けるか／なぜ /settings/notifications を (app) 配下へ移したかの記録
metadata: 
  node_type: memory
  type: project
  originSessionId: a88f4a5d-b431-4a63-9e51-2e4f7e82cc4a
---

settings-sheet **SHIPPED** — PR #110 merge `4857787`（2026-06-03）、親 Issue #97 + 子 #98-#101 全クローズ。

**経緯**: design.md §3 に「設定は `{name}さん` をタップしてシート」と明記されていたが**未実装**で、設定ページ2つ（`/settings/notifications`=Web Push購読 / `/settings/line-link`=LINE連携）が UI 上どこからもリンクされず **URL 直打ちのみ到達可能な孤立ページ**だった。特に shipped 済み mail-triage-badge の Web Push 購読ページが到達不能で機能が活きていなかった（ユーザー指摘「設定画面への導線あります？」起点）。

**導線の在り処（重要・将来の参照用）**: ヘッダ右の `{name}さん`（`apps/web/src/components/layout/app-bar-main.tsx`）をタップ → `AccountMenu`（`apps/web/src/components/layout/account-menu.tsx`）のボトムシートが開く。シート内は**ロール出し分け**:
- メール通知（admin/vice_admin のみ）→ `/settings/notifications`
- LINE アカウント切替（全員）→ `/settings/line-link`
- ログアウト（ヘッダ独立ボタンを廃しシート内へ集約）

新タブ追加・歯車アイコンは採らない（design.md「タブ4個固定、5個以上にしない」準拠）。

**非自明な設計判断**:
- `/settings/notifications` は `app/(app)/settings/notifications/` に置く（アプリシェル＝上バー＋ボトムナビ＝戻る導線あり）。route group は URL に影響せず **URL 不変・認可不変**（ページ側 /403 ゲート＋シート側ロール出し分けの二重）。
- `/settings/line-link` は独自の全画面センタリングフロー＋戻るリンクを持つ自己完結ページなので `app/settings/line-link/`（シェル外）に**据え置き**。設定が app/ 配下で2箇所に分かれるのは意図的。
- シートは手書きボトムシート（Radix/shadcn 未導入。InviteCodeModal/ManualLinkModal と同一パターン、新規依存なし）。iOS セーフエリアは `pb-[calc(1rem_+_env(safe-area-inset-bottom))]`（[[feedback-tailwind-arbitrary-underscore-space]]）。AppBar は server component のまま signOut Server Action を client の AccountMenu へ透過。

**残 DoD**: スマホ実機目視のみ（シート開閉・セーフエリア・遷移）。本番反映は [[project-auto-deploy]] に委ねる（migration なし＝build+restart のみ）。
