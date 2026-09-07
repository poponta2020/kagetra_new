---
name: feature-def-mail-body-link-card
description: mail-body-as-image 改修（本文リンクカード化）要件定義(2026-09-07)
type: project
---

LINE 配信のメール本文を **A4 縦 JPEG 画像 → ✉ Flex カード 1 通＋公開の全文ページ**（署名トークン 60 日・ログイン不要）へ変える改修。カードをタップすると全文をテキストで読める。URL は uri アクションに隠しトークには出さない。改修モードで既存 requirements.md を生きた仕様として上書き（slug は参照を壊さないため `mail-body-as-image` のまま）。

## 主要な設計判断（と理由）

- **公開トークン方式を採用**（会員向け `/mail/[id]` へのリンクにしない）: LINE グループには景虎にログインできない非会員が含まれる前提（既存の添付公開 URL のコメントと整合）。初版 §4.3 で見送られた `mail_body_share_tokens` をここで実装する。
- **★【訂正】はカードにだけ付け、全文ページには付けない**: `is_correction` は `event_broadcast_messages`（＝1 回の配信）の情報で、共有トークンは `mail_message_id` に 1 行しか持てない。トークン行にフラグを持たせる設計だと「通常配信 → 別イベントへ訂正再配信」で**先の配信のカードから開いたページまで【訂正】になる**。ページは件名を受信したまま出す。
- **本文テキストは LINE に一切載せない**（カードのみ）。画像化失敗時の text fallback も廃止し、URL を作れない場合は監査行 `failed` にして管理者に見せる（黙って別形式に化けさせない）。
- **本文添付 OFF のメールではカードも出さない**（管理者の「本文を流さない」判断をカード経由で覆さない）。
- **監査列は増やさない**: `body_link` → `sent_text_count`、添付 → `fallback_link_count`、`sent_image_count` は今後常に 0。デプロイ直後に旧監査行（`sent_image_count > 0`）を再送すると役割別カウント減少を検知して全件再送に倒れる＝既存ロジックのまま（AC-21 で固定）。
- **`X-Robots-Tag` / next.config `headers()` は使わない**。robots meta ＋ `force-dynamic` で AC-16 を満たす（1 ルートのために全アプリが継承する設定面を増やさない）。
- `design_required: false` — 公開ページは既存 `/mail/[id]` の意匠・部品を流用するのでデザイン工程なし。

## 触らないもの（調査済み）

`splitForLine`（`event-grade-broadcast` が使用）／`buildBroadcastBody`（未使用化するが削除は別スコープ）／`image-cache.ts`（`attachment-preview` が使用）／`/api/line-broadcast/images/[token]`（未使用化するが撤去しない。in-process キャッシュ TTL 24h なので過去配信の画像はどのみち取得不能）。`mail-body-image-render.ts` は削除する。

## AC / Issue / Wave

AC 25 件（auto-test 24 / verify 0 / manual 1 ＝ 本番 LINE グループでの実機確認）。
親 #594 ／ 子 #595（トークン基盤）#596（Flex カード）#597（配信差し替え）#598（公開ページ）。
Wave 1 = #595・#596 ／ Wave 2 = #597・#598。**#596 だけが `line-flex-attachment.ts` を編集する**（`truncateToUtf16Units` の export 追加）ので、#597 は `line-flex-mail-body.ts` から import すること。

正典 = `docs/features/mail-body-as-image/{requirements,implementation-plan}.md`（コミット 66417c1）
