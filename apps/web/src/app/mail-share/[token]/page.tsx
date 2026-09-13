import type { Metadata } from 'next'
import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { mailBodyShareTokens, mailMessages } from '@kagetra/shared/schema'
import { stripMailFooter } from '@/lib/mail-body-cleaner'
import { formatMailDetailDateTime } from '@/lib/member-mail/format'
import { Card } from '@/components/ui'

/**
 * `/mail-share/[token]` — mail-body-as-image 改修（要件定義書 タスク4）。
 * LINE へ送る本文カードのタップ先。未ログインの非会員 (LINE グループの
 * 他会応援者等) が開く前提の**認証無し**公開ページ (requirements.md AC-13〜18)。
 *
 * `(app)` グループの外に置くのが必須要件（ボトムナビ等の会員向け UI を
 * 一切持ち込まない）。本文は untrusted input (IMAP 経由の外部メール) なので
 * `dangerouslySetInnerHTML` は使わず、React の通常描画（自動エスケープ）に
 * 委ねる。`(app)/mail/MailBody.tsx` は import しない（clamp/expand の client
 * component依存を公開ルートへ染み出させないため。このページは元々全文表示
 * なので折りたたみ自体が不要）。
 *
 * トークンの存在有無を外部から推測させないため、形式不正・存在しない・
 * 期限切れは**すべて同一の案内ページ**を返す（`notFound()` は使わない）。
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

// attachment-image-render.ts / mail-body-share.ts と同じ形式
// (randomBytes(24).toString('base64url') = 32 文字。許容幅は 16-64 文字)。
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

function ExpiredNotice() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <h1 className="font-display text-lg font-bold text-ink">有効期限が切れました</h1>
          <p className="text-[13px] text-ink-2">
            このリンクは無効か、有効期限（60日）が切れています。
          </p>
          <p className="text-[11px] text-ink-meta">
            北溟の会員は、アプリの「受信メール」から同じメールを検索できます。
          </p>
        </div>
      </Card>
    </div>
  )
}

export default async function MailSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || !TOKEN_PATTERN.test(token)) {
    return <ExpiredNotice />
  }

  const rows = await db
    .select({
      tokenId: mailBodyShareTokens.id,
      subject: mailMessages.subject,
      receivedAt: mailMessages.receivedAt,
      bodyText: mailMessages.bodyText,
    })
    .from(mailBodyShareTokens)
    .innerJoin(mailMessages, eq(mailMessages.id, mailBodyShareTokens.mailMessageId))
    .where(
      and(
        eq(mailBodyShareTokens.token, token),
        gt(mailBodyShareTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)

  const hit = rows[0]
  if (!hit) {
    return <ExpiredNotice />
  }

  // access_count は異常検知用の参考値のみ (認可判断には使わない)。
  // 加算失敗でページを 500 にしないよう、失敗は握りつぶす (表示前後どちらでもよい)。
  await db
    .update(mailBodyShareTokens)
    .set({ accessCount: sql`${mailBodyShareTokens.accessCount} + 1` })
    .where(eq(mailBodyShareTokens.id, hit.tokenId))
    .catch(() => {})

  const cleanedBody = hit.bodyText ? stripMailFooter(hit.bodyText) : ''

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <div className="flex flex-col gap-2">
          <span className="text-[10px] text-ink-meta">
            {formatMailDetailDateTime(hit.receivedAt)}
          </span>
          <h1 className="font-display text-lg font-bold leading-tight text-ink">
            {hit.subject || '(件名なし)'}
          </h1>
        </div>
      </Card>

      <pre className="whitespace-pre-wrap break-words rounded-md border border-border-soft bg-surface-alt px-2.5 py-2 text-xs leading-[1.55] text-ink-2">
        {cleanedBody || '(本文なし)'}
      </pre>
    </div>
  )
}
