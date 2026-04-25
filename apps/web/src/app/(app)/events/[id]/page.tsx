import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { events, users } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { and, eq, inArray } from 'drizzle-orm'
import { auth } from '@/auth'
import {
  AttendanceCounts,
  Btn,
  Card,
  DescList,
  type DescListItem,
  GradePill,
  Pill,
  SectionLabel,
  StatusPill,
} from '@/components/ui'
import { submitAttendance } from './actions'

// Mirrors EventForm's CANCEL_LINK_CLASS but at size sm so the edit affordance
// matches the back link's visual weight in the in-page header bar.
const EDIT_LINK_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors h-8 px-3 text-xs bg-surface text-ink-2 border border-border hover:bg-surface-alt'

/** Extract the surname for the participant chip (split on ASCII or full-width space). */
function surname(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.split(/[\s　]/)
  return parts[0] || name
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const idNum = Number(id)
  if (!Number.isInteger(idNum) || idNum <= 0) notFound()
  const session = await auth()
  const isAdmin =
    session?.user.role === 'admin' || session?.user.role === 'vice_admin'

  const event = await db.query.events.findFirst({
    where: eq(events.id, idNum),
    with: {
      eventGroup: true,
      attendances: {
        with: { user: true },
      },
    },
  })

  if (!event) notFound()

  // Unanswered count must only consider invited users; the users table may contain
  // legacy/migration rows with isInvited=false that should not count toward the denominator.
  const eligibleUsers = await db.query.users.findMany({
    columns: { id: true, name: true },
    where: event.eligibleGrades?.length
      ? and(eq(users.isInvited, true), inArray(users.grade, event.eligibleGrades))
      : eq(users.isInvited, true),
  })

  // Domain rule (CLAUDE.md): 未回答 = 不参加扱い. Both the participant chips and
  // the count cards are scoped to currently-eligible attendees so that 参加 +
  // (不参加 + 未回答) always equals the eligible denominator. Stale attend=true
  // rows from non-eligible users (e.g. grade changed, or admin-override answers
  // for a different cohort) are excluded from the displayed totals.
  const eligibleUserIdSet = new Set(eligibleUsers.map((u) => u.id))
  const eligibleAttendingList = event.attendances.filter(
    (a) => a.attend && eligibleUserIdSet.has(a.userId),
  )
  const nonAttendingCount = Math.max(
    0,
    eligibleUsers.length - eligibleAttendingList.length,
  )

  // Check if current user can respond to attendance (JST-based comparison)
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const isBeforeDeadline = !event.internalDeadline || event.internalDeadline >= todayStr
  const myAttendance = session
    ? event.attendances.find((a) => a.userId === session.user.id)
    : null

  // Fetch current user's grade + isInvited from DB if logged in
  let currentUserGrade: Grade | null = null
  let currentUserIsInvited = false
  if (session?.user.id) {
    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    })
    currentUserGrade = currentUser?.grade ?? null
    currentUserIsInvited = currentUser?.isInvited ?? false
  }

  const isEligible =
    !event.eligibleGrades?.length ||
    (currentUserGrade != null && event.eligibleGrades.includes(currentUserGrade))
  // Admins/vice-admins bypass deadline/grade/invite checks (administrative override).
  // For non-admins, isInvited is required because Auth.js signIn allows returning users
  // (with already-linked accounts) to skip the isInvited gate — so the app must re-check here.
  // Non-admin users with grade=null are considered ineligible when the event has eligibleGrades;
  // there is no self-service grade UI in this PR, so such users must ask an admin to set it.
  const canRespond =
    session && (isAdmin || (currentUserIsInvited && isBeforeDeadline && isEligible))
  const boundSubmitAttendance = submitAttendance.bind(null, event.id)

  // Sort participants by ascending grade (A < B < ... < E); unranked goes last.
  const sortedAttending = eligibleAttendingList
    .slice()
    .sort((a, b) => (a.user.grade ?? 'Z').localeCompare(b.user.grade ?? 'Z'))

  const detailItems: DescListItem[] = [
    ...(event.formalName
      ? [{ label: '正式名称', value: event.formalName }]
      : []),
    {
      label: '日付',
      value: (
        <>
          {event.eventDate}
          {event.startTime && ` ${event.startTime}`}
          {event.endTime && `〜${event.endTime}`}
        </>
      ),
    },
    ...(event.location ? [{ label: '会場', value: event.location }] : []),
    ...(event.eligibleGrades?.length
      ? [
          {
            label: '対象級',
            value: (
              <div className="flex flex-wrap gap-1.5">
                {event.eligibleGrades.map((g) => (
                  <GradePill key={g} grade={g} size="sm" />
                ))}
              </div>
            ),
          },
        ]
      : []),
    ...(event.capacity != null
      ? [{ label: '定員', value: `${event.capacity}名` }]
      : []),
    ...(event.eventGroup?.name
      ? [{ label: '大会グループ', value: event.eventGroup.name }]
      : []),
    ...(event.entryDeadline
      ? [{ label: '大会申込締切', value: event.entryDeadline }]
      : []),
    ...(event.internalDeadline
      ? [{ label: '会内締切', value: event.internalDeadline }]
      : []),
    { label: 'ステータス', value: <StatusPill status={event.status} size="sm" /> },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link href="/events" className="text-sm text-brand">
          ← イベント一覧
        </Link>
        {isAdmin && (
          <Link href={`/events/${event.id}/edit`} className={EDIT_LINK_CLASS}>
            編集
          </Link>
        )}
      </div>

      <div>
        <h1 className="font-display text-[28px] font-bold text-ink leading-tight">
          {event.title}
        </h1>
        {event.official && (
          <div className="mt-1.5">
            <Pill tone="success" size="sm">
              公認
            </Pill>
          </div>
        )}
      </div>

      <Card>
        <DescList items={detailItems} />
      </Card>

      {event.description && (
        <Card>
          <SectionLabel>詳細</SectionLabel>
          <div className="whitespace-pre-wrap text-sm text-ink">
            {event.description}
          </div>
        </Card>
      )}

      <Card>
        <SectionLabel>出欠状況</SectionLabel>
        <AttendanceCounts
          ev={{
            attendIds: eligibleAttendingList.map((a) => a.userId),
            nonAttendingCount,
          }}
          variant="cards"
        />
      </Card>

      {eligibleAttendingList.length > 0 && (
        <Card>
          <SectionLabel>参加者 ({eligibleAttendingList.length}名)</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {sortedAttending.map((a) => (
              <span
                key={a.userId}
                className="inline-flex items-center gap-1.5 rounded-full bg-neutral-bg px-2 py-0.5 text-xs text-neutral-fg"
              >
                {surname(a.user.name)}
                {a.user.grade && <GradePill grade={a.user.grade} size="sm" />}
              </span>
            ))}
          </div>
        </Card>
      )}

      {!canRespond && session && (
        <Card>
          <div className="text-sm text-ink-meta">
            {!currentUserIsInvited && '出欠回答の対象外です'}
            {currentUserIsInvited &&
              !isBeforeDeadline &&
              '会内締切を過ぎています'}
            {currentUserIsInvited &&
              isBeforeDeadline &&
              currentUserGrade == null &&
              '級が未設定のため回答できません'}
            {currentUserIsInvited &&
              isBeforeDeadline &&
              currentUserGrade != null &&
              !isEligible &&
              '対象外の級です'}
          </div>
        </Card>
      )}

      {canRespond && (
        <Card>
          {/* Comment editor is intentionally separated from the sticky toggle so
              the toggle can keep submitting only `attend` (preserves an existing
              comment via submitAttendance's omitted-field guard), while this
              form explicitly sends `comment` when the user wants to edit it. */}
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-ink-meta tracking-[0.02em]">
              コメント{myAttendance?.comment ? '（記入済み）' : ''}
            </summary>
            <form
              action={boundSubmitAttendance}
              className="mt-3 flex flex-col gap-2"
            >
              <input
                type="hidden"
                name="attend"
                value={myAttendance?.attend === true ? 'true' : 'false'}
              />
              <textarea
                name="comment"
                rows={2}
                defaultValue={myAttendance?.comment ?? ''}
                className="block w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <div className="flex justify-end">
                <Btn type="submit" kind="secondary" size="sm">
                  コメントを保存
                </Btn>
              </div>
            </form>
          </details>
        </Card>
      )}

      {canRespond && (
        <div className="sticky bottom-0 bg-canvas/95 backdrop-blur border-t border-border-soft p-3">
          <form action={boundSubmitAttendance}>
            <input
              type="hidden"
              name="attend"
              value={myAttendance?.attend === true ? 'false' : 'true'}
            />
            <Btn
              type="submit"
              kind={myAttendance?.attend === true ? 'secondary' : 'primary'}
              size="lg"
              block
            >
              {myAttendance?.attend === true ? '参加をキャンセル' : '参加する'}
            </Btn>
          </form>
        </div>
      )}
    </div>
  )
}
