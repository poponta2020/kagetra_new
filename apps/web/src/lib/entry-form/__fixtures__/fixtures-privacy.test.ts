import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { loadWorkbook } from '../workbook'

/**
 * fixture は実物の申込書テンプレ由来なので、コミット前に個人情報が落ちている
 * ことを機械的に確かめる。
 *
 * セル値だけを見ていると足りない——xlsx は docProps に作成者名・最終更新者名・
 * 所属組織を持ち、画面には出ないまま実名が残る（実際に一度混入させた）。
 * `build-fixtures.mts` の scrub 漏れをここで落とす。
 */
const FIXTURE_DIR = resolve(process.cwd(), 'src/lib/entry-form/__fixtures__')

/** scrub 済みの値。これ以外の作成者名が入っていたら実物の痕跡が残っている。 */
const ALLOWED_AUTHOR = 'kagetra-fixture'

/**
 * セル値を文字列化する。`cell.text` は値が null のセルで内部的に `toString()` を
 * 呼んで落ちるため使わず、`cell.value` の形（richText / 数式）を自分で畳む。
 */
function cellToText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  const obj = value as { richText?: { text: string }[]; result?: unknown; text?: unknown }
  if (Array.isArray(obj.richText)) return obj.richText.map((t) => t.text).join('')
  if (obj.result != null) return cellToText(obj.result)
  if (obj.text != null) return cellToText(obj.text)
  return ''
}

async function fixtureFiles(): Promise<string[]> {
  const entries = await readdir(FIXTURE_DIR)
  return entries.filter((name) => name.endsWith('.xlsx'))
}

describe('__fixtures__ の xlsx に個人情報が残っていない', () => {
  it('ドキュメントプロパティの作成者・更新者・所属が scrub 済み', async () => {
    const files = await fixtureFiles()
    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      const wb = await loadWorkbook(await readFile(resolve(FIXTURE_DIR, name)))
      expect(wb.creator, name).toBe(ALLOWED_AUTHOR)
      expect(wb.lastModifiedBy, name).toBe(ALLOWED_AUTHOR)
      expect(wb.company ?? '', name).toBe('')
      expect(wb.manager ?? '', name).toBe('')
    }
  })

  it('セル内のメールアドレスは example 系の予約ドメインだけ', async () => {
    const emailPattern = /[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g

    for (const name of await fixtureFiles()) {
      const wb = await loadWorkbook(await readFile(resolve(FIXTURE_DIR, name)))
      const found: string[] = []
      wb.eachSheet((ws) => {
        ws.eachRow({ includeEmpty: false }, (row) => {
          row.eachCell({ includeEmpty: false }, (cell) => {
            found.push(...(cellToText(cell.value).match(emailPattern) ?? []))
          })
        })
      })
      for (const address of found) {
        expect(address, `${name} に実アドレスが残っている: ${address}`).toMatch(
          /@example\.(invalid|com|jp|org|net)$/,
        )
      }
    }
  })
})
