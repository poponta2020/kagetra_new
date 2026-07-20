import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  events,
  tournamentEditionGradeLotteryFacts,
  tournamentEntryRosters,
  tournamentRosterImportDrafts,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { Card, Pill } from '@/components/ui'
import { RosterDraftApprovalForm } from './components/RosterDraftApprovalForm'
import { RejectRosterDraftButton } from './components/RejectRosterDraftButton'

export const dynamic = 'force-dynamic'

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
const GRADES = new Set<Grade>(['A', 'B', 'C', 'D', 'E'])

function payloadEntries(payload: unknown): Array<{
  rawName: string
  grade: Grade | null
  rawAffiliation: string | null
  selectionOutcome: string
  selectionExempt: boolean
}> {
  if (!payload || typeof payload !== 'object' || !('entries' in payload)) return []
  const entries = (payload as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const value = entry as Record<string, unknown>
    if (typeof value.rawName !== 'string') return []
    const grade = typeof value.grade === 'string' && GRADES.has(value.grade as Grade)
      ? value.grade as Grade
      : null
    return [{
      rawName: value.rawName,
      grade,
      rawAffiliation: typeof value.rawAffiliation === 'string' ? value.rawAffiliation : null,
      selectionOutcome: typeof value.selectionOutcome === 'string' ? value.selectionOutcome : 'unknown',
      selectionExempt: value.selectionExempt === true,
    }]
  })
}

function payloadValidationIssues(payload: unknown): Array<{
  code: string
  message: string
  sheetNames: string[]
}> {
  if (!payload || typeof payload !== 'object' || !('validationIssues' in payload)) return []
  const issues = (payload as { validationIssues?: unknown }).validationIssues
  if (!Array.isArray(issues)) return []
  return issues.flatMap((issue) => {
    if (!issue || typeof issue !== 'object') return []
    const value = issue as Record<string, unknown>
    if (typeof value.message !== 'string') return []
    return [{
      code: typeof value.code === 'string' ? value.code : 'validation_error',
      message: value.message,
      sheetNames: Array.isArray(value.sheetNames)
        ? value.sheetNames.filter((name): name is string => typeof name === 'string')
        : [],
    }]
  })
}

function jstDate(date: Date | null | undefined): string {
  if (!date) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export default async function RosterDraftReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const draftId = Number(id)
  if (!Number.isInteger(draftId) || draftId <= 0) notFound()

  const session = await auth()
  if (!session || (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')) {
    redirect('/403')
  }

  const draft = await db.query.tournamentRosterImportDrafts.findFirst({
    where: eq(tournamentRosterImportDrafts.id, draftId),
    with: {
      sourceMail: { columns: { id: true, subject: true, receivedAt: true } },
      sourceAttachment: { columns: { id: true, filename: true } },
    },
  })
  if (!draft) notFound()

  const [editionRows, eventRows, rosterRows, factRows] = await Promise.all([
    db
      .select({
        id: tournamentSeriesEditions.id,
        number: tournamentSeriesEditions.editionNumber,
        year: tournamentSeriesEditions.year,
        seriesName: tournamentSeries.name,
      })
      .from(tournamentSeriesEditions)
      .innerJoin(tournamentSeries, eq(tournamentSeries.id, tournamentSeriesEditions.seriesId)),
    db
      .select({
        id: events.id,
        editionId: events.editionId,
        title: events.title,
        eventDate: events.eventDate,
      })
      .from(events)
      .where(isNotNull(events.editionId)),
    db
      .select({
        id: tournamentEntryRosters.id,
        eventId: tournamentEntryRosters.eventId,
        rosterType: tournamentEntryRosters.rosterType,
        version: tournamentEntryRosters.version,
        publishedAt: tournamentEntryRosters.publishedAt,
      })
      .from(tournamentEntryRosters)
      .innerJoin(events, eq(events.id, tournamentEntryRosters.eventId))
      .where(and(isNull(tournamentEntryRosters.supersededAt), isNotNull(events.editionId))),
    db
      .select({
        editionId: tournamentEditionGradeLotteryFacts.editionId,
        grade: tournamentEditionGradeLotteryFacts.grade,
        selectionStatus: tournamentEditionGradeLotteryFacts.selectionStatus,
        capacity: tournamentEditionGradeLotteryFacts.capacity,
        applicationStartDate: tournamentEditionGradeLotteryFacts.applicationStartDate,
      })
      .from(tournamentEditionGradeLotteryFacts)
      .where(isNull(tournamentEditionGradeLotteryFacts.validTo)),
  ])

  const entries = payloadEntries(draft.extractedPayload)
  const validationIssues = payloadValidationIssues(draft.extractedPayload)
  const explicitGrades = [...new Set(entries.flatMap((entry) => entry.grade ? [entry.grade] : []))]
  const initialGrades = explicitGrades.length > 0
    ? explicitGrades
    : draft.inferredGrade
      ? [draft.inferredGrade]
      : []
  const statusLabels: Record<string, string> = {
    pending_review: '承認待ち',
    approved: '承認済み',
    rejected: '却下',
    parse_failed: '解析失敗',
    superseded: '差し替え済み',
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={draft.sourceMail ? `/admin/mail-inbox/mail/${draft.sourceMail.id}` : '/admin/mail-inbox'}
        className="text-sm text-brand-fg underline"
      >
        ← {draft.sourceMail ? 'メール詳細へ戻る' : 'メール受信箱'}
      </Link>

      <div className="flex items-center gap-2">
        <h1 className="font-display text-lg font-bold text-ink">名簿ドラフト #{draft.id}</h1>
        <Pill tone={draft.status === 'approved' ? 'success' : draft.status === 'pending_review' ? 'warn' : 'danger'} size="sm">
          {statusLabels[draft.status] ?? draft.status}
        </Pill>
      </div>

      <Card>
        <div className="flex flex-col gap-1 text-sm text-ink-2">
          <span>メール: {draft.sourceMail?.subject || '(件名なし)'}</span>
          <span>原本: {draft.sourceAttachment?.filename ?? 'メール本文'}</span>
          <span>パーサ: {draft.parserVersion}</span>
          {draft.failureReason && <p className="text-xs text-danger-fg">{draft.failureReason}</p>}
        </div>
      </Card>

      {entries.length > 0 && (
        <Card>
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-sm font-semibold text-ink-2">抽出行（{entries.length}名）</h2>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs text-ink">
                <thead><tr className="border-b border-border-soft text-left text-ink-meta"><th className="pb-1">級</th><th className="pb-1">氏名</th><th className="pb-1">所属</th><th className="pb-1">当落</th><th className="pb-1">抽選区分</th></tr></thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <tr key={`${entry.rawName}-${index}`} className="border-b border-border-soft/50">
                      <td className="py-1">{entry.grade ? `${entry.grade}級` : '未確定'}</td>
                      <td className="py-1">{entry.rawName}</td>
                      <td className="py-1 text-ink-meta">{entry.rawAffiliation ?? '—'}</td>
                      <td className="py-1 text-ink-meta">{entry.selectionOutcome}</td>
                      <td className="py-1 text-ink-meta">{entry.selectionExempt ? '主催者枠・除外' : '通常'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {draft.status === 'pending_review' && validationIssues.length > 0 && (
        <Card className="border-warn-fg/30 bg-warn-bg">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-sm font-semibold text-warn-fg">原本の確認が必要です</h2>
              <p className="text-xs text-warn-fg">
                次の検証エラーがあるため採用できません。原本を修正して再解析するか、このドラフトを却下してください。
              </p>
              <ul className="list-disc pl-5 text-xs text-warn-fg">
                {validationIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    {issue.message}
                    {issue.sheetNames.length > 0 ? `（${issue.sheetNames.join('、')}）` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <RejectRosterDraftButton
              draftId={draft.id}
              returnTo={draft.sourceMail ? `/admin/mail-inbox/mail/${draft.sourceMail.id}` : '/admin/mail-inbox'}
            />
          </div>
        </Card>
      )}

      {draft.status === 'pending_review' && entries.length > 0 && validationIssues.length === 0 && (
        <Card>
          <RosterDraftApprovalForm
            draftId={draft.id}
            mailId={draft.sourceMail?.id ?? null}
            initialEditionId={draft.inferredEditionId}
            initialPurpose={draft.inferredRosterType}
            initialGrades={initialGrades}
            publishedAt={jstDate(draft.sourceMail?.receivedAt)}
            editions={editionRows.map((edition) => ({
              id: edition.id,
              label: `${edition.seriesName} 第${edition.number}回${edition.year ? ` (${edition.year})` : ''}`,
            }))}
            events={eventRows.map((event) => ({
              id: event.id,
              editionId: event.editionId!,
              label: `${event.title} (${event.eventDate})`,
            }))}
            rosters={rosterRows.map((roster) => ({
              id: roster.id,
              eventId: roster.eventId,
              rosterType: roster.rosterType,
              label: `#${roster.id} v${roster.version}${roster.publishedAt ? ` (${roster.publishedAt})` : ''}`,
            }))}
            facts={factRows}
          />
        </Card>
      )}

      {draft.status === 'pending_review' && entries.length === 0 && (
        <Card className="border-warn-fg/30 bg-warn-bg">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-warn-fg">
              構造化された名簿行がないため採用できません。原本を確認して却下してください。
            </p>
            <RejectRosterDraftButton
              draftId={draft.id}
              returnTo={draft.sourceMail ? `/admin/mail-inbox/mail/${draft.sourceMail.id}` : '/admin/mail-inbox'}
            />
          </div>
        </Card>
      )}

      {draft.status === 'parse_failed' && (
        <Card className="border-danger-fg/30 bg-danger-bg">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-danger-fg">構造化できないため採用できません。原本を確認して再解析するか却下してください。</p>
            <RejectRosterDraftButton
              draftId={draft.id}
              returnTo={draft.sourceMail ? `/admin/mail-inbox/mail/${draft.sourceMail.id}` : '/admin/mail-inbox'}
            />
          </div>
        </Card>
      )}
    </div>
  )
}
