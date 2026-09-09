import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyLineChatWorkerToken } from './line-chat-worker-token'

const TOKEN = 'test-line-chat-worker-token-123'

describe('verifyLineChatWorkerToken', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('正しいトークンで ok', () => {
    vi.stubEnv('LINE_CHAT_WORKER_TOKEN', TOKEN)
    expect(verifyLineChatWorkerToken(TOKEN)).toBe('ok')
  })

  it('トークン不一致で invalid（同長でも別値なら弾く）', () => {
    vi.stubEnv('LINE_CHAT_WORKER_TOKEN', TOKEN)
    expect(verifyLineChatWorkerToken('wrong-token')).toBe('invalid')
    // timingSafeEqual 本体（同長比較）を通るパス。
    expect(verifyLineChatWorkerToken('x'.repeat(TOKEN.length))).toBe('invalid')
  })

  it('ヘッダ欠落・空文字は missing（AC-21: 401 と 403 を区別する）', () => {
    vi.stubEnv('LINE_CHAT_WORKER_TOKEN', TOKEN)
    expect(verifyLineChatWorkerToken(null)).toBe('missing')
    expect(verifyLineChatWorkerToken('')).toBe('missing')
  })

  it('env 未設定ならヘッダが正しい値でも invalid（fail-closed）', () => {
    vi.stubEnv('LINE_CHAT_WORKER_TOKEN', undefined)
    expect(verifyLineChatWorkerToken(TOKEN)).toBe('invalid')
  })

  it('env 空文字 × 空文字ヘッダは missing のまま（空文字同士の一致で素通りさせない）', () => {
    vi.stubEnv('LINE_CHAT_WORKER_TOKEN', '')
    expect(verifyLineChatWorkerToken('')).toBe('missing')
    // ヘッダが非空だが env が空文字 → invalid（決して ok にしない）。
    expect(verifyLineChatWorkerToken('anything')).toBe('invalid')
  })
})
