import { describe, it, expect } from 'vitest'
import {
  buildRolePreviewSelection,
  isRolePreviewAllowed,
  parseUserRole,
  resolveEffectiveRole,
  roleViewLabel,
  sanitizeReturnPath,
  selectableRoles,
} from './role-preview'

describe('parseUserRole', () => {
  it('enum 内の値はそのまま返す', () => {
    expect(parseUserRole('admin')).toBe('admin')
    expect(parseUserRole('vice_admin')).toBe('vice_admin')
    expect(parseUserRole('member')).toBe('member')
  })

  it('enum 外・非文字列は null', () => {
    expect(parseUserRole('superadmin')).toBeNull()
    expect(parseUserRole('')).toBeNull()
    expect(parseUserRole(undefined)).toBeNull()
    expect(parseUserRole(null)).toBeNull()
    expect(parseUserRole(1)).toBeNull()
    expect(parseUserRole({ role: 'admin' })).toBeNull()
  })
})

describe('resolveEffectiveRole', () => {
  it('viewAsRole 未設定なら本物のロール（AC-18 の回帰）', () => {
    expect(resolveEffectiveRole('admin', undefined)).toBe('admin')
    expect(resolveEffectiveRole('admin', null)).toBe('admin')
    expect(resolveEffectiveRole('member', undefined)).toBe('member')
  })

  it('同値なら本物のロール', () => {
    expect(resolveEffectiveRole('admin', 'admin')).toBe('admin')
    expect(resolveEffectiveRole('vice_admin', 'vice_admin')).toBe('vice_admin')
  })

  it('下位ロールを指定すればその下位ロールになる', () => {
    expect(resolveEffectiveRole('admin', 'member')).toBe('member')
    expect(resolveEffectiveRole('admin', 'vice_admin')).toBe('vice_admin')
    expect(resolveEffectiveRole('vice_admin', 'member')).toBe('member')
  })

  it('上位ロールを指定しても本物のロール止まり（AC-12 昇格不能）', () => {
    expect(resolveEffectiveRole('vice_admin', 'admin')).toBe('vice_admin')
    expect(resolveEffectiveRole('member', 'admin')).toBe('member')
    expect(resolveEffectiveRole('member', 'vice_admin')).toBe('member')
  })

  it('enum 外の値が混入しても本物のロール（AC-11）', () => {
    expect(resolveEffectiveRole('admin', 'superadmin')).toBe('admin')
    expect(resolveEffectiveRole('admin', '')).toBe('admin')
    expect(resolveEffectiveRole('member', { role: 'admin' })).toBe('member')
  })

  it('本物のロールが未解決のときは受け取った値をそのまま素通しする（既存挙動の保存）', () => {
    expect(resolveEffectiveRole(undefined, 'member')).toBeUndefined()
    expect(resolveEffectiveRole(null, 'member')).toBeNull()
  })
})

describe('isRolePreviewAllowed', () => {
  it('env 未設定・空・空白のみは常に false（AC-1 fail-closed）', () => {
    expect(isRolePreviewAllowed('u1', undefined)).toBe(false)
    expect(isRolePreviewAllowed('u1', '')).toBe(false)
    expect(isRolePreviewAllowed('u1', '   ')).toBe(false)
    expect(isRolePreviewAllowed('u1', ',,')).toBe(false)
    expect(isRolePreviewAllowed('u1', null)).toBe(false)
  })

  it('リストに含まれないユーザーは false（AC-2）', () => {
    expect(isRolePreviewAllowed('u9', 'u1,u2,u3')).toBe(false)
  })

  it('リストに含まれるユーザーは true', () => {
    expect(isRolePreviewAllowed('u2', 'u1,u2,u3')).toBe(true)
  })

  it('空白入り・末尾カンマを正しく分解する', () => {
    expect(isRolePreviewAllowed('b', 'a, b ,c')).toBe(true)
    expect(isRolePreviewAllowed('c', 'a,b,c,')).toBe(true)
    expect(isRolePreviewAllowed('a', ' a ')).toBe(true)
  })

  it('userId が空・null・空白のみなら false', () => {
    expect(isRolePreviewAllowed('', 'u1,u2')).toBe(false)
    expect(isRolePreviewAllowed(null, 'u1,u2')).toBe(false)
    expect(isRolePreviewAllowed(undefined, 'u1,u2')).toBe(false)
    expect(isRolePreviewAllowed('   ', 'u1,u2')).toBe(false)
  })

  it('部分一致では許可しない', () => {
    expect(isRolePreviewAllowed('u1', 'u10,u11')).toBe(false)
  })
})

describe('selectableRoles', () => {
  it('admin は 3 件（上位から）', () => {
    expect(selectableRoles('admin')).toEqual(['admin', 'vice_admin', 'member'])
  })

  it('vice_admin は 2 件で admin を含まない（AC-4 昇格不可）', () => {
    expect(selectableRoles('vice_admin')).toEqual(['vice_admin', 'member'])
  })

  it('member は 1 件', () => {
    expect(selectableRoles('member')).toEqual(['member'])
  })
})

describe('roleViewLabel', () => {
  it('日本語のロール名を返す', () => {
    expect(roleViewLabel('admin')).toBe('管理者')
    expect(roleViewLabel('vice_admin')).toBe('副管理者')
    expect(roleViewLabel('member')).toBe('一般会員')
  })
})

describe('buildRolePreviewSelection', () => {
  it('許可された admin は 3 択（AC-3）', () => {
    expect(buildRolePreviewSelection('u1', 'admin', 'admin', 'u1')).toEqual({
      current: 'admin',
      real: 'admin',
      selectable: ['admin', 'vice_admin', 'member'],
    })
  })

  it('許可された vice_admin は 2 択で admin を含まない（AC-4）', () => {
    expect(buildRolePreviewSelection('u1', 'vice_admin', 'vice_admin', 'u1')).toEqual({
      current: 'vice_admin',
      real: 'vice_admin',
      selectable: ['vice_admin', 'member'],
    })
  })

  it('env 未設定なら null＝セクションを描画しない（AC-1）', () => {
    expect(buildRolePreviewSelection('u1', 'admin', 'admin', undefined)).toBeNull()
    expect(buildRolePreviewSelection('u1', 'admin', 'admin', '')).toBeNull()
  })

  it('許可リスト外・非プレビューなら null（AC-2）', () => {
    expect(buildRolePreviewSelection('u1', 'admin', 'admin', 'someone-else')).toBeNull()
  })

  it('プレビュー中は current が実効ロールになる', () => {
    expect(buildRolePreviewSelection('u1', 'admin', 'member', 'u1')).toEqual({
      current: 'member',
      real: 'admin',
      selectable: ['admin', 'vice_admin', 'member'],
    })
  })

  it('de-list されてもプレビュー中なら「本物のロールへ戻す」1択だけ残す（AC-10b 締め出し防止）', () => {
    expect(buildRolePreviewSelection('u1', 'admin', 'member', 'someone-else')).toEqual({
      current: 'member',
      real: 'admin',
      selectable: ['admin'],
    })
  })

  it('ロールが未解決なら null', () => {
    expect(buildRolePreviewSelection('u1', undefined, undefined, 'u1')).toBeNull()
    expect(buildRolePreviewSelection('u1', 'admin', undefined, 'u1')).toBeNull()
  })
})

describe('guest-role（AC-1 / AC-24 / AC-36）', () => {
  it('parseUserRole は guest を受理する（実効ロールが下流の認可へ届くため）', () => {
    expect(parseUserRole('guest')).toBe('guest')
  })

  it('roleViewLabel は guest を「ゲスト」と返す（AC-27 の表示元）', () => {
    expect(roleViewLabel('guest')).toBe('ゲスト')
  })

  it('selectableRoles のどの結果にも guest は現れない（AC-36 の拒否そのもの）', () => {
    expect(selectableRoles('admin')).toEqual(['admin', 'vice_admin', 'member'])
    expect(selectableRoles('vice_admin')).toEqual(['vice_admin', 'member'])
    expect(selectableRoles('member')).toEqual(['member'])
    expect(selectableRoles('guest')).toEqual([])
  })

  it('viewAsRole="guest" は誰も適用できず本物のロールのまま（管理者の締め出し防止）', () => {
    expect(resolveEffectiveRole('admin', 'guest')).toBe('admin')
    expect(resolveEffectiveRole('vice_admin', 'guest')).toBe('vice_admin')
    expect(resolveEffectiveRole('member', 'guest')).toBe('member')
  })

  it('ゲスト本人は昇格できない（実効ロールは guest のまま）', () => {
    expect(resolveEffectiveRole('guest', 'admin')).toBe('guest')
    expect(resolveEffectiveRole('guest', 'vice_admin')).toBe('guest')
    expect(resolveEffectiveRole('guest', 'member')).toBe('guest')
    expect(resolveEffectiveRole('guest', undefined)).toBe('guest')
  })

  it('ゲストには表示ロール切替セクションを描画しない（許可リストに載っていても null）', () => {
    expect(buildRolePreviewSelection('u1', 'guest', 'guest', 'u1')).toBeNull()
    expect(buildRolePreviewSelection('u1', 'guest', 'guest', undefined)).toBeNull()
    // 実効ロールだけが guest（原理的に起きないが fail-closed で塞ぐ）
    expect(buildRolePreviewSelection('u1', 'admin', 'guest', 'u1')).toBeNull()
  })
})

describe('sanitizeReturnPath', () => {
  it('相対パスはそのまま通す', () => {
    expect(sanitizeReturnPath('/')).toBe('/')
    expect(sanitizeReturnPath('/events/12')).toBe('/events/12')
    expect(sanitizeReturnPath('/players?grade=A')).toBe('/players?grade=A')
  })

  it('絶対 URL・protocol-relative はフォールバック（オープンリダイレクト防止）', () => {
    expect(sanitizeReturnPath('https://evil.com')).toBe('/')
    expect(sanitizeReturnPath('//evil.com')).toBe('/')
    expect(sanitizeReturnPath('/\\evil.com')).toBe('/')
    expect(sanitizeReturnPath('evil.com')).toBe('/')
  })

  it('制御文字入り・非文字列はフォールバック', () => {
    expect(sanitizeReturnPath('/ok\nSet-Cookie: x')).toBe('/')
    expect(sanitizeReturnPath(null)).toBe('/')
    expect(sanitizeReturnPath(undefined)).toBe('/')
    expect(sanitizeReturnPath(123)).toBe('/')
  })
})
