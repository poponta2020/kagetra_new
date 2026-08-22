import { notFound, redirect } from 'next/navigation'
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import {
  entryFormDrafts,
  entryGroupOpenChats,
  eventAttendances,
  eventBroadcastGuidelineAttachments,
  eventBroadcastMessages,
  eventGradeBroadcasts,
  eventLineBroadcasts,
  events,
  lineChannels,
  lineGradeGroupBindings,
  mailMessages,
  tournamentEntryRosterFiles,
  tournamentEntryRosters,
  tournamentSeries,
  tournamentSeriesEditions,
  users,
} from '@kagetra/shared/schema'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { deriveEntryGroupName, selectRepresentativeEvent } from '@/lib/entry-groups'
import { isGuestRole } from '@/lib/guest-access'
import { todayInJst } from '@/lib/jst-date'
import { formatFlowDate } from '@/lib/event-date'
import { resolveTargetGrades } from '@/lib/event-grade-broadcast'
import { tallyEntryFeesForGroup } from '@/lib/entry-fee-tally'
import { formatUnknownGradeNote } from '@/lib/event-lifecycle-notify'
import { loadConfirmedRosterState } from '@/lib/events/confirmed-roster'
import { buildEntryFlow } from '@/lib/events/entry-flow'
import { aggregateGroupCommonFields } from '@/lib/events/group-common-fields'
import { aggregateGroupFlowInput } from '@/lib/events/group-entry-flow'
import { GroupDetailHeader, SectionRule } from '@/components/events/detail'
import {
  LineBroadcastSection,
  type LineBroadcastBindingStatus,
} from '@/components/events/LineBroadcastSection'
import type { BroadcastHistoryRow } from '@/components/events/BroadcastHistoryTable'
import type { GradeBroadcastRow } from '@/components/events/GradeBroadcastSection'
import { EventRelatedMails } from '@/components/events/EventRelatedMails'
import { OpenChatSection } from '@/app/(app)/events/[id]/components/OpenChatSection'
import {
  RosterSection,
  type RosterAdminControls,
  type RosterFileView,
} from '@/app/(app)/events/[id]/components/RosterSection'
import {
  generateInviteCodeForEvent,
  manualBroadcast,
  resendGradeBroadcast,
  resendGuidelines,
  revokeBroadcast,
  setConfirmedRosterOverride,
  setEntriesApplied,
  setEntriesNotApplying,
  setGuidelineAttachments,
  setPaymentsPaid,
  setPaymentTypes,
} from '@/app/(app)/events/[id]/actions'
import { displayName, type EntryBoardItem } from '../entry-board-utils'
import { dayPhase } from '../day-phase'
import { saveGroupCommonFields } from './actions'
import { GroupDayTable, type GroupDayRow } from './components/GroupDayTable'
import { GroupProgressSection, type GroupSummary } from './components/GroupProgressSection'
import { CommonFieldsSection } from './components/CommonFieldsSection'

export const dynamic = 'force-dynamic'

const ACTIVE_BROADCAST_STATUSES = [
  'invite_pending',
  'joined_waiting_code',
  'linked',
] as const

/**
 * 申込グループページ `/admin/entries/[groupId]`（entry-group-page）。
 *
 * 管理者の申込運用の起点。**閲覧はログイン済みの全ロール**（ボード `/admin/entries`
 * が PR #378 で開放済みなので、その遷移先を管理者専用にすると会員に死んだリンクが
 * 生まれる＝設計判断3）。**操作 UI は管理者/副管理者にのみ描画し、非管理者には
 * RSC payload にも載せない**（AC-2。値を計算してから JSX の条件分岐で隠すのでは
 * 不十分——client component へ渡した props は payload に出る）。
 *
 * セクション順（要件 §3.1・design-spec §8 の忠実度チェックリスト）:
 *   ヘッダー → フロー帯 → 日程 → 進行管理 → 共通項目 → LINE配信 → 名簿 →
 *   オープンチャット → 関連メール
 *
 * 判定ロジックはすべて純関数側にある（`aggregateGroupFlowInput` /
 * `aggregateGroupCommonFields` / `dayPhase`）。ここはその入力 DTO を組み、
 * 結果を並べるだけ。
 */
export default async function EntryGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const groupIdNum = Number(groupId)
  if (!Number.isInteger(groupIdNum) || groupIdNum <= 0) notFound()

  const session = await auth()
  // 未ログインは通さない（通常は middleware が先に弾く。ここはその fail-safe）。
  if (!session?.user?.id) redirect('/403')
  // ゲストは申込管理ボードと同じく立ち入れない（AC-1）。middleware の許可リストに
  // 該当しないが、降格直後の stale な JWT が素通りするのでページ側にも置く。
  if (isGuestRole(session.user.role)) redirect('/403')

  const isAdmin =
    session.user.role === 'admin' || session.user.role === 'vice_admin'
  // 級別グループ配信は admin 限定（vice_admin にも渡さない。既存 AC-29）。
  const isStrictAdmin = session.user.role === 'admin'
  const todayStr = todayInJst()

  // ① グループの全イベント（開催日昇順・同着は id 昇順。cancelled も含む）。
  //    通称は edition → series で辿る（edition_id は nullable なので leftJoin 2 段）。
  const eventRows = await db
    .select({
      id: events.id,
      title: events.title,
      shortName: tournamentSeries.shortName,
      eventDate: events.eventDate,
      eligibleGrades: events.eligibleGrades,
      status: events.status,
      kind: events.kind,
      entryStatus: events.entryStatus,
      paymentType: events.paymentType,
      paymentStatus: events.paymentStatus,
      internalDeadline: events.internalDeadline,
      entryDeadline: events.entryDeadline,
      lotteryDate: events.lotteryDate,
      paymentDeadline: events.paymentDeadline,
      paymentDeadlineKind: events.paymentDeadlineKind,
      paymentMethod: events.paymentMethod,
      paymentInfo: events.paymentInfo,
      entryMethod: events.entryMethod,
    })
    .from(events)
    .leftJoin(tournamentSeriesEditions, eq(tournamentSeriesEditions.id, events.editionId))
    .leftJoin(tournamentSeries, eq(tournamentSeries.id, tournamentSeriesEditions.seriesId))
    .where(eq(events.entryGroupId, groupIdNum))
    .orderBy(asc(events.eventDate), asc(events.id))

  // 存在しない groupId・イベント0件のグループはどちらも 404（要件 エラーケース節）。
  // 日程表もヘッダーも成立しないため、空グループを空ページとして出さない。
  if (eventRows.length === 0) notFound()

  const eventIds = eventRows.map((e) => e.id)
  // 代表イベント: 今日以降で最も近い開催日、無ければ最新。同着は id 昇順（§3.2.2）。
  const representative = selectRepresentativeEvent(eventRows, todayStr)!
  // グループ名は導出（保存しない）。導出不能なら代表イベントのタイトルへ
  // フォールバックする（本番実例: 九段E + 九段CDE → null）。AC-5。
  const groupName =
    deriveEntryGroupName(eventRows.map((e) => e.title)) ?? representative.title
  // 個人戦/団体戦はグループ内で揃っている前提だが、揃わない事故があっても
  // 「1日でも団体戦なら名簿・申込書を出さない」側（安全側）へ倒す（AC-35）。
  const isTeamGroup = eventRows.some((e) => e.kind === 'team')

  // ② 参加希望者数（`attend=true` の素通し・ゲストは数えない）。/events 一覧・
  //    ボードと同じセマンティクス（対象級・isInvited で絞らない）。AC-8。
  const attendanceRows = await db
    .select({ eventId: eventAttendances.eventId, userId: eventAttendances.userId })
    .from(eventAttendances)
    .innerJoin(users, eq(users.id, eventAttendances.userId))
    .where(
      and(
        inArray(eventAttendances.eventId, eventIds),
        eq(eventAttendances.attend, true),
        ne(users.role, 'guest'),
      ),
    )
  const attendCountByEvent = new Map<number, number>()
  for (const row of attendanceRows) {
    attendCountByEvent.set(row.eventId, (attendCountByEvent.get(row.eventId) ?? 0) + 1)
  }

  // 自分の回答印（全ロールに出す。未ログインはこの画面に到達しない）。
  // 不参加と未回答を区別したいので attend の生値を引く。
  const myAttendanceRows = await db
    .select({ eventId: eventAttendances.eventId, attend: eventAttendances.attend })
    .from(eventAttendances)
    .where(
      and(
        inArray(eventAttendances.eventId, eventIds),
        eq(eventAttendances.userId, session.user.id),
      ),
    )
  const myAttendByEvent = new Map<number, boolean>(
    myAttendanceRows.map((r) => [r.eventId, r.attend]),
  )

  // ③ 確定名簿（グループ帰属）。ここで引くのは**表示用**の一覧（名簿セクションに
  //    そのまま渡す）で、フェーズ判定には使わない——判定は下の
  //    `loadConfirmedRosterState` が正典（confirmed-roster-signal。材料が
  //    パース済み ∪ 採用ファイル ∪ 確定名簿メール ∪ 手動フラグ の 4 つに増えたため）。
  const rosters = await db.query.tournamentEntryRosters.findMany({
    where: and(
      eq(tournamentEntryRosters.entryGroupId, groupIdNum),
      isNull(tournamentEntryRosters.supersededAt),
    ),
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
  })
  // ★`columns` で表示に使う列だけを取る。`RosterSection` は client component
  //   なので、この結果は RSC payload としてブラウザへ直列化される（日ページと
  //   同じ規約。note / approvedByUserId / rawKana / selectionOutcome 等の内部列を
  //   一般会員へ渡さない）。
  const rosterFileRows = await db.query.tournamentEntryRosterFiles.findMany({
    where: eq(tournamentEntryRosterFiles.entryGroupId, groupIdNum),
    orderBy: [asc(tournamentEntryRosterFiles.id)],
    columns: { id: true, rosterType: true, publishedAt: true, grades: true },
    with: { sourceAttachment: { columns: { filename: true } } },
  })
  const rosterFiles: RosterFileView[] = rosterFileRows.map((f) => ({
    id: f.id,
    rosterType: f.rosterType,
    publishedAt: f.publishedAt,
    filename: f.sourceAttachment?.filename ?? '',
    grades: f.grades,
  }))
  // 確定名簿の有無＋手動フラグの生値。判定の正典は 1 つ（要件 §6）——`settled` は
  // フロー帯と日程表のフェーズ語へ、`override` は名簿セクションのトグルの現在値へ。
  // トグルの状態を別クエリで読み直さない（判定の正典が2つに割れる）。
  const { settled: hasConfirmedRoster, override: confirmedRosterOverride } =
    await loadConfirmedRosterState(groupIdNum)

  // confirmed-roster-signal タスク2 (AC-11): 管理者向けの値と Server Action は
  // **管理者のときだけ**組み立てる（`RosterSection` は `'use client'`。日ページと
  // 同じ規約）。
  const rosterAdminControls: RosterAdminControls | undefined = isAdmin
    ? {
        confirmedRosterOverride,
        setConfirmedRosterOverride: setConfirmedRosterOverride.bind(
          null,
          groupIdNum,
        ),
      }
    : undefined

  // ④ 申込フロー帯（集約入力を作って既存 `buildEntryFlow` へ渡す。§3.2.4）。
  //    対象日（非 cancelled）が0件なら null が返り、帯を丸ごと描かない（AC-14）。
  const flowInput = aggregateGroupFlowInput(eventRows, todayStr, hasConfirmedRoster)
  const flowSteps = flowInput ? buildEntryFlow(flowInput) : null

  // ⑤ 共通7項目（一致ならその値・食い違えば最も早い日付＋varies）。AC-15。
  //    eventRows は非空なので null は返らない。
  const commonFields = aggregateGroupCommonFields(eventRows, todayStr)!

  // ⑥ 日程表の行。フェーズ語はサーバーで確定させ、client には表示用の値だけ渡す
  //    （`classify` を client バンドルへ持ち込まない）。
  const dayRows: GroupDayRow[] = eventRows.map((e) => {
    const item: EntryBoardItem = {
      id: e.id,
      entryGroupId: groupIdNum,
      groupName,
      groupDisplayName: groupName,
      groupRepresentativeEventId: representative.id,
      title: e.title,
      shortName: e.shortName,
      eventDate: e.eventDate,
      eligibleGrades: e.eligibleGrades,
      internalDeadline: e.internalDeadline,
      entryDeadline: e.entryDeadline,
      paymentDeadline: e.paymentDeadline,
      paymentDeadlineKind: e.paymentDeadlineKind,
      lotteryDate: e.lotteryDate,
      entryStatus: e.entryStatus,
      paymentType: e.paymentType,
      paymentStatus: e.paymentStatus,
      attendCount: attendCountByEvent.get(e.id) ?? 0,
      hasConfirmedRoster,
    }
    const phase = dayPhase({ ...item, status: e.status }, todayStr)
    return {
      id: e.id,
      eventDate: e.eventDate,
      name: displayName(e),
      gradesLabel: e.eligibleGrades?.join('') ?? '—',
      phaseLabel: phase.label,
      phaseTone: phase.tone,
      attendCount: item.attendCount,
      myAttend: myAttendByEvent.get(e.id) ?? null,
      cancelled: e.status === 'cancelled',
      entryStatus: e.entryStatus,
      paymentType: e.paymentType,
      paymentStatus: e.paymentStatus,
    }
  })
  const totalAttendCount = dayRows.reduce((sum, r) => sum + r.attendCount, 0)

  // ⑦ オープンチャット（グループ帰属・開催日で絞らない。並び順は取得順が契約）。
  const openChatRows = await db
    .select({
      id: entryGroupOpenChats.id,
      url: entryGroupOpenChats.url,
      grades: entryGroupOpenChats.grades,
      eventDate: entryGroupOpenChats.eventDate,
      label: entryGroupOpenChats.label,
      password: entryGroupOpenChats.password,
    })
    .from(entryGroupOpenChats)
    .where(eq(entryGroupOpenChats.entryGroupId, groupIdNum))
    .orderBy(asc(entryGroupOpenChats.sortOrder), asc(entryGroupOpenChats.id))

  // ⑧ LINE 紐付け（グループ帰属）。非管理者には status すら使わない——
  //    LineBroadcastSection ごと描画しないので、クエリ自体を撃たない。
  const broadcastStatusRow = isAdmin
    ? await db
        .select({ status: eventLineBroadcasts.status })
        .from(eventLineBroadcasts)
        .where(
          and(
            eq(eventLineBroadcasts.entryGroupId, groupIdNum),
            inArray(eventLineBroadcasts.status, ACTIVE_BROADCAST_STATUSES),
          ),
        )
        .limit(1)
    : []
  const activeBroadcastStatus = broadcastStatusRow[0]?.status ?? null
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

  if (isAdmin && activeBroadcastStatus != null) {
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
      .innerJoin(lineChannels, eq(lineChannels.id, eventLineBroadcasts.lineChannelId))
      .where(
        and(
          eq(eventLineBroadcasts.entryGroupId, groupIdNum),
          inArray(eventLineBroadcasts.status, ACTIVE_BROADCAST_STATUSES),
        ),
      )
      .limit(1)
    const activeBroadcast = broadcastRow[0]
    if (activeBroadcast) {
      const guidelineCountRows = await db
        .select({ n: count() })
        .from(eventBroadcastGuidelineAttachments)
        .where(
          eq(
            eventBroadcastGuidelineAttachments.eventLineBroadcastId,
            activeBroadcast.id,
          ),
        )
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
          eq(eventLineBroadcasts.id, eventBroadcastMessages.eventLineBroadcastId),
        )
        .leftJoin(mailMessages, eq(mailMessages.id, eventBroadcastMessages.mailMessageId))
        .where(eq(eventLineBroadcasts.entryGroupId, groupIdNum))
        .orderBy(desc(eventBroadcastMessages.createdAt))
        .limit(20)

      broadcastBinding = {
        status: activeBroadcast.status as LineBroadcastBindingStatus,
        botLabel: activeBroadcast.botLabel ?? activeBroadcast.botId,
        lineGroupIdTail: activeBroadcast.lineGroupId
          ? activeBroadcast.lineGroupId.slice(-8)
          : null,
        linkedAt: activeBroadcast.linkedAt,
        lastBroadcastAt: historyRows.find((row) => row.sentAt)?.sentAt ?? null,
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
  }

  // ⑨ 級別グループ配信は **event 単位**の状態（対象級は各日の eligible_grades、
  //    送信済みは event_grade_broadcasts.event_id）。代表イベントだけに畳むと
  //    複数日グループで他の日へ配信する手段が失われるので、**日ごとに1行**出す。
  let gradeBroadcastDays: {
    eventId: number
    label?: string
    rows: readonly GradeBroadcastRow[]
  }[] = []
  if (isStrictAdmin) {
    const [sentRows, linkedRows] = await Promise.all([
      db
        .select({
          eventId: eventGradeBroadcasts.eventId,
          grade: eventGradeBroadcasts.grade,
          sentAt: eventGradeBroadcasts.sentAt,
        })
        .from(eventGradeBroadcasts)
        .where(inArray(eventGradeBroadcasts.eventId, eventIds)),
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
    // claim 中（sent_at NULL）の行は「未送信」として扱う（コアロジックと同じ判定）。
    const sentAtByEventGrade = new Map(
      sentRows
        .filter((r) => r.sentAt != null)
        .map((r) => [`${r.eventId}:${r.grade}`, r.sentAt]),
    )
    const linkedGrades = new Set(linkedRows.map((r) => r.grade))
    const multiDay = eventRows.length > 1
    gradeBroadcastDays = eventRows.map((e) => ({
      eventId: e.id,
      // 1日だけのグループでは既定ラベル（`級別グループ配信`）のまま＝日ページと同一。
      label: multiDay ? `級別配信 ${formatFlowDate(e.eventDate)}` : undefined,
      rows: resolveTargetGrades(e.eligibleGrades).map((grade) => ({
        grade,
        sentAt: sentAtByEventGrade.get(`${e.id}:${grade}`) ?? null,
        linked: linkedGrades.has(grade),
      })),
    }))
  }

  // ⑩ 進行管理（管理者のみ）。非管理者にはそもそも計算しない（AC-2）。
  const feeTally = isAdmin ? await tallyEntryFeesForGroup(db, groupIdNum) : null
  const entryFormLatestDraft =
    isAdmin && !isTeamGroup
      ? ((
          await db
            .select({
              id: entryFormDrafts.id,
              createdAt: entryFormDrafts.createdAt,
              createdByName: users.name,
              attachmentFilename: entryFormDrafts.attachmentFilename,
              status: entryFormDrafts.status,
            })
            .from(entryFormDrafts)
            .leftJoin(users, eq(users.id, entryFormDrafts.createdBy))
            .where(eq(entryFormDrafts.entryGroupId, groupIdNum))
            .orderBy(desc(entryFormDrafts.createdAt), desc(entryFormDrafts.id))
            .limit(1)
        )[0] ?? null)
      : null

  const entrySummary = isAdmin ? summarizeEntry(eventRows) : null
  const paymentSummary = isAdmin ? summarizePayment(eventRows) : null

  // ヘッダーの subline: 開催日の並び ／ 申込締切 ／ 抽選日。朱を当てるのは
  // 期限超過と「日により異なる」だけ（design-spec §8）。
  const eventDatesLabel = eventRows.map((e) => formatFlowDate(e.eventDate)).join('・')
  const entryDeadlineValue = commonFields.entryDeadline.value
  const lotteryValue = commonFields.lotteryDate.value
  const entryDeadlineOverdue =
    entryDeadlineValue != null && entryDeadlineValue < todayStr
  const sublineVaries =
    commonFields.entryDeadline.varies || commonFields.lotteryDate.varies

  return (
    <div className="flex min-h-full flex-col p-4">
      <GroupDetailHeader
        groupName={groupName}
        steps={flowSteps}
        subline={
          <>
            {eventDatesLabel}
            {entryDeadlineValue != null && (
              <>
                {' ／ '}申込締切 {formatFlowDate(entryDeadlineValue)}
                {entryDeadlineOverdue && (
                  <span className="text-accent-fg">（超過）</span>
                )}
              </>
            )}
            {lotteryValue != null && <>{' ／ '}抽選 {formatFlowDate(lotteryValue)}</>}
            {sublineVaries && (
              <span className="ml-1.5 text-accent-fg">（日により異なる）</span>
            )}
          </>
        }
      />

      <SectionRule
        title="日程"
        count={eventRows.length}
        countUnit="日"
        aux={`参加希望 のべ${totalAttendCount}名`}
        // 固定ヘッダーの直下なので上余白を詰める（モックの `.sec.tight`）。
        className="pt-[22px]"
      >
        <GroupDayTable
          rows={dayRows}
          isAdmin={isAdmin}
          isLineLinked={isLineLinked}
          setEntriesAppliedAction={setEntriesApplied}
          setEntriesNotApplyingAction={setEntriesNotApplying}
          setPaymentsPaidAction={setPaymentsPaid}
          setPaymentTypesAction={setPaymentTypes}
        />
        {!isAdmin && (
          <p className="mt-[3px] text-xs text-neutral-fg">
            ● は自分が参加すると答えた日。回答は各日の大会詳細で行う。
          </p>
        )}
      </SectionRule>

      {isAdmin && entrySummary && paymentSummary && (
        <GroupProgressSection
          entrySummary={entrySummary}
          paymentSummary={paymentSummary}
          entryMethod={commonFields.entryMethod.value}
          entryDeadline={commonFields.entryDeadline.value}
          internalDeadline={commonFields.internalDeadline.value}
          paymentDeadline={commonFields.paymentDeadline.value}
          paymentDeadlineKind={commonFields.paymentDeadlineKind.value}
          paymentMethod={commonFields.paymentMethod.value}
          paymentInfo={commonFields.paymentInfo.value}
          totalJpy={feeTally?.totalJpy ?? null}
          breakdownLabel={feeTally?.breakdownLabel ?? null}
          unknownGradeNote={formatUnknownGradeNote(feeTally?.unknownGradeCount)}
          // 申込書ウィザードは個人戦のみ（団体戦は Non-goal）。AC-22 / AC-35。
          entryFormGroupId={isTeamGroup ? undefined : groupIdNum}
          entryFormLatestDraft={entryFormLatestDraft}
        />
      )}

      {isAdmin && (
        <CommonFieldsSection
          groupId={groupIdNum}
          fields={commonFields}
          dayCount={eventRows.length}
          saveAction={saveGroupCommonFields}
        />
      )}

      {/* 非管理者には何も描画しない（コンポーネント側でも isAdmin で早期 return）。
          紐付け・要綱・履歴はグループ帰属なので、Server Action へ渡す eventId は
          代表イベントでよい（各アクションが内部で entry_group へ解決する）。 */}
      {isAdmin && (
        <LineBroadcastSection
          eventId={representative.id}
          eventTitle={groupName}
          isAdmin={isAdmin}
          binding={broadcastBinding}
          history={broadcastHistory}
          generateInviteCodeAction={generateInviteCodeForEvent}
          revokeBroadcastAction={revokeBroadcast}
          manualBroadcastAction={manualBroadcast}
          setGuidelineAttachmentsAction={setGuidelineAttachments}
          resendGuidelinesAction={resendGuidelines}
          gradeBroadcast={
            gradeBroadcastDays.length > 0
              ? { days: gradeBroadcastDays, resendAction: resendGradeBroadcast }
              : null
          }
        />
      )}

      {/* 名簿・オープンチャットは全ロール。日ページにも残す（同一データの二重表示で
          状態は増えない＝設計判断8）。団体戦では名簿を出さない（AC-35）。 */}
      <RosterSection
        kind={isTeamGroup ? 'team' : 'individual'}
        rosters={rosters}
        rosterFiles={rosterFiles}
        currentUserId={session.user.id}
        adminControls={rosterAdminControls}
      />

      <OpenChatSection rows={openChatRows} />

      {/* 関連メールはグループ全日分の UNION（AC-25）。リンク先が管理者専用の
          /admin/mail-inbox/mail/[id] なので一般会員には出さない。 */}
      {isAdmin && <EventRelatedMails eventIds={eventIds} />}
    </div>
  )
}

/** 進行管理の集約ラベルが読む1日ぶんの形。 */
interface ProgressDay {
  status: string
  entryStatus: 'not_applied' | 'applied' | 'not_applying'
  paymentType: 'advance' | 'onsite' | null
  paymentStatus: 'unpaid' | 'paid'
}

const ENTRY_LABEL: Record<ProgressDay['entryStatus'], string> = {
  not_applied: '未申込',
  applied: '申込済',
  not_applying: '申込なし',
}

/**
 * 集約の母集団 = 対象日（非 cancelled）。全日 cancelled なら過去の記録として
 * 読めるよう全日へフォールバックする（`aggregateGroupCommonFields` と同じ規則）。
 */
function targetDaysOf<T extends { status: string }>(days: readonly T[]): readonly T[] {
  const active = days.filter((d) => d.status !== 'cancelled')
  return active.length > 0 ? active : days
}

/** `2日とも申込済` / `1／3日 申込済`（N=1 はラベルのみ）。 */
function summarizeEntry(days: readonly ProgressDay[]): GroupSummary {
  const target = targetDaysOf(days)
  const first = target[0]!
  const n = target.length
  if (target.every((d) => d.entryStatus === first.entryStatus)) {
    const label = ENTRY_LABEL[first.entryStatus]
    return {
      label: n === 1 ? label : `${n}日とも${label}`,
      tone: first.entryStatus === 'applied' ? 'ok' : 'plain',
    }
  }
  const applied = target.filter((d) => d.entryStatus === 'applied').length
  return { label: `${applied}／${n}日 申込済`, tone: 'plain' }
}

/** 支払は**申込対象日**（`not_applying` を除く）で見る。 */
function summarizePayment(days: readonly ProgressDay[]): GroupSummary {
  const target = targetDaysOf(days).filter((d) => d.entryStatus !== 'not_applying')
  if (target.length === 0) return { label: '申込なし', tone: 'plain' }
  const first = target[0]!
  const n = target.length
  const same = target.every(
    (d) => d.paymentType === first.paymentType && d.paymentStatus === first.paymentStatus,
  )
  if (same) {
    const base = paymentLabel(first.paymentType, first.paymentStatus)
    return { label: n === 1 ? base.label : `${n}日とも${base.label}`, tone: base.tone }
  }
  const paid = target.filter(
    (d) => d.paymentType === 'advance' && d.paymentStatus === 'paid',
  ).length
  return { label: `${paid}／${n}日 支払済`, tone: 'plain' }
}

/** 単日の支払状態ラベル（日ページ `EventLifecycleSection.paymentSummary` と同一）。 */
function paymentLabel(
  paymentType: ProgressDay['paymentType'],
  paymentStatus: ProgressDay['paymentStatus'],
): GroupSummary {
  if (paymentType === 'advance') {
    return paymentStatus === 'paid'
      ? { label: '支払済', tone: 'ok' }
      : { label: '未払', tone: 'ng' }
  }
  if (paymentType === 'onsite') return { label: '現地払い', tone: 'plain' }
  return { label: '未設定', tone: 'ng' }
}
