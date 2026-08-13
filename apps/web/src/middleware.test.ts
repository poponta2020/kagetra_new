import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * middleware のルーティング判定テスト。
 *
 * `NextAuth(authConfig)` が返す `auth()` は「渡したハンドラをそのまま
 * ラップして req.auth にセッションを載せる」だけなので、ここではその
 * ラッパーを恒等関数にモックし、ハンドラ本体の分岐だけを検証する。
 * セッションはテスト側が `req.auth` に直接載せる。
 */
vi.mock('next-auth', () => ({
  default: () => ({
    auth: (handler: (req: unknown) => unknown) => handler,
  }),
}))

const middlewareModule = await import('./middleware')
const middleware = middlewareModule.default as (req: unknown) => Response
const matcher = middlewareModule.config.matcher[0] as string

type Session = {
  user?: { id?: string; role?: string }
} | null

function request(path: string, session: Session): unknown {
  const req = new NextRequest(`http://localhost:3000${path}`)
  // `auth` は NextAuth のラッパーが載せるプロパティ。恒等モックなので
  // テスト側で用意する。
  Object.defineProperty(req, 'auth', { value: session, writable: true })
  return req
}

const guest = { user: { id: 'g1', role: 'guest' } }
const member = { user: { id: 'm1', role: 'member' } }

function locationOf(res: Response): string | null {
  const raw = res.headers.get('location')
  return raw ? new URL(raw).pathname : null
}

describe('middleware — 既存の挙動（回帰）', () => {
  it('未認証は /auth/signin へ', () => {
    const res = middleware(request('/dashboard', null))
    expect(res.status).toBe(307)
    expect(locationOf(res)).toBe('/auth/signin')
  })

  it('未認証でも /auth/signin と /register/* は素通し', () => {
    expect(middleware(request('/auth/signin', null)).status).toBe(200)
    expect(middleware(request('/register/tok', null)).status).toBe(200)
  })

  it('セッションはあるが内部 id 未解決なら /self-identify へ', () => {
    const res = middleware(request('/dashboard', { user: {} }))
    expect(locationOf(res)).toBe('/self-identify')
  })

  it('紐付け済みユーザーの /register/* は / へ', () => {
    expect(locationOf(middleware(request('/register/tok', member)))).toBe('/')
  })

  it('一般会員は会員向け画面を素通しできる', () => {
    for (const path of [
      '/dashboard',
      '/players',
      '/tournaments/stats',
      '/mail',
      '/settings/notifications',
      '/api/mail/attachments/7',
    ]) {
      expect(middleware(request(path, member)).status, path).toBe(200)
    }
  })
})

describe('middleware — ゲストの許可リスト（AC-9 / AC-10 / AC-11 / AC-33 / AC-35）', () => {
  it('許可されたページは素通し', () => {
    for (const path of [
      '/',
      '/events',
      '/events/12',
      '/events-archive',
      '/settings',
      '/roster-files/9',
      '/403',
    ]) {
      expect(middleware(request(path, guest)).status, path).toBe(200)
    }
  })

  it('許可外のページは /403 へリダイレクト', () => {
    for (const path of [
      '/dashboard',
      '/players',
      '/players/ranking',
      '/tournaments',
      '/mail',
      '/admin/entries',
      '/admin/members',
      '/events/new',
      '/events/12/edit',
      '/settings/notifications',
    ]) {
      const res = middleware(request(path, guest))
      expect(res.status, path).toBe(307)
      expect(locationOf(res), path).toBe('/403')
    }
  })

  it('許可外の API は 403 JSON（リダイレクトしない）', async () => {
    for (const path of [
      '/api/mail/attachments/7',
      '/api/mail/attachments/7/preview/1',
      '/api/admin/mail/unprocessed-count',
    ]) {
      const res = middleware(request(path, guest))
      expect(res.status, path).toBe(403)
      expect(res.headers.get('location'), path).toBeNull()
      await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
    }
  })

  it('名簿ファイルの API は素通し（AC-34）', () => {
    expect(middleware(request('/api/roster-files/9', guest)).status).toBe(200)
    expect(
      middleware(request('/api/roster-files/9/preview/1', guest)).status,
    ).toBe(200)
  })

  it('リダイレクト先にクエリを持ち越さない', () => {
    const res = middleware(request('/players?q=%E5%B1%B1%E7%94%B0', guest))
    expect(new URL(res.headers.get('location') as string).search).toBe('')
  })
})

describe('middleware — matcher（未認証前提ルートの除外。external-entrants-api）', () => {
  // matcher のカスタム正規表現グループ `((?!...).*)` をそのまま JS の RegExp
  // として評価する（Next の matcher コンパイルの近似。除外リストの回帰網）。
  const pattern = new RegExp(`^${matcher}$`)

  it('/api/external/* は matcher の対象外（セッション認証へ誘導されない）', () => {
    expect(pattern.test('/api/external/tournament-entrants')).toBe(false)
  })

  it('既存の除外（LINE webhook）と保護対象（ページ・通常 API）は変わらない', () => {
    expect(pattern.test('/api/webhook/line')).toBe(false)
    expect(pattern.test('/dashboard')).toBe(true)
    expect(pattern.test('/api/mail/attachments/7')).toBe(true)
  })
})
