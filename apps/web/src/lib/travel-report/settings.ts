import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings } from '@kagetra/shared/schema'
import { TRAVEL_REPORT_SETTING_KEYS } from '@kagetra/shared'
import { db } from '@/lib/db'

/**
 * travel-report タスク4: 遠征届設定（S4 = `/settings/travel-report`）の
 * 顧問教員3項目（所属部局等・職・氏名）の型付き get/set。
 *
 * `apps/web/src/lib/entry-form/settings.ts` と同じ `app_settings`
 * key-value の読み書き流儀を踏襲する（キーの正典は共有定数
 * `TRAVEL_REPORT_SETTING_KEYS`。接頭辞 `travel_report.` は他機能と衝突しない）。
 *
 * **初期値は空**にする（原本の顧問教員名をコードに埋め込まない。requirements
 * R11・§7）。未設定でも遠征届の作成は成功し、該当欄が空欄になるだけ（R13）。
 */
export type AdvisorField = keyof typeof TRAVEL_REPORT_SETTING_KEYS

const FIELD_BY_KEY: Record<string, AdvisorField> = Object.fromEntries(
  (Object.entries(TRAVEL_REPORT_SETTING_KEYS) as [AdvisorField, string][]).map(
    ([field, key]) => [key, field],
  ),
)

/** 遠征届設定3項目の値。未設定のフィールドは null。 */
export type TravelReportSettings = Record<AdvisorField, string | null>

/** 遠征届設定3項目を1回のクエリで読む。未設定のキーは null を返す。 */
export async function getTravelReportSettings(): Promise<TravelReportSettings> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, Object.values(TRAVEL_REPORT_SETTING_KEYS)))

  const result: TravelReportSettings = {
    advisorDepartment: null,
    advisorTitle: null,
    advisorName: null,
  }

  for (const row of rows) {
    const field = FIELD_BY_KEY[row.key]
    if (field) result[field] = row.value
  }
  return result
}

/**
 * 遠征届設定3項目を upsert する。空文字（trim 後）は「未設定」として扱い、
 * 該当キーの行を削除する（`getTravelReportSettings` が null を返すのと
 * 一貫させる。entry-form/settings.ts と同じ規律）。
 *
 * `updatedAt` は `onConflictDoUpdate` の `set` で明示的に上書きする —
 * スキーマの `defaultNow()` は INSERT 時にしか効かず、UPDATE では前回値の
 * まま残ってしまうため。
 *
 * 認可はここに入れない（`settings/travel-report/actions.ts` の Server Action
 * 側で `lib/travel-report/authz.ts` の唯一のヘルパーを通す）。
 */
export async function saveTravelReportSettings(
  values: Partial<Record<AdvisorField, string | null | undefined>>,
  updatedBy: string | null,
): Promise<void> {
  const now = new Date()
  const toUpsert: { key: string; value: string }[] = []
  const toDelete: string[] = []

  for (const field of Object.keys(TRAVEL_REPORT_SETTING_KEYS) as AdvisorField[]) {
    if (!(field in values)) continue
    const key = TRAVEL_REPORT_SETTING_KEYS[field]
    const normalized = values[field]?.trim()
    if (normalized) toUpsert.push({ key, value: normalized })
    else toDelete.push(key)
  }

  // 3項目は「遠征届設定（顧問教員）」という1つの設定なので、途中で失敗して
  // 一部だけ新しい値、という状態を残さない。
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
