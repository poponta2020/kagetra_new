import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { mailMessages } from '@kagetra/shared/schema'
import { Card, Pill, type PillTone } from '@/components/ui'

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

  const rows = await db.query.mailMessages.findMany({
    orderBy: (m, { desc }) => [desc(m.receivedAt)],
    limit: 100,
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink">メール受信箱</h1>
      </div>

      {rows.length === 0 ? (
        <Card>
          <div className="py-6 text-center text-ink-meta">
            まだメールが取り込まれていません
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const status = STATUS_LABEL[row.status] ?? {
              label: row.status,
              tone: 'neutral' as const,
            }
            const classification = row.classification
              ? CLASSIFICATION_LABEL[row.classification]
              : null
            return (
              <Card key={row.id}>
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
                    {row.fromName ? `${row.fromName} <${row.fromAddress}>` : row.fromAddress}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
