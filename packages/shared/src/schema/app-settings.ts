import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth'

/**
 * app_settings: 汎用 key-value の会定数ストア。
 *
 * entry-form-autofill で新設。最初の用途は申込書ヘッダ・申込メールに使う会の
 * 定数6項目（都道府県／所属会名／申込責任者氏名／連絡先電話／連絡先 E-Mail／
 * 振込名義人）。責任者交代を設定ハブの編集だけで完結させるため DB 化する
 * （requirements §3.2.9）。将来の会定数追加にも開放された汎用テーブル。
 *
 * キーの定義と型付き get/set は apps/web/src/lib/entry-form/settings.ts 側に
 * 持つ（このテーブルは素の key-value のまま保つ）。
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow(),
  // 監査用の最終更新者。ユーザー削除で設定値まで消えては困るので SET NULL。
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
})
