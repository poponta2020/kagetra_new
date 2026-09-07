'use server'

import { z } from 'zod'
import { and, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { events, travelReportBatches } from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'
import {
  createTravelReports,
  loadActiveEventDates,
  loadTravelReportDefaultsForSplit,
  type TravelReportFileDefaults,
  type TravelReportFileInput,
} from '@/lib/travel-report/create'
import { sendTravelReportCreatedNotice } from '@/lib/travel-report/notify'
import { requireTravelReportRequired } from '@/lib/travel-report/targets'
import { isValidCalendarDate } from '@/lib/travel-report/units'

/**
 * S6「遠征届 作成画面」の Server Action（requirements R9・AC-20〜28）。
 *
 * ★通知は**作成物を保存したあと**に送る。通知が失敗しても documents は保存済みのまま
 * で、失敗理由を `travel_report_batches.notify_error` に残す（R13・AC-28）。
 */

/** 通知エラーの記録が長すぎないよう切り詰める上限（`entry-overdue-alert.ts` 等と同じ流儀）。 */
const NOTIFY_ERROR_MAX_LENGTH = 200

const contactSchema = z.object({
  name: z.string().trim().max(60),
  phone: z.string().trim().max(40).nullable(),
})

const dateStringSchema = (invalidFormatMessage: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, invalidFormatMessage)
    .refine(isValidCalendarDate, '実在する日付を入力してください')

const fileSchema = z.object({
  dates: z.array(dateStringSchema('日付の形式が不正です')).min(1, 'ファイルに含める日がありません'),
  purpose: z.string().trim().max(200),
  place: z.string().trim().max(200),
  destinationContacts: z.array(contactSchema).max(4),
  homeContact: contactSchema.nullable(),
  reportDate: dateStringSchema('届の日付の形式が不正です'),
  approvalDate: dateStringSchema('承認日の形式が不正です').nullable(),
})

const inputSchema = z
  .array(fileSchema)
  .min(1, '作成するファイルがありません')
  .max(12, 'ファイルが多すぎます')

export interface CreateTravelReportsResultView {
  ok: boolean
  /** 生成したファイル数。 */
  fileCount?: number
  /** 通知が失敗したときの理由（作成自体は成功している）。 */
  notifyError?: string
  error?: string
}

/**
 * 遠征届を作成する。**提出権限者のみ**（AC-21）。
 * ファイル分割・各ファイルの届の内容は S6 で確定した値をそのまま受け取る。
 */
export async function createTravelReportsAction(
  entryGroupId: number,
  files: TravelReportFileInput[],
): Promise<CreateTravelReportsResultView> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: 'ログインが必要です' }
  if (!(await isTravelReportSubmitter(session))) {
    return { ok: false, error: 'この操作を行う権限がありません' }
  }

  const parsed = inputSchema.safeParse(files)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力が不正です' }
  }

  try {
    await requireTravelReportRequired(entryGroupId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '入力が不正です' }
  }

  // ★同じ日が複数のファイルに入っていたら拒否する（統合・分割の操作ミスで
  // 同じ人が2枚に載るのを防ぐ）。
  const seen = new Set<string>()
  for (const file of parsed.data) {
    for (const date of file.dates) {
      if (seen.has(date)) return { ok: false, error: '同じ日が複数のファイルに入っています' }
      seen.add(date)
    }
  }

  // ★送られた日付集合が、現在の非 cancelled 開催日と過不足なく一致する
  // （重複なしの完全な分割である）ことを検証する（Codex R1 #7）。未知の日・
  // cancelled の日・一部欠落はいずれもここで拒否する（重複は上で拒否済み）。
  const currentEventDateRows = await db
    .select({ eventDate: events.eventDate })
    .from(events)
    .where(and(eq(events.entryGroupId, entryGroupId), ne(events.status, 'cancelled')))
  const currentDates = new Set(currentEventDateRows.map((r) => r.eventDate))
  const isExactMatch = seen.size === currentDates.size && [...seen].every((d) => currentDates.has(d))
  if (!isExactMatch) {
    return { ok: false, error: '選択した日付が現在の開催日と一致しません' }
  }

  let result: Awaited<ReturnType<typeof createTravelReports>>
  try {
    result = await createTravelReports(entryGroupId, parsed.data, session.user.id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '遠征届の作成に失敗しました' }
  }

  // 作成物は保存済み。ここから先の失敗は作成の失敗ではない
  // （Codex R1 #9: 通知処理の例外で Action 全体を reject させない。文書は
  // コミット済みなので、ここで reject すると利用者の再実行で重複作成が起きる）。
  let notifyError: string | undefined
  try {
    const notify = await sendTravelReportCreatedNotice({
      entryGroupId,
      fileCount: result.documents.length,
      tournamentName: result.tournamentName,
    })
    if (notify.outcome === 'sent') {
      await db
        .update(travelReportBatches)
        .set({ notifiedAt: new Date(), notifyError: null })
        .where(eq(travelReportBatches.id, result.batchId))
    } else if (notify.outcome === 'failed') {
      notifyError = notify.error
      await db
        .update(travelReportBatches)
        .set({ notifyError: notify.error })
        .where(eq(travelReportBatches.id, result.batchId))
    }
    // skipped_unlinked（LINE 未紐付け）は失敗ではないので記録しない。
  } catch (e) {
    notifyError = (e instanceof Error ? e.message : '通知処理に失敗しました').slice(
      0,
      NOTIFY_ERROR_MAX_LENGTH,
    )
    try {
      await db
        .update(travelReportBatches)
        .set({ notifyError })
        .where(eq(travelReportBatches.id, result.batchId))
    } catch {
      // 記録自体の失敗も握りつぶす（作成は既に成功しているため）。
    }
  }

  revalidatePath(`/admin/entries/${entryGroupId}`)
  return {
    ok: true,
    fileCount: result.documents.length,
    notifyError,
  }
}

/**
 * S6 でファイル分割を変えたときに、**サーバー側の同じ既定値ロジック**から
 * 目的・場所・連絡者・期間・人数・備考行数・未入力者を取り直す（Codex R1 #9）。
 *
 * ★画面側で分割だけ変えて古い既定値を送ると、2単位を統合したファイルが
 * 「(AB級)への参加」のまま D/E 級の日を含む届になる。目的と場所は docx に入るので、
 * 表示と生成結果が一致しなくなる。分割操作のたびにここを呼び直す。
 *
 * ユーザーが手で直した項目を維持するのは**画面側の責務**（この関数は常に既定値を返す）。
 */
export async function reloadTravelReportDefaultsAction(
  entryGroupId: number,
  split: string[][],
): Promise<{ ok: true; files: TravelReportFileDefaults[] } | { ok: false; error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: 'ログインが必要です' }
  if (!(await isTravelReportSubmitter(session))) {
    return { ok: false, error: 'この操作を行う権限がありません' }
  }

  const parsed = z
    .array(z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidCalendarDate)).min(1))
    .min(1)
    .max(12)
    .safeParse(split)
  if (!parsed.success) return { ok: false, error: 'ファイル分割の指定が不正です' }

  // 作成 Action と同じ検証（現在の非 cancelled 開催日の重複なしの完全な分割）。
  const seen = new Set<string>()
  for (const dates of parsed.data) {
    for (const date of dates) {
      if (seen.has(date)) return { ok: false, error: '同じ日が複数のファイルに入っています' }
      seen.add(date)
    }
  }
  const currentDates = new Set(await loadActiveEventDates(entryGroupId))
  if (seen.size !== currentDates.size || ![...seen].every((d) => currentDates.has(d))) {
    return { ok: false, error: '選択した日付が現在の開催日と一致しません' }
  }

  const { files } = await loadTravelReportDefaultsForSplit(entryGroupId, parsed.data)
  return { ok: true, files }
}
