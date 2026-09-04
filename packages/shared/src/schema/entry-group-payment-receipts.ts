import { customType, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { entryGroupPaymentReports } from './entry-group-payment-reports'

/**
 * PostgreSQL `bytea` ↔ Node `Buffer`. `mail-attachments.ts` の同名 customType と
 * 同じ実装（Drizzle 0.45.x に組み込みの bytea ヘルパーが無いため、table-create 時に
 * 正しい SQL 型を吐かせるためだけに置いている）。
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * entry_group_payment_receipts: 証憑画像 **1 枚 = 1 行**（payment-receipt-broadcast §3.2.2）。
 *
 * 支払報告に添えた振込明細の写真。**正規化後の JPEG だけを保存する** —— 受け取った
 * 原本（PNG・巨大な JPEG）はサーバー側で `.rotate()` → 4096px 以内へ縮小 → JPEG 化した
 * 結果に置き換わる。LINE の画像メッセージが JPEG しか受け付けないため、原本を持っても
 * 送信には使えない。
 *
 * ★`image-cache.ts`（プロセス内 Map・TTL 24h）は使わない。証憑は**記録として永続保存**
 * する対象で、プロセス再起動で消えてよいものではない（要件 §6）。
 *
 * ★`token` は LINE の画像フェッチャが Cookie 無しで取りに来る公開 URL の鍵。
 * `attachment_share_tokens` は `mail_attachment_id NOT NULL UNIQUE` の FK なので
 * 証憑には流用できず（要件 §6）、この表が自前で持つ。
 */
export const entryGroupPaymentReceipts = pgTable(
  'entry_group_payment_receipts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    reportId: integer('report_id')
      .notNull()
      .references(() => entryGroupPaymentReports.id, { onDelete: 'cascade' }),
    // 1 報告内の並び順（0 始まり）。送信順・履歴のサムネ順をこの順で固定する。
    sortOrder: integer('sort_order').notNull().default(0),
    // アップロード時のファイル名（表示用。拡張子は正規化前のものが残りうる）。
    filename: text('filename').notNull(),
    // 正規化後なので実質 `image/jpeg` 固定。将来の形式追加に備えて列は持つ。
    contentType: text('content_type').notNull(),
    data: bytea('data').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    // LINE の `previewImageUrl`（1MB 以内）と履歴のサムネ表示に使う縮小版。
    previewData: bytea('preview_data').notNull(),
    // 公開取得 URL の鍵。`randomBytes(24).toString('base64url')` 相当の推測不能な値。
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('entry_group_payment_receipts_token_unique').on(t.token),
    index('entry_group_payment_receipts_report_idx').on(t.reportId),
  ],
)
