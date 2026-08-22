import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth, signOut } from '@/auth'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { Pill, SectionLabel } from '@/components/ui'
import { buildRolePreviewSelection, roleViewLabel } from '@/lib/role-preview'
import type { RolePreviewSelection } from '@/lib/role-preview'
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

  // role-preview-switch: ゲスト分岐より**前**で組み立てる。ゲストビュー中の
  // 設定ページに出す「表示ロール」セクションが唯一の復帰導線で、分岐の後で
  // 計算するとゲストビューでは到達しない（requirements R7 / AC-21）。
  // `ROLE_PREVIEW_USER_IDS` は関数内で読む（モジュールトップだとビルド時に
  // インライン化され、本番で再起動しても値が反映されない）。
  const realRole = session.user.realRole ?? session.user.role
  const rolePreview = buildRolePreviewSelection(
    session.user.id,
    realRole,
    session.user.role,
    process.env.ROLE_PREVIEW_USER_IDS,
  )

  // guest-role: ゲストは表示のみ（表示名・級・所属会）＋ログアウトの専用
  // ビュー（guest-role requirements S7 / AC-24）。通知設定・申込書設定・
  // 会員一覧への導線も、切替不能な LINE アカウント切替（`/settings/line-link`
  // はゲストを /403 へ弾く）も一切出さないので、下の会員/管理者向けの
  // レンダリングとは分岐する。
  //
  // role-preview-switch: 唯一の例外が「表示ロール」セクションで、これだけは
  // ここにも描画する（AC-21）。ゲストビュー中の管理者が管理者へ戻る唯一の
  // 導線だから。本物のゲストには `buildRolePreviewSelection` が null を
  // 返すので出ない（AC-26）。それ以外（アカウントセクション・管理セクション）
  // をここで描画しないことは従来どおり。
  if (isGuestRole(role)) {
    // 表示名も級・所属会と同じく DB の最新値を使う。毎リクエストの JWT
    // 再検証（node-jwt-callback.ts）は role / LINE 情報こそ同期するが name は
    // 同期しないため、`session.user.name` のままだと管理者がゲストの表示名を
    // 変更してもこの画面には古い名前が出続けてしまう。
    const guestProfile = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { name: true, grade: true, affiliation: true },
    })
    const guestLabel = guestProfile?.name ? `${guestProfile.name}さん` : ''

    return (
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-xl font-bold text-ink">設定</h1>
          {guestLabel ? (
            <p className="text-[13px] text-ink-meta">{guestLabel}</p>
          ) : null}
        </div>

        <section>
          <SectionLabel>登録情報</SectionLabel>
          <dl className="divide-y divide-border border-y border-border bg-surface">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <dt className="text-sm text-ink-2">表示名</dt>
              <dd className="text-sm text-ink">{guestProfile?.name ?? '未設定'}</dd>
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

        <RolePreviewSection selection={rolePreview} />

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

      <RolePreviewSection selection={rolePreview} />

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

/**
 * role-preview-switch の「表示ロール」セクション。
 *
 * ゲスト分岐（表示のみビュー）と会員/管理者ビューの**両方**から描画する。
 * ゲストビュー中はこれが管理者へ戻る唯一の導線なので、ゲスト分岐から外すと
 * 復帰不能になる（requirements R7 / AC-21）。`selection` が null のとき
 * （非プレビュー かつ 許可リスト外、または本物のゲスト）はセクションごと
 * 描画しない。
 */
function RolePreviewSection({
  selection,
}: {
  selection: RolePreviewSelection | null
}) {
  if (!selection) return null
  const isPreviewing = selection.current !== selection.real
  return (
    <section>
      <SectionLabel>表示ロール</SectionLabel>
      <div className="divide-y divide-border border-y border-border bg-surface">
        <form action={setRolePreviewAction} className="flex flex-col">
          {/* nav-settings-hub: 設定ページ内で切り替えるので、切替後も
              この画面に留まる。以前は「シートを開いた画面」へ戻していたが、
              それはシートが全画面から開けた前提の設計だった。 */}
          <input type="hidden" name="returnTo" value="/settings" />
          {selection.selectable.map((r) => {
            const current = selection.current === r
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
          いま {roleViewLabel(selection.current)}
          として表示しています。元に戻すには
          {roleViewLabel(selection.real)}を選んでください。
        </p>
      ) : null}
    </section>
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
