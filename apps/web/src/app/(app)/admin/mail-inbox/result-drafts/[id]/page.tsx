import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  resultDrafts,
  tournamentClasses,
  tournamentEditionGradeLotteryFacts,
  tournaments,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { Card, Pill } from '@/components/ui'
import { ParsedResultPayloadSchema } from '@kagetra/mail-worker/result-import/schema'
import { ApproveResultDraftForm } from './components/ApproveResultDraftForm'
import { RejectResultDraftButton } from './components/RejectResultDraftButton'
import { ReplaceActualResultButton } from './components/ReplaceActualResultButton'

export const dynamic = 'force-dynamic'

export default async function ResultDraftReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const draftId = Number(id)
  if (!Number.isInteger(draftId) || draftId <= 0) notFound()

  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  const draft = await db.query.resultDrafts.findFirst({
    where: eq(resultDrafts.id, draftId),
    with: {
      mail: {
        columns: { id: true, subject: true },
      },
    },
  })
  if (!draft) notFound()

  // Parse payload (may be empty/invalid for parse_failed)
  const payloadResult = ParsedResultPayloadSchema.safeParse(draft.extractedPayload)
  const payload = payloadResult.success ? payloadResult.data : null

  // Pre-fill tournament name from mail subject
  const defaultTournamentName = draft.mail?.subject?.replace(/^(Re:|FW:|Fw:)\s*/i, '').trim() ?? ''

  const statusLabel: Record<string, string> = {
    pending_review: '承認待ち',
    approved: '承認済み',
    rejected: '却下',
    parse_failed: '取込失敗',
    superseded: '差し替え済み',
  }

  const editionRows = await db
    .select({
      id: tournamentSeriesEditions.id,
      editionNumber: tournamentSeriesEditions.editionNumber,
      year: tournamentSeriesEditions.year,
      seriesName: tournamentSeries.name,
    })
    .from(tournamentSeriesEditions)
    .innerJoin(tournamentSeries, eq(tournamentSeries.id, tournamentSeriesEditions.seriesId))

  let replacementCandidates: Array<{
    grade: 'A' | 'B' | 'C' | 'D' | 'E'
    activeFactId: number
  }> = []
  if (draft.status === 'approved' && draft.tournamentId !== null) {
    const [tournament] = await db
      .select({ editionId: tournaments.editionId })
      .from(tournaments)
      .where(eq(tournaments.id, draft.tournamentId))
      .limit(1)
    if (tournament?.editionId != null) {
      const [classes, facts] = await Promise.all([
        db
          .select({ id: tournamentClasses.id, grade: tournamentClasses.grade })
          .from(tournamentClasses)
          .where(eq(tournamentClasses.tournamentId, draft.tournamentId)),
        db
          .select({
            id: tournamentEditionGradeLotteryFacts.id,
            grade: tournamentEditionGradeLotteryFacts.grade,
            actualResultClassId: tournamentEditionGradeLotteryFacts.actualResultClassId,
          })
          .from(tournamentEditionGradeLotteryFacts)
          .where(
            and(
              eq(tournamentEditionGradeLotteryFacts.editionId, tournament.editionId),
              isNull(tournamentEditionGradeLotteryFacts.validTo),
            ),
          ),
      ])
      replacementCandidates = (['A', 'B', 'C', 'D', 'E'] as const).flatMap((grade) => {
        const gradeClasses = classes.filter((row) => row.grade === grade)
        const fact = facts.find((row) => row.grade === grade)
        return gradeClasses.length === 1 && fact?.actualResultClassId != null &&
          fact.actualResultClassId !== gradeClasses[0]!.id
          ? [{ grade, activeFactId: fact.id }]
          : []
      })
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Link
          href={draft.mail ? `/admin/mail-inbox/mail/${draft.mail.id}` : '/admin/mail-inbox'}
          className="text-sm text-brand-fg underline"
        >
          ← {draft.mail ? 'メール詳細へ戻る' : 'メール受信箱'}
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <h1 className="font-display text-lg font-bold text-ink">結果ドラフト #{draftId}</h1>
        <Pill
          tone={
            draft.status === 'approved'
              ? 'success'
              : draft.status === 'rejected' || draft.status === 'parse_failed'
                ? 'danger'
                : 'warn'
          }
          size="sm"
        >
          {statusLabel[draft.status] ?? draft.status}
        </Pill>
      </div>

      {/* メール件名 */}
      {draft.mail && (
        <p className="text-sm text-ink-meta">
          対象メール：{draft.mail.subject || '(件名なし)'}
        </p>
      )}

      {/* 解析エラー (parse_failed) */}
      {draft.status === 'parse_failed' && draft.parseError && (
        <Card className="border-danger-fg/30 bg-danger-bg">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-danger-fg">取込エラー</span>
            <pre className="whitespace-pre-wrap break-words text-xs text-danger-fg opacity-80">
              {draft.parseError}
            </pre>
          </div>
        </Card>
      )}

      {/* 承認済み */}
      {draft.status === 'approved' && (
        <Card className="border-success-fg/30 bg-success-bg">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-success-fg">
              承認済み — 大会 #{draft.tournamentId} として保存されました
            </span>
            {replacementCandidates.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-danger-fg">
                  この開催回には別の採用結果があります。訂正版として切り替える級だけ明示操作してください。
                </p>
                {replacementCandidates.map((candidate) => (
                  <ReplaceActualResultButton
                    key={candidate.grade}
                    draftId={draftId}
                    grade={candidate.grade}
                    expectedActiveFactId={candidate.activeFactId}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* 却下済み */}
      {draft.status === 'rejected' && (
        <Card className="border-danger-fg/30 bg-danger-bg">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-danger-fg">却下済み</span>
            {draft.rejectionReason && (
              <p className="text-xs text-danger-fg opacity-80">{draft.rejectionReason}</p>
            )}
          </div>
        </Card>
      )}

      {/* 解析内容プレビュー */}
      {payload && payload.classes.length > 0 && (
        <Card>
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-sm font-semibold text-ink-2">
              解析結果 — {payload.classes.length} 級 / パーサ {payload.parserVersion}
            </h2>

            {payload.classes.map((cls, ci) => (
              <div key={ci} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{cls.className}</span>
                  {cls.grade && (
                    <Pill tone="brand" size="sm">{cls.grade}級</Pill>
                  )}
                  <span className="text-xs text-ink-meta">
                    {cls.participants.length}名 / {cls.participants.reduce((s, p) => s + p.matches.length, 0)}試合
                  </span>
                </div>

                {/* 参加者プレビュー（最大10名） */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-ink">
                    <thead>
                      <tr className="border-b border-border-soft text-left text-ink-meta">
                        <th className="pb-1 pr-3">順位</th>
                        <th className="pb-1 pr-3">選手名</th>
                        <th className="pb-1 pr-3">所属</th>
                        <th className="pb-1 pr-3 text-right">勝</th>
                        <th className="pb-1 text-right">負</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cls.participants.slice(0, 10).map((p, pi) => {
                        const wins = p.matches.filter(m => m.result === 'win' && m.status === 'normal').length
                        const loses = p.matches.filter(m => m.result === 'lose' && m.status === 'normal').length
                        return (
                          <tr key={pi} className="border-b border-border-soft/50">
                            <td className="py-0.5 pr-3 text-ink-meta">{p.finalRank ?? `${p.seqNo ?? pi + 1}`}</td>
                            <td className="py-0.5 pr-3">{p.name}</td>
                            <td className="py-0.5 pr-3 text-ink-meta">{p.affiliation ?? '—'}</td>
                            <td className="py-0.5 pr-3 text-right">{wins}</td>
                            <td className="py-0.5 text-right">{loses}</td>
                          </tr>
                        )
                      })}
                      {cls.participants.length > 10 && (
                        <tr>
                          <td colSpan={5} className="pt-1 text-xs text-ink-meta">
                            …他 {cls.participants.length - 10} 名
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 承認フォーム (pending_review のみ) */}
      {draft.status === 'pending_review' && payload && (
        <Card>
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-sm font-semibold text-ink-2">大会情報を確認して承認</h2>
            <ApproveResultDraftForm
              draftId={draftId}
              defaultTournamentName={defaultTournamentName}
              editionOptions={editionRows.map((edition) => ({
                id: edition.id,
                label: `${edition.seriesName} 第${edition.editionNumber}回${edition.year ? ` (${edition.year})` : ''}`,
              }))}
            />
            <RejectResultDraftButton draftId={draftId} />
          </div>
        </Card>
      )}

      {/* 却下のみ (parse_failed) */}
      {draft.status === 'parse_failed' && (
        <Card>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-meta">
              解析に失敗したため承認はできません。却下してメール詳細から再取込してください。
            </p>
            <RejectResultDraftButton draftId={draftId} />
          </div>
        </Card>
      )}
    </div>
  )
}
