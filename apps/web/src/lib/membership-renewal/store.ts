import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import {
  clubLineGroups,
  lineChatTasks,
  membershipRenewalMembers,
  membershipRenewals,
  users,
} from '@kagetra/shared/schema'
import {
  RENEWAL_NOTE_MAX_LENGTH,
  ROSTER_FIELDS,
  isSchoolYearForKind,
} from '@kagetra/shared'
import type {
  FacultyKind,
  MembershipKind,
  ReaderCertification,
  RenewalAnswer,
  RenewalSchoolYearKind,
  RenewalSnapshot,
} from '@kagetra/shared'
import type { db as appDb } from '@/lib/db'
import { db } from '@/lib/db'
import { todayInJst } from '@/lib/jst-date'
import { cancelTasks, createChatTask } from '@/lib/line-chat-tasks'
import { resolveMembershipKind } from './membership-kind'
import { buildRenewalSnapshot, findMissingRegisterFields, safeParseRenewalSnapshot } from './snapshot'
import type { RenewalSnapshotSource } from './snapshot'
import { diffRoster } from './diff'
import type { RosterDiffEntry } from './diff'
import { announcementSendAt, reminderTargetDates } from './schedule'
import { buildAnnouncementMessage } from './messages'
import { resolveSchoolYearApply } from './school-year'
import { resolveRenewalPageUrl } from './base-url'

/**
 * `YYYY-MM-DD` が**実在する日付**か。正規表現だけだと `2027-02-30` のような
 * 形式は正しいが存在しない日付が通り、PostgreSQL の `date` 列への INSERT/UPDATE で
 * 未処理例外になる（Action が返すエラー状態にならない。Codex レビュー PR #631）。
 * UTC で組み直して各要素が一致することまで確認する（既存の会員編集
 * `isRealYmd` と同形。時刻を持たない日付なのでタイムゾーンの影響を受けない）。
 */
function isRealYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const y = Number(value.slice(0, 4))
  const m = Number(value.slice(5, 7))
  const d = Number(value.slice(8, 10))
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * membership-renewal store: 年度確認（annual-registration-renewal）の
 * `membership_renewals` / `membership_renewal_members` に対する読み書き。
 *
 * 認可（admin/vice_admin か本人か）は**呼び出し側の Server Action** が持つ。
 * ただし「他人の行を書けない」ことは*この層でも* `user_id` を WHERE に含めて
 * 構造的に担保する（AC-9。Action の判定漏れを 1 段で通さないため）。
 *
 * 日程の導出（対象日集合・送信時刻）と文面の組み立ては `schedule.ts` /
 * `messages.ts`、送信タスクの保存は `lib/line-chat-tasks.ts` の責務。ここは
 * その 3 つを束ねてトランザクションに載せる。
 */

type Database = typeof appDb
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Transaction

export type RenewalRow = typeof membershipRenewals.$inferSelect

/** `users` から名簿の列＋学年を取り出す select 断片（スナップショットと同じ形）。 */
const rosterColumns = {
  familyName: users.familyName,
  givenName: users.givenName,
  familyKana: users.familyKana,
  givenKana: users.givenKana,
  birthDate: users.birthDate,
  gender: users.gender,
  dan: users.dan,
  grade: users.grade,
  postalCode: users.postalCode,
  address1: users.address1,
  address2: users.address2,
  phone: users.phone,
  facultyKind: users.facultyKind,
  faculty: users.faculty,
  schoolYear: users.schoolYear,
} as const

// ---------------------------------------------------------------------------
// 読み出し
// ---------------------------------------------------------------------------

/** 進行中（`status='open'`）の年度確認。同時に 1 つだけ存在する前提。 */
export async function loadOpenRenewal(dbc: DbOrTx = db): Promise<RenewalRow | null> {
  const [row] = await dbc
    .select()
    .from(membershipRenewals)
    .where(eq(membershipRenewals.status, 'open'))
    .orderBy(desc(membershipRenewals.fiscalYear))
    .limit(1)
  return row ?? null
}

/** 直近の年度確認（進行中が無ければ完了済みの最新）。S2 の未開始表示に使う。 */
export async function loadLatestRenewal(dbc: DbOrTx = db): Promise<RenewalRow | null> {
  const [row] = await dbc
    .select()
    .from(membershipRenewals)
    .orderBy(desc(membershipRenewals.fiscalYear))
    .limit(1)
  return row ?? null
}

export interface RenewalTargetCounts {
  zennichikyo: number
  circle: number
}

/**
 * 開始時に対象になる人数（S2 の前提表示・AC-1 と同じ条件）。
 * 全日協＝`zen_nichikyo` ∧ 未退会 ∧ 非ゲスト／学年＝`is_circle_member` ∧ 同条件。
 */
export async function countRenewalTargets(dbc: DbOrTx = db): Promise<RenewalTargetCounts> {
  const rows = await dbc
    .select({ zenNichikyo: users.zenNichikyo, isCircleMember: users.isCircleMember })
    .from(users)
    .where(and(isNull(users.deactivatedAt), ne(users.role, 'guest')))
  return {
    zennichikyo: rows.filter((r) => r.zenNichikyo).length,
    circle: rows.filter((r) => r.isCircleMember).length,
  }
}

// ---------------------------------------------------------------------------
// 開始（R2・AC-1・AC-2・AC-3）
// ---------------------------------------------------------------------------

export interface StartRenewalInput {
  fiscalYear: number
  /** `YYYY-MM-DD`（JST）。今日より後であること。 */
  deadline: string
  note: string | null
}

export type StartRenewalResult = { renewalId: number } | { error: string }

/**
 * 年度確認を開始する。**対象者の確定・スナップショット・案内タスクの作成を
 * 1 トランザクション**で行う（AC-2。途中失敗で「開始したのに案内が無い」を作らない）。
 *
 * 前提の検証は 2 段階に分ける:
 *   1. tx の**外**で `PUBLIC_BASE_URL`・締切・一言・案内文の組み立てを済ませる。
 *      env 未設定はスナップショットを入れてから巻き戻す話ではなく、単なる入力検証。
 *   2. tx の**中**で S3 設定・進行中・同一年度を見る。特に `club_line_groups` は
 *      `FOR UPDATE` でロックしてから確認する —— ロックしないと、確認と案内タスクの
 *      作成の間に S3 の「プールへ戻す」が走って宛先の無いタスクが残る。
 */
export async function startRenewal(
  input: StartRenewalInput,
  adminUserId: string,
  now: Date = new Date(),
): Promise<StartRenewalResult> {
  const todayJst = todayInJst(now)
  if (!isRealYmd(input.deadline)) {
    return { error: '回答締切の日付が不正です' }
  }
  if (input.deadline <= todayJst) {
    return { error: '回答締切は今日より後の日付にしてください' }
  }
  if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 2000 || input.fiscalYear > 2100) {
    return { error: '対象年度が不正です' }
  }
  const note = input.note?.trim() ? input.note.trim() : null
  if (note && note.length > RENEWAL_NOTE_MAX_LENGTH) {
    return { error: `案内に添える一言は${RENEWAL_NOTE_MAX_LENGTH}字以内で入力してください` }
  }

  const url = resolveRenewalPageUrl()
  if (!url) {
    return {
      error:
        'PUBLIC_BASE_URL が設定されていないため開始できません（案内に載せる回答ページの URL を作れません）',
    }
  }
  const messageText = buildAnnouncementMessage({
    fiscalYear: input.fiscalYear,
    deadlineJst: input.deadline,
    note,
    url,
  })
  const scheduledSendAt = announcementSendAt(now)

  return db.transaction(async (tx) => {
    // S3 設定を先にロックする（revertClubLineGroup とのレース。lib/club-line-group.ts
    // の revert 側も同じ行を FOR UPDATE する）。
    const [group] = await tx.select().from(clubLineGroups).for('update')
    if (!group) {
      return {
        error: '会 LINE グループが未設定のため開始できません（設定 › 会 LINE グループ）',
      }
    }

    const open = await loadOpenRenewal(tx)
    if (open) {
      return { error: `${open.fiscalYear}年度の年度確認が進行中です。先に登録完了にしてください` }
    }
    const [sameYear] = await tx
      .select({ id: membershipRenewals.id })
      .from(membershipRenewals)
      .where(eq(membershipRenewals.fiscalYear, input.fiscalYear))
      .limit(1)
    if (sameYear) {
      return { error: `${input.fiscalYear}年度の年度確認は実施済みです（やり直しはできません）` }
    }

    const [renewal] = await tx
      .insert(membershipRenewals)
      .values({
        fiscalYear: input.fiscalYear,
        deadline: input.deadline,
        note,
        startedBy: adminUserId,
        startedAt: now,
      })
      .returning({ id: membershipRenewals.id })
    const renewalId = renewal!.id

    // AC-1: 対象は**開始時点**の値で確定する。以後 users のフラグが動いても
    // この行集合は増減しない（読み出しも必ずこのテーブルを見る）。
    const targets = await tx
      .select({
        id: users.id,
        zenNichikyo: users.zenNichikyo,
        isCircleMember: users.isCircleMember,
        ...rosterColumns,
      })
      .from(users)
      .where(and(isNull(users.deactivatedAt), ne(users.role, 'guest')))

    const rows = targets
      .filter((t) => t.zenNichikyo || t.isCircleMember)
      .map((t) => ({
        renewalId,
        userId: t.id,
        isZennichikyoTarget: t.zenNichikyo,
        isCircleTarget: t.isCircleMember,
        snapshot: buildRenewalSnapshot(t),
      }))
    if (rows.length > 0) {
      await tx.insert(membershipRenewalMembers).values(rows)
    }

    await createChatTask(tx, {
      renewalId,
      kind: 'announcement',
      targetDate: todayJst,
      scheduledSendAt,
      messageText,
    })

    return { renewalId }
  })
}

// ---------------------------------------------------------------------------
// S1（本人）の読み出し
// ---------------------------------------------------------------------------

export interface MemberRenewalView {
  renewal: RenewalRow
  memberId: number
  isZennichikyoTarget: boolean
  isCircleTarget: boolean
  snapshot: RenewalSnapshot
  current: RenewalSnapshotSource
  membershipKind: MembershipKind
  readerCertification: ReaderCertification | null
  isAssociateReferee: boolean
  answer: RenewalAnswer | null
  answeredAt: Date | null
  answeredByAdmin: boolean
  schoolYearKind: RenewalSchoolYearKind | null
  nextFacultyKind: FacultyKind | null
  nextFaculty: string | null
  nextSchoolYear: string | null
  schoolYearAnsweredAt: Date | null
  diff: RosterDiffEntry[]
}

/**
 * 進行中（または直近）の年度確認における本人の状態。対象外なら `null`。
 * ★`user_id` を条件に含めるので、他人の id を渡しても他人の行は返らない（AC-9）。
 */
export async function loadMemberRenewalView(
  userId: string,
  dbc: DbOrTx = db,
): Promise<MemberRenewalView | null> {
  const renewal = (await loadOpenRenewal(dbc)) ?? (await loadLatestRenewal(dbc))
  if (!renewal) return null

  const [row] = await dbc
    .select({
      member: membershipRenewalMembers,
      readerCertification: users.readerCertification,
      isAssociateReferee: users.isAssociateReferee,
      ...rosterColumns,
    })
    .from(membershipRenewalMembers)
    .innerJoin(users, eq(users.id, membershipRenewalMembers.userId))
    .where(
      and(
        eq(membershipRenewalMembers.renewalId, renewal.id),
        eq(membershipRenewalMembers.userId, userId),
      ),
    )
    .limit(1)
  if (!row) return null

  const snapshot = safeParseRenewalSnapshot(row.member.snapshot)
  const current: RenewalSnapshotSource = pickRosterSource(row)
  return {
    renewal,
    memberId: row.member.id,
    isZennichikyoTarget: row.member.isZennichikyoTarget,
    isCircleTarget: row.member.isCircleTarget,
    snapshot: snapshot ?? buildRenewalSnapshot(current),
    current,
    membershipKind: resolveMembershipKind(current.birthDate, renewal.fiscalYear),
    readerCertification: row.readerCertification,
    isAssociateReferee: row.isAssociateReferee,
    answer: row.member.answer,
    answeredAt: row.member.answeredAt,
    answeredByAdmin: row.member.answeredByAdmin,
    schoolYearKind: row.member.schoolYearKind,
    nextFacultyKind: row.member.nextFacultyKind,
    nextFaculty: row.member.nextFaculty,
    nextSchoolYear: row.member.nextSchoolYear,
    schoolYearAnsweredAt: row.member.schoolYearAnsweredAt,
    diff: snapshot ? diffRoster(snapshot, current) : [],
  }
}

function pickRosterSource(row: Record<string, unknown>): RenewalSnapshotSource {
  return {
    familyName: (row.familyName as string | null) ?? null,
    givenName: (row.givenName as string | null) ?? null,
    familyKana: (row.familyKana as string | null) ?? null,
    givenKana: (row.givenKana as string | null) ?? null,
    birthDate: (row.birthDate as string | null) ?? null,
    gender: (row.gender as RenewalSnapshotSource['gender']) ?? null,
    dan: (row.dan as number | null) ?? null,
    grade: (row.grade as RenewalSnapshotSource['grade']) ?? null,
    postalCode: (row.postalCode as string | null) ?? null,
    address1: (row.address1 as string | null) ?? null,
    address2: (row.address2 as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    facultyKind: (row.facultyKind as FacultyKind | null) ?? null,
    faculty: (row.faculty as string | null) ?? null,
    schoolYear: (row.schoolYear as string | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// 回答（R3・R4・R6・AC-5〜9・AC-12・AC-14）
// ---------------------------------------------------------------------------

export interface SchoolYearAnswerInput {
  schoolYearKind: RenewalSchoolYearKind
  nextFacultyKind?: FacultyKind | null
  nextFaculty?: string | null
  nextSchoolYear?: string | null
}

export interface SaveAnswerInput {
  renewalId: number
  /** 回答の持ち主。 */
  userId: string
  /** 実際に操作した人（本人 or 代理の管理者）。 */
  actorUserId: string
  byAdmin: boolean
  /** 全日協セクションの回答。対象外なら省略する。 */
  answer?: RenewalAnswer
  /**
   * 名簿の列の修正（形式検証済みの値）。「登録する」のときだけ渡す。
   * `users` へ直接保存する（R3）。★`name`（合成表示名）は書かない。
   */
  rosterPatch?: Partial<Pick<RenewalSnapshotSource, (typeof ROSTER_FIELDS)[number]>>
  /** 学年セクションの回答。対象外・未回答なら省略する。 */
  schoolYear?: SchoolYearAnswerInput
}

export type SaveAnswerResult =
  | { ok: true; appliedSchoolYear: boolean }
  | { error: string; missingFields?: string[] }

/**
 * 本人／代理の回答を保存する。名簿の修正・回答・学年の 3 つを 1 トランザクションで
 * 書き、4/1 以降なら学年を同じ tx で `users` へ反映する（AC-12 の即時反映）。
 */
export async function saveRenewalAnswer(
  input: SaveAnswerInput,
  now: Date = new Date(),
): Promise<SaveAnswerResult> {
  const todayJst = todayInJst(now)

  return db.transaction(async (tx) => {
    // ★最初に年度確認行を `FOR UPDATE` する（`completeRenewal` と同じロック順序）。
    // 会員行だけをロックしていると、回答の保存と登録完了が並行したときに直列化
    // されず、「完了処理は未回答として扱って zen_nichikyo を残したのに、回答行
    // だけ not_register になる」不整合が起きる（＝全日協へ退会届を出し損ねる。
    // Codex レビュー PR #631 blocker）。ロック取得後に status を再確認する。
    const [lockedRenewal] = await tx
      .select({ id: membershipRenewals.id, status: membershipRenewals.status })
      .from(membershipRenewals)
      .where(eq(membershipRenewals.id, input.renewalId))
      .for('update')
      .limit(1)
    if (!lockedRenewal) return { error: '年度確認の対象ではありません' }
    if (lockedRenewal.status !== 'open') {
      return { error: 'この年度確認は登録完了しているため、回答を変更できません' }
    }

    const [row] = await tx
      .select({
        member: membershipRenewalMembers,
        renewalStatus: membershipRenewals.status,
        fiscalYear: membershipRenewals.fiscalYear,
        deactivatedAt: users.deactivatedAt,
        ...rosterColumns,
      })
      .from(membershipRenewalMembers)
      .innerJoin(membershipRenewals, eq(membershipRenewals.id, membershipRenewalMembers.renewalId))
      .innerJoin(users, eq(users.id, membershipRenewalMembers.userId))
      .where(
        and(
          eq(membershipRenewalMembers.renewalId, input.renewalId),
          eq(membershipRenewalMembers.userId, input.userId),
        ),
      )
      .for('update', { of: membershipRenewalMembers })
      .limit(1)
    if (!row) return { error: '年度確認の対象ではありません' }
    if (row.renewalStatus !== 'open') {
      return { error: 'この年度確認は登録完了しているため、回答を変更できません' }
    }

    const current = pickRosterSource(row)

    // ── 全日協セクション ────────────────────────────────────────────
    if (input.answer) {
      if (!row.member.isZennichikyoTarget) {
        return { error: '全日協の登録確認の対象ではありません' }
      }
      if (input.answer === 'register') {
        const merged: RenewalSnapshotSource = { ...current, ...(input.rosterPatch ?? {}) }
        const missing = findMissingRegisterFields(merged)
        if (missing.length > 0) {
          return {
            error: `未入力の項目があります: ${missing.join('・')}`,
            missingFields: missing,
          }
        }
        if (input.rosterPatch && Object.keys(input.rosterPatch).length > 0) {
          // ★`name`（合成表示名・UNIQUE）は書かない。既存の会員編集・招待登録と
          // 同じ規則で、補助列だけを更新する。
          await tx
            .update(users)
            .set({ ...input.rosterPatch, updatedAt: now })
            .where(eq(users.id, input.userId))
        }
      }
      await tx
        .update(membershipRenewalMembers)
        .set({
          answer: input.answer,
          answeredAt: now,
          // AC-8/AC-14: 回答者は毎回**両方**を上書きする。本人が答え直したのに
          // 「管理者が代理回答」の表示が残らないようにする。
          answeredByUserId: input.actorUserId,
          answeredByAdmin: input.byAdmin,
          updatedAt: now,
        })
        .where(eq(membershipRenewalMembers.id, row.member.id))
    }

    // ── 学年セクション ──────────────────────────────────────────────
    let appliedSchoolYear = false
    if (input.schoolYear) {
      if (!row.member.isCircleTarget) {
        return { error: '学年の確認の対象ではありません' }
      }
      const kind = input.schoolYear.schoolYearKind
      // 「卒業（サークルを離れる）」は学部等名・学年を残す（R4）ので、next_* が
      // 送られてきても保存しない（スキーマのコメントどおり 3 列とも NULL）。
      const answer = {
        schoolYearKind: kind,
        nextFacultyKind: kind === 'leave' ? null : (input.schoolYear.nextFacultyKind ?? null),
        nextFaculty: kind === 'leave' ? null : (input.schoolYear.nextFaculty ?? null),
        nextSchoolYear: kind === 'leave' ? null : (input.schoolYear.nextSchoolYear ?? null),
      }

      // ★区分と学年の整合性は**この境界で**検証する。Action 側は
      // `isValidSchoolYear`（区分をまたいだ全集合）しか見ていないため、
      // `nextFacultyKind` を省いて `nextSchoolYear: '博士4年'` を直接 POST すると
      // `faculty_kind='undergraduate'` なのに `school_year='博士4年'` という
      // 不整合が保存できてしまう（Codex レビュー PR #631 blocker）。
      // 進学で区分を変えない場合は現在の区分が実効値になる。
      if (kind === 'advance' || kind === 'custom') {
        if (!answer.nextSchoolYear) {
          return { error: '4月からの学年を選んでください' }
        }
        const effectiveFacultyKind = answer.nextFacultyKind ?? current.facultyKind
        if (!effectiveFacultyKind) {
          return { error: '所属（学部／大学院）を選んでください' }
        }
        if (!isSchoolYearForKind(answer.nextSchoolYear, effectiveFacultyKind)) {
          return { error: '選んだ所属では指定できない学年です' }
        }
      }

      // ★4/1 以降に「サークルを離れる」が **反映済み** の人が回答を継続側へ
      // 変えたら、`users.is_circle_member` を戻す。戻さないと回答行だけ継続に
      // 変わり、users は非所属のまま残る（遠征届の対象から外れたまま。
      // Codex レビュー PR #631 blocker）。対象者は開始時点でサークル員だった
      // （`is_circle_target`）ので、復元して差し支えない。
      const revertsAppliedLeave =
        row.member.schoolYearKind === 'leave' &&
        row.member.schoolYearAppliedAt !== null &&
        kind !== 'leave'

      const patch = resolveSchoolYearApply(answer, todayJst, row.fiscalYear)
      const usersPatch =
        patch || revertsAppliedLeave
          ? { ...(patch ?? {}), ...(revertsAppliedLeave ? { isCircleMember: true } : {}) }
          : null

      await tx
        .update(membershipRenewalMembers)
        .set({
          ...answer,
          schoolYearAnsweredAt: now,
          // 4/1 以降の回答は即時反映（AC-12）。反映しない場合は applied_at を
          // NULL のまま残し、4/1 の日次バッチが拾う。
          schoolYearAppliedAt: patch ? now : null,
          updatedAt: now,
        })
        .where(eq(membershipRenewalMembers.id, row.member.id))
      if (usersPatch) {
        await tx
          .update(users)
          .set({ ...usersPatch, updatedAt: now })
          .where(eq(users.id, input.userId))
        appliedSchoolYear = patch !== null
      }
    }

    return { ok: true as const, appliedSchoolYear }
  })
}

// ---------------------------------------------------------------------------
// 締切変更（R8・AC-17）
// ---------------------------------------------------------------------------

export type ChangeDeadlineResult = { ok: true; cancelled: number } | { error: string }

/**
 * 締切を変更し、新しい締切で計算し直したリマインド日程に無い**未送信の
 * リマインド**だけを取り消す。
 *
 * ★`kinds: ['reminder']` は必須。省略すると案内タスク（`target_date` が開始日で、
 * リマインドの対象日集合には決して含まれない）まで取り消され、「送信済みの案内は
 * 取り消さない」に反する。
 * ★新しい対象日が 0 件のとき（締切を翌日に詰めた等）は `keepTargetDates` を
 * **渡さない** —— `cancelTasks` は空配列を「絞り込み無し」として扱うので、
 * 「全リマインドを取り消す」意図を呼び出し側で明示する。
 */
export async function changeRenewalDeadline(
  renewalId: number,
  newDeadline: string,
  now: Date = new Date(),
): Promise<ChangeDeadlineResult> {
  const todayJst = todayInJst(now)
  if (!isRealYmd(newDeadline)) return { error: '締切の日付が不正です' }
  if (newDeadline < todayJst) return { error: '締切は今日以降の日付にしてください' }

  return db.transaction(async (tx) => {
    const [renewal] = await tx
      .select()
      .from(membershipRenewals)
      .where(eq(membershipRenewals.id, renewalId))
      .for('update')
      .limit(1)
    if (!renewal) return { error: '年度確認が見つかりません' }
    if (renewal.status !== 'open') return { error: '登録完了した年度確認の締切は変更できません' }

    await tx
      .update(membershipRenewals)
      .set({ deadline: newDeadline, updatedAt: now })
      .where(eq(membershipRenewals.id, renewalId))

    const keep = reminderTargetDates(todayInJst(renewal.startedAt), newDeadline)
    const cancelled = await cancelTasks(tx, {
      renewalId,
      kinds: ['reminder'],
      ...(keep.length > 0 ? { keepTargetDates: keep } : {}),
    })
    return { ok: true as const, cancelled }
  })
}

// ---------------------------------------------------------------------------
// 登録完了（R9・AC-18・AC-19）
// ---------------------------------------------------------------------------

export interface CompletionPreview {
  /** `zen_nichikyo` を false にする人数（「登録しない」∧ 未退会）。 */
  turnOffCount: number
  /** 未回答（全日協対象・未退会）の氏名。 */
  unansweredNames: string[]
}

/** 登録完了ダイアログに出す 3 点のうち人数と氏名（AC-19）。 */
export async function loadCompletionPreview(
  renewalId: number,
  dbc: DbOrTx = db,
): Promise<CompletionPreview> {
  const rows = await dbc
    .select({
      answer: membershipRenewalMembers.answer,
      isZennichikyoTarget: membershipRenewalMembers.isZennichikyoTarget,
      deactivatedAt: users.deactivatedAt,
      name: users.name,
    })
    .from(membershipRenewalMembers)
    .innerJoin(users, eq(users.id, membershipRenewalMembers.userId))
    .where(eq(membershipRenewalMembers.renewalId, renewalId))

  const active = rows.filter((r) => r.isZennichikyoTarget && r.deactivatedAt === null)
  return {
    turnOffCount: active.filter((r) => r.answer === 'not_register').length,
    unansweredNames: active.filter((r) => r.answer === null).map((r) => r.name ?? '（表示名なし）'),
  }
}

export type CompleteRenewalResult =
  | { ok: true; turnedOff: number; cancelled: number }
  | { error: string }

/**
 * 登録完了（取り消せない）。R9 の 3 つを 1 トランザクションで行う:
 * ①「登録しない」回答者の `zen_nichikyo` を false ②未送信タスクの取消
 * ③年度確認を completed に。
 *
 * ★退会処理済みの対象者はフラグを触らない（集計からも外している人に副作用を
 * 残さない。R1 末尾）。未回答者のフラグも変えない（＝継続扱い・AC-18）。
 */
export async function completeRenewal(
  renewalId: number,
  adminUserId: string,
  now: Date = new Date(),
): Promise<CompleteRenewalResult> {
  return db.transaction(async (tx) => {
    const [renewal] = await tx
      .select()
      .from(membershipRenewals)
      .where(eq(membershipRenewals.id, renewalId))
      .for('update')
      .limit(1)
    if (!renewal) return { error: '年度確認が見つかりません' }
    if (renewal.status !== 'open') return { error: 'この年度確認は既に登録完了しています' }

    const turnedOff = await tx
      .update(users)
      .set({ zenNichikyo: false, updatedAt: now })
      .where(
        and(
          isNull(users.deactivatedAt),
          sql`${users.id} IN (
            SELECT ${membershipRenewalMembers.userId}
            FROM ${membershipRenewalMembers}
            WHERE ${membershipRenewalMembers.renewalId} = ${renewalId}
              AND ${membershipRenewalMembers.isZennichikyoTarget}
              AND ${membershipRenewalMembers.answer} = 'not_register'
          )`,
        ),
      )
      .returning({ id: users.id })

    const cancelled = await cancelTasks(tx, { renewalId })

    await tx
      .update(membershipRenewals)
      .set({ status: 'completed', completedAt: now, completedBy: adminUserId, updatedAt: now })
      .where(eq(membershipRenewals.id, renewalId))

    return { ok: true as const, turnedOff: turnedOff.length, cancelled }
  })
}

// ---------------------------------------------------------------------------
// S2 ボードの読み出し（R5・AC-7・AC-13）
// ---------------------------------------------------------------------------

/** 4 タブの分類（design-spec S2）。 */
export type RenewalCategory = 'unanswered' | 'unchanged' | 'changed' | 'not_register'

export interface RenewalBoardRow {
  userId: string
  displayName: string
  membershipKind: MembershipKind
  current: RenewalSnapshotSource
  snapshot: RenewalSnapshot
  diff: RosterDiffEntry[]
  category: RenewalCategory
  readerCertification: ReaderCertification | null
  isAssociateReferee: boolean
  isZennichikyoTarget: boolean
  isCircleTarget: boolean
  answer: RenewalAnswer | null
  answeredAt: Date | null
  answeredByAdmin: boolean
  schoolYearKind: RenewalSchoolYearKind | null
  nextSchoolYear: string | null
  schoolYearAnsweredAt: Date | null
  /** 退会処理済み（集計の母数から外し、行には「退会」印を出す）。 */
  deactivated: boolean
  lineLinked: boolean
  /** リマインドタスクの対象に載った回数。 */
  reminderCount: number
}

export interface RenewalBoard {
  renewal: RenewalRow
  rows: RenewalBoardRow[]
  /** 主集計（全日協・退会処理済みは母数から除外）。 */
  zennichikyo: { answered: number; total: number }
  /** 副集計（学年）。 */
  circle: { answered: number; total: number }
  counts: Record<RenewalCategory, number>
  /** 次のリマインド日（`YYYY-MM-DD`）。残っていなければ `null`。 */
  nextReminderDate: string | null
}

function categorize(row: {
  answer: RenewalAnswer | null
  diffCount: number
}): RenewalCategory {
  if (row.answer === null) return 'unanswered'
  if (row.answer === 'not_register') return 'not_register'
  return row.diffCount > 0 ? 'changed' : 'unchanged'
}

/** S2 の 1 画面ぶんをまとめて読む。 */
export async function loadRenewalBoard(
  renewalId: number,
  now: Date = new Date(),
  dbc: DbOrTx = db,
): Promise<RenewalBoard | null> {
  const [renewal] = await dbc
    .select()
    .from(membershipRenewals)
    .where(eq(membershipRenewals.id, renewalId))
    .limit(1)
  if (!renewal) return null

  const memberRows = await dbc
    .select({
      member: membershipRenewalMembers,
      name: users.name,
      lineUserId: users.lineUserId,
      deactivatedAt: users.deactivatedAt,
      readerCertification: users.readerCertification,
      isAssociateReferee: users.isAssociateReferee,
      ...rosterColumns,
    })
    .from(membershipRenewalMembers)
    .innerJoin(users, eq(users.id, membershipRenewalMembers.userId))
    .where(eq(membershipRenewalMembers.renewalId, renewalId))
    .orderBy(asc(users.familyKana), asc(users.name))

  // 「リマインドに載った回数」は送信タスクの対象リストから数える（専用の列を
  // 持たない）。取消済みのタスクは載らなかったのと同じなので除く。
  const tasks = await dbc
    .select({ targetUserIds: lineChatTasks.targetUserIds })
    .from(lineChatTasks)
    .where(
      and(
        eq(lineChatTasks.renewalId, renewalId),
        eq(lineChatTasks.kind, 'reminder'),
        ne(lineChatTasks.status, 'CANCELLED'),
      ),
    )
  const reminderCounts = new Map<string, number>()
  for (const task of tasks) {
    for (const id of task.targetUserIds) {
      reminderCounts.set(id, (reminderCounts.get(id) ?? 0) + 1)
    }
  }

  const rows: RenewalBoardRow[] = memberRows.map((row) => {
    const current = pickRosterSource(row)
    const snapshot = safeParseRenewalSnapshot(row.member.snapshot) ?? buildRenewalSnapshot(current)
    const diff = diffRoster(snapshot, current)
    return {
      userId: row.member.userId,
      displayName: row.name ?? '（表示名なし）',
      membershipKind: resolveMembershipKind(current.birthDate, renewal.fiscalYear),
      current,
      snapshot,
      diff,
      category: categorize({ answer: row.member.answer, diffCount: diff.length }),
      readerCertification: row.readerCertification,
      isAssociateReferee: row.isAssociateReferee,
      isZennichikyoTarget: row.member.isZennichikyoTarget,
      isCircleTarget: row.member.isCircleTarget,
      answer: row.member.answer,
      answeredAt: row.member.answeredAt,
      answeredByAdmin: row.member.answeredByAdmin,
      schoolYearKind: row.member.schoolYearKind,
      nextSchoolYear: row.member.nextSchoolYear,
      schoolYearAnsweredAt: row.member.schoolYearAnsweredAt,
      deactivated: row.deactivatedAt !== null,
      lineLinked: row.lineUserId !== null,
      reminderCount: reminderCounts.get(row.member.userId) ?? 0,
    }
  })

  const zenActive = rows.filter((r) => r.isZennichikyoTarget && !r.deactivated)
  const circleActive = rows.filter((r) => r.isCircleTarget && !r.deactivated)
  const counts: Record<RenewalCategory, number> = {
    unanswered: 0,
    unchanged: 0,
    changed: 0,
    not_register: 0,
  }
  for (const row of zenActive) counts[row.category] += 1

  const todayJst = todayInJst(now)
  const upcoming =
    renewal.status === 'open'
      ? reminderTargetDates(todayInJst(renewal.startedAt), renewal.deadline).find(
          (d) => d >= todayJst,
        ) ?? null
      : null

  return {
    renewal,
    rows,
    zennichikyo: {
      answered: zenActive.filter((r) => r.answer !== null).length,
      total: zenActive.length,
    },
    circle: {
      answered: circleActive.filter((r) => r.schoolYearAnsweredAt !== null).length,
      total: circleActive.length,
    },
    counts,
    nextReminderDate: upcoming,
  }
}

/**
 * リマインドの対象になる未回答者（全日協対象 ∧ 未退会 ∧ 未回答）。
 * 19:30 バッチ（タスク8）と S2 の未回答一覧が共用する。
 */
export async function loadUnansweredZenTargets(
  renewalId: number,
  dbc: DbOrTx = db,
): Promise<{ userId: string; displayName: string; lineUserId: string | null }[]> {
  const rows = await dbc
    .select({
      userId: membershipRenewalMembers.userId,
      name: users.name,
      lineUserId: users.lineUserId,
    })
    .from(membershipRenewalMembers)
    .innerJoin(users, eq(users.id, membershipRenewalMembers.userId))
    .where(
      and(
        eq(membershipRenewalMembers.renewalId, renewalId),
        eq(membershipRenewalMembers.isZennichikyoTarget, true),
        isNull(membershipRenewalMembers.answer),
        isNull(users.deactivatedAt),
      ),
    )
    .orderBy(asc(users.familyKana), asc(users.name))
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.name ?? '（表示名なし）',
    lineUserId: r.lineUserId,
  }))
}
