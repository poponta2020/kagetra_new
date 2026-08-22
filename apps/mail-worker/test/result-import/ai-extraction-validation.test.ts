import { describe, expect, it } from 'vitest'
import { ParsedResultPayloadSchema } from '../../src/result-import/schema.js'

/**
 * フル抽出出力の Zod 不整合テスト(AC-8 の下支え)。Anthropic クライアント
 * 自体はネットワーク呼び出しなのでここではテストしない — `safeParse` が
 * 壊れた形を確実に拒否することだけを固定する。`ai/anthropic.ts` の
 * `extract()` はこの `safeParse` の失敗を `AiValidationError` として run
 * 側の `parse_failed` に落とす。
 */
describe('ParsedResultPayloadSchema (AI extraction output validation)', () => {
  it('accepts a well-formed payload', () => {
    const result = ParsedResultPayloadSchema.safeParse({
      parserVersion: 'ai-extract-1.0.0',
      classes: [
        {
          className: 'D級',
          grade: 'D',
          sheetName: '対戦結果表_D1級',
          participants: [
            {
              seqNo: 1,
              name: 'テスト一郎',
              nameKana: null,
              affiliation: null,
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [
                {
                  round: 1,
                  roundLabel: '1回戦',
                  opponentName: 'テスト二郎',
                  scoreDiff: 5,
                  result: 'win',
                  status: 'normal',
                },
              ],
            },
          ],
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a participant with an empty name', () => {
    const result = ParsedResultPayloadSchema.safeParse({
      parserVersion: 'ai-extract-1.0.0',
      classes: [
        {
          className: 'D級',
          grade: 'D',
          sheetName: null,
          participants: [
            {
              seqNo: 1,
              name: '',
              nameKana: null,
              affiliation: null,
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [],
            },
          ],
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown match result value', () => {
    const result = ParsedResultPayloadSchema.safeParse({
      parserVersion: 'ai-extract-1.0.0',
      classes: [
        {
          className: 'D級',
          grade: 'D',
          sheetName: null,
          participants: [
            {
              seqNo: 1,
              name: 'テスト一郎',
              nameKana: null,
              affiliation: null,
              prefecture: null,
              dan: null,
              memberNo: null,
              finalRank: null,
              matches: [
                {
                  round: 1,
                  roundLabel: null,
                  opponentName: null,
                  scoreDiff: null,
                  result: 'draw',
                  status: 'normal',
                },
              ],
            },
          ],
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing className', () => {
    const result = ParsedResultPayloadSchema.safeParse({
      parserVersion: 'ai-extract-1.0.0',
      classes: [
        {
          className: '',
          grade: null,
          sheetName: null,
          participants: [],
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('accepts an omitted rawClassName (backward compatible with pre-AI payloads)', () => {
    const result = ParsedResultPayloadSchema.safeParse({
      parserVersion: 'v1',
      classes: [
        {
          className: 'D1',
          grade: null,
          sheetName: '対戦結果表_D1級',
          participants: [],
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts an explicit rawClassName', () => {
    const result = ParsedResultPayloadSchema.safeParse({
      parserVersion: 'v1',
      classes: [
        {
          className: 'D級',
          grade: 'D',
          sheetName: '対戦結果表_D1級',
          rawClassName: 'D1',
          participants: [],
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})
