import { auth } from '@/auth'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { users } from '@kagetra/shared/schema'
import { eq } from 'drizzle-orm'
import type { Grade, Gender } from '@kagetra/shared/types'
import { EditMemberForm } from './edit-member-form'
import { toggleMemberDeactivation, unlinkLine } from './actions'
import { formatLinkedAt, formatLinkMethod } from '../../_line-link-format'

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E'] as const
const GENDERS: readonly Gender[] = ['male', 'female'] as const

export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  const { id } = await params
  const member = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: {
      id: true,
      name: true,
      role: true,
      grade: true,
      gender: true,
      affiliation: true,
      dan: true,
      zenNichikyo: true,
      deactivatedAt: true,
      isInvited: true,
      lineUserId: true,
      lineLinkedAt: true,
      lineLinkedMethod: true,
    },
  })
  if (!member) notFound()

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/members"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 会員一覧へ戻る
        </Link>
        <h2 className="mt-2 text-xl font-bold">
          会員編集: {member.name ?? '未設定'}
        </h2>
        {member.deactivatedAt && (
          <p className="mt-1 inline-block rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
            退会済み（{member.deactivatedAt.toLocaleDateString('ja-JP')}）
          </p>
        )}
      </div>

      <EditMemberForm
        userId={member.id}
        name={member.name ?? ''}
        grade={member.grade ?? null}
        gender={member.gender ?? null}
        affiliation={member.affiliation ?? ''}
        dan={member.dan ?? null}
        zenNichikyo={member.zenNichikyo}
        grades={GRADES}
        genders={GENDERS}
      />

      {member.lineUserId && (
        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold">LINE 紐付け</h3>
          <dl className="mt-2 space-y-1 text-sm text-gray-600">
            <div>
              <dt className="inline font-medium">紐付け日時: </dt>
              <dd className="inline">
                {member.lineLinkedAt ? formatLinkedAt(member.lineLinkedAt) : '不明'}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">方法: </dt>
              <dd className="inline">{formatLinkMethod(member.lineLinkedMethod)}</dd>
            </div>
          </dl>
          {session.user?.role === 'admin' && (
            <form action={unlinkLine} className="mt-3">
              <input type="hidden" name="userId" value={member.id} />
              <button
                type="submit"
                className="rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
              >
                LINE 紐付けを解除
              </button>
            </form>
          )}
          <p className="mt-2 text-xs text-gray-500">
            解除すると本人の次回 LINE ログインで /self-identify から再選択できます。
          </p>
        </section>
      )}

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold">退会処理</h3>
        <p className="mt-1 text-xs text-gray-600">
          退会処理するとログインできなくなります。取り消しで復帰できます。
        </p>
        <form action={toggleMemberDeactivation} className="mt-3">
          <input type="hidden" name="userId" value={member.id} />
          <button
            type="submit"
            className={
              member.deactivatedAt
                ? 'rounded-md bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700'
                : 'rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700'
            }
          >
            {member.deactivatedAt ? '退会を取り消す' : '退会処理する'}
          </button>
        </form>
      </section>
    </div>
  )
}
