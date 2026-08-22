import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RoutingResultSchema } from '../../src/result-import/ai/routing-schema.js'

/**
 * RoutingResultSchema の受理/拒否契約テスト。verdict の値域・classMap 要素の
 * 必須性・nullable フィールドを固定する。
 */
describe('RoutingResultSchema', () => {
  const baseValid = {
    verdict: 'adopt' as const,
    outOfScopeKind: null,
    classMap: [
      {
        className: 'D1',
        normalizedClassName: 'D級',
        grade: 'D' as const,
        exclude: false,
        note: null,
      },
    ],
    meta: {
      tournamentName: '第11回東大阪競技かるた大会',
      editionNumber: 11,
      eventDate: '2026-01-25',
      isCorrection: false,
    },
    issues: [],
  }

  it('accepts a fully-populated adopt verdict', () => {
    const parsed = RoutingResultSchema.parse(baseValid)
    expect(parsed.verdict).toBe('adopt')
    expect(parsed.classMap).toHaveLength(1)
  })

  it('accepts an out_of_scope verdict with outOfScopeKind set', () => {
    const parsed = RoutingResultSchema.parse({
      ...baseValid,
      verdict: 'out_of_scope',
      outOfScopeKind: 'team',
      classMap: [],
    })
    expect(parsed.outOfScopeKind).toBe('team')
  })

  it('rejects an unknown verdict value', () => {
    const result = RoutingResultSchema.safeParse({
      ...baseValid,
      verdict: 'unknown_verdict',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown outOfScopeKind value', () => {
    const result = RoutingResultSchema.safeParse({
      ...baseValid,
      outOfScopeKind: 'not_a_valid_kind',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a classMap entry missing a required field', () => {
    const result = RoutingResultSchema.safeParse({
      ...baseValid,
      classMap: [
        {
          className: 'D1',
          normalizedClassName: 'D級',
          // grade omitted entirely — required (nullable, not optional)
          exclude: false,
          note: null,
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown grade value in classMap', () => {
    const result = RoutingResultSchema.safeParse({
      ...baseValid,
      classMap: [
        {
          className: 'D1',
          normalizedClassName: 'D級',
          grade: 'Z',
          exclude: false,
          note: null,
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a null grade in classMap (non A-E class)', () => {
    const parsed = RoutingResultSchema.parse({
      ...baseValid,
      classMap: [
        {
          className: '段位認定',
          normalizedClassName: '段位認定',
          grade: null,
          exclude: true,
          note: '選手一覧シートで対戦結果を含まない',
        },
      ],
    })
    expect(parsed.classMap[0]?.grade).toBeNull()
    expect(parsed.classMap[0]?.exclude).toBe(true)
  })

  it('accepts null meta fields', () => {
    const parsed = RoutingResultSchema.parse({
      ...baseValid,
      meta: {
        tournamentName: null,
        editionNumber: null,
        eventDate: null,
        isCorrection: false,
      },
    })
    expect(parsed.meta.tournamentName).toBeNull()
  })

  /**
   * classify で実際に踏んだ罠の回帰: zod-to-json-schema (v3 系) だと v4 の
   * スキーマ定義を渡した際に `{ "$schema": "..." }` に近い、ほぼ空の JSON
   * Schema が返り、Anthropic へ制約無しで送られてしまう。`z.toJSONSchema`
   * (zod v4 ネイティブ)が `properties` を正しく持つ JSON Schema を返すことを
   * 固定する。
   */
  it('z.toJSONSchema produces a non-empty properties object (draft-7, io: input)', () => {
    const jsonSchema = z.toJSONSchema(RoutingResultSchema, {
      target: 'draft-7',
      io: 'input',
    }) as Record<string, unknown>

    expect(jsonSchema.properties).toBeDefined()
    const properties = jsonSchema.properties as Record<string, unknown>
    expect(Object.keys(properties).length).toBeGreaterThan(0)
    expect(properties.verdict).toBeDefined()
    expect(properties.classMap).toBeDefined()
    expect(properties.meta).toBeDefined()
    expect(properties.issues).toBeDefined()
  })
})
