import { auth } from '@/auth'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { Card, Pill, type PillTone } from '@/components/ui'
import { mailWorkerRuns } from '@kagetra/shared/schema'
import { AttachmentList } from './components/AttachmentList'
import { DraftCard } from './components/DraftCard'
import { TriggerFetchButton } from './components/TriggerFetchButton'

/**
 * /admin/mail-inbox — list of mails fetched by `apps/mail-worker` (PR1).
 *
 * Scope per implementation-plan PR1:
 *   - LIST ONLY (no draft, no AI, no approval — those land in PR3 / PR4)
 *   - admin/vice_admin gate (other users → /403)
 *   - newest-first, top 100 (cheap pagination deferred)
 *   - status as Pill, classification surfaced when present
 */
export const dynamic = 'force-dynamic'

// PR1 only emits `fetched` and (for pre-filtered mails) `noise` classification.
// `parse_failed` / `fetch_failed` rows aren't persisted yet — those errors are
// logged via the pipeline summary and stay log-only until PR3 lands a failed-row
// writer. Labels are kept here so the UI doesn't need to grow when that ships.
const STATUS_LABEL: Record<string, { label: string; tone: PillTone }> = {
  pending: { label: '受信待ち', tone: 'neutral' },
  fetched: { label: '取得済み', tone: 'info' },
  parse_failed: { label: 'パース失敗', tone: 'danger' },
  fetch_failed: { label: '取得失敗', tone: 'danger' },
  ai_processing: { label: 'AI 処理中', tone: 'warn' },
  ai_done: { label: 'AI 完了', tone: 'success' },
  ai_failed: { label: 'AI 失敗', tone: 'danger' },
  archived: { label: 'アーカイブ', tone: 'neutral' },
}

const CLASSIFICATION_LABEL: Record<string, { label: string; tone: PillTone }> = {
  tournament: { label: '大会案内', tone: 'brand' },
  noise: { label: 'ノイズ', tone: 'neutral' },
  unknown: { label: '不明', tone: 'neutral' },
}

// PR5 Phase 4c — `mail_worker_runs.status` mapping for the recent-runs table.
// Mirrors the enum in packages/shared/src/schema/enums.ts.
const RUN_STATUS_LABEL: Record<string, { label: string; tone: PillTone }> = {
  running: { label: '実行中', tone: 'info' },
  success: { label: '成功', tone: 'success' },
  imap_failed: { label: 'IMAP 失敗', tone: 'danger' },
  ai_failed: { label: 'AI 失敗', tone: 'danger' },
  partial: { label: '部分成功', tone: 'warn' },
}

const RUN_KIND_LABEL: Record<string, string> = {
  cron: '定期',
  manual: '手動',
}

function formatJst(date: Date): string {
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function MailInboxPage() {
  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  // PR5 Phase 4c — recent mail-worker invocations. The list query below is the
  // existing PR1-PR4 surface; this query is independent so it can fail or
  // return empty without affecting the inbox itself. Limit 5 mirrors the
  // pr5-plan.md DoD ("直近 5 件").
  const recentRuns = await db
    .select({
      id: mailWorkerRuns.id,
      startedAt: mailWorkerRuns.startedAt,
      finishedAt: mailWorkerRuns.finishedAt,
      kind: mailWorkerRuns.kind,
      status: mailWorkerRuns.status,
      summary: mailWorkerRuns.summary,
      error: mailWorkerRuns.error,
    })
    .from(mailWorkerRuns)
    .orderBy(desc(mailWorkerRuns.startedAt))
    .limit(5)

  // List view never renders body_text / body_html. Restrict columns so the top
  // 100 rows don't drag full HTML bodies across the wire on every page load.
  // PR2 layers in attachment chips: we pull only the chip-worthy columns
  // (id / filename / content_type / extraction_status) — `data` (bytea) is
  // explicitly omitted so the list query doesn't haul attachment payloads
  // into the response body. The detail view will fetch full bodies on demand
  // when PR4 lands.
  const rows = await db.query.mailMessages.findMany({
    columns: {
      id: true,
      receivedAt: true,
      subject: true,
      fromName: true,
      fromAddress: true,
      status: true,
      classification: true,
    },
    with: {
      attachments: {
        columns: {
          id: true,
          filename: true,
          contentType: true,
          extractionStatus: true,
        },
      },
      // PR3 addition: 1:0..1 — at most one tournament_drafts row per mail
      // (UNIQUE on message_id). PR4 added the detail page + approval form;
      // we select `id` so the inline card can wrap-link into /[id].
      draft: {
        columns: {
          id: true,
          status: true,
          confidence: true,
          isCorrection: true,
          referencesSubject: true,
          extractedPayload: true,
        },
      },
    },
    orderBy: (m, { desc }) => [desc(m.receivedAt)],
    limit: 100,
  })
  type Row = (typeof rows)[number]

  // Priority grouping for the inbox queue. A single mail-worker run can push
  // tens of pending_review drafts in (PR #24 verification on 2026-05-12 took
  // pending from 17 → 35 at once, with confidence clustering at 0.97 / 0.82 /
  // 0.72). With a flat received_at sort the high-confidence tournaments were
  // hidden among reference rows. Bucketing by (status + confidence band) lets
  // the operator triage from the top.
  //
  //   tier 0 ("要対応") — pending_review with confidence >= 0.9. Brand accent.
  //   tier 1 ("要確認") — pending_review with confidence < 0.9 or null.
  //   tier 2 ("その他") — everything else (approved / rejected / superseded /
  //                       ai_failed / no draft). Kept visible for back-ref.
  //
  // Tier 0 and 1 are re-sorted by confidence DESC so the most confident draft
  // floats to the top within each group; tier 2 keeps the received_at DESC
  // order from the fetch, which is what admins expect for the reference
  // bucket. The 0.9 threshold matches `ConfidenceBadge`'s "高" band so the
  // visual emphasis is consistent with the per-row confidence pill.
  const buckets: Record<0 | 1 | 2, Row[]> = { 0: [], 1: [], 2: [] }
  for (const row of rows) {
    let tier: 0 | 1 | 2 = 2
    if (row.draft?.status === 'pending_review') {
      const c = row.draft.confidence
      const n = c == null || c === '' ? null : Number(c)
      tier = n !== null && n >= 0.9 ? 0 : 1
    }
    buckets[tier].push(row)
  }
  const confNum = (row: Row): number => {
    // -1 sorts null / missing conf to the bottom of tier 1 (tier 0 never
    // sees these because the tier check already required >= 0.9).
    const c = row.draft?.confidence
    return c == null || c === '' ? -1 : Number(c)
  }
  buckets[0].sort((a, b) => confNum(b) - confNum(a))
  buckets[1].sort((a, b) => confNum(b) - confNum(a))

  const TIER_META: Record<0 | 1 | 2, { label: string; cardClassName: string }> = {
    0: { label: '要対応', cardClassName: 'border-l-4 border-l-brand' },
    1: { label: '要確認', cardClassName: '' },
    2: { label: 'その他', cardClassName: '' },
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">メール受信箱</h1>
        <TriggerFetchButton />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-semibold text-ink-2">
          最近の取り込み履歴
        </h2>
        {recentRuns.length === 0 ? (
          <Card>
            <div className="py-3 text-center text-xs text-ink-meta">
              まだ実行履歴がありません
            </div>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-soft text-left text-ink-meta">
                    <th className="py-1 pr-3 font-medium">開始</th>
                    <th className="py-1 pr-3 font-medium">種別</th>
                    <th className="py-1 pr-3 font-medium">状態</th>
                    <th className="py-1 pr-3 font-medium">新規 draft</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => {
                    const status = RUN_STATUS_LABEL[run.status] ?? {
                      label: run.status,
                      tone: 'neutral' as const,
                    }
                    const kindLabel = RUN_KIND_LABEL[run.kind] ?? run.kind
                    // summary jsonb is `unknown`. Pull the one field we render
                    // defensively without trusting the shape.
                    const summary = (run.summary ?? {}) as {
                      drafts_created?: number
                    }
                    const draftsCreated = summary.drafts_created ?? 0
                    return (
                      <tr
                        key={run.id}
                        className="border-b border-border-soft last:border-0"
                      >
                        <td className="py-1.5 pr-3 text-ink-2">
                          {formatJst(run.startedAt)}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-2">{kindLabel}</td>
                        <td className="py-1.5 pr-3">
                          <span
                            className="inline-flex items-center gap-1"
                            title={run.error ?? undefined}
                          >
                            <Pill tone={status.tone} size="sm">
                              {status.label}
                            </Pill>
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-ink-2">
                          {draftsCreated} 件
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {rows.length === 0 ? (
        <Card>
          <div className="py-6 text-center text-ink-meta">
            まだメールが取り込まれていません
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {([0, 1, 2] as const).map((tier) => {
            const items = buckets[tier]
            if (items.length === 0) return null
            return (
              <section key={tier} className="flex flex-col gap-2">
                <h2 className="font-display text-sm font-semibold text-ink-2">
                  {TIER_META[tier].label} ({items.length})
                </h2>
                <div className="flex flex-col gap-2">
                  {items.map((row) => {
                    const status = STATUS_LABEL[row.status] ?? {
                      label: row.status,
                      tone: 'neutral' as const,
                    }
                    const classification = row.classification
                      ? CLASSIFICATION_LABEL[row.classification]
                      : null
                    return (
                      <Card
                        key={row.id}
                        className={TIER_META[tier].cardClassName}
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-ink-meta">
                              {formatJst(row.receivedAt)}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {classification && (
                                <Pill tone={classification.tone} size="sm">
                                  {classification.label}
                                </Pill>
                              )}
                              <Pill tone={status.tone} size="sm">
                                {status.label}
                              </Pill>
                            </div>
                          </div>
                          <div className="font-medium text-ink truncate">
                            {row.subject || '(件名なし)'}
                          </div>
                          <div className="text-xs text-ink-meta truncate">
                            {row.fromName
                              ? `${row.fromName} <${row.fromAddress}>`
                              : row.fromAddress}
                          </div>
                          <AttachmentList items={row.attachments} />
                          {row.draft && (
                            <Link
                              href={`/admin/mail-inbox/${row.draft.id}`}
                              className="block"
                            >
                              <DraftCard draft={row.draft} />
                            </Link>
                          )}
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
