import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFixturesFromDir } from '../../src/classify/llm/fixture.js'

const LLM_FIXTURE_DIR = fileURLToPath(
  new URL('../fixtures/llm/', import.meta.url),
)

/**
 * Locks in the wrapper-based loader contract. Pre-fix the loader keyed each
 * payload by `<filename without .expected.json>`, so `--mock-imap --mock-llm`
 * smoke runs never matched the actual eml subjects (`[taikai-ajka:828] …`)
 * and silently returned the fallback payload. See PR3 review r1 Should Fix.
 *
 * 3.0.0 dropped `newsletter.expected.json` — it encoded a noise verdict, and
 * classification is no longer part of the extraction contract (AC-21⑥).
 */
describe('loadFixturesFromDir', () => {
  it('keys payloads by the on-file `subject` field, not the filename', async () => {
    const fixtures = await loadFixturesFromDir(LLM_FIXTURE_DIR)

    expect(fixtures.size).toBeGreaterThanOrEqual(3)
    // The three checked-in fixtures must each be reachable by the subject the
    // matching .eml in test/fixtures/ actually has.
    const tournament = fixtures.get(
      '[taikai-ajka:828] 第65回全日本選手権大会/ご案内',
    )
    expect(tournament?.events[0]?.formal_name).toBe('第65回全日本選手権大会')
    expect(tournament?.events[0]?.payment_deadline_kind).toBe('日付あり')

    const mlTournament = fixtures.get(
      '[taikai-ajka:829] 第66回標榜大会のご案内',
    )
    expect(mlTournament?.events[0]?.formal_name).toBe('第66回標榜大会')

    const correction = fixtures.get(
      'Re: 【訂正】第65回全日本選手権大会のご案内',
    )
    expect(correction?.events[0]?.entry_deadline).toBe('2026-05-07')
  })

  it('no longer ships the noise fixture (classification left the schema)', async () => {
    const fixtures = await loadFixturesFromDir(LLM_FIXTURE_DIR)
    expect(fixtures.has('Weekly Update: New Features Available')).toBe(false)
  })

  it('does NOT key by filename basename (regression guard for review r1 fix)', async () => {
    const fixtures = await loadFixturesFromDir(LLM_FIXTURE_DIR)
    // Pre-fix code keyed by `tournament-announcement` etc.; a hit on those
    // keys means the loader regressed back to the broken behaviour.
    expect(fixtures.has('tournament-announcement')).toBe(false)
    expect(fixtures.has('ml-tournament')).toBe(false)
  })
})
