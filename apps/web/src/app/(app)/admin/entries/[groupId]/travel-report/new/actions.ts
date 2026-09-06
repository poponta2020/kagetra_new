'use server'

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { travelReportBatches } from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'
import { createTravelReports, type TravelReportFileInput } from '@/lib/travel-report/create'
import { sendTravelReportCreatedNotice } from '@/lib/travel-report/notify'

/**
 * S6「遠征届 作成画面」の Server Action（requirements R9・AC-20〜28）。
 *
 * ★通知は**作成物を保存したあと**に送る。通知が失敗しても documents は保存済みのまま
 * で、失敗理由を `travel_report_batches.notify_error` に残す（R13・AC-28）。
 */

const contactSchema = z.object({
  name: z.string().trim().max(60),
  phone: z.string().trim().max(40).nullable(),
})

const fileSchema = z.object({
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付の形式が不正です'))
    .min(1, 'ファイルに含める日がありません'),
  purpose: z.string().trim().max(200),
  place: z.string().trim().max(200),
  destinationContacts: z.array(contactSchema).max(4),
  homeContact: contactSchema.nullable(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '届の日付の形式が不正です'),
  approvalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '承認日の形式が不正です')
    .nullable(),
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

  // ★同じ日が複数のファイルに入っていたら拒否する（統合・分割の操作ミスで
  // 同じ人が2枚に載るのを防ぐ）。
  const seen = new Set<string>()
  for (const file of parsed.data) {
    for (const date of file.dates) {
      if (seen.has(date)) return { ok: false, error: '同じ日が複数のファイルに入っています' }
      seen.add(date)
    }
  }

  let result: Awaited<ReturnType<typeof createTravelReports>>
  try {
    result = await createTravelReports(entryGroupId, parsed.data, session.user.id)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '遠征届の作成に失敗しました' }
  }

  // 作成物は保存済み。ここから先の失敗は作成の失敗ではない。
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
    await db
      .update(travelReportBatches)
      .set({ notifyError: notify.error })
      .where(eq(travelReportBatches.id, result.batchId))
  }
  // skipped_unlinked（LINE 未紐付け）は失敗ではないので記録しない。

  revalidatePath(`/admin/entries/${entryGroupId}`)
  return {
    ok: true,
    fileCount: result.documents.length,
    notifyError: notify.outcome === 'failed' ? notify.error : undefined,
  }
}
