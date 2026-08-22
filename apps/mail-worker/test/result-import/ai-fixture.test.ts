import { describe, expect, it } from 'vitest'
import { FixtureResultImportAi } from '../../src/result-import/ai/fixture.js'
import type {
  ExtractionInput,
  RoutingInput,
} from '../../src/result-import/ai/types.js'
import type { RoutingResult } from '../../src/result-import/ai/routing-schema.js'
import type { ParsedResultPayload } from '../../src/result-import/schema.js'

const ROUTING_INPUT: RoutingInput = {
  filename: 'result.xlsx',
  subject: '第11回東大阪競技かるた大会 結果',
  sheetNames: ['対戦結果表_D1級'],
  sheetHeadRows: [],
  parserAttempt: [{ className: 'D1', participantCount: 8 }],
  promptVersion: '1.0.0',
}

const EXTRACTION_INPUT: ExtractionInput = {
  filename: 'result.xlsx',
  subject: '第11回東大阪競技かるた大会 結果',
  promptVersion: '1.0.0',
  source: { kind: 'sheets', sheets: [{ name: '対戦結果表_D1級', csv: '' }] },
}

describe('FixtureResultImportAi', () => {
  it('reports modelId as fixture', () => {
    const ai = new FixtureResultImportAi()
    expect(ai.modelId).toBe('fixture')
  })

  it('route() returns a default adopt verdict when unconfigured', async () => {
    const ai = new FixtureResultImportAi()
    const result = await ai.route(ROUTING_INPUT)
    expect(result.parsed.verdict).toBe('adopt')
    expect(result.model).toBe('fixture')
    expect(result.tokensInput).toBeGreaterThan(0)
    expect(result.tokensOutput).toBeGreaterThan(0)
    expect(result.costUsd).toBe(0)
  })

  it('route() returns the configured routing result', async () => {
    const configured: RoutingResult = {
      verdict: 'escalate',
      outOfScopeKind: null,
      classMap: [],
      meta: {
        tournamentName: 'テスト大会',
        editionNumber: 5,
        eventDate: '2026-01-25',
        isCorrection: true,
      },
      issues: ['級分割が消えている'],
    }
    const ai = new FixtureResultImportAi({ routing: configured })
    const result = await ai.route(ROUTING_INPUT)
    expect(result.parsed).toEqual(configured)
  })

  it('route() throws the configured failRoute error', async () => {
    const err = new Error('boom')
    const ai = new FixtureResultImportAi({ failRoute: err })
    await expect(ai.route(ROUTING_INPUT)).rejects.toBe(err)
  })

  it('extract() returns a default minimal payload when unconfigured', async () => {
    const ai = new FixtureResultImportAi()
    const result = await ai.extract(EXTRACTION_INPUT)
    expect(result.parsed.classes.length).toBeGreaterThan(0)
    expect(result.model).toBe('fixture')
    expect(result.tokensInput).toBeGreaterThan(0)
    expect(result.tokensOutput).toBeGreaterThan(0)
    expect(result.costUsd).toBe(0)
  })

  it('extract() returns the configured extraction payload', async () => {
    const configured: ParsedResultPayload = {
      parserVersion: 'ai-extract-1.0.0',
      classes: [],
    }
    const ai = new FixtureResultImportAi({ extraction: configured })
    const result = await ai.extract(EXTRACTION_INPUT)
    expect(result.parsed).toEqual(configured)
  })

  it('extract() throws the configured failExtract error', async () => {
    const err = new Error('boom')
    const ai = new FixtureResultImportAi({ failExtract: err })
    await expect(ai.extract(EXTRACTION_INPUT)).rejects.toBe(err)
  })
})
