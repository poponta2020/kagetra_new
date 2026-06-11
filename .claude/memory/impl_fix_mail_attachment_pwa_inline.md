---
name: impl-fix-mail-attachment-pwa-inline
description: PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 8960db3b-571a-484e-b095-af4e6a2d3b00
---

**PR #139 merge `d84ae90` (2026-06-11)、Issue #138 クローズ。** mail-inbox の添付チップが iPhone ホーム画面 PWA で開けない（白画面死）バグの修正。

- 原因: `/api/admin/mail/attachments/[id]` が PDF のみ inline、他は attachment+octet-stream → iOS standalone PWA の in-app ブラウザがダウンロード処理不能（[[feedback-ios-pwa-attachment-disposition]]）
- 最終形: **fail-closed allowlist 拡張** — PDF / Office 文書 (msword, openxmlformats 系, ms-excel, ms-powerpoint) / ラスタ画像 (jpeg/png/gif/webp/heic/heif) / text (plain/csv) を実 MIME + inline、それ以外（html/svg/`*+xml`/js/zip/不正値）は octet-stream + attachment
- 経緯が非自明: 初版 blocklist+inline → Codex R1「`*+xml` すり抜け」→ R2「blocklist 自体が fail-open、allowlist 回帰せよ」で設計転換。3R で pass、tokens 104k
- 公開側 `/api/line-broadcast/attachments/[token]` は触っていない（非認証なので attachment 固定が正、PR #70 決定維持）
- route.test.ts 31 ケース。応答 Content-Type は allowlist 定数 or octet-stream のみ＝stored 値不エコーでヘッダ注入構造的不可
- **残 DoD: 本番 auto-deploy 反映後、iPhone PWA で多摩大会 .doc 添付チップ → QuickLook プレビュー実機確認**（多摩 draft #29 再抽出→承認の残 DoD と同時に実施可能）
