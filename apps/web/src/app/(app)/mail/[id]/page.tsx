import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailMessages } from '@kagetra/shared/schema'
import { loadHistories } from '@/lib/mail-history.queries'
import { formatMailDetailDateTime } from '@/lib/member-mail/format'
import { Card, Pill, SectionLabel, type PillTone } from '@/components/ui'
import { MailAttachmentRows } from '../MailAttachmentRows'
import { MailBody } from '../MailBody'
import { MailHistory } from '../MailHistory'
import { isGuestRole } from '@/lib/guest-access'

/**
 * /mail/[id] — 会員向けメール検索・詳細画面（requirements.md §3.1 S2・§3.5・design-spec.md
 * §3/§4/§8）。権限は「ログイン済みか」だけ（role は見ない。`/mail` 一覧と同じ）。
 *
 * ★セクション順は上から ヘッダ → 添付ファイル → 本文 → 処理の記録（design-spec §3 の
 * ユーザーの明示的判断。会員の主目的が「添付を開く」ことなので入れ替えない）。
 */
export const dynamic = 'force-dynamic'

// 種別ピルは既存 /admin/mail-inbox/mail/[id] と同じ MAIL_KIND_LABEL 表記に倣う
// （requirements.md §3.5「既存の /admin/mail-inbox の表記に倣う」）。判断がつかない
// mail_kind 値は存在しない前提（enum は3値のみ）だが、防御的に該当なしは undefined。
const MAIL_KIND_LABEL: Record<string, { label: string; tone: PillTone }> = {
  tournament_notice: { label: '大会案内', tone: 'brand' },
  applicant_roster: { label: '申込名簿', tone: 'brand' },
  confirmed_roster: { label: '確定名簿', tone: 'brand' },
}

const TRIAGE_LABEL: Record<'unprocessed' | 'processed', { label: string; tone: PillTone }> = {
  unprocessed: { label: '未処理', tone: 'warn' },
  processed: { label: '処理済み', tone: 'success' },
}

export default async function MailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect('/auth/signin')
  // guest-role: ゲストは会員向け画面に入れない（許可リスト。middleware の
  // 早期ゲートに加えた Node 側の実防御 — Edge の JWT role は降格直後 stale
  // になりうる）。requirements R2 / AC-10
  if (isGuestRole(session.user?.role)) redirect('/403')

  const { id } = await params
  // 動的セグメントは正規な 10 進正整数のみを受ける（`1.5` `1e5` `0` `01` は 404）。
  // 先頭ゼロを弾くのは `01` と `1` が同じ行を指す別 URL になるのを避けるため。
  if (!/^[1-9]\d*$/.test(id)) notFound()
  const mailId = Number.parseInt(id, 10)
  // `mail_messages.id` は int4。上限超過をそのままクエリに載せると pg が範囲外
  // エラーを投げて 500 になるので、境界で 404 に倒す（API ルートと同じ規約）。
  if (mailId > 2147483647) notFound()

  // AC-28: mail_attachments.data（bytea）は projection に含めない。attachments の
  // columns を明示列挙することで data 列を SELECT させない（既存
  // /admin/mail-inbox/mail/[id]/page.tsx と同じ方式）。
  const mail = await db.query.mailMessages.findFirst({
    where: eq(mailMessages.id, mailId),
    columns: {
      id: true,
      subject: true,
      fromName: true,
      fromAddress: true,
      receivedAt: true,
      bodyText: true,
      bodyHtml: true,
      mailKind: true,
      triageStatus: true,
    },
    with: {
      attachments: {
        columns: {
          id: true,
          filename: true,
          contentType: true,
          sizeBytes: true,
        },
        orderBy: (a, { asc }) => [asc(a.id)],
      },
    },
  })
  if (!mail) notFound()

  const historyMap = await loadHistories(db, [mailId])
  const history = historyMap.get(mailId) ?? []

  const mailKind = mail.mailKind ? MAIL_KIND_LABEL[mail.mailKind] : null
  const triage = TRIAGE_LABEL[mail.triageStatus]
  const body = mail.bodyText ?? mail.bodyHtml
  const hasAttachments = mail.attachments.length > 0
  const hasBody = Boolean(body)

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link href="/mail" className="text-xs text-brand-fg">
        ‹ 受信メール
      </Link>

      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-ink-meta">
              {formatMailDetailDateTime(mail.receivedAt)}
            </span>
            <div className="flex items-center gap-1.5">
              {mailKind && (
                <Pill tone={mailKind.tone} size="sm">
                  {mailKind.label}
                </Pill>
              )}
              <Pill tone={triage.tone} size="sm">
                {triage.label}
              </Pill>
            </div>
          </div>
          <h1 className="font-display text-lg font-bold leading-tight text-ink">
            {mail.subject || '(件名なし)'}
          </h1>
          <div className="text-[10px] text-ink-meta">
            {mail.fromName ? `${mail.fromName} <${mail.fromAddress}>` : mail.fromAddress}
          </div>
        </div>
      </Card>

      {hasAttachments && (
        <div>
          <SectionLabel>添付ファイル {mail.attachments.length}件</SectionLabel>
          <Card>
            <MailAttachmentRows items={mail.attachments} mailId={mailId} />
          </Card>
        </div>
      )}

      {hasBody && (
        <div>
          <SectionLabel>本文</SectionLabel>
          <MailBody body={body as string} />
        </div>
      )}

      {/* AC-29: 本文・添付が両方無いメール（未処理・fetch_failed 等）は例外を出さず、
          上の2セクションの代わりに空状態だけを出す（edge.html ③）。 */}
      {!hasAttachments && !hasBody && (
        <div className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
          <p className="text-[13px] text-ink-2">このメールには本文と添付がありません</p>
          <p className="text-[10px] text-ink-meta">
            取り込みの途中で本文を取得できなかった可能性があります。
          </p>
        </div>
      )}

      {/* H6（未処理）や履歴が導出できないメールはセクション自体を出さない（空カード禁止）。 */}
      {history.length > 0 && (
        <div>
          <SectionLabel>処理の記録</SectionLabel>
          <Card>
            <MailHistory rows={history} />
          </Card>
        </div>
      )}
    </div>
  )
}
