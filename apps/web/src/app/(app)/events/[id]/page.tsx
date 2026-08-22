import { Fragment } from 'react'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import {
  entryGroupOpenChats,
  events,
  tournamentEntryRosterFiles,
  tournamentEntryRosters,
  users,
} from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { memberEntryFeeJpy, type EntryFeeSource } from '@/lib/entry-fee'
import { auth } from '@/auth'
import { Btn } from '@/components/ui'
import {
  EventDetailHeader,
  GroupBackLink,
  LinkActionLink,
  SectionRule,
} from '@/components/events/detail'
import {
  deriveEntryGroupName,
  listGroupSiblings,
  selectRepresentativeEvent,
} from '@/lib/entry-groups'
import { loadConfirmedRosterState } from '@/lib/events/confirmed-roster'
import { buildEntryFlow } from '@/lib/events/entry-flow'
import { formatFlowDate } from '@/lib/event-date'
import { todayInJst } from '@/lib/jst-date'
import { isGuestRole } from '@/lib/guest-access'
import { roleViewLabel } from '@/lib/role-preview'
import { submitAttendance } from './actions'
import { OpenChatSection } from './components/OpenChatSection'
import { RosterSection, type RosterFileView } from './components/RosterSection'
import { surname } from '@/lib/surname'

/**
 * 大会申込詳細。event-detail-redesign: 罫線＋余白主導（脱カード）へ作り替えた。
 * カードを使うのは関連メールの1件ずつだけで、運営操作は `<details>`（既定=閉）に
 * 畳む。既定表示では会員も管理者も「どの大会か・今どの段階か・自分は出るか」
 * だけが見える。要件は docs/features/event-detail-redesign/requirements.md、
 * 視覚の正は同ディレクトリの design-spec.md / design-mock/redesign.html。
 *
 * entry-group-page タスク4 (AC-28/AC-29/AC-30): 進行管理・LINE配信・関連メール・
 * 日リンク帯（`GroupDayLinks`）は `/admin/entries/[groupId]`（申込グループページ）
 * へ移設し、このページから撤去した。管理者に残る操作は見出しの「編集」リンクのみ。
 * 代わりにグループページへの固定文言の戻り導線（`GroupBackLink`）を持つ。
 * 申込フロー帯は従来どおり**日別のまま**（判定を変えていない）。
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
          // roster-file-adoption タスク4: 原本ファイルのまま採用した名簿
          // （AC-5/AC-6/AC-7）。帰属は entry_group なので、グループ内のどの日の
          // 詳細からも同じファイルが見える。
          //
          // ★ここも `rosters` と同じ注意が要る。会員へ渡してよいのはファイル名・
          // 採用種別・発表日・ビューア導線（id）だけ。sourceMailMessageId（取込元
          // メール）/ adoptedByUserId（採用者）/ note（管理メモ）は internal 列
          // なので `columns` を絞り、RSC payload に載せない（PR #376 の教訓）。
          // roster-file-adoption 2026-08-01 改修: 級は要件上「公開情報として
          // 追加してよい」（AC-18）ので grades だけ増やす。
          rosterFiles: {
            orderBy: [asc(tournamentEntryRosterFiles.id)],
            columns: { id: true, rosterType: true, publishedAt: true, grades: true },
            with: {
              sourceAttachment: { columns: { filename: true } },
            },
          },
        },
      },
    },
  })

  if (!event) notFound()

  // grade-entry-fee タスク7: 単価解決は entry-fee.ts の resolveEntryFee に
  // 一切を委ねる（page 側で official/kind の分岐を再実装しない）。会員向け
  // 「あなたの参加費」がこの feeSource から導出される。
  const feeSource: EntryFeeSource = {
    official: event.official,
    kind: event.kind,
    eligibleGrades: event.eligibleGrades,
    feeJpy: event.feeJpy,
  }

  // entry-groups タスク4 (AC-16): 同じ申込グループの日一覧（開催日昇順・自分を
  // 含む）。entry-group-page タスク4以降はグループ導線のグループ名導出にのみ使う
  // （進行管理の一括ダイアログは `/admin/entries/[groupId]` へ移設済み）。
  const groupSiblings = await listGroupSiblings(db, event.id)

  const todayStr = todayInJst()

  // entry-group-page タスク4 (AC-29): グループページの見出しと同じ規則で
  // グループ名を導出する（食い違うと同じグループが2つの名前で呼ばれてしまう）。
  // シングルトングループでは添え字を出さない（大会名と同一になるため null）。
  const groupName =
    groupSiblings.length > 1
      ? (deriveEntryGroupName(groupSiblings.map((s) => s.title)) ??
         selectRepresentativeEvent(groupSiblings, todayStr)!.title)
      : null

  // openchat-broadcast タスク10 (AC-29/AC-52): 帰属は申込グループなので
  // 開催日で絞らない。並び順は Flex のボタン順と同一にする契約
  // （entry-group-open-chats.ts のコメント）—— `ORDER BY sort_order, id` で
  // 取得した順を OpenChatSection にそのまま渡し、sortOrder 自体は DTO に
  // 含めない（呼び出し先で再ソートできない形にする）。
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
    .where(eq(entryGroupOpenChats.entryGroupId, event.entryGroupId))
    .orderBy(asc(entryGroupOpenChats.sortOrder), asc(entryGroupOpenChats.id))

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
  // guest-role R3: ゲストは会内締切に縛られない（会経由で申し込まないため、
  // 「会が主催者へ申し込む準備の締切」に意味が無い）。この 1 行を bypass
  // するだけで、下の理由表示（「会内締切を過ぎています」）にもゲストには
  // 出さないという要件が自動的に満たされる——両方とも isBeforeDeadline を
  // 見ているので、片方だけ直すとズレる。
  const isGuest = isGuestRole(session?.user.role)
  const isBeforeDeadline =
    isGuest || !event.internalDeadline || event.internalDeadline >= todayStr
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

  // grade-entry-fee タスク7 (AC-21/AC-22): 「あなたの参加費」。出欠の回答状況は
  // 問わない（申し込む前に金額を知りたいため、myAttendance を見ない）。
  //
  // guest-role AC-16: ゲストには出さない（会へ振り込むと誤解させないため）。
  // ★JSX の条件分岐で隠すのではなく、ここで computed before branch —— この
  // ページ自体が Server Component の戻り値としてテストで直列化検査されるため、
  // 値を計算して JSX 側の `{cond && <p>...}` だけで隠すと RSC payload には
  // 載ってしまう。ゲストのときはそもそも算出しない。
  const memberFeeJpy = isGuest ? null : memberEntryFeeJpy(feeSource, currentUserGrade)

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

  // 申込フロー（両ビュー共通）。判定は純関数へ切り出してある（AC-1〜9）。entry-group-page
  // タスク4 (AC-30): この帯は**日別のまま**——グループ帯（`/admin/entries/[groupId]`）と
  // 判定を混ぜない。確定名簿の有無は申込管理ボードと同じ定義で、その正典は
  // `@/lib/events/confirmed-roster`（confirmed-roster-signal。パース済み ∪ 採用済み
  // 原本ファイル ∪ 確定名簿メール ∪ 手動フラグ の 4 材料）。上で引いてある
  // `entryGroup.rosters` / `rosterFiles` は**表示用として残す**——判定だけ差し替える。
  // 会員向けのこの画面にも反映するのは意図どおり（要件 §3.2.4。ボードと会員画面で
  // フェーズがずれない）。
  const { settled: hasConfirmedRoster } = await loadConfirmedRosterState(
    event.entryGroupId,
  )
  const flowSteps = buildEntryFlow({
    internalDeadline: event.internalDeadline,
    entryDeadline: event.entryDeadline,
    lotteryDate: event.lotteryDate,
    paymentDeadline: event.paymentDeadline,
    eventDate: event.eventDate,
    entryStatus: event.entryStatus,
    paymentType: event.paymentType,
    paymentStatus: event.paymentStatus,
    hasConfirmedRoster,
    todayStr,
  })

  // roster-file-adoption タスク4: entryGroup.rosterFiles を会員向け DTO へ
  // 詰め替える。クエリ側で既に列を絞ってあるので（AC-7）、ここは選んだ列を
  // そのまま渡すだけ——sourceMailMessageId / adoptedByUserId / note は
  // クエリに存在せず、この DTO にも現れない。
  const rosterFiles: RosterFileView[] = event.entryGroup.rosterFiles.map((f) => ({
    id: f.id,
    rosterType: f.rosterType,
    publishedAt: f.publishedAt,
    filename: f.sourceAttachment?.filename ?? '',
    grades: f.grades,
  }))

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

      {/* entry-group-page タスク4 (AC-29): グループページへの戻り導線。全ロールに
          表示・シングルトングループでも常に出す。sticky ヘッダーの外に置く
          （design-spec の明示指定。ヘッダーのラッパー内では分割しない）。 */}
      <GroupBackLink entryGroupId={event.entryGroupId} groupName={groupName} />

      {/* openchat-broadcast タスク10 (AC-42/AC-43/AC-51): 保存済みオープンチャット
          欄。全会員に表示・表示のみ。0件のときは null を返しセクションごと出ない。 */}
      <OpenChatSection rows={openChatRows} />

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
                  {/* guest-role R5/AC-15: 参加者欄は会員と同じ欄にゲストも
                      並べ、既存の級添字の隣に短いラベルを添えるだけの
                      ゲスト印を付ける（design-spec 不要と明示された最小表現）。 */}
                  {isGuestRole(a.user.role) && (
                    <span className="ml-0.5 text-[10px] text-ink-meta">
                      {roleViewLabel('guest')}
                    </span>
                  )}
                </span>
              </Fragment>
            ))}
          </p>
        ) : (
          <p className="text-xs text-neutral-fg">まだ参加者がいません。</p>
        )}
        {/* grade-entry-fee タスク7 (AC-21/AC-22/AC-23): 対象級の会員に
            出欠の回答状況を問わず出す。「規定額」等のラベルは付けない。 */}
        {memberFeeJpy != null && (
          <p className="mt-2 text-xs text-ink-meta">
            あなたの参加費 {memberFeeJpy.toLocaleString('ja-JP')}円
          </p>
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

      {/* tournament-entry-rosters PR-4: 申込/確定名簿＋会員突合（個人戦のみ）。
          Excel 取込は廃止し、この画面は閲覧専用（名簿はメール取込経由のみ）。
          セクション間余白（34px）は RosterSection 自身が持つ（0件/団体戦のときに
          空の余白が残らないよう null を返す設計）。 */}
      <RosterSection
        kind={event.kind}
        rosters={event.entryGroup.rosters}
        rosterFiles={rosterFiles}
        currentUserId={session?.user.id ?? null}
      />

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
