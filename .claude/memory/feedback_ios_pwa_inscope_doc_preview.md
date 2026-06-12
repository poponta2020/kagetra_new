---
name: feedback-ios-pwa-inscope-doc-preview
description: iOS standalone PWA は in-scope URL から脱出不可 (overlay なし)・iframe PDF は1ページ目のみ → 文書プレビューはサーバーでページ画像化一択
metadata:
  node_type: memory
  type: feedback
  originSessionId: fd653184-a471-4645-a085-f6a7250741d9
---

iOS ホーム画面 PWA (standalone) でドキュメントを開かせる UI の制約 2 つ (2026-06-12, PR #146 で確定):

1. **manifest scope 内 (same-origin) の URL は `target="_blank"` を付けても同一 WebView を直接遷移する**。「完了」ボタン付き in-app browser overlay が出るのは out-of-scope / cross-origin のときだけ。QuickLook 表示に遷移してしまうと戻る UI がゼロでアプリ再起動しかない。[[feedback-ios-pwa-attachment-disposition]] (PR #139) の「overlay」記述は cross-origin の話で、same-origin には適用されない — #138 の白画面も同一 WebView 遷移だった
2. **iframe / embed / object 内の PDF は iOS Safari が1ページ目しか描画しない**（古くからの WebKit 制限、CSS では回避不能）。Office 文書の subframe QuickLook も期待できない

**Why:** この2つで「ブラウザ任せの添付プレビュー + 戻るボタン」という構成は全滅する。target=_blank も iframe ビューアも iOS PWA では機能しない。

**How to apply:** アプリ内に戻る UI を持つ文書プレビューは「サーバーで libreoffice+pdftoppm によりページ JPEG 化して `<img>` 縦積み + 自前 sticky ヘッダ」で作る。[[impl-fix-attachment-inapp-viewer]] の `attachment-preview.ts` が実装例（image-cache 格納・in-flight dedup・キャッシュヒット時も行存在確認）。
