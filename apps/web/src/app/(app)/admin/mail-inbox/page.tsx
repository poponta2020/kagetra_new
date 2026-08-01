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
import { TriageActions } from './components/TriageActions'
import { UndoTriageButton } from './components/UndoTriageButton'

/**
 * /admin/mail-inbox — 受信メール一覧（mail-triage-badge で再構成）。
 *
 * 第1階層は triage_status:「未処理」「保留」を優先表示（received DESC, 100件）、
 * 「処理済み」は最新 20 件を折りたたみで参照表示。既存メールは migration で全件
 * processed 化されるため、未処理を優先取得しないと新着が処理済みの山に埋もれる。
 *
 * mail-ai-extract-refinements タスク10: 未処理グループ内の tier 分け（要対応/要確認/
 * その他）は廃止し、受信日降順の一本の並びに統一した（`tournament_drafts.confidence`
 * は書き込みを止め表示もしない。列自体は DROP しない）。各カードに triage
 * クイックアクションと詳細(mail/[id]) への導線を出す。admin/vice_admin のみ。
 */
export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, { label: string; tone: PillTone }> = {
  pending: { label: '受信待ち', tone: 'neutral' },
  fetched: { label: '取得済み', tone: 'info' },
  parse_failed: { label: 'パース失敗', tone: 'danger' },
  fetch_failed: { label: '取得失敗', tone: 'danger' },
  ai_processing: { label: 'AI 処理中', tone: 'warn' },
  ai_done: { label: 'AI 完了', tone: 'success' },
  ai_failed: { label: 'AI 失敗', tone: 'danger' },
  oversize_skipped: { label: 'AI スキップ (PDF サイズ超過)', tone: 'warn' },
  archived: { label: 'アーカイブ', tone: 'neutral' },
}

// mail-inbox-mailer タスク6 (AC-26): 一覧の区分ピルを AI 由来の classification
// から手動選択の mail_kind へ差し替える。classification 列自体は pre-filter・
// AI 用途で残すため、表示から外すだけ（schema は変更しない）。
const MAIL_KIND_LABEL: Record<string, { label: string; tone: PillTone }> = {
  tournament_notice: { label: '大会案内', tone: 'brand' },
  applicant_roster: { label: '申込名簿', tone: 'brand' },
  confirmed_roster: { label: '確定名簿', tone: 'brand' },
}

// PR5 Phase 4c — `mail_worker_runs.status` mapping for the recent-runs table.
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

// 未処理+保留は多めに、処理済みは参考用に最新だけ。
const ACTIVE_LIMIT = 100
const PROCESSED_LIMIT = 20

const LIST_COLUMNS = {
  id: true,
  receivedAt: true,
  subject: true,
  status: true,
  mailKind: true,
  triageStatus: true,
  // mail-inbox-mailer (Codex r3 blocker): 処理済セクションの「未処理に戻す」が
  // linked_event_id を解除しないと、紐付け先イベントの関連メールに残り続けて
  // 不整合になる。UndoTriageButton に linkedEventId の有無を伝えるため、
  // 一覧クエリでも列を引いておく。
  linkedEventId: true,
} as const

const LIST_WITH = {
  attachments: {
    columns: {
      id: true,
      filename: true,
      contentType: true,
      extractionStatus: true,
    },
  },
  draft: {
    columns: {
      id: true,
      status: true,
      isCorrection: true,
      referencesSubject: true,
      extractedPayload: true,
    },
  },
} as const

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

  // 未処理 + 保留（triage != processed）を優先取得。処理済みは別枠で最新のみ。
  // bytea の attachment data は projection から除外（list は本文/バイナリを載せない）。
  const activeRows = await db.query.mailMessages.findMany({
    columns: LIST_COLUMNS,
    with: LIST_WITH,
    where: (m, { ne }) => ne(m.triageStatus, 'processed'),
    orderBy: (m, { desc }) => [desc(m.receivedAt)],
    limit: ACTIVE_LIMIT,
  })
  const processedRows = await db.query.mailMessages.findMany({
    columns: LIST_COLUMNS,
    with: LIST_WITH,
    where: (m, { eq }) => eq(m.triageStatus, 'processed'),
    orderBy: (m, { desc }) => [desc(m.receivedAt)],
    limit: PROCESSED_LIMIT,
  })
  type Row = (typeof activeRows)[number]

  // mail-inbox-mailer: triage 2 状態化（unprocessed / processed）。activeRows は
  // `ne(triageStatus, 'processed')` フィルタなので全て unprocessed と等価だが、
  // 既存のコードフローを保ったまま明示的に絞り込んでおく。
  const unprocessed = activeRows.filter((r) => r.triageStatus === 'unprocessed')

  function renderRow(row: Row) {
    const status = STATUS_LABEL[row.status] ?? {
      label: row.status,
      tone: 'neutral' as const,
    }
    const mailKind = row.mailKind ? MAIL_KIND_LABEL[row.mailKind] : null
    return (
      <Card key={row.id}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-meta">{formatJst(row.receivedAt)}</span>
            <div className="flex items-center gap-1.5">
              {mailKind && (
                <Pill tone={mailKind.tone} size="sm">
                  {mailKind.label}
                </Pill>
              )}
              <Pill tone={status.tone} size="sm">
                {status.label}
              </Pill>
            </div>
          </div>
          <Link
            href={`/admin/mail-inbox/mail/${row.id}`}
            className="break-words font-medium text-ink hover:underline"
          >
            {row.subject || '(件名なし)'}
          </Link>
          <AttachmentList items={row.attachments} />
          {row.draft && (
            <Link href={`/admin/mail-inbox/${row.draft.id}`} className="block">
              <DraftCard draft={row.draft} />
            </Link>
          )}
          <div className="mt-1">
            {/* mail-inbox-mailer (Codex r3 blocker): processed 行の
                「未処理に戻す」が triage だけを戻すと linked_event_id が残る。
                2026-08-02 改修で undoTriage 自体が種別・紐付け・そのメール由来の
                名簿採用をまとめて戻すようになったので、UndoTriageButton は
                linkedEventId の有無で呼び分けない。unprocessed 行はそのまま
                TriageActions（対応不要のクイックアクション）を維持。
                Codex r6 should-fix: dismissMail はサーバー側で未完了 draft
                (ai_processing/pending_review/ai_failed) があるメールを拒否する
                ので、一覧でも該当 draft があれば「対応不要」を出さない。
                draft 詳細 / 再試行は DraftCard リンク or 詳細画面に集約する。 */}
            {row.triageStatus === 'processed' ? (
              <UndoTriageButton mailId={row.id} />
            ) : row.draft?.status === 'ai_processing' ||
              row.draft?.status === 'pending_review' ||
              row.draft?.status === 'ai_failed' ? null : (
              <TriageActions mailId={row.id} triageStatus={row.triageStatus} />
            )}
          </div>
        </div>
      </Card>
    )
  }

  const hasAnyActive = unprocessed.length > 0

  return (
    <div className="flex flex-col gap-4 p-4">
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

      {/* 未処理 */}
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-semibold text-ink-2">
          未処理 ({unprocessed.length})
        </h2>
        {unprocessed.length === 0 ? (
          <Card>
            <div className="py-4 text-center text-sm text-ink-meta">
              未処理のメールはありません 🎉
            </div>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {unprocessed.map((row) => renderRow(row))}
          </div>
        )}
      </section>

      {/* mail-inbox-mailer: 保留セクション廃止（deferred 状態自体を削除）。 */}

      {/* 処理済み（参考・折りたたみ） */}
      {processedRows.length > 0 && (
        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer font-display text-sm font-semibold text-ink-2">
            処理済み（最新 {processedRows.length} 件）
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {processedRows.map((row) => renderRow(row))}
          </div>
        </details>
      )}

      {!hasAnyActive && processedRows.length === 0 && (
        <Card>
          <div className="py-6 text-center text-ink-meta">
            まだメールが取り込まれていません
          </div>
        </Card>
      )}
    </div>
  )
}
