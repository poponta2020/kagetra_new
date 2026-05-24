---
name: project-pwa-minimal
description: PWA 最小対応の要件定義完了状況。Issue
metadata: 
  node_type: memory
  type: project
  originSessionId: d4a500a2-0f82-4650-9613-03a4a7fbea9f
---

PWA 最小対応の要件定義 + 実装手順 + Issue 起票まで完了 (2026-05-24)。

- 親 Issue: #43 [Feature] PWA 対応（最小）
- 子 Issue:
  - #44 アイコンソース SVG + 生成スクリプト
  - #45 manifest.webmanifest 作成
  - #46 layout.tsx Metadata 追加
  - #47 ローカル動作確認（DevTools + Lighthouse）
  - #48 本番反映後 iOS/Android 実機検証（fix PR 想定）
- 要件定義: `docs/features/pwa-minimal/requirements.md`
- 実装手順: `docs/features/pwa-minimal/implementation-plan.md`

**Why:** スマホでホーム画面追加してもアドレスバー付きのブラウザ起動になっていた。最小コストで standalone 起動を実現する。

**How to apply:** `/implement pwa-minimal` で実装着手。タスク1〜4 は 1 PR、タスク5 は本番マージ後検証で詰まれば fix PR の二段構え。iOS Safari standalone での LINE OAuth は既知トラップ、Auth.js v5 cookie 設定 (`sameSite`/`secure`/`useSecureCookies`) を疑う。next-pwa は使わず Next.js 15 Metadata API + 静的アセットで完結。SW・Push は LINE 通知で代替済みなのでスコープ外。

関連: [[project_production_deploy]]（Phase D 完了済み、本番 `new.hokudaicarta.com` で実機検証可能）
