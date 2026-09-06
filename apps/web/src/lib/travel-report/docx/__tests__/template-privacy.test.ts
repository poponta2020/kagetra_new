import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { travelReportTemplateBuffer } from '../template.b64'

/**
 * 同梱テンプレは実物の原本 `.dotx` 由来なので、コミット前に個人情報が落ちている
 * ことを機械的に確かめる（requirements R11・§7・AC-29）。
 *
 * 本文（word/document.xml）だけを見ていると足りない——OOXML は docProps に
 * 作成者名・最終更新者名を持ち、Word の画面には出ないまま実名が残る
 * （`entry-form/__fixtures__/fixtures-privacy.test.ts` と同じ理由）。
 * ここでは**全エントリを走査**して、原本に入っていた文字列が1つも残らないことを見る。
 */

/** 原本に入っていた値。1つでも残っていたら scrub 漏れ。 */
const FORBIDDEN = [
  '田中佑樹', // 団体代表者 氏名
  '080-3838-4133', // 団体代表者 連絡先
  '百合野', // 顧問教員 氏名
  '大雅',
  '応用科学部門', // 顧問教員 所属部局等
  '助教', // 顧問教員 職
  '深井', // docProps 最終更新者
  'daifu', // docProps 作成者
]

async function entries(): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(travelReportTemplateBuffer())
  const out = new Map<string, string>()
  for (const name of Object.keys(zip.files)) {
    const file = zip.files[name]
    if (file.dir) continue
    out.set(name, await file.async('string'))
  }
  return out
}

describe('同梱テンプレに原本の個人情報が残っていない', () => {
  it('全エントリを走査して禁止文字列が 1 件も無い', async () => {
    const files = await entries()
    // 読めていない（空 zip）のを green と誤認しないための下限。
    expect(files.size).toBeGreaterThan(10)
    expect(files.has('word/document.xml')).toBe(true)
    expect(files.has('docProps/core.xml')).toBe(true)

    const hits: string[] = []
    for (const [name, xml] of files) {
      for (const needle of FORBIDDEN) {
        if (xml.includes(needle)) hits.push(`${name}: ${needle}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('docProps の作成者・最終更新者が空', async () => {
    const core = (await entries()).get('docProps/core.xml') ?? ''
    expect(core).toContain('<dc:creator></dc:creator>')
    expect(core).toContain('<cp:lastModifiedBy></cp:lastModifiedBy>')
  })

  it('様式の構造（表2枚・ヘッダ12行・名簿41行）と固定文言は原本のまま', async () => {
    const doc = (await entries()).get('word/document.xml') ?? ''
    const tables = doc.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []
    expect(tables).toHaveLength(2)
    expect(tables[0].match(/<w:tr[ >]/g) ?? []).toHaveLength(12)
    // 名簿は見出し1行 + 40人分。41人以上は fill.ts が行をクローンして足す。
    expect(tables[1].match(/<w:tr[ >]/g) ?? []).toHaveLength(41)
    // 個人情報ではない固定文言は消さない（消すと様式が変わる）。
    expect(doc).toContain('北海道大学かるた会')
    expect(doc).toContain('副　学　長　　殿')
    expect(doc).toContain('遠　征　届 ・ 合　宿　届')
  })
})
