import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyExternalApiKey } from './external-api-key'

const KEY = 'test-external-api-key-123'

describe('verifyExternalApiKey', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('正しいキーの Bearer で true', () => {
    vi.stubEnv('EXTERNAL_ENTRANTS_API_KEY', KEY)
    expect(verifyExternalApiKey(`Bearer ${KEY}`)).toBe(true)
  })

  it('キー不一致で false（同長でも別値なら弾く）', () => {
    vi.stubEnv('EXTERNAL_ENTRANTS_API_KEY', KEY)
    expect(verifyExternalApiKey('Bearer wrong-key')).toBe(false)
    // timingSafeEqual 本体（同長比較）を通るパス。
    expect(verifyExternalApiKey(`Bearer ${'x'.repeat(KEY.length)}`)).toBe(false)
  })

  it('Authorization ヘッダ欠落・Bearer 以外のスキームで false', () => {
    vi.stubEnv('EXTERNAL_ENTRANTS_API_KEY', KEY)
    expect(verifyExternalApiKey(null)).toBe(false)
    expect(verifyExternalApiKey(KEY)).toBe(false)
    expect(verifyExternalApiKey(`Basic ${KEY}`)).toBe(false)
  })

  it('env 未設定なら正しい形式でも false（fail-closed）', () => {
    vi.stubEnv('EXTERNAL_ENTRANTS_API_KEY', undefined)
    expect(verifyExternalApiKey(`Bearer ${KEY}`)).toBe(false)
  })

  it('env 空文字 × 空 Bearer でも false（空文字同士の一致で素通りさせない）', () => {
    vi.stubEnv('EXTERNAL_ENTRANTS_API_KEY', '')
    expect(verifyExternalApiKey('Bearer ')).toBe(false)
    expect(verifyExternalApiKey('Bearer')).toBe(false)
  })
})
