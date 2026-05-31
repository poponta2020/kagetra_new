---
name: feedback-libreoffice-ja-fonts
description: PDF/Word を画像化する本番ホストは fonts-noto-cjk を必ずインストール。さもないと日本語が□に化ける
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bdf544e9-cf0c-4681-90d4-e0b0d2b2c4aa
---

# 本番ホストに Noto CJK 必須 (PDF/Word 画像化系)

`poppler-utils` (pdftoppm) + `libreoffice` で PDF/Word を JPEG 化する場合、本番ホストに日本語フォントが入っていないと LibreOffice がフォールバックで全文字を □ に置き換える。

## インストール

```bash
sudo apt-get install -y fonts-noto-cjk fonts-noto-cjk-extra fonts-ipafont
fc-list :lang=ja | wc -l   # 0 ではなく 86+ になっていれば OK
```

**Why:** Ubuntu 22.04 server 標準では日本語フォントが入っていない (`fc-list :lang=ja` が 0 件)。LibreOffice の PDF コンバータは Noto CJK / IPA があれば自動採用、無いと白塗りや □ になる。本番運用で初めての日本語 PDF/Word 添付で発覚する罠 (2026-05-31 セッション3 で実例)。

**How to apply:** `docs/deploy/event-line-broadcast.md` §1 と同じタイミング (poppler-utils + libreoffice インストール時) に必ず追加。新しい LibreOffice/pdftoppm を使うサービスをデプロイするたびにチェック。

## 関連
- [[project-event-line-broadcast-deploy]] — 2026-05-31 本番デプロイで発覚・修正
