import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEvent,
  createEventAttendance,
  createGuest,
  createUser,
} from '@/test-utils/seed'
import { loadAttendanceEditData } from './attendance-edit'

/**
 * admin-attendance-edit タスク1: 編集画面の「参加者」セクション用ローダー。
 *
 * ここで固定するのは AC-8 のサーバー側の意味論 —— 参加者一覧は `attend=true` の
 * **全行**（詳細ページには出ない stale 行も落とさず、印だけ付ける）、候補は
 * 「対象ユーザー − 参加済み」。
 */
describe('loadAttendanceEditData', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  it('参加者一覧に対象級外の stale 行が含まれ outOfScope が立つ', async () => {
    const event = await createEvent({ eligibleGrades: ['A', 'B'] })
    const inScope = await createUser({ name: 'あ会員', grade: 'A' })
    const outOfScope = await createUser({ name: 'い会員', grade: 'D' })
    await createEventAttendance({ eventId: event.id, userId: inScope.id })
    await createEventAttendance({ eventId: event.id, userId: outOfScope.id })

    const { attendees } = await loadAttendanceEditData(event.id, event.eligibleGrades)

    expect(attendees.map((a) => [a.id, a.outOfScope])).toEqual([
      [inScope.id, false],
      [outOfScope.id, true],
    ])
  })

  it('isInvited=false の旧データ行も参加者一覧に残り outOfScope が立つ', async () => {
    const event = await createEvent({ eligibleGrades: null })
    const retired = await createUser({ name: '退会者', grade: 'A', isInvited: false })
    await createEventAttendance({ eventId: event.id, userId: retired.id })

    const { attendees, candidates } = await loadAttendanceEditData(
      event.id,
      event.eligibleGrades,
    )

    expect(attendees).toHaveLength(1)
    expect(attendees[0]?.outOfScope).toBe(true)
    expect(candidates.map((c) => c.id)).not.toContain(retired.id)
  })

  it('attend=false（不参加回答）の行は参加者一覧に出ない', async () => {
    const event = await createEvent({ eligibleGrades: null })
    const declined = await createUser({ name: '不参加会員' })
    await createEventAttendance({ eventId: event.id, userId: declined.id, attend: false })

    const { attendees, candidates } = await loadAttendanceEditData(
      event.id,
      event.eligibleGrades,
    )

    expect(attendees).toHaveLength(0)
    // 「不参加」回答済みの会員は候補には出す（追加＝attend 反転が起きる。AC-3）
    expect(candidates.map((c) => c.id)).toContain(declined.id)
  })

  it('候補から参加済み・対象級外・級未設定・isInvited=false が除かれる', async () => {
    const event = await createEvent({ eligibleGrades: ['A', 'B'] })
    const attending = await createUser({ name: '参加済み', grade: 'A' })
    const candidate = await createUser({ name: '候補', grade: 'B' })
    const wrongGrade = await createUser({ name: '対象級外', grade: 'C' })
    const noGrade = await createUser({ name: '級未設定', grade: null })
    const notInvited = await createUser({ name: '未招待', grade: 'A', isInvited: false })
    await createEventAttendance({ eventId: event.id, userId: attending.id })

    const { candidates } = await loadAttendanceEditData(event.id, event.eligibleGrades)

    const ids = candidates.map((c) => c.id)
    expect(ids).toEqual([candidate.id])
    expect(ids).not.toContain(attending.id)
    expect(ids).not.toContain(wrongGrade.id)
    expect(ids).not.toContain(noGrade.id)
    expect(ids).not.toContain(notInvited.id)
  })

  it('対象級が未設定の大会では級未設定の会員も候補に含まれる', async () => {
    const event = await createEvent({ eligibleGrades: null })
    const noGrade = await createUser({ name: '級未設定', grade: null })

    const { candidates } = await loadAttendanceEditData(event.id, event.eligibleGrades)

    expect(candidates.map((c) => c.id)).toContain(noGrade.id)
  })

  it('ゲスト・管理者ロールも候補に含まれる（ロール不問）', async () => {
    const event = await createEvent({ eligibleGrades: ['A'] })
    const guest = await createGuest({ name: 'ゲスト', grade: 'A' })
    const admin = await createAdmin({ name: '管理者', grade: 'A' })

    const { candidates } = await loadAttendanceEditData(event.id, event.eligibleGrades)

    const ids = candidates.map((c) => c.id)
    expect(ids).toContain(guest.id)
    expect(ids).toContain(admin.id)
    expect(candidates.find((c) => c.id === guest.id)?.role).toBe('guest')
  })

  it('返す列は id / name / grade / role だけ（PII を RSC payload に載せない）', async () => {
    const event = await createEvent({ eligibleGrades: null })
    const user = await createUser({ name: '会員', grade: 'A' })
    await createUser({ name: '別会員', grade: 'A' })
    await createEventAttendance({ eventId: event.id, userId: user.id })

    const { attendees, candidates } = await loadAttendanceEditData(
      event.id,
      event.eligibleGrades,
    )

    expect(Object.keys(attendees[0] ?? {}).sort()).toEqual([
      'grade',
      'id',
      'name',
      'outOfScope',
      'role',
    ])
    expect(Object.keys(candidates[0] ?? {}).sort()).toEqual(['grade', 'id', 'name', 'role'])
  })

  it('級の昇順で並び、級未設定は末尾に来る', async () => {
    const event = await createEvent({ eligibleGrades: null })
    const c = await createUser({ name: 'C会員', grade: 'C' })
    const none = await createUser({ name: '級なし会員', grade: null })
    const a = await createUser({ name: 'A会員', grade: 'A' })
    for (const u of [c, none, a]) {
      await createEventAttendance({ eventId: event.id, userId: u.id })
    }

    const { attendees } = await loadAttendanceEditData(event.id, event.eligibleGrades)

    expect(attendees.map((x) => x.id)).toEqual([a.id, c.id, none.id])
  })
})
