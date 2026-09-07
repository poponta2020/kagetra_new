import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { entryGroups } from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { isTravelReportSubmitter } from '@/lib/travel-report/authz'
import { loadTravelReportDefaults } from '@/lib/travel-report/create'
import { formatEventDate } from '@/lib/event-date'
import { CreateForm } from './CreateForm'
import { createTravelReportsAction, reloadTravelReportDefaultsAction } from './actions'

/**
 * S6 遠征届 作成画面（`/admin/entries/[groupId]/travel-report/new`）。
 *
 * **提出権限者のみ**（AC-21）。一般会員・ゲストは 404 相当へ倒す（403 ページを見せると
 * 「そこに何かある」ことが分かるため、既存の管理画面と同じ流儀）。
 */
export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const entryGroupId = Number(groupId)
  if (!Number.isInteger(entryGroupId) || entryGroupId <= 0) notFound()

  const session = await auth()
  if (!session?.user?.id) redirect('/api/auth/signin')
  if (!(await isTravelReportSubmitter(session))) notFound()

  const [group] = await db
    .select({ id: entryGroups.id })
    .from(entryGroups)
    .where(eq(entryGroups.id, entryGroupId))
    .limit(1)
  if (!group) notFound()

  const { files, tournamentName } = await loadTravelReportDefaults(entryGroupId)
  if (files.length === 0) notFound()

  const allDates = files.flatMap((f) => f.dates).sort()

  return (
    <div className="p-4">
      <div className="pb-3">
        <p className="text-xs text-ink-meta">
          <Link href="/admin/entries" className="text-brand underline underline-offset-2">
            申込管理
          </Link>
          <span className="px-1">›</span>
          <Link
            href={`/admin/entries/${entryGroupId}`}
            className="text-brand underline underline-offset-2"
          >
            {tournamentName || 'グループ'}
          </Link>
          <span className="px-1">›</span>
          <span>遠征届を作成</span>
        </p>
        <h1 className="pt-1 font-display text-[20px] font-semibold text-ink">遠征届を作成</h1>
        <p className="pt-1 text-xs text-ink-meta">
          {tournamentName}
          {allDates.length > 0 && ` ／ ${allDates.map((d) => formatEventDate(d)).join('・')}`}
        </p>
      </div>

      <CreateForm
        entryGroupId={entryGroupId}
        defaults={files}
        createAction={createTravelReportsAction}
        reloadAction={reloadTravelReportDefaultsAction}
      />
    </div>
  )
}
