---
name: impl-fix-attachment-inapp-viewer
description: PR #146 添付アプリ内ビューア (ページ画像化 + ✕で戻る) SHIPPED — 残DoD=実機確認のみ
metadata:
  node_type: memory
  type: project
  originSessionId: fd653184-a471-4645-a085-f6a7250741d9
---

PR #146 merge `c99b2ea` (2026-06-12、/quickfix 起点・Issue なし)。添付チップの遷移先をバイナリルート直リンクからアプリ内ビューア `/admin/mail-inbox/attachments/[id]` に変更し、ヘッダの ✕ で元画面に戻れるようにした。[[impl_fix_mail_attachment_pwa_inline]] (PR #139) で QuickLook 表示は開けるようになったが戻る UI がなかった問題への対応。

非自明ポイント:
- PDF/Office は web プロセス内で libreoffice→pdftoppm のページ JPEG 化 ([[impl_mail_body_as_image]] のパイプライン流用、`apps/web/src/lib/attachment-preview.ts` 新設)。ページは image-cache (`attpv:` キー) + in-flight dedup (globalThis pin) + 30 ページ cap
- `runLibreofficeConvertToPdf` に `forceWriter` オプション追加 — `--writer` 固定は HTML 本文専用 (issue #93 の空白ページ回避)。Office 添付は auto-detect に倒す (xlsx/pptx を Writer で開くと壊れるため)。既定 true なので既存呼び出しは不変
- preview 配信ルート `/api/admin/mail/attachments/[id]/preview/[page]` はキャッシュヒット時も id-only 投影で行存在確認 (codex R1 blocker: 添付削除後の stale 配信防止)
- ✕ の戻り先はチップ (`AttachmentList` の `from` prop) が `?from=` で明示し、ビューア側は `/admin/mail-inbox` prefix のみ許可して `Link replace`。`window.history.length` 推測は deep link で誤動作する (codex R1 should_fix)
- バイナリルート (PR #139 の fail-closed inline allowlist) は無変更 — 画像 kind の直 `<img>` と「元ファイル」リンクが使用継続。LINE 公開 token ルートも無関係
- /auto-review-loop: 2R (high→high、規模トリガ)、tokens 110,541/500k、R2 pass
- **残 DoD: 本番反映後、iPhone 実機 PWA で .doc/PDF チップ → ページ画像ビューア表示 → ✕ で元画面復帰を確認**（多摩 draft #29 の既存残 DoD と同一画面で消化可能）

関連: [[feedback-ios-pwa-inscope-doc-preview]] [[feedback-ios-pwa-attachment-disposition]]
