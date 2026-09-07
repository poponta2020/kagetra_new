---
name: impl-mail-body-link-card-wave1
description: mail-body-as-image 改修 タスク1・2（トークン基盤＋Flexカード）
type: project
---

mail-body-as-image 改修（本文リンクカード化）の Wave 1 = タスク1・タスク2。どちらも main が直接実装した（タスク1 は Drizzle migration 生成を含むため規約上 main 担当、タスク2 は数ツールコールで終わる小径のため委譲しない判断）。

## タスク1: 共有トークン基盤（#595・コミット fbf0302）

- `packages/shared/src/schema/mail-body-share-tokens.ts`（新規）: `attachment_share_tokens` と同形。mail_message_id UNIQUE + FK cascade / token UNIQUE / expires_at / access_count / created_at、index 2本
- `packages/shared/drizzle/0064_mushy_cammi.sql`: drizzle-kit generate で生成（新テーブルのみ・他の差分なし）
- `apps/web/src/lib/mail-body-share.ts`（新規）: `getOrCreateMailBodyShareToken`（INSERT ... ON CONFLICT の1文で「期限内は既存 token 維持／期限切れは token・expires_at・access_count を再生成」）と `mailBodyShareUrl`（`${baseUrl}/mail-share/${token}`）。TTL 60日
- `apps/web/scripts/cleanup-expired-tokens.ts`: 両テーブルを期限+7日の猶予で削除。deletedCount は合計を返す
- docs: `docs/design/db.md` 索引 + `docs/design/db-tables-mail.md` にテーブル定義
- テスト 8件 green（発行3系統・URL形式・cleanup 3ケース）

## タスク2: 本文カードの Flex ビルダー（#596・コミット 4f529d0）

- `apps/web/src/lib/line-flex-mail-body.ts`（新規・pure）: 48px 藤バッジ(#534286 = globals.css の --kg-brand を実照合)＋白の ✉／件名 sm/bold/wrap/maxLines:3／「タップして全文を見る」／body 全体に uri アクション。altText = 📧 件名（400 UTF-16 単位でコードポイント境界切り詰め）
- `apps/web/src/lib/line-flex-attachment.ts`: `truncateToUtf16Units` / `ALT_TEXT_MAX` / 型別名 `LineFlexMessage` を export（添付カードの出力は不変）
- テスト 18件 green（本文カード8 + 添付カード既存10の回帰）

## 実装時に判明した注意点

- ★**worktree の docs/features/ が古かった**: /define-feature が main の作業ディレクトリで作った改修版（コミット 66417c1）は **origin/main に push されていなかった**ため、origin/main から切った worktree には初版（本文画像化）の requirements/implementation-plan が入っていた。気づかず読むと丸ごと別機能を実装する。worktree 作成直後にメインからコピーしてコミット（99aa9dd）した
- `--kg-brand` は globals.css で #534286（藤）。Flex JSON は CSS 変数を持てないのでリテラル固定
- test DB は worktree ごとに自動導出されるが、`.env.local`（apps/web）とルート `.env` のコピー + `corepack pnpm install` が worktree 側に必要
