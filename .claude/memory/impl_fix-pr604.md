---
name: fix-pr604
description: fix PR #604
type: project
---

PR #604（feature/mail-body-as-image・本文リンクカード化）の R1 レビュー指摘への対応。

## 対応した指摘（CRITICAL）

- **長い件名で Flex bubble が LINE の 30KB 上限を超える** → `line-flex-mail-body.ts` にカード見出しの上限 `CARD_TITLE_MAX = 200` を追加し、コードポイント境界で切り詰め（コミット 5a1f859）。altText は従来どおり 400 まで（見出しの切り詰めに引きずらせない）。回帰テスト 2件（10万文字の件名で見出し200字・bubble < 30KB・altText 400／見出し切り詰めもサロゲートペア非分断）
  - ★学び: `maxLines: 3` は**表示行数を絞るだけで送信 JSON のサイズを減らさない**。外部由来の可変長テキストを Flex に載せるときは、表示制限とペイロード制限を別に掛ける必要がある

## 対応しなかった指摘

- **[WONTFIX] 期限切れトークンを更新した部分再送で新しい本文カードがスキップされる**（ユーザー判断 2026-09-07）: 「本文カード成功・添付失敗の partial」→「60日以上あけて再送」→「その間 LINE 紐付けが生きている」の3条件が要る。紐付けは開催日+30日で自動解放される（release-expired-broadcasts.ts）ため実運用では到達しない。以降のレビューでも再掲させない

## 補足（同 PR で解消した別件）

travel-report（PR #592）が先に main へ 0064 を入れたため、本 PR の migration を **0065** へ採番し直した（e7b43cc）。drizzle の meta は main 側を採用し、`drizzle-kit generate` で再生成（内容は mail_body_share_tokens の作成のみで不変）。
