import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  clubLineGroups,
  lineChannels,
  lineChatTasks,
  membershipRenewalMembers,
  membershipRenewals,
  users,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createGuest, createUser } from '@/test-utils/seed'
import {
  changeRenewalDeadline,
  completeRenewal,
  countRenewalTargets,
  findMissingRegisterFields,
  loadCompletionPreview,
  loadMemberRenewalView,
  loadRenewalBoard,
  loadUnansweredZenTargets,
  saveRenewalAnswer,
  startRenewal,
} from './store'

const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

/** 全日協「登録する」の必須項目を全て満たす会員の初期値。 */
const FULL_PROFILE = {
  zenNichikyo: true,
  familyName: '北海',
  givenName: '太郎',
  familyKana: 'ほっかい',
  givenKana: 'たろう',
  birthDate: '2004-06-12',
  gender: 'male' as const,
  grade: 'B' as const,
  dan: 3,
  postalCode: '0010017',
  address1: '札幌市北区北17条西3-1-38',
  address2: 'ボストンハウス501',
  phone: '090-0000-0000',
}

afterAll(async () => {
  await closeTestDb()
  if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL
})

beforeEach(async () => {
  await truncateAll()
  process.env.PUBLIC_BASE_URL = 'https://example.test'
})

/** S3（会 LINE グループ）を設定済みにする＝開始の前提を満たす。 */
async function seedClubLineGroup(): Promise<number> {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${crypto.randomUUID()}`,
      channelSecret: 's',
      channelAccessToken: 't',
      botId: '@club-bot',
      purpose: 'club_chat',
      status: 'assigned',
    })
    .returning({ id: lineChannels.id })
  const [group] = await testDb
    .insert(clubLineGroups)
    .values({
      lineChannelId: channel!.id,
      oamAccountPath: 'U16c4a1b2c3d4e5f60718293a4b5c6d70',
      oamChatRoomId: 'C432c0102030405060708090a0b0c0d0e',
      chatRoomName: '会グループ',
    })
    .returning({ id: clubLineGroups.id })
  return group!.id
}

describe('countRenewalTargets（開始前の前提表示・AC-1 と同条件）', () => {
  it('全日協 ON・サークル ON をそれぞれ数え、退会済みとゲストは数えない', async () => {
    await createUser({ name: 'zen-only', zenNichikyo: true })
    await createUser({ name: 'circle-only', isCircleMember: true })
    await createUser({ name: 'both', zenNichikyo: true, isCircleMember: true })
    await createUser({ name: 'left', zenNichikyo: true, deactivatedAt: new Date() })
    await createGuest({ name: 'guest-1', zenNichikyo: true, isCircleMember: true })

    const counts = await countRenewalTargets()
    expect(counts.zennichikyo).toBe(2)
    expect(counts.circle).toBe(2)
  })
})

describe('startRenewal（AC-1・AC-2・AC-3）', () => {
  it('対象者のスナップショットと案内タスクを 1 トランザクションで作る', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const target = await createUser({ name: '対象者', ...FULL_PROFILE })
    await createUser({ name: '対象外' })

    const result = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: '住所が変わった人は郵便番号も' },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    expect(result).toEqual({ renewalId: expect.any(Number) })
    const renewalId = (result as { renewalId: number }).renewalId

    const members = await testDb
      .select()
      .from(membershipRenewalMembers)
      .where(eq(membershipRenewalMembers.renewalId, renewalId))
    expect(members).toHaveLength(1)
    expect(members[0]!.userId).toBe(target.id)
    expect(members[0]!.isZennichikyoTarget).toBe(true)
    expect(members[0]!.snapshot.familyName).toBe('北海')
    expect(members[0]!.snapshot.phone).toBe('090-0000-0000')
    expect(members[0]!.snapshot.v).toBe(1)

    const tasks = await testDb
      .select()
      .from(lineChatTasks)
      .where(eq(lineChatTasks.renewalId, renewalId))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.kind).toBe('announcement')
    expect(tasks[0]!.messageText).toContain('https://example.test/renewal')
    expect(tasks[0]!.messageText).toContain('3/25')
    expect(tasks[0]!.messageText).toContain('住所が変わった人は郵便番号も')
    // 現在時刻 +15 分を 10 分境界へ切り上げ（12:00 JST → 12:20 JST）。
    expect(tasks[0]!.scheduledSendAt.toISOString()).toBe('2027-03-10T03:20:00.000Z')
  })

  it('学年だけの対象者も行になり、両方 false の会員は行にならない', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const circle = await createUser({ name: 'サークルのみ', isCircleMember: true })

    const result = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    const renewalId = (result as { renewalId: number }).renewalId
    const members = await testDb
      .select()
      .from(membershipRenewalMembers)
      .where(eq(membershipRenewalMembers.renewalId, renewalId))
    expect(members).toHaveLength(1)
    expect(members[0]!.userId).toBe(circle.id)
    expect(members[0]!.isZennichikyoTarget).toBe(false)
    expect(members[0]!.isCircleTarget).toBe(true)
  })

  it('開始後に users のフラグを変えても対象集合は増減しない（AC-1）', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const target = await createUser({ name: '対象者', ...FULL_PROFILE })
    const outsider = await createUser({ name: '対象外' })

    const result = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    const renewalId = (result as { renewalId: number }).renewalId

    // 開始後にフラグを反転させる。
    await testDb.update(users).set({ zenNichikyo: false }).where(eq(users.id, target.id))
    await testDb.update(users).set({ zenNichikyo: true }).where(eq(users.id, outsider.id))

    const board = await loadRenewalBoard(renewalId, new Date('2027-03-12T03:00:00Z'))
    expect(board!.zennichikyo.total).toBe(1)
    expect(board!.rows.map((r) => r.userId)).toEqual([target.id])
    // 対象外だった会員は S1 でも対象にならない。
    expect(await loadMemberRenewalView(outsider.id)).toBeNull()
  })

  it('会 LINE グループ未設定なら開始できない', async () => {
    const admin = await createAdmin({ name: 'admin' })
    const result = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    expect(result).toEqual({ error: expect.stringContaining('会 LINE グループ') })
    expect(await testDb.select().from(membershipRenewals)).toHaveLength(0)
  })

  it('PUBLIC_BASE_URL 未設定なら開始できず、行も作られない', async () => {
    await seedClubLineGroup()
    delete process.env.PUBLIC_BASE_URL
    const admin = await createAdmin({ name: 'admin' })
    const result = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    expect(result).toEqual({ error: expect.stringContaining('PUBLIC_BASE_URL') })
    expect(await testDb.select().from(membershipRenewals)).toHaveLength(0)
  })

  it('進行中がある／同一年度が実施済み／締切が今日以前 のとき拒否する', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const now = new Date('2027-03-10T03:00:00Z')

    expect(
      await startRenewal({ fiscalYear: 2027, deadline: '2027-03-10', note: null }, admin.id, now),
    ).toEqual({ error: expect.stringContaining('今日より後') })

    await startRenewal({ fiscalYear: 2027, deadline: '2027-03-25', note: null }, admin.id, now)
    expect(
      await startRenewal({ fiscalYear: 2028, deadline: '2027-03-25', note: null }, admin.id, now),
    ).toEqual({ error: expect.stringContaining('進行中') })

    await testDb.update(membershipRenewals).set({ status: 'completed' })
    expect(
      await startRenewal({ fiscalYear: 2027, deadline: '2027-03-25', note: null }, admin.id, now),
    ).toEqual({ error: expect.stringContaining('実施済み') })
  })
})

describe('findMissingRegisterFields（AC-5）', () => {
  const base = {
    familyName: '北海',
    givenName: '太郎',
    familyKana: 'ほっかい',
    givenKana: 'たろう',
    birthDate: '2004-06-12',
    gender: 'male' as const,
    dan: null,
    grade: 'B' as const,
    postalCode: '0010017',
    address1: '札幌市北区',
    address2: null,
    phone: '090-0000-0000',
    facultyKind: null,
    faculty: null,
    schoolYear: null,
  }

  it('全て埋まっていれば空（住所2・段位は B 級では必須ではない）', () => {
    expect(findMissingRegisterFields(base)).toEqual([])
  })

  it('欠けた項目のラベルを返す', () => {
    expect(findMissingRegisterFields({ ...base, phone: null, address1: null })).toEqual([
      '住所1',
      '電話番号',
    ])
  })

  it('段位は A 級のときだけ必須', () => {
    expect(findMissingRegisterFields({ ...base, grade: 'A', dan: null })).toEqual(['段位'])
    expect(findMissingRegisterFields({ ...base, grade: 'A', dan: 4 })).toEqual([])
  })
})

describe('saveRenewalAnswer（AC-5・AC-6・AC-8・AC-12・AC-14）', () => {
  async function startWith(
    // 必須欠落のケースを作るため、名簿の列は明示的に null にできる形にする
    // （`zen_nichikyo` は NOT NULL なので boolean のまま）。
    overrides: {
      [K in keyof typeof FULL_PROFILE]?: K extends 'zenNichikyo'
        ? boolean
        : (typeof FULL_PROFILE)[K] | null
    } = {},
    now = new Date('2027-03-10T03:00:00Z'),
  ) {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const member = await createUser({ name: '北海 太郎', ...FULL_PROFILE, ...overrides })
    const result = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      now,
    )
    return { admin, member, renewalId: (result as { renewalId: number }).renewalId }
  }

  it('「登録する」で必須が欠けていれば保存されず、欠けた項目が返る', async () => {
    const { member, renewalId } = await startWith({ phone: null })

    const result = await saveRenewalAnswer({
      renewalId,
      userId: member.id,
      actorUserId: member.id,
      byAdmin: false,
      answer: 'register',
    })
    expect(result).toMatchObject({ missingFields: ['電話番号'] })

    const [row] = await testDb
      .select()
      .from(membershipRenewalMembers)
      .where(eq(membershipRenewalMembers.renewalId, renewalId))
    expect(row!.answer).toBeNull()
  })

  it('「登録しない」は必須が欠けていても保存できる（AC-5）', async () => {
    const { member, renewalId } = await startWith({ phone: null })

    const result = await saveRenewalAnswer({
      renewalId,
      userId: member.id,
      actorUserId: member.id,
      byAdmin: false,
      answer: 'not_register',
    })
    expect(result).toMatchObject({ ok: true })

    const [row] = await testDb
      .select()
      .from(membershipRenewalMembers)
      .where(eq(membershipRenewalMembers.renewalId, renewalId))
    expect(row!.answer).toBe('not_register')
  })

  it('行内修正が users へ直接保存され、name は書き換わらない（AC-6）', async () => {
    const { member, renewalId } = await startWith()

    const result = await saveRenewalAnswer({
      renewalId,
      userId: member.id,
      actorUserId: member.id,
      byAdmin: false,
      answer: 'register',
      rosterPatch: { address1: '東京都府中市小柳町1-20-6', postalCode: '1830013' },
    })
    expect(result).toMatchObject({ ok: true })

    const updated = await testDb.query.users.findFirst({ where: eq(users.id, member.id) })
    expect(updated?.address1).toBe('東京都府中市小柳町1-20-6')
    expect(updated?.postalCode).toBe('1830013')
    expect(updated?.name).toBe('北海 太郎')

    const view = await loadMemberRenewalView(member.id)
    expect(view!.diff.map((d) => d.field)).toEqual(['postalCode', 'address1'])
  })

  it('回答者が上書きされる — 管理者の代理回答のあとに本人が答え直すと代理の印が消える（AC-8・AC-14）', async () => {
    const { admin, member, renewalId } = await startWith()

    await saveRenewalAnswer({
      renewalId,
      userId: member.id,
      actorUserId: admin.id,
      byAdmin: true,
      answer: 'not_register',
    })
    let [row] = await testDb
      .select()
      .from(membershipRenewalMembers)
      .where(eq(membershipRenewalMembers.renewalId, renewalId))
    expect(row!.answeredByAdmin).toBe(true)
    expect(row!.answeredByUserId).toBe(admin.id)

    await saveRenewalAnswer({
      renewalId,
      userId: member.id,
      actorUserId: member.id,
      byAdmin: false,
      answer: 'register',
    })
    ;[row] = await testDb
      .select()
      .from(membershipRenewalMembers)
      .where(eq(membershipRenewalMembers.renewalId, renewalId))
    expect(row!.answer).toBe('register')
    expect(row!.answeredByAdmin).toBe(false)
    expect(row!.answeredByUserId).toBe(member.id)
  })

  it('対象外の会員 id では書けない（AC-9 の store 側の担保）', async () => {
    const { renewalId } = await startWith()
    const outsider = await createUser({ name: '対象外' })

    const result = await saveRenewalAnswer({
      renewalId,
      userId: outsider.id,
      actorUserId: outsider.id,
      byAdmin: false,
      answer: 'register',
    })
    expect(result).toEqual({ error: expect.stringContaining('対象ではありません') })
  })

  it('学年の回答は 4/1 より前は users に反映されず、applied_at も NULL のまま（AC-12）', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const member = await createUser({
      name: '学年 対象',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '工学部',
      schoolYear: '3年',
    })
    const started = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    const renewalId = (started as { renewalId: number }).renewalId

    const result = await saveRenewalAnswer(
      {
        renewalId,
        userId: member.id,
        actorUserId: member.id,
        byAdmin: false,
        schoolYear: { schoolYearKind: 'advance', nextSchoolYear: '4年' },
      },
      new Date('2027-03-12T03:00:00Z'),
    )
    expect(result).toMatchObject({ ok: true, appliedSchoolYear: false })

    const [row] = await testDb
      .select()
      .from(membershipRenewalMembers)
      .where(eq(membershipRenewalMembers.renewalId, renewalId))
    expect(row!.nextSchoolYear).toBe('4年')
    expect(row!.schoolYearAppliedAt).toBeNull()
    const unchanged = await testDb.query.users.findFirst({ where: eq(users.id, member.id) })
    expect(unchanged?.schoolYear).toBe('3年')
  })

  it('4/1 以降の回答は即時反映され、卒業はサークル所属を外す（AC-12）', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const advancing = await createUser({
      name: '進級',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '工学部',
      schoolYear: '3年',
    })
    const leaving = await createUser({
      name: '卒業',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '4年',
    })
    const started = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    const renewalId = (started as { renewalId: number }).renewalId
    const afterApril = new Date('2027-04-02T03:00:00Z')

    await saveRenewalAnswer(
      {
        renewalId,
        userId: advancing.id,
        actorUserId: advancing.id,
        byAdmin: false,
        schoolYear: {
          schoolYearKind: 'advance',
          nextFacultyKind: 'graduate',
          nextFaculty: '工学院',
          nextSchoolYear: '修士1年',
        },
      },
      afterApril,
    )
    const a = await testDb.query.users.findFirst({ where: eq(users.id, advancing.id) })
    expect(a?.schoolYear).toBe('修士1年')
    expect(a?.facultyKind).toBe('graduate')
    expect(a?.faculty).toBe('工学院')

    await saveRenewalAnswer(
      {
        renewalId,
        userId: leaving.id,
        actorUserId: leaving.id,
        byAdmin: false,
        schoolYear: { schoolYearKind: 'leave' },
      },
      afterApril,
    )
    const l = await testDb.query.users.findFirst({ where: eq(users.id, leaving.id) })
    expect(l?.isCircleMember).toBe(false)
    // 卒業は学部等名・学年を残す。
    expect(l?.faculty).toBe('文学部')
    expect(l?.schoolYear).toBe('4年')
  })

  it('登録完了後は回答を変更できない', async () => {
    const { admin, member, renewalId } = await startWith()
    await completeRenewal(renewalId, admin.id)

    const result = await saveRenewalAnswer({
      renewalId,
      userId: member.id,
      actorUserId: member.id,
      byAdmin: false,
      answer: 'register',
    })
    expect(result).toEqual({ error: expect.stringContaining('登録完了') })
  })
})

describe('changeRenewalDeadline（AC-17）', () => {
  it('新しい締切の日程に無いリマインドだけを取り消し、案内は取り消さない', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    await createUser({ name: '対象者', ...FULL_PROFILE })
    const started = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    const renewalId = (started as { renewalId: number }).renewalId

    // 旧締切での対象日のうち 2 日ぶんを未送信タスクとして仕込む。
    for (const targetDate of ['2027-03-13', '2027-03-24']) {
      await testDb.insert(lineChatTasks).values({
        renewalId,
        kind: 'reminder',
        targetDate,
        scheduledSendAt: new Date(`${targetDate}T11:00:00Z`),
        messageText: 'リマインド',
      })
    }

    const result = await changeRenewalDeadline(
      renewalId,
      '2027-03-15',
      new Date('2027-03-11T03:00:00Z'),
    )
    expect(result).toMatchObject({ ok: true })

    const tasks = await testDb
      .select()
      .from(lineChatTasks)
      .where(eq(lineChatTasks.renewalId, renewalId))
    const byDate = new Map(tasks.map((t) => [`${t.kind}:${t.targetDate}`, t.status]))
    // 新しい締切 3/15 の対象日は 3/13（+3）・3/14（前日）・3/15（当日）。
    expect(byDate.get('reminder:2027-03-13')).toBe('PENDING')
    expect(byDate.get('reminder:2027-03-24')).toBe('CANCELLED')
    // 案内（target_date = 開始日）は取り消されない。
    expect(byDate.get('announcement:2027-03-10')).toBe('PENDING')
  })

  it('新しい締切で対象日が 0 件になるときは全てのリマインドを取り消す（案内は残す）', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const started = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    const renewalId = (started as { renewalId: number }).renewalId
    await testDb.insert(lineChatTasks).values({
      renewalId,
      kind: 'reminder',
      targetDate: '2027-03-13',
      scheduledSendAt: new Date('2027-03-13T11:00:00Z'),
      messageText: 'リマインド',
    })

    // 締切を開始日と同日に詰めると対象日集合は空になる。
    await changeRenewalDeadline(renewalId, '2027-03-10', new Date('2027-03-10T03:00:00Z'))

    const tasks = await testDb
      .select()
      .from(lineChatTasks)
      .where(eq(lineChatTasks.renewalId, renewalId))
    const byKind = new Map(tasks.map((t) => [t.kind, t.status]))
    expect(byKind.get('reminder')).toBe('CANCELLED')
    expect(byKind.get('announcement')).toBe('PENDING')
  })
})

describe('completeRenewal（AC-18・AC-19）', () => {
  async function setupForCompletion() {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const notRegister = await createUser({ name: '登録しない', ...FULL_PROFILE })
    const register = await createUser({ name: '登録する', ...FULL_PROFILE })
    const unanswered = await createUser({ name: '未回答', ...FULL_PROFILE })
    const left = await createUser({ name: '退会者', ...FULL_PROFILE })
    const started = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    const renewalId = (started as { renewalId: number }).renewalId

    for (const [user, answer] of [
      [notRegister, 'not_register'],
      [register, 'register'],
      [left, 'not_register'],
    ] as const) {
      await saveRenewalAnswer({
        renewalId,
        userId: user.id,
        actorUserId: user.id,
        byAdmin: false,
        answer,
      })
    }
    // 回答後に退会処理された対象者。
    await testDb.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, left.id))
    return { admin, notRegister, register, unanswered, left, renewalId }
  }

  it('確認ダイアログの人数と未回答の氏名（AC-19）', async () => {
    const { renewalId } = await setupForCompletion()
    const preview = await loadCompletionPreview(renewalId)
    expect(preview.turnOffCount).toBe(1)
    expect(preview.unansweredNames).toEqual(['未回答'])
  })

  it('「登録しない」のフラグだけを落とし、未回答・退会済みは変えない', async () => {
    const { admin, notRegister, register, unanswered, left, renewalId } =
      await setupForCompletion()
    await testDb.insert(lineChatTasks).values({
      renewalId,
      kind: 'reminder',
      targetDate: '2027-03-19',
      scheduledSendAt: new Date('2027-03-19T11:00:00Z'),
      messageText: 'リマインド',
    })

    const result = await completeRenewal(renewalId, admin.id)
    expect(result).toMatchObject({ ok: true, turnedOff: 1 })

    const flags = async (id: string) =>
      (await testDb.query.users.findFirst({ where: eq(users.id, id) }))?.zenNichikyo
    expect(await flags(notRegister.id)).toBe(false)
    expect(await flags(register.id)).toBe(true)
    expect(await flags(unanswered.id)).toBe(true)
    // 退会処理済みは「登録しない」でもフラグを触らない。
    expect(await flags(left.id)).toBe(true)

    const [renewal] = await testDb
      .select()
      .from(membershipRenewals)
      .where(eq(membershipRenewals.id, renewalId))
    expect(renewal!.status).toBe('completed')
    expect(renewal!.completedBy).toBe(admin.id)

    const pending = await testDb
      .select()
      .from(lineChatTasks)
      .where(and(eq(lineChatTasks.renewalId, renewalId), eq(lineChatTasks.status, 'PENDING')))
    expect(pending).toHaveLength(0)

    // 二重実行は拒否する（取り消せない・冪等ではなく明示エラー）。
    expect(await completeRenewal(renewalId, admin.id)).toEqual({
      error: expect.stringContaining('既に登録完了'),
    })
  })
})

describe('loadRenewalBoard / loadUnansweredZenTargets（AC-7・AC-13）', () => {
  it('4 分類・主副集計・次のリマインド日・退会印・リマインド回数を返す', async () => {
    await seedClubLineGroup()
    const admin = await createAdmin({ name: 'admin' })
    const unchanged = await createUser({ name: 'あ 変更なし', ...FULL_PROFILE })
    const changed = await createUser({ name: 'い 変更あり', ...FULL_PROFILE })
    const declined = await createUser({ name: 'う 登録しない', ...FULL_PROFILE })
    const unanswered = await createUser({ name: 'え 未回答', ...FULL_PROFILE })
    const circleOnly = await createUser({
      name: 'お 学年のみ',
      isCircleMember: true,
      facultyKind: 'undergraduate',
      faculty: '文学部',
      schoolYear: '2年',
    })
    const started = await startRenewal(
      { fiscalYear: 2027, deadline: '2027-03-25', note: null },
      admin.id,
      new Date('2027-03-10T03:00:00Z'),
    )
    const renewalId = (started as { renewalId: number }).renewalId

    await saveRenewalAnswer({
      renewalId,
      userId: unchanged.id,
      actorUserId: unchanged.id,
      byAdmin: false,
      answer: 'register',
    })
    await saveRenewalAnswer({
      renewalId,
      userId: changed.id,
      actorUserId: changed.id,
      byAdmin: false,
      answer: 'register',
      rosterPatch: { phone: '080-1111-2222' },
    })
    await saveRenewalAnswer({
      renewalId,
      userId: declined.id,
      actorUserId: declined.id,
      byAdmin: false,
      answer: 'not_register',
    })
    // 管理者が会員編集で直した分も差分に出る（AC-7）。
    await testDb.update(users).set({ address2: '新棟101' }).where(eq(users.id, unanswered.id))

    await testDb.insert(lineChatTasks).values({
      renewalId,
      kind: 'reminder',
      targetDate: '2027-03-13',
      scheduledSendAt: new Date('2027-03-13T11:00:00Z'),
      messageText: 'リマインド',
      targetUserIds: [unanswered.id],
    })

    const board = await loadRenewalBoard(renewalId, new Date('2027-03-12T03:00:00Z'))
    expect(board!.zennichikyo).toEqual({ answered: 3, total: 4 })
    expect(board!.circle).toEqual({ answered: 0, total: 1 })
    expect(board!.counts).toEqual({
      unanswered: 1,
      unchanged: 1,
      changed: 1,
      not_register: 1,
    })
    expect(board!.nextReminderDate).toBe('2027-03-13')

    const byId = new Map(board!.rows.map((r) => [r.userId, r]))
    expect(byId.get(changed.id)!.diff.map((d) => d.field)).toEqual(['phone'])
    expect(byId.get(unchanged.id)!.category).toBe('unchanged')
    expect(byId.get(unanswered.id)!.reminderCount).toBe(1)
    expect(byId.get(circleOnly.id)!.isZennichikyoTarget).toBe(false)

    const targets = await loadUnansweredZenTargets(renewalId)
    expect(targets.map((t) => t.userId)).toEqual([unanswered.id])

    // 退会処理されると母数から外れる。
    await testDb.update(users).set({ deactivatedAt: new Date() }).where(eq(users.id, unanswered.id))
    const after = await loadRenewalBoard(renewalId, new Date('2027-03-12T03:00:00Z'))
    expect(after!.zennichikyo).toEqual({ answered: 3, total: 3 })
    expect(after!.rows.find((r) => r.userId === unanswered.id)!.deactivated).toBe(true)
    expect(await loadUnansweredZenTargets(renewalId)).toEqual([])
  })
})
