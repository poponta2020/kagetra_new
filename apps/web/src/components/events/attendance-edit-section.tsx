'use client'

import { useState, useTransition } from 'react'
import type {
  AttendanceEditAttendee,
  AttendanceEditUser,
} from '@/lib/events/attendance-edit'
import { isGuestRole } from '@/lib/guest-access'
import { roleViewLabel } from '@/lib/role-preview'
import { Btn } from '@/components/ui'

/**
 * admin-attendance-edit タスク2: `/events/[id]/edit` の「参加者」セクション。
 *
 * ★`EventForm` の**外**（下）に置く独立セクション。追加・削除はフォームの
 * 「保存」とは無関係に**即時確定する** —— 保存ボタンに巻き込むと、他の項目を
 * 直したくないときに参加者だけ変えられなくなる（要件 §3.1）。
 *
 * 反映は Server Action 側の `revalidatePath` に委ね、ここではローカル state に
 * 参加者一覧を持たない（持つと DB と画面の2系統になり、失敗時に食い違う）。
 *
 * 認可は Server Action が持つ。このコンポーネントは role を見ない —— 描画の
 * 出し分けだけに頼らない方針（要件 §6）。
 */

const LABEL_CLASS = 'block text-xs font-semibold text-ink-meta tracking-[0.02em]'
const FIELD_CLASS =
  'mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30'

/** 詳細ページの参加者欄に出ない行であることの説明（`outOfScope` の印の title）。 */
const OUT_OF_SCOPE_TITLE =
  '対象級外または招待対象外のため、詳細ページの参加者欄には出ません'

export interface AttendanceEditSectionProps {
  eventId: number
  /** `attend=true` の全行（対象外の stale 行も含む）。 */
  attendees: readonly AttendanceEditAttendee[]
  /** 追加候補（対象ユーザー − 参加済み）。 */
  candidates: readonly AttendanceEditUser[]
  addAction: (eventId: number, userId: string) => Promise<void>
  removeAction: (eventId: number, userId: string) => Promise<void>
}

function displayName(user: Pick<AttendanceEditUser, 'name'>): string {
  return user.name ?? '（氏名未設定）'
}

/** 氏名＋級添字＋ゲスト印。詳細ページの参加者欄と同じ最小表現。 */
function UserLabel({ user }: { user: AttendanceEditUser }) {
  return (
    <>
      {displayName(user)}
      {user.grade && (
        <i className="ml-0.5 font-mono not-italic text-ink-meta">{user.grade}</i>
      )}
      {isGuestRole(user.role) && (
        <span className="ml-0.5 text-[10px] text-ink-meta">{roleViewLabel('guest')}</span>
      )}
    </>
  )
}

export function AttendanceEditSection({
  eventId,
  attendees,
  candidates,
  addAction,
  removeAction,
}: AttendanceEditSectionProps) {
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [isPending, startAttendanceChange] = useTransition()

  const query = filter.trim().toLowerCase()
  const filtered =
    query === ''
      ? candidates
      : candidates.filter((c) => displayName(c).toLowerCase().includes(query))

  function run(userId: string, action: () => Promise<void>, fallbackMessage: string) {
    setError(null)
    setPendingUserId(userId)
    startAttendanceChange(async () => {
      try {
        await action()
      } catch (e) {
        setError(e instanceof Error ? e.message : fallbackMessage)
      } finally {
        setPendingUserId(null)
      }
    })
  }

  return (
    <section className="rounded-md border border-border p-3">
      <p className={LABEL_CLASS}>参加者（{attendees.length}名）</p>
      <p className="mt-1 text-[11px] text-ink-meta">
        追加・削除はこの場で確定します（下の「保存」とは別）。削除すると「未回答」に戻ります。
      </p>
      {error && <p className="mt-1 text-xs text-danger-fg">{error}</p>}

      {attendees.length === 0 ? (
        <p className="mt-2 text-xs text-ink-meta">まだ参加者がいません。</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {attendees.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 break-words text-sm text-ink">
                <UserLabel user={a} />
                {a.outOfScope && (
                  <span className="ml-1 text-[10px] text-accent-fg" title={OUT_OF_SCOPE_TITLE}>
                    対象外
                  </span>
                )}
              </span>
              <Btn
                kind="danger"
                size="sm"
                aria-label={`${displayName(a)} を参加者から削除`}
                disabled={isPending}
                onClick={() =>
                  run(
                    a.id,
                    () => removeAction(eventId, a.id),
                    '参加者の削除に失敗しました',
                  )
                }
              >
                {pendingUserId === a.id ? '削除中…' : '削除'}
              </Btn>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <p className={LABEL_CLASS}>参加者を追加</p>
        <input
          type="text"
          placeholder="氏名で絞り込み"
          aria-label="追加候補を氏名で絞り込み"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={FIELD_CLASS}
        />
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {filtered.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-words text-sm text-ink">
                <UserLabel user={c} />
              </span>
              <Btn
                kind="secondary"
                size="sm"
                aria-label={`${displayName(c)} を参加者に追加`}
                disabled={isPending}
                onClick={() =>
                  run(c.id, () => addAction(eventId, c.id), '参加者の追加に失敗しました')
                }
              >
                {pendingUserId === c.id ? '追加中…' : '追加'}
              </Btn>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="text-xs text-ink-meta">
              {candidates.length === 0
                ? '追加できる会員がいません。'
                : '該当する会員がいません。'}
            </li>
          )}
        </ul>
      </div>
    </section>
  )
}
