import { describe, expect, it } from 'vitest'
import { applyClassMap } from '../../src/result-import/ai/apply.js'
import type { ClassMapEntry } from '../../src/result-import/ai/routing-schema.js'
import type { ParsedResultPayload } from '../../src/result-import/schema.js'

function makePayload(): ParsedResultPayload {
  return {
    parserVersion: 'v1',
    classes: [
      {
        className: 'D1',
        grade: null,
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
            matches: [],
          },
        ],
      },
      {
        className: '選手一覧',
        grade: null,
        sheetName: '選手一覧',
        participants: [],
      },
      {
        className: 'B級',
        grade: 'B',
        sheetName: '対戦結果表_B級',
        participants: [],
      },
    ],
  }
}

describe('applyClassMap', () => {
  it('normalizes className/grade and preserves rawClassName for matched entries', () => {
    const payload = makePayload()
    const classMap: ClassMapEntry[] = [
      {
        className: 'D1',
        normalizedClassName: 'D級',
        grade: 'D',
        exclude: false,
        note: null,
      },
    ]

    const result = applyClassMap(payload, classMap)
    const d = result.classes.find((c) => c.rawClassName === 'D1')
    expect(d).toBeDefined()
    expect(d?.className).toBe('D級')
    expect(d?.grade).toBe('D')
    expect(d?.rawClassName).toBe('D1')
  })

  it('excludes classes flagged exclude: true', () => {
    const payload = makePayload()
    const classMap: ClassMapEntry[] = [
      {
        className: '選手一覧',
        normalizedClassName: '選手一覧',
        grade: null,
        exclude: true,
        note: '対戦結果を含まない一覧シート',
      },
    ]

    const result = applyClassMap(payload, classMap)
    expect(result.classes.find((c) => c.className === '選手一覧')).toBeUndefined()
    expect(result.classes).toHaveLength(2)
  })

  it('leaves classes not present in classMap unchanged (no rawClassName attached)', () => {
    const payload = makePayload()
    const classMap: ClassMapEntry[] = [
      {
        className: 'D1',
        normalizedClassName: 'D級',
        grade: 'D',
        exclude: false,
        note: null,
      },
    ]

    const result = applyClassMap(payload, classMap)
    const untouched = result.classes.find((c) => c.className === 'B級')
    expect(untouched).toBeDefined()
    expect(untouched?.rawClassName).toBeUndefined()
    expect(untouched?.grade).toBe('B')
  })

  it('does not mutate the input payload', () => {
    const payload = makePayload()
    const snapshot = JSON.parse(JSON.stringify(payload))
    const classMap: ClassMapEntry[] = [
      {
        className: 'D1',
        normalizedClassName: 'D級',
        grade: 'D',
        exclude: false,
        note: null,
      },
      {
        className: '選手一覧',
        normalizedClassName: '選手一覧',
        grade: null,
        exclude: true,
        note: null,
      },
    ]

    applyClassMap(payload, classMap)
    expect(payload).toEqual(snapshot)
  })
})
