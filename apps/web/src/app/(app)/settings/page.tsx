import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth, signOut } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { Pill, SectionLabel } from '@/components/ui'
import { buildRolePreviewSelection, roleViewLabel } from '@/lib/role-preview'
import { isGuestRole } from '@/lib/guest-access'
import { setRolePreviewAction } from '../role-preview-actions'

interface SettingsLink {
  href: string
  label: string
  /** 補足の 1 行説明。項目名だけでは何が起きるか分からないものに付ける。 */
  description?: string
}

/**
 * nav-settings-hub: 設定ハブ。
 *
 * 上部バー（44px）の `{name}さん` タップで開いていたボトムシートを廃止し、
 * その中身をボトムナビ「設定」タブから開く独立ページへ移した。あわせて
 * 日常動線ではない管理導線（会員 / Bot）をナビから引き取っている。
 *
 * 行のスタイルは廃止した設定シートのリスト行（`px-2 py-3` ＋ 右端 `›`）を
 * 引き継ぎ、Card では包まずに区切り線でグループ化する。項目数が少なく、
 * Card で囲うと余白ばかりの画面になるため。
 */
export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/auth/signin')

  const role = session.user.role
  const isAdmin = role === 'admin' || role === 'vice_admin'
  const userLabel = session.user.name ? `${session.user.name}さん` : ''

  const signOutAction = async () => {
    'use server'
    await signOut({ redirectTo: '/auth/signin' })
  }

  // guest-role: ゲストは表示のみ（表示名・級・所属会）＋ログアウトの専用
  // ビュー（requirements S7 / AC-24）。通知設定・申込書設定・会員一覧への
  // 導線も、切替不能な LINE アカウント切替（`/settings/line-link` は
  // ゲストを /403 へ弾く）も一切出さないので、下の会員/管理者向けの
  // レンダリングとは分岐する。表示ロールのプレビューセクションは
  // `buildRolePreviewSelection` が guest に対して null を返すため自然に
  // 消えるが、それ以外（アカウントセクション・管理セクション）はここで
  // 明示的に描画しないことで担保する。
  if (isGuestRole(role)) {
    const guestProfile = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { grade: true, affiliation: true },
    })

    return (
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-xl font-bold text-ink">設定</h1>
          {userLabel ? (
            <p className="text-[13px] text-ink-meta">{userLabel}</p>
          ) : null}
        </div>

        <section>
          <SectionLabel>登録情報</SectionLabel>
          <dl className="divide-y divide-border border-y border-border bg-surface">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-sm text-ink-2">表示名</dt>
              <dd className="text-sm text-ink">{session.user.name ?? '未設定'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-sm text-ink-2">級</dt>
              <dd className="text-sm text-ink">
                {guestProfile?.grade ? `${guestProfile.grade}級` : '未設定'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-sm text-ink-2">所属会</dt>
              <dd className="text-sm text-ink">
                {guestProfile?.affiliation || '未設定'}
              </dd>
            </div>
          </dl>
        </section>

        <form action={signOutAction} className="pt-1">
          <button
            type="submit"
            className="w-full rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-alt"
          >
            ログアウト
          </button>
        </form>
      </div>
    )
  }

  const realRole = session.user.realRole ?? session.user.role
  const rolePreview = buildRolePreviewSelection(
    session.user.id,
    realRole,
    session.user.role,
    process.env.ROLE_PREVIEW_USER_IDS,
  )
  const isPreviewing =
    !!rolePreview && rolePreview.current !== rolePreview.real

  const accountLinks: SettingsLink[] = [
    {
      href: '/settings/line-link',
      label: 'LINE アカウント切替',
      description: '通知を受け取る LINE アカウントを変更します',
    },
  ]

  // メール通知 (Web Push) はページ側も /403 で管理者に絞られている。
  // ここで隠すのは導線の整合であって認可ではない（認可は各ページが持つ）。
  const adminLinks: SettingsLink[] = isAdmin
    ? [
        {
          href: '/admin/members',
          label: '会員',
          description: '会員の追加・編集・招待リンクの発行',
        },
        {
          href: '/settings/notifications',
          label: 'メール通知',
          description: '新着メールのプッシュ通知',
        },
        {
          href: '/settings/entry-form',
          label: '申込書設定',
          description: '申込書ヘッダとメール署名に使う会の情報',
        },
        {
          href: '/admin/line-channels',
          label: 'Bot',
          description: 'LINE Bot プールとグループの紐付け',
        },
      ]
    : []

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-bold text-ink">設定</h1>
        {userLabel ? (
          <p className="text-[13px] text-ink-meta">{userLabel}</p>
        ) : null}
      </div>

      <section>
        <SectionLabel>アカウント</SectionLabel>
        <SettingsLinkList items={accountLinks} />
      </section>

      {adminLinks.length > 0 ? (
        <section>
          <SectionLabel>管理</SectionLabel>
          <SettingsLinkList items={adminLinks} />
        </section>
      ) : null}

      {rolePreview ? (
        <section>
          <SectionLabel>表示ロール</SectionLabel>
          <div className="divide-y divide-border border-y border-border bg-surface">
            <form action={setRolePreviewAction} className="flex flex-col">
              {/* nav-settings-hub: 設定ページ内で切り替えるので、切替後も
                  この画面に留まる。以前は「シートを開いた画面」へ戻していたが、
                  それはシートが全画面から開けた前提の設計だった。 */}
              <input type="hidden" name="returnTo" value="/settings" />
              {rolePreview.selectable.map((r) => {
                const current = rolePreview.current === r
                return (
                  <button
                    key={r}
                    type="submit"
                    name="role"
                    value={r}
                    aria-current={current ? 'true' : undefined}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-left text-sm text-ink-1 transition-colors hover:bg-surface-alt"
                  >
                    <span className={current ? 'font-semibold text-brand' : undefined}>
                      {roleViewLabel(r)}
                    </span>
                    {current ? (
                      <Pill tone="brand" size="sm">
                        {isPreviewing ? '表示中' : '本来のロール'}
                      </Pill>
                    ) : null}
                  </button>
                )
              })}
            </form>
          </div>
          {isPreviewing ? (
            <p className="px-1 pt-2 text-xs text-ink-meta">
              いま {roleViewLabel(rolePreview.current)}
              として表示しています。元に戻すには
              {roleViewLabel(rolePreview.real)}を選んでください。
            </p>
          ) : null}
        </section>
      ) : null}

      <form action={signOutAction} className="pt-1">
        <button
          type="submit"
          className="w-full rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-alt"
        >
          ログアウト
        </button>
      </form>
    </div>
  )
}

function SettingsLinkList({ items }: { items: SettingsLink[] }) {
  return (
    <nav className="divide-y divide-border border-y border-border bg-surface">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-alt"
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-sm text-ink-1">{item.label}</span>
            {item.description ? (
              <span className="text-xs text-ink-meta">{item.description}</span>
            ) : null}
          </span>
          <span aria-hidden className="text-ink-meta">
            ›
          </span>
        </Link>
      ))}
    </nav>
  )
}
