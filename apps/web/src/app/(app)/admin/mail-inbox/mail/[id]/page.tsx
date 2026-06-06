import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { and, desc, eq, gte, ne } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { events, mailMessages } from '@kagetra/shared/schema'
import { Card, Pill, type PillTone } from '@/components/ui'
import { AttachmentList } from '../../components/AttachmentList'
import { type TriageStatus } from '../../components/TriageActions'
import { MailDetailActions } from '../../components/MailDetailActions'
import { ExtractionInProgressCard } from '../../components/ExtractionInProgressCard'
import { DraftCard } from '../../components/DraftCard'
import { UndoTriageButton } from '../../components/UndoTriageButton'
import { AIExtractConfirmDialog } from '../../components/AIExtractConfirmDialog'
import type { LinkableEventOption } from '../../components/ExistingEventLinkSheet'
import { linkableEventCutoffStr } from '../../linkable-events'

/**
 * /admin/mail-inbox/mail/[id] — mail-inbox-mailer タスク4: 「メーラー詳細」画面。
 *
 * 旧仕様（mail-triage-badge）から大きく変更:
 *   - 本文は details トグル → **即時表示**（要件 §3.1.2）
 *   - 「保留」アクション廃止
 *   - draft の状態に応じてアクションエリアを切り替え:
 *       draft なし                  → MailDetailActions (3 ボタン)
 *       draft.status='ai_processing' → ExtractionInProgressCard (polling)
 *       draft.status='ai_failed'     → 再試行 + 「手動でイベント作成」
 *       draft.status='pending_review' → DraftCard + 承認動線リンク
 *       draft.status='approved'/'rejected'/'superseded' → 状態表示 + undo
 */
export const dynamic = 'force-dynamic'

const CLASSIFICATION_LABEL: Record<string, { label: string; tone: PillTone }> = {
  tournament: { label: '大会案内', tone: 'brand' },
  noise: { label: 'ノイズ', tone: 'neutral' },
  unknown: { label: '不明', tone: 'neutral' },
}

// mail-inbox-mailer: triage 2 状態化（unprocessed / processed）。「保留」廃止。
const TRIAGE_LABEL: Record<TriageStatus, { label: string; tone: PillTone }> = {
  unprocessed: { label: '未処理', tone: 'warn' },
  processed: { label: '処理済み', tone: 'success' },
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

/**
 * 既存イベント結びつけシートの候補。
 *
 * 要件 §3.1.6: 「未開催（=今日以降）+ 過去 30 日以内」を受信日降順ではなく
 * 開催日降順で表示（候補一覧としては開催日順の方が直感的、シート内検索で
 * タイトル絞り込みも可能）。
 *
 * Codex r1 should-fix: 旧実装は「過去 30 日側を status='done' に限定」して
 * いたが、開催日が過ぎても status が published のままの大会は運用上ありえる
 * ので領収書/事後連絡が拾えなくなっていた。status は cancelled だけ除外して
 * 残りは全部候補に出す（並び順も降順に修正）。
 */
async function loadLinkableEvents(): Promise<LinkableEventOption[]> {
  // mail-inbox-mailer (Codex r5 should-fix): cutoff 算出は linkable-events.ts
  // に集約し、Server Action 側 (linkMailToEvent) と完全同期させる。
  const cutoffStr = linkableEventCutoffStr()

  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      eventDate: events.eventDate,
      status: events.status,
    })
    .from(events)
    .where(
      and(
        gte(events.eventDate, cutoffStr),
        ne(events.status, 'cancelled'),
      ),
    )
    .orderBy(desc(events.eventDate))
  return rows
}

export default async function MailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const mailId = Number(id)
  if (!Number.isInteger(mailId) || mailId <= 0) notFound()

  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  // bytea attachment `data` は projection から除外（一覧と同じく一覧/詳細では
  // バイナリを載せない）。本文は bodyText / bodyHtml を両方使う（プレーンテキスト
  // を優先し、無ければ HTML を pre 表示）。
  const mail = await db.query.mailMessages.findFirst({
    where: eq(mailMessages.id, mailId),
    with: {
      attachments: {
        columns: {
          id: true,
          filename: true,
          contentType: true,
          extractionStatus: true,
        },
      },
      // 1:0..1。draft の状態によってアクションエリアを切替。
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
  })
  if (!mail) notFound()

  const triage = TRIAGE_LABEL[mail.triageStatus] ?? {
    label: mail.triageStatus,
    tone: 'neutral' as const,
  }
  const classification = mail.classification
    ? CLASSIFICATION_LABEL[mail.classification]
    : null

  const linkableEvents =
    !mail.draft && mail.triageStatus === 'unprocessed'
      ? await loadLinkableEvents()
      : []

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/mail-inbox" className="text-sm text-brand-fg underline">
          ← メール受信箱
        </Link>
      </div>

      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-meta">{formatJst(mail.receivedAt)}</span>
            <div className="flex items-center gap-1.5">
              {classification && (
                <Pill tone={classification.tone} size="sm">
                  {classification.label}
                </Pill>
              )}
              <Pill tone={triage.tone} size="sm">
                {triage.label}
              </Pill>
            </div>
          </div>
          <h1 className="font-display text-lg font-bold text-ink">
            {mail.subject || '(件名なし)'}
          </h1>
          <div className="text-xs text-ink-meta">
            {mail.fromName
              ? `${mail.fromName} <${mail.fromAddress}>`
              : mail.fromAddress}
          </div>
          <AttachmentList items={mail.attachments} />

          {/* mail-inbox-mailer: 本文は details トグルではなく即時表示。
              Codex r1 blocker: bodyText のみだと HTML-only メール (text/plain
              代替を持たない) の本文が表示されない。bodyText が無ければ bodyHtml
              にフォールバックする。HTML は dangerouslySetInnerHTML せず、
              <pre> 内に生テキストとして見せる（タグも一緒に見えるが、
              本文を取りこぼさない方が要件「全件確認」上は重要）。 */}
          {(() => {
            const body = mail.bodyText ?? mail.bodyHtml
            if (!body) return null
            return (
              <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border-soft bg-surface-alt p-2 text-xs text-ink">
                {body}
              </pre>
            )
          })()}
        </div>
      </Card>

      {/* アクションエリアは triage_status + draft.status の組み合わせで分岐。 */}
      {mail.triageStatus === 'processed' ? (
        <Card>
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-sm font-semibold text-ink-2">処理済み</h2>
            <p className="text-xs text-ink-meta">
              このメールは処理済みです。誤って処理した場合は未処理に戻せます。
              {mail.linkedEventId != null &&
                ' 紐付け済みイベントの解除も同時に行われます（LINE 配信済みメッセージの取り消しはできません）。'}
            </p>
            <UndoTriageButton
              mailId={mail.id}
              hasLinkedEvent={mail.linkedEventId != null}
            />
          </div>
        </Card>
      ) : !mail.draft ? (
        <Card>
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-sm font-semibold text-ink-2">処理</h2>
            <MailDetailActions mailId={mail.id} linkableEvents={linkableEvents} />
            <p className="text-xs text-ink-meta">
              「会で流す」は AI 抽出を実行。「既存イベントに紐付ける」は組合せ表
              などの補足情報を既存大会に紐付けて LINE で配信。「対応不要」は未処理
              バッジから外すだけ。
            </p>
          </div>
        </Card>
      ) : mail.draft.status === 'ai_processing' ? (
        <ExtractionInProgressCard mailId={mail.id} />
      ) : mail.draft.status === 'ai_failed' ? (
        <Card>
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-sm font-semibold text-ink-2">
              AI 抽出に失敗しました
            </h2>
            <p className="text-xs text-ink-meta">
              再試行してください。手動でイベント作成する場合は
              この画面から AI 抽出を諦めた上で、メニューから新規イベント作成へ
              進んでください（mail との自動紐付けは将来対応）。
            </p>
            <div className="flex flex-col gap-2">
              <AIExtractConfirmDialog
                mailId={mail.id}
                buttonLabel="AI 抽出を再試行"
                buttonKind="primary"
              />
              {/* mail-inbox-mailer (Codex r6 blocker): /admin/events/new は実在
                  しないため 404 を回避するためリンクを撤去。要件 §3.1.5 の
                  「手動でイベント作成」フロー (空 EventForm を mail 詳細に展開
                  + draft.status='approved' で締める) は専用 Server Action +
                  画面を別 PR で実装してから再度有効化する想定。 */}
            </div>
          </div>
        </Card>
      ) : mail.draft.status === 'pending_review' ? (
        <Card>
          <div className="flex flex-col gap-2">
            <DraftCard draft={mail.draft} />
            <Link
              href={`/admin/mail-inbox/${mail.draft.id}`}
              className="text-sm text-brand-fg underline"
            >
              承認 / 却下 / 紐付けへ →
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-2">
            <DraftCard draft={mail.draft} />
            <Link
              href={`/admin/mail-inbox/${mail.draft.id}`}
              className="text-sm text-brand-fg underline"
            >
              draft 詳細を開く →
            </Link>
          </div>
        </Card>
      )}
    </div>
  )
}
