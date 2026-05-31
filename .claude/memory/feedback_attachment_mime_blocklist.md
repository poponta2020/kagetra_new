---
name: feedback-attachment-mime-blocklist
description: 公開添付 route の MIME ポリシーは allowlist (inline 許可) ではなく blocklist (危険 MIME のみ octet-stream) + attachment 固定が正解
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bdf544e9-cf0c-4681-90d4-e0b0d2b2c4aa
---

# 公開添付 route の MIME 設計は blocklist + attachment 固定

untrusted な mail 添付を公開ダウンロード URL で配信するとき:

## NG: allowlist 方式 (inline 許可リスト)
- PDF のみ inline 許可、それ以外を全部 `application/octet-stream` + `attachment`
- XSS 防御としては効くが、**LINE モバイル内蔵ブラウザが xlsx/docx を helper apps で開けず白画面**になる副作用

## OK: blocklist + attachment 固定方式
1. `Content-Disposition: attachment` を **常に固定** (inline 表示完全禁止) → 同一オリジン XSS の窓を完全に閉じる
2. 危険 MIME (`text/html`, `image/svg+xml`, `application/xhtml+xml`, `text/xml`, `application/xml`, `javascript`) のみ `application/octet-stream` に書き換え
3. それ以外は元 MIME を保持 → LINE 内ブラウザや OS の関連付け (Excel.app / Numbers / Adobe Reader) が正しく動作
4. RFC 6838 token grammar (`/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i`) で不正トークン (制御文字/空白/カンマ等) を弾く。さもないと `new NextResponse(..., { headers })` が例外で 500
5. `X-Content-Type-Options: nosniff` 常時付与

## Why
**inline 禁止だけで XSS は防げる** (ブラウザはダウンロード扱いでスクリプト実行しない)。Content-Type を全部 octet-stream にするのは過剰防衛で、副作用 (Mobile app での開けない問題) を発生させる。三重防御 (attachment 固定 + 危険 MIME blocklist + token 検証) が最適バランス。

## How to apply
- 同様の公開添付 route を新規実装するときは初手からこの方針
- 既存の admin 添付 route (`apps/web/src/app/api/admin/mail/attachments/[id]/route.ts`) は allowlist 方式のままだが、admin 限定アクセスなのでリスクは低い。次回触る機会に統一する

## 関連
- PR #65 R16 で allowlist 導入 → PR #70 で blocklist に転換 (2026-05-31)
- 実装: apps/web/src/app/api/line-broadcast/attachments/[token]/route.ts
