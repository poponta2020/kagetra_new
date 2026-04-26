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
 * and silently returned the noise default. See PR3 review r1 Should Fix.
 */
describe('loadFixturesFromDir', () => {
  it('keys payloads by the on-file `subject` field, not the filename', async () => {
    const fixtures = await loadFixturesFromDir(LLM_FIXTURE_DIR)

    expect(fixtures.size).toBeGreaterThanOrEqual(4)
    // The four checked-in fixtures must each be reachable by the subject the
    // matching .eml in test/fixtures/ actually has.
    const tournament = fixtures.get(
      '[taikai-ajka:828] 第65回全日本選手権大会/ご案内',
    )
    expect(tournament?.is_tournament_announcement).toBe(true)
    expect(tournament?.extracted.title).toBe('第65回全日本選手権大会')

    const mlTournament = fixtures.get(
      '[taikai-ajka:829] 第66回標榜大会のご案内',
    )
    expect(mlTournament?.is_tournament_announcement).toBe(true)

    const correction = fixtures.get(
      'Re: 【訂正】第65回全日本選手権大会のご案内',
    )
    expect(correction?.is_correction).toBe(true)

    const newsletter = fixtures.get('Weekly Update: New Features Available')
    expect(newsletter?.is_tournament_announcement).toBe(false)
  })

  it('does NOT key by filename basename (regression guard for review r1 fix)', async () => {
    const fixtures = await loadFixturesFromDir(LLM_FIXTURE_DIR)
    // Pre-fix code keyed by `tournament-announcement` etc.; a hit on those
    // keys means the loader regressed back to the broken behaviour.
    expect(fixtures.has('tournament-announcement')).toBe(false)
    expect(fixtures.has('newsletter')).toBe(false)
  })
})
