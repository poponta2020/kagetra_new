import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { and, eq, gte, or } from 'drizzle-orm'
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
 * 既存イベント結びつけシートの候補: 未開催 (event_date >= 今日) + 過去 30 日。
 * 受信日降順ではなく event_date 降順で並べる（候補ソートとしては開催日順が
 * 直感的。シート内検索でタイトル絞り込みもできる）。
 */
async function loadLinkableEvents(): Promise<LinkableEventOption[]> {
  const todayJst = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }),
  )
  const cutoff = new Date(todayJst.getTime() - 30 * 24 * 3600 * 1000)
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  const todayStr = `${todayJst.getFullYear()}-${String(todayJst.getMonth() + 1).padStart(2, '0')}-${String(todayJst.getDate()).padStart(2, '0')}`

  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      eventDate: events.eventDate,
      status: events.status,
    })
    .from(events)
    .where(
      or(
        gte(events.eventDate, todayStr),
        and(gte(events.eventDate, cutoffStr), eq(events.status, 'done')),
      ),
    )
    .orderBy(events.eventDate)
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

          {/* mail-inbox-mailer: 本文は details トグルではなく即時表示。 */}
          {mail.bodyText && (
            <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border-soft bg-surface-alt p-2 text-xs text-ink">
              {mail.bodyText}
            </pre>
          )}
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
              再試行するか、手動でイベントを作成してください。
            </p>
            <div className="flex flex-col gap-2">
              <AIExtractConfirmDialog
                mailId={mail.id}
                buttonLabel="AI 抽出を再試行"
                buttonKind="primary"
              />
              {/* 手動イベント作成は既存 /admin/events/new に mailMessageId を渡す
                  形が筋。実画面は別 PR（タスク7 までに整備予定）。今は placeholder
                  リンクで導線だけ示す。 */}
              <Link
                href={`/admin/events/new?mailMessageId=${mail.id}`}
                className="inline-flex items-center justify-center rounded border border-border-soft bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-alt"
              >
                手動でイベントを作成
              </Link>
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
