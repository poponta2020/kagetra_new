---
name: ship-mail-body-link-card
description: メール本文の LINE 配信を画像から Flex カード＋公開全文ページへ
type: project
---

**shipped: PR #604**（https://github.com/poponta2020/kagetra_new/pull/604 ・2026-09-07 マージ済み）

LINE 配信のメール本文を **A4 縦 JPEG 画像 → ✉ Flex カード 1 通＋公開の全文ページ `/mail-share/[token]`**（署名トークン60日・ログイン不要）へ全面変更。親 Issue #594／子 #595-#598 はすべてクローズ済み。

## 出荷内容

- `mail_body_share_tokens`（migration **0065**）＋ `mail-body-share.ts`（60日 TTL・期限内再利用・cleanup 対応）
- `line-flex-mail-body.ts`: 48px 藤バッジ（#534286）＋✉＋件名（**200字で切り詰め**・maxLines 3）＋「タップして全文を見る」。altText = 📧 件名（400）
- `line-broadcast.ts`: MessageRole を lead_text/body_link/attachment_link へ。本文カード1通を push し、画像化・text fallback は撤去（`mail-body-image-render.ts` 削除）。監査は sent_text_count に計上・sent_image_count は常に0（AC-21 の layoutShrunk 比較のみ 0 固定で残す）
- `app/mail-share/[token]/page.tsx`（(app) の外・force-dynamic・robots noindex・エラーは全て同一案内）＋ middleware matcher に `mail-share/` 追加

## レビュー（auto-review-loop）

3ラウンド（initial sol/high → delta terra/high → final sol/medium）・累計 574,501 トークン・最終 verdict=pass。
- R1 blocker 2件 → **1件修正**（長い件名で Flex bubble が LINE の 30KB 上限超過 → 見出し200字切り詰め）／**1件 WONTFIX**（期限切れトークン更新後の partial 再送で新カードがスキップ。紐付けが開催日+30日で自動解放されるため実運用で到達しない — ユーザー判断）
- final の **nit 1件（baseUrl 既定値コメントの記述ずれ）は修正のみで再レビューなし**（3-d の nits-only 打ち切り）。CI が赤くなった場合の手がかり
- 出荷中に main が2回進み、**migration 0064 が travel-report と衝突 → 0065 へ採番し直し**、その後 INDEX.md も再マージした

## 残 DoD（出荷後に確認が必要）

- **AC-25（本番実機）**: LINE グループで本文カードが届き、タップで全文ページが開いて本文が読めること
- **AC-16 / AC-13 の実挙動未確認**: `Cache-Control: no-store` の実ヘッダと「未ログインで 200」は RSC 単体テストでは観測できていない（コード上は force-dynamic ＋ matcher 除外を確認済み）
- 本番 `.env.production` の `PUBLIC_BASE_URL`（既存前提。未設定だと配信が failed になる）
- CI は pending のままマージ（v0.9.0 方針）。赤なら /quickfix で追修正
