import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import type { HeaderField } from './cell-map'

/**
 * entry-form-autofill タスク6: 「会の定数（申込書設定）」の型付き get/set。
 *
 * `app_settings` は素の key-value テーブル（他機能とも共有し得る）。ここでは
 * `HeaderField`（cell-map.ts が定義する申込書ヘッダ欄の6項目）と1対1対応する
 * DB キーの集合を定義し、その範囲だけを読み書きするビューを提供する。
 *
 * キー命名規則: 他機能とキーが衝突しないよう `entry_form.` を接頭辞に付け、
 * 残りは snake_case で続ける（例: `entry_form.club_name`）。将来この機能の
 * 定数を追加する場合も同じ接頭辞を踏襲すること。
 */
const SETTINGS_KEYS: Record<HeaderField, string> = {
  prefecture: 'entry_form.prefecture',
  clubName: 'entry_form.club_name',
  managerName: 'entry_form.manager_name',
  phone: 'entry_form.phone',
  email: 'entry_form.email',
  transferName: 'entry_form.transfer_name',
}

const FIELD_BY_KEY: Record<string, HeaderField> = Object.fromEntries(
  (Object.entries(SETTINGS_KEYS) as [HeaderField, string][]).map(([field, key]) => [key, field]),
)

/** 申込書設定6項目の値。未設定のフィールドは null。 */
export type EntryFormSettings = Record<HeaderField, string | null>

/** 申込書設定6項目を1回のクエリで読む。未設定のキーは null を返す。 */
export async function getEntryFormSettings(): Promise<EntryFormSettings> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(SETTINGS_KEYS)))

  const result = {
    prefecture: null,
    clubName: null,
    managerName: null,
    phone: null,
    email: null,
    transferName: null,
  } as EntryFormSettings

  for (const row of rows) {
    const field = FIELD_BY_KEY[row.key]
    if (field) result[field] = row.value
  }
  return result
}

/**
 * 申込書設定6項目を upsert する。空文字（trim 後）は「未設定」として扱い、
 * 該当キーの行を削除する（`getEntryFormSettings` が null を返すのと一貫させる。
 * 値なし行を残さない方が「未設定」の意味が空文字と二重化せず単純になる）。
 *
 * `updatedAt` は `onConflictDoUpdate` の `set` で明示的に上書きする — スキーマの
 * `defaultNow()` は INSERT 時にしか効かず、UPDATE では前回値のまま残ってしまうため。
 */
export async function saveEntryFormSettings(
  values: Partial<Record<HeaderField, string | null | undefined>>,
  updatedBy: string | null,
): Promise<void> {
  const now = new Date()
  const toUpsert: { key: string; value: string }[] = []
  const toDelete: string[] = []

  for (const field of Object.keys(SETTINGS_KEYS) as HeaderField[]) {
    if (!(field in values)) continue
    const key = SETTINGS_KEYS[field]
    const normalized = values[field]?.trim()
    if (normalized) toUpsert.push({ key, value: normalized })
    else toDelete.push(key)
  }

  // 6項目は「申込書ヘッダ」「メールの差出人・署名」という1つの設定なので、
  // 途中で失敗して一部だけ新しい値、という状態を残さない。
  await db.transaction(async (tx) => {
    for (const { key, value } of toUpsert) {
      await tx
        .insert(appSettings)
        .values({ key, value, updatedBy, updatedAt: now })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updatedBy, updatedAt: now },
        })
    }
    if (toDelete.length > 0) {
      await tx.delete(appSettings).where(inArray(appSettings.key, toDelete))
    }
  })
}
