import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createGuest, createUser, createViceAdmin } from '@/test-utils/seed'
import { isTravelReportSubmitter } from './authz'

// travel-report タスク4: 提出権限者判定（requirements R2・R12）の唯一のヘルパー。
// admin ∪ vice_admin ∪ (role==='member' ∧ is_travel_report_submitter ∧ 未退会)。

describe('travel-report/authz: isTravelReportSubmitter', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('未ログイン（session なし）は false', async () => {
    expect(await isTravelReportSubmitter(null)).toBe(false)
    expect(await isTravelReportSubmitter(undefined)).toBe(false)
    expect(await isTravelReportSubmitter({ user: null })).toBe(false)
    expect(await isTravelReportSubmitter({ user: { role: 'admin' } })).toBe(false)
  })

  it('admin は常に true（フラグ不問）', async () => {
    const admin = await createAdmin({ isTravelReportSubmitter: false })
    expect(
      await isTravelReportSubmitter({ user: { id: admin.id, role: 'admin' } }),
    ).toBe(true)
  })

  it('vice_admin は常に true（フラグ不問）', async () => {
    const vice = await createViceAdmin({ isTravelReportSubmitter: false })
    expect(
      await isTravelReportSubmitter({ user: { id: vice.id, role: 'vice_admin' } }),
    ).toBe(true)
  })

  it('role=member でフラグ ON なら true', async () => {
    const member = await createUser({ isTravelReportSubmitter: true })
    expect(
      await isTravelReportSubmitter({ user: { id: member.id, role: 'member' } }),
    ).toBe(true)
  })

  it('role=member でフラグ OFF なら false（一般会員は不可）', async () => {
    const member = await createUser({ isTravelReportSubmitter: false })
    expect(
      await isTravelReportSubmitter({ user: { id: member.id, role: 'member' } }),
    ).toBe(false)
  })

  it('role=guest はフラグが ON でも false（ゲストにフラグが付いても権限にならない）', async () => {
    const guest = await createGuest({ isTravelReportSubmitter: true })
    expect(
      await isTravelReportSubmitter({ user: { id: guest.id, role: 'guest' } }),
    ).toBe(false)
  })

  it('退会済み（deactivated_at あり）は role=member ∧ フラグ ON でも false', async () => {
    const member = await createUser({
      isTravelReportSubmitter: true,
      deactivatedAt: new Date(),
    })
    expect(
      await isTravelReportSubmitter({ user: { id: member.id, role: 'member' } }),
    ).toBe(false)
  })

  it('role-preview: 実効ロール member ∧ 本人のフラグ ON なら true（実効ロール規律どおり）', async () => {
    // admin が member としてプレビュー中でも session.user.id は本物の admin の
    // id のまま。その admin 自身の行にフラグが立っていれば true になる
    // （role-preview で member として閲覧中の管理者にフラグがあれば
    // 提出権限者 UI が出る、という意図した挙動）。
    const admin = await createAdmin({ isTravelReportSubmitter: true })
    expect(
      await isTravelReportSubmitter({ user: { id: admin.id, role: 'member' } }),
    ).toBe(true)
  })

  it('存在しない user id は false（fail-closed）', async () => {
    expect(
      await isTravelReportSubmitter({ user: { id: 'no-such-user', role: 'member' } }),
    ).toBe(false)
  })
})
