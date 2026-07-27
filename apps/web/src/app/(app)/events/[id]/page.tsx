import { Fragment } from 'react'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import {
  eventBroadcastGuidelineAttachments,
  eventBroadcastMessages,
  eventGradeBroadcasts,
  eventLineBroadcasts,
  events,
  lineChannels,
  lineGradeGroupBindings,
  mailMessages,
  tournamentEntryRosters,
  users,
} from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { resolveTargetGrades } from '@/lib/event-grade-broadcast'
import { auth } from '@/auth'
import { Btn } from '@/components/ui'
import {
  LineBroadcastSection,
  type LineBroadcastBindingStatus,
} from '@/components/events/LineBroadcastSection'
import type { BroadcastHistoryRow } from '@/components/events/BroadcastHistoryTable'
import type { GradeBroadcastRow } from '@/components/events/GradeBroadcastSection'
import { EventLifecycleSection } from '@/components/events/EventLifecycleSection'
import {
  EventDetailHeader,
  GroupDayLinks,
  LinkActionLink,
  SectionRule,
} from '@/components/events/detail'
import { listGroupSiblings } from '@/lib/entry-groups'
import { buildEntryFlow } from '@/lib/events/entry-flow'
import { formatFlowDate } from '@/lib/event-date'
import { todayInJst } from '@/lib/jst-date'
import {
  generateInviteCodeForEvent,
  manualBroadcast,
  resendGradeBroadcast,
  resendGuidelines,
  revokeBroadcast,
  setEntriesApplied,
  setEntryApplied,
  setEntryNotApplying,
  setGuidelineAttachments,
  setPaymentPaid,
  setPaymentsPaid,
  setPaymentType,
  setPaymentTypes,
  submitAttendance,
} from './actions'
import { EventRelatedMails } from './components/EventRelatedMails'
import { RosterSection } from './components/RosterSection'
import { surname } from '@/lib/surname'

const ACTIVE_BROADCAST_STATUSES = [
  'invite_pending',
  'joined_waiting_code',
  'linked',
] as const

/**
 * 大会申込詳細。event-detail-redesign: 罫線＋余白主導（脱カード）へ作り替えた。
 * カードを使うのは関連メールの1件ずつだけで、運営操作は `<details>`（既定=閉）に
 * 畳む。既定表示では会員も管理者も「どの大会か・今どの段階か・自分は出るか」
 * だけが見える。要件は docs/features/event-detail-redesign/requirements.md、
 * 視覚の正は同ディレクトリの design-spec.md / design-mock/redesign.html。
 *
 * ★このファイルにヘルパーコンポーネントを増やさないこと。`page-padding.test.ts`
 * （AC-23）が「ファイル全体で `  return (` がちょうど1本・その次行が padding
 * utility」を機械的に検査しており、2 スペースインデントの `return (` が増えると
 * アンカーが曖昧になって落ちる。分割するなら components/events/detail/ へ。
 */
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
      attendances: {
        with: { user: true },
      },
      // entry-groups タスク8: 名簿の帰属が event → entry_group へ移ったので、
      // `entryGroup: { with: { rosters } }` を辿る（`eventsRelations.rosters` は撤去済み）。
      // グループ内のどの日の詳細からも同一の名簿が見える（AC-17）。
      //
      // ★`columns` で表示に使う列だけを明示的に取る。event-detail-redesign で
      // `RosterSection` を client component 化したため、この結果は **RSC payload
      // としてブラウザへ直列化される**。TypeScript の `RosterView` 型は実行時に
      // 余剰プロパティを落とさないので、列を絞らないと note（管理メモ）/
      // approvedByUserId / source_*（取込元メール・添付）/ rawKana / rawDan /
      // selectionOutcome（抽選結果）等の内部列と非表示の個人情報が一般会員へ
      // 渡ってしまう（Server Component だった従来は直列化されなかった）。
      entryGroup: {
        columns: { id: true },
        with: {
          rosters: {
            where: isNull(tournamentEntryRosters.supersededAt),
            orderBy: [desc(tournamentEntryRosters.version)],
            columns: { id: true, rosterType: true, version: true, publishedAt: true },
            with: {
              entries: {
                columns: {
                  id: true,
                  rawName: true,
                  grade: true,
                  rawAffiliation: true,
                  status: true,
                  userId: true,
                },
                with: { user: { columns: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  })

  if (!event) notFound()

  // entry-groups タスク4 (AC-16): 同じ申込グループの日一覧（開催日昇順・自分を
  // 含む）。全ロールへ表示するグループ日リンクと、管理者向け進行操作の一括
  // ダイアログの両方が使う。
  const groupSiblings = await listGroupSiblings(db, event.id)

  // event-line-broadcast: 紐付け状態と配信履歴を取得する。
  //
  // rr2 review blocker: LineBroadcastSection は `use client` なので、
  // props は RSC payload としてブラウザに必ず届く。非管理者には Bot 名 /
  // グループ ID 末尾 / 配信履歴 / エラーメッセージなど管理者専用情報を
  // **そもそも送らない** こと（AC-28）。event-detail-redesign 後の
  // LineBroadcastSection は非管理者に何も描画しないが、status のみスタブを
  // 渡す遮断方式は要件 §6 の契約としてそのまま維持する。
  // entry-groups タスク3: 帰属は entry_group_id。event は既に全列取得済み
  // なので追加クエリなしで event.entryGroupId を使う（AC-4: グループ内の
  // どの日から見ても同一の紐付け状態が見える）。
  const broadcastStatusRow = await db
    .select({ status: eventLineBroadcasts.status })
    .from(eventLineBroadcasts)
    .where(
      and(
        eq(eventLineBroadcasts.entryGroupId, event.entryGroupId),
        inArray(eventLineBroadcasts.status, ACTIVE_BROADCAST_STATUSES),
      ),
    )
    .limit(1)
  const activeBroadcastStatus = broadcastStatusRow[0]?.status ?? null
  // Lifecycle notifications only fire on a live (linked) group. Drives the
  // confirm prompt in the 進行管理 section.
  const isLineLinked = activeBroadcastStatus === 'linked'

  let broadcastBinding:
    | {
        status: LineBroadcastBindingStatus
        botLabel: string | null
        lineGroupIdTail: string | null
        linkedAt: Date | string | null
        lastBroadcastAt: Date | string | null
        guidelineCount: number
        guidelinesSentAt: Date | string | null
      }
    | null = null
  let broadcastHistory: BroadcastHistoryRow[] = []

  if (activeBroadcastStatus != null) {
    if (isAdmin) {
      // 管理者向け: フル情報を取得して RSC payload に乗せる。
      const broadcastRow = await db
        .select({
          id: eventLineBroadcasts.id,
          status: eventLineBroadcasts.status,
          lineGroupId: eventLineBroadcasts.lineGroupId,
          linkedAt: eventLineBroadcasts.linkedAt,
          guidelinesSentAt: eventLineBroadcasts.guidelinesSentAt,
          botId: lineChannels.botId,
          botLabel: lineChannels.note,
        })
        .from(eventLineBroadcasts)
        .innerJoin(
          lineChannels,
          eq(lineChannels.id, eventLineBroadcasts.lineChannelId),
        )
        .where(
          and(
            eq(eventLineBroadcasts.entryGroupId, event.entryGroupId),
            inArray(eventLineBroadcasts.status, ACTIVE_BROADCAST_STATUSES),
          ),
        )
        .limit(1)
      const activeBroadcast = broadcastRow[0]
      if (activeBroadcast) {
        // broadcast-guidelines-on-link: 選択済み要綱の件数（招待コード発行
        // モーダルで選択された添付の join 件数）。
        const guidelineCountRows = await db
          .select({ n: count() })
          .from(eventBroadcastGuidelineAttachments)
          .where(
            eq(
              eventBroadcastGuidelineAttachments.eventLineBroadcastId,
              activeBroadcast.id,
            ),
          )
        // 要綱件数・guidelines_sent_at は broadcast 行そのものから取る値で、
        // 配信履歴 (event_broadcast_messages) の有無には依存しない。linked 直後で
        // 履歴が空でも、選択済みなら guidelineCount は正しく > 0 になり再送導線が出る。
        const guidelineCount = guidelineCountRows[0]?.n ?? 0

        const historyRows = await db
          .select({
            id: eventBroadcastMessages.id,
            status: eventBroadcastMessages.status,
            isCorrection: eventBroadcastMessages.isCorrection,
            mailMessageId: eventBroadcastMessages.mailMessageId,
            subject: mailMessages.subject,
            receivedAt: mailMessages.receivedAt,
            sentAt: eventBroadcastMessages.sentAt,
            sentTextCount: eventBroadcastMessages.sentTextCount,
            sentImageCount: eventBroadcastMessages.sentImageCount,
            fallbackLinkCount: eventBroadcastMessages.fallbackLinkCount,
            errorMessage: eventBroadcastMessages.errorMessage,
          })
          .from(eventBroadcastMessages)
          .innerJoin(
            eventLineBroadcasts,
            eq(
              eventLineBroadcasts.id,
              eventBroadcastMessages.eventLineBroadcastId,
            ),
          )
          .leftJoin(
            mailMessages,
            eq(mailMessages.id, eventBroadcastMessages.mailMessageId),
          )
          .where(eq(eventLineBroadcasts.entryGroupId, event.entryGroupId))
          .orderBy(desc(eventBroadcastMessages.createdAt))
          .limit(20)

        const lastBroadcastAt =
          historyRows.find((row) => row.sentAt)?.sentAt ?? null

        broadcastBinding = {
          status: activeBroadcast.status as LineBroadcastBindingStatus,
          botLabel: activeBroadcast.botLabel ?? activeBroadcast.botId,
          lineGroupIdTail: activeBroadcast.lineGroupId
            ? activeBroadcast.lineGroupId.slice(-8)
            : null,
          linkedAt: activeBroadcast.linkedAt,
          lastBroadcastAt,
          guidelineCount,
          guidelinesSentAt: activeBroadcast.guidelinesSentAt,
        }
        broadcastHistory = historyRows.map((row) => ({
          id: row.id,
          status: row.status,
          isCorrection: row.isCorrection,
          mailMessageId: row.mailMessageId,
          subject: row.subject,
          receivedAt: row.receivedAt,
          sentAt: row.sentAt,
          sentTextCount: row.sentTextCount,
          sentImageCount: row.sentImageCount,
          fallbackLinkCount: row.fallbackLinkCount,
          errorMessage: row.errorMessage,
        }))
      }
    } else {
      // 一般会員向け: status だけのスタブ。Bot 名・履歴・エラーは含めない。
      broadcastBinding = {
        status: activeBroadcastStatus as LineBroadcastBindingStatus,
        botLabel: null,
        lineGroupIdTail: null,
        linkedAt: null,
        lastBroadcastAt: null,
        guidelineCount: 0,
        guidelinesSentAt: null,
      }
    }
  }

  // event-grade-group-broadcast: 級別グループへの配信状況（AC-29 により admin 限定。
  // vice_admin にも渡さないので、page 冒頭の isAdmin（vice_admin を含む）ではなく
  // role を直接見る）。event-detail-redesign 後は独立セクションをやめ、
  // LineBroadcastSection の `gradeBroadcast` prop 経由で LINE 配信トグルの中に
  // 描画する。非 admin には props ごと渡さない。
  const isStrictAdmin = session?.user.role === 'admin'
  let gradeBroadcastRows: GradeBroadcastRow[] = []
  if (isStrictAdmin) {
    const targetGrades = resolveTargetGrades(event.eligibleGrades)
    const [sentRows, linkedRows] = await Promise.all([
      db
        .select({ grade: eventGradeBroadcasts.grade, sentAt: eventGradeBroadcasts.sentAt })
        .from(eventGradeBroadcasts)
        .where(eq(eventGradeBroadcasts.eventId, idNum)),
      db
        .select({ grade: lineGradeGroupBindings.grade })
        .from(lineGradeGroupBindings)
        .where(
          and(
            eq(lineGradeGroupBindings.status, 'linked'),
            isNotNull(lineGradeGroupBindings.lineGroupId),
          ),
        ),
    ])
    // claim 中（sent_at NULL）の行は「未送信」として扱う — 送信が確定した級だけを
    // 送信済みと表示する（コアロジックの claim 契約と同じ判定）。
    const sentAtByGrade = new Map(
      sentRows.filter((r) => r.sentAt != null).map((r) => [r.grade, r.sentAt]),
    )
    const linkedGrades = new Set(linkedRows.map((r) => r.grade))
    gradeBroadcastRows = targetGrades.map((grade) => ({
      grade,
      sentAt: sentAtByGrade.get(grade) ?? null,
      linked: linkedGrades.has(grade),
    }))
  }

  // 対象会員（分母）。event-detail-redesign で不参加人数の算出はやめたが、この
  // クエリ自体は残す — 参加者一覧から対象級外の stale な attend=true 行を除外する
  // のに必要（AC-26）。isInvited=false の旧データ行も同時に除外される。
  const eligibleUsers = await db.query.users.findMany({
    columns: { id: true, name: true },
    where: event.eligibleGrades?.length
      ? and(eq(users.isInvited, true), inArray(users.grade, event.eligibleGrades))
      : eq(users.isInvited, true),
  })

  const eligibleUserIdSet = new Set(eligibleUsers.map((u) => u.id))
  const eligibleAttendingList = event.attendances.filter(
    (a) => a.attend && eligibleUserIdSet.has(a.userId),
  )

  // Check if current user can respond to attendance (JST-based comparison)
  const todayStr = todayInJst()
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
  // Non-admin users with grade=null are considered ineligible when the event has eligibleGrades.
  const canRespond =
    session && (isAdmin || (currentUserIsInvited && isBeforeDeadline && isEligible))
  const boundSubmitAttendance = submitAttendance.bind(null, event.id)

  // Sort participants by ascending grade (A < B < ... < E); unranked goes last.
  const sortedAttending = eligibleAttendingList
    .slice()
    .sort((a, b) => (a.user.grade ?? 'Z').localeCompare(b.user.grade ?? 'Z'))

  const perGradeCapacities: Array<{ grade: Grade; capacity: number }> = (
    [
      ['A', event.capacityA],
      ['B', event.capacityB],
      ['C', event.capacityC],
      ['D', event.capacityD],
      ['E', event.capacityE],
    ] as const
  ).flatMap(([g, c]) => (c != null ? [{ grade: g as Grade, capacity: c }] : []))
  const capacityTotal = perGradeCapacities.reduce((sum, c) => sum + c.capacity, 0)
  // 旧「対象級」行は級別定員セクションへ統合した（requirements §3.2.4）。定員が
  // 1つも設定されていない大会では eligibleGrades の級だけを数字なしで並べ、
  // どちらも無い（全級対象・定員未設定）なら セクションごと出さない（AC-17/18）。
  const eligibleGradeList: Grade[] = event.eligibleGrades ?? []
  const showCapacitySection =
    perGradeCapacities.length > 0 || eligibleGradeList.length > 0

  // 申込フロー（両ビュー共通）。判定は純関数へ切り出してある（AC-1〜9）。
  const flowSteps = buildEntryFlow({
    internalDeadline: event.internalDeadline,
    entryDeadline: event.entryDeadline,
    lotteryDate: event.lotteryDate,
    paymentDeadline: event.paymentDeadline,
    eventDate: event.eventDate,
    entryStatus: event.entryStatus,
    paymentType: event.paymentType,
    paymentStatus: event.paymentStatus,
    todayStr,
  })

  return (
    <div className="flex min-h-full flex-col p-4">
      <EventDetailHeader
        eventId={event.id}
        title={event.title}
        eventDate={event.eventDate}
        location={event.location}
        steps={flowSteps}
        canEdit={isAdmin}
      />

      {/* entry-groups タスク4 (AC-16): 全ロールに表示。sticky ヘッダーの外に
          置く（design-spec の明示指定。ヘッダーのラッパー内では分割しない）。 */}
      <GroupDayLinks siblings={groupSiblings} currentEventId={event.id} />

      {isAdmin && (
        <EventLifecycleSection
          eventId={event.id}
          entryStatus={event.entryStatus}
          paymentType={event.paymentType}
          paymentStatus={event.paymentStatus}
          feeJpy={event.feeJpy}
          entryDeadline={event.entryDeadline}
          paymentDeadline={event.paymentDeadline}
          entryMethod={event.entryMethod}
          paymentMethod={event.paymentMethod}
          paymentInfo={event.paymentInfo}
          isLineLinked={isLineLinked}
          setEntryAppliedAction={setEntryApplied}
          setEntryNotApplyingAction={setEntryNotApplying}
          setPaymentTypeAction={setPaymentType}
          setPaymentPaidAction={setPaymentPaid}
          groupSiblings={groupSiblings}
          setEntriesAppliedAction={setEntriesApplied}
          setPaymentsPaidAction={setPaymentsPaid}
          setPaymentTypesAction={setPaymentTypes}
        />
      )}

      {/* 出欠状況カード（参加/不参加の2枚）は廃止し、参加人数を見出しへ移した。 */}
      <SectionRule
        title="参加者"
        count={eligibleAttendingList.length}
        countUnit="名"
      >
        {sortedAttending.length > 0 ? (
          <p className="min-w-0 text-xs leading-[1.7] text-neutral-fg">
            {sortedAttending.map((a, i) => (
              <Fragment key={a.userId}>
                {i > 0 && <em className="mx-1 not-italic text-ink-meta">・</em>}
                <span className="whitespace-nowrap">
                  {surname(a.user.name)}
                  {a.user.grade && (
                    <i className="ml-0.5 font-mono not-italic text-ink-meta">
                      {a.user.grade}
                    </i>
                  )}
                </span>
              </Fragment>
            ))}
          </p>
        ) : (
          <p className="text-xs text-neutral-fg">まだ参加者がいません。</p>
        )}
      </SectionRule>

      {showCapacitySection && (
        <SectionRule
          title="級別定員"
          sub={
            event.lotteryDate
              ? `（抽選日：${formatFlowDate(event.lotteryDate)}）`
              : undefined
          }
          aux={perGradeCapacities.length > 0 ? `計 ${capacityTotal}名` : undefined}
        >
          <div className="flex flex-wrap items-baseline gap-x-[26px] gap-y-2">
            {perGradeCapacities.length > 0
              ? perGradeCapacities.map(({ grade, capacity }) => (
                  <span key={grade} className="flex items-baseline gap-1">
                    <span className="font-mono text-[16px] font-bold text-ink-2">
                      {grade}
                    </span>
                    <span className="font-display text-[18px] font-bold leading-none tabular-nums text-ink">
                      {capacity}
                    </span>
                    <span className="text-xs text-ink-meta">名</span>
                  </span>
                ))
              : eligibleGradeList.map((grade) => (
                  <span
                    key={grade}
                    className="font-mono text-[16px] font-bold text-ink-2"
                  >
                    {grade}
                  </span>
                ))}
          </div>
        </SectionRule>
      )}

      {event.description && (
        <SectionRule
          title="備考"
          aux={
            isAdmin ? (
              <LinkActionLink href={`/events/${event.id}/edit`}>
                編集
              </LinkActionLink>
            ) : undefined
          }
        >
          <div className="whitespace-pre-wrap font-display text-[16px] leading-[1.9] text-ink-2">
            {event.description}
          </div>
        </SectionRule>
      )}

      {/* 以下3セクションはセクション間余白（34px）を自前で持つ。ここで
          ラッパー div に付けると、条件を満たさず null を返したときに空の
          34px が残ってしまうため（非管理者の LINE 配信・団体戦の名簿・
          0件の関連メール）。 */}

      {/* 非管理者には何も描画しない（AC-13b）。級別グループ配信は
          gradeBroadcast prop でこの中の1項目として描画される（AC-13c）。 */}
      <LineBroadcastSection
        eventId={event.id}
        eventTitle={event.title}
        isAdmin={isAdmin}
        binding={broadcastBinding}
        history={broadcastHistory}
        generateInviteCodeAction={generateInviteCodeForEvent}
        revokeBroadcastAction={revokeBroadcast}
        manualBroadcastAction={manualBroadcast}
        setGuidelineAttachmentsAction={setGuidelineAttachments}
        resendGuidelinesAction={resendGuidelines}
        gradeBroadcast={
          isStrictAdmin && gradeBroadcastRows.length > 0
            ? { rows: gradeBroadcastRows, resendAction: resendGradeBroadcast }
            : null
        }
      />

      {/* tournament-entry-rosters PR-4: 申込/確定名簿＋会員突合（個人戦のみ）。
          Excel 取込は廃止し、この画面は閲覧専用（名簿はメール取込経由のみ）。 */}
      <RosterSection
        kind={event.kind}
        rosters={event.entryGroup.rosters}
        currentUserId={session?.user.id ?? null}
      />

      {/* mail-inbox-mailer タスク5: 関連メール。リンク先が
          /admin/mail-inbox/mail/[id] (管理者専用) なので一般会員には出さない。 */}
      {isAdmin && <EventRelatedMails eventId={idNum} />}

      {!canRespond && session && (
        <p className="pt-[34px] text-xs text-ink-meta">
          {!currentUserIsInvited && '出欠回答の対象外です'}
          {currentUserIsInvited && !isBeforeDeadline && '会内締切を過ぎています'}
          {currentUserIsInvited &&
            isBeforeDeadline &&
            currentUserGrade == null &&
            '級が未設定のため回答できません'}
          {currentUserIsInvited &&
            isBeforeDeadline &&
            currentUserGrade != null &&
            !isEligible &&
            '対象外の級です'}
        </p>
      )}

      {canRespond && (
        <div className="sticky bottom-0 -mx-4 mt-auto border-t border-border bg-canvas/95 px-4 py-3 backdrop-blur">
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
