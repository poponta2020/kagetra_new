---
name: feedback_libreoffice_writer_blank_page
description: libreoffice の HTML→PDF 変換は --writer 必須。無いと先頭に真っ白な空白ページが入る
metadata:
  type: feedback
---

`libreoffice --headless --convert-to pdf foo.html` で HTML を PDF 化すると、**先頭に真っ白な 1 ページが挿入され本文が 2 ページ目から**始まる（LibreOffice の既知バグ。HTML が既定で「Web レイアウト」で開かれるため）。`--writer` を付けて Writer 文書として開かせると回避できる: `libreoffice --headless --writer --convert-to pdf foo.html`。

**Why:** kagetra のメール本文画像化 (`renderBodyImageToJpegs` → `runLibreofficeConvertToPdf` in `apps/web/src/lib/attachment-image-render.ts`) で、`renderPdfToJpegs` が空白ページもそのまま JPEG 化し、LINE に 1 枚目が真っ白な画像が届いた（Issue #93 / PR #94 merge `c6a4be6`）。`--writer` は docx/odt 等のテキスト文書にも正しい（spreadsheet/presentation には付けない）。etherpad-lite も同症状を同じ方法で修正している。

**How to apply:** HTML を libreoffice で PDF 化する箇所では必ず `--writer` を入れる。リグレッションは「短い本文/HTML → ちょうど 1 ページ」を assert する統合テストで防ぐ（空白ページが復活すると 2 ページになって落ちる）。ローカル Windows は libreoffice 無しで再現不可なので CI(Linux) で実描画検証する。関連: [[feedback_libreoffice_ja_fonts]]（本番 Noto CJK 必須）、[[impl_mail_body_as_image]]
