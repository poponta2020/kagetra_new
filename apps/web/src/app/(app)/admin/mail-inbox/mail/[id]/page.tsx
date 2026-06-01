import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailMessages } from '@kagetra/shared/schema'
import { Card, Pill, type PillTone } from '@/components/ui'
import { AttachmentList } from '../../components/AttachmentList'
import { TriageActions, type TriageStatus } from '../../components/TriageActions'

/**
 * /admin/mail-inbox/mail/[id] — mail-triage-badge: 全メールの詳細 + トリアージ。
 *
 * 既存の /admin/mail-inbox/[id] は tournament_drafts.id ベースで「AI が大会案内と
 * 判定したメール」の承認画面。本ページは mail_messages.id ベースで、ノイズ/非大会
 * を含む全メールの本文・添付・AI 分類を表示し、triage アクション（対応不要/保留/
 * 取消）を提供する。draft があるメールは承認動線（[id]）へのリンクを出す。
 */
export const dynamic = 'force-dynamic'

const CLASSIFICATION_LABEL: Record<string, { label: string; tone: PillTone }> = {
  tournament: { label: '大会案内', tone: 'brand' },
  noise: { label: 'ノイズ', tone: 'neutral' },
  unknown: { label: '不明', tone: 'neutral' },
}

const TRIAGE_LABEL: Record<TriageStatus, { label: string; tone: PillTone }> = {
  unprocessed: { label: '未処理', tone: 'warn' },
  deferred: { label: '保留', tone: 'info' },
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
  // バイナリを載せない）。本文は bodyText のみ使う。
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
      // 1:0..1。draft があれば承認動線（[id]）へ誘導する。
      draft: { columns: { id: true, status: true } },
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
          {mail.bodyText && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium text-ink-meta">
                本文プレビュー
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-border-soft bg-surface-alt p-2 text-xs text-ink">
                {mail.bodyText}
              </pre>
            </details>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-sm font-semibold text-ink-2">処理</h2>
          <TriageActions mailId={mail.id} triageStatus={mail.triageStatus} size="md" />
          <p className="text-xs text-ink-meta">
            「対応不要」で処理済み（未処理バッジから除外）、「保留」は後で対応（バッジには残る）。
          </p>
        </div>
      </Card>

      {mail.draft && (
        <Card className="border-brand/30 bg-brand-bg">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-ink">
              AI が大会案内として抽出済み
            </span>
            <Link
              href={`/admin/mail-inbox/${mail.draft.id}`}
              className="text-brand-fg underline"
            >
              承認 / 却下 / 紐付けへ →
            </Link>
          </div>
        </Card>
      )}
    </div>
  )
}
