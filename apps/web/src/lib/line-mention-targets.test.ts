import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createUser, createViceAdmin } from '@/test-utils/seed'
import {
  loadAdminLineUserIds,
  loadTreasurerLineUserIds,
  resolveTreasurerMention,
} from './line-mention-targets'

/** id 昇順を決定的に検証するため、id を明示して作る。 */
function linked(id: string, lineUserId: string) {
  return { id, lineUserId, lineLinkedAt: new Date() }
}

describe('line-mention-targets', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  describe('loadTreasurerLineUserIds', () => {
    it('会計フラグ・LINE 紐付け済み・未無効化の会員を id 昇順で全員返す（AC-4）', async () => {
      await createUser({
        name: 't-c',
        isTreasurer: true,
        ...linked('id-c', 'Uccc'),
      })
      await createUser({
        name: 't-a',
        isTreasurer: true,
        ...linked('id-a', 'Uaaa'),
      })
      await createUser({
        name: 't-b',
        isTreasurer: true,
        ...linked('id-b', 'Ubbb'),
      })

      expect(await loadTreasurerLineUserIds(testDb)).toEqual(['Uaaa', 'Ubbb', 'Uccc'])
    })

    it('line_user_id が NULL の会計担当は外れ、他の会計担当は残る（AC-6）', async () => {
      await createUser({ id: 'id-1', name: 't-nolink', isTreasurer: true, lineUserId: null })
      await createUser({ name: 't-linked', isTreasurer: true, ...linked('id-2', 'Ulinked') })

      expect(await loadTreasurerLineUserIds(testDb)).toEqual(['Ulinked'])
    })

    it('退会済み（deactivated_at 非 NULL）の会計担当は外れる', async () => {
      await createUser({
        name: 't-deactivated',
        isTreasurer: true,
        deactivatedAt: new Date(),
        ...linked('id-1', 'Udead'),
      })
      await createUser({ name: 't-active', isTreasurer: true, ...linked('id-2', 'Ualive') })

      expect(await loadTreasurerLineUserIds(testDb)).toEqual(['Ualive'])
    })

    it('会計フラグの無い会員は含まれない', async () => {
      await createUser({ name: 't-plain', ...linked('id-1', 'Uplain') })
      await createAdmin({ name: 't-admin', ...linked('id-2', 'Uadmin') })

      expect(await loadTreasurerLineUserIds(testDb)).toEqual([])
    })

    it('会計が0人なら空配列を返す（呼び出し側が素テキストへ倒せる・AC-5）', async () => {
      expect(await loadTreasurerLineUserIds(testDb)).toEqual([])
      expect(await resolveTreasurerMention(testDb)).toEqual({ kind: 'users', userIds: [] })
    })
  })

  describe('loadAdminLineUserIds', () => {
    it('admin と vice_admin を id 昇順で返し、一般会員は含めない', async () => {
      await createViceAdmin({ name: 'a-vice', ...linked('id-b', 'Uvice') })
      await createAdmin({ name: 'a-admin', ...linked('id-a', 'Uadmin') })
      await createUser({ name: 'a-member', ...linked('id-c', 'Umember') })

      expect(await loadAdminLineUserIds(testDb)).toEqual(['Uadmin', 'Uvice'])
    })

    it('未紐付け・退会済みの管理者は外れる', async () => {
      await createAdmin({ id: 'id-1', name: 'a-nolink', lineUserId: null })
      await createAdmin({
        name: 'a-deactivated',
        deactivatedAt: new Date(),
        ...linked('id-2', 'Udead'),
      })
      await createAdmin({ name: 'a-ok', ...linked('id-3', 'Uok') })

      expect(await loadAdminLineUserIds(testDb)).toEqual(['Uok'])
    })

    it('会計フラグは管理者メンションの対象判定に影響しない（§6: 認可に使わない）', async () => {
      await createUser({ name: 'a-treasurer', isTreasurer: true, ...linked('id-1', 'Utre') })

      expect(await loadAdminLineUserIds(testDb)).toEqual([])
    })
  })
})
