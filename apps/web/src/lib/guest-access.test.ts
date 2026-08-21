import { describe, it, expect } from 'vitest'
import { isGuestAllowedPath, isGuestRole } from './guest-access'

describe('isGuestRole', () => {
  it('guest だけ true', () => {
    expect(isGuestRole('guest')).toBe(true)
    expect(isGuestRole('member')).toBe(false)
    expect(isGuestRole('vice_admin')).toBe(false)
    expect(isGuestRole('admin')).toBe(false)
  })

  it('未解決・不正値は false（ロール未解決のユーザーはゲスト扱いしない）', () => {
    expect(isGuestRole(undefined)).toBe(false)
    expect(isGuestRole(null)).toBe(false)
    expect(isGuestRole('')).toBe(false)
    expect(isGuestRole({ role: 'guest' })).toBe(false)
  })
})

describe('isGuestAllowedPath — 許可されるもの（AC-11 / AC-34）', () => {
  it('ログイン後の着地点と拒否先そのもの', () => {
    expect(isGuestAllowedPath('/')).toBe(true)
    // /403 を閉めるとリダイレクトループになる
    expect(isGuestAllowedPath('/403')).toBe(true)
  })

  it('大会申込一覧・大会詳細・過去の大会・設定', () => {
    expect(isGuestAllowedPath('/events')).toBe(true)
    expect(isGuestAllowedPath('/events/12')).toBe(true)
    expect(isGuestAllowedPath('/events/12/')).toBe(true)
    expect(isGuestAllowedPath('/events-archive')).toBe(true)
    expect(isGuestAllowedPath('/settings')).toBe(true)
  })

  it('名簿ファイルビューアはページ・API とも許可（AC-34）', () => {
    expect(isGuestAllowedPath('/roster-files/9')).toBe(true)
    expect(isGuestAllowedPath('/api/roster-files/9')).toBe(true)
    expect(isGuestAllowedPath('/api/roster-files/9/preview/1')).toBe(true)
  })

  it('認証そのものは許可', () => {
    expect(isGuestAllowedPath('/api/auth/signout')).toBe(true)
    expect(isGuestAllowedPath('/api/auth/session')).toBe(true)
  })
})

describe('isGuestAllowedPath — 拒否されるもの（AC-9 / AC-10 / AC-33 / AC-35）', () => {
  it('イベントの作成・編集は管理者専用', () => {
    expect(isGuestAllowedPath('/events/new')).toBe(false)
    expect(isGuestAllowedPath('/events/12/edit')).toBe(false)
  })

  it('設定は完全一致のみで下位ページは拒否', () => {
    expect(isGuestAllowedPath('/settings/notifications')).toBe(false)
    expect(isGuestAllowedPath('/settings/entry-form')).toBe(false)
    expect(isGuestAllowedPath('/settings/line-link')).toBe(false)
  })

  it('ホーム・統計戦績・メールは拒否（AC-9 / AC-10）', () => {
    expect(isGuestAllowedPath('/dashboard')).toBe(false)
    expect(isGuestAllowedPath('/players')).toBe(false)
    expect(isGuestAllowedPath('/players/3')).toBe(false)
    expect(isGuestAllowedPath('/players/ranking')).toBe(false)
    expect(isGuestAllowedPath('/tournaments')).toBe(false)
    expect(isGuestAllowedPath('/tournaments/stats')).toBe(false)
    expect(isGuestAllowedPath('/mail')).toBe(false)
    expect(isGuestAllowedPath('/mail/7')).toBe(false)
    expect(isGuestAllowedPath('/mail/attachments/7')).toBe(false)
  })

  it('管理画面は拒否（AC-10）', () => {
    expect(isGuestAllowedPath('/admin/entries')).toBe(false)
    expect(isGuestAllowedPath('/admin/members')).toBe(false)
    expect(isGuestAllowedPath('/admin/mail-inbox')).toBe(false)
  })

  it('会員向け受信メールの添付 API は拒否（AC-33）', () => {
    expect(isGuestAllowedPath('/api/mail/attachments/7')).toBe(false)
    expect(isGuestAllowedPath('/api/mail/attachments/7/preview/1')).toBe(false)
  })

  it('管理 API は拒否（AC-35）', () => {
    expect(isGuestAllowedPath('/api/admin/mail/unprocessed-count')).toBe(false)
    expect(isGuestAllowedPath('/api/admin/mail/attachments/7')).toBe(false)
  })

  it('未知のパスは既定で拒否（fail-closed。新しい画面が増えても閉じている）', () => {
    expect(isGuestAllowedPath('/some-future-page')).toBe(false)
    expect(isGuestAllowedPath('/api/some-future-route')).toBe(false)
    expect(isGuestAllowedPath('/self-identify')).toBe(false)
  })

  // events-no-entrants AC-14: 「申込者なしで締切済の大会」は会員・管理者専用。
  // 許可リストへ**追加しないこと自体が仕様**（fail-closed）なので、`/events` の
  // 前方一致に化けたり、将来うっかり許可側へ移されたりしないことを固定する。
  it('/events-no-entrants はゲストに開かない（events-no-entrants AC-14）', () => {
    expect(isGuestAllowedPath('/events-no-entrants')).toBe(false)
    expect(isGuestAllowedPath('/events-no-entrants/')).toBe(false)
  })

  it('パストラバーサル風のセグメントは許可に化けない', () => {
    expect(isGuestAllowedPath('/events/..')).toBe(false)
    expect(isGuestAllowedPath('/api/roster-files/../mail/attachments/7')).toBe(false)
    expect(isGuestAllowedPath('/roster-files/.')).toBe(false)
  })

  it('許可パスの下にサブパスをぶら下げても通らない', () => {
    expect(isGuestAllowedPath('/events-archive/9')).toBe(false)
    expect(isGuestAllowedPath('/403/x')).toBe(false)
    expect(isGuestAllowedPath('/roster-files/9/raw')).toBe(false)
    expect(isGuestAllowedPath('/api/roster-files/9/preview')).toBe(false)
    expect(isGuestAllowedPath('/api/roster-files/9/preview/1/2')).toBe(false)
  })
})
