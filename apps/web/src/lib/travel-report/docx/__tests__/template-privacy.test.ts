import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { travelReportTemplateBuffer } from '../template.b64'
import { cells, paragraphs, rows, runTexts, tables } from '../xml'

/**
 * 同梱テンプレは実物の原本 `.dotx` 由来なので、コミット前に個人情報が落ちている
 * ことを機械的に確かめる（requirements R11・§7・AC-29）。
 *
 * ★**この検査自身にも原本の氏名・電話番号を書かない。** 「この名前が無いこと」を
 * 確かめる形にすると、その名前がリポジトリに残って §7 の目的（原本の個人情報を
 * git 履歴に残さない）を検査側が破ってしまう。代わりに
 * 「**値が入る場所が空白しか含まないこと**」を位置で検査する。こちらのほうが検査
 * としても強い（前年度の氏名だけでなく、どんな値が残っていても落ちる）。
 *
 * 本文だけを見ていると足りない——OOXML は docProps に作成者名・最終更新者名を持ち、
 * Word の画面には出ないまま実名が残る（`entry-form/__fixtures__/fixtures-privacy.test.ts`
 * と同じ理由）。
 */

/** 署名欄で値が入る段落と、様式のラベルとして残す先頭 run の数（build-template.mjs と対）。 */
const VALUE_SLOTS = [
  { paragraph: 5, keep: 1, name: '団体代表者 所属' },
  { paragraph: 7, keep: 1, name: '団体代表者 氏名' },
  { paragraph: 9, keep: 3, name: '団体代表者 連絡先' },
  { paragraph: 11, keep: 2, name: '顧問教員 所属部局等' },
  { paragraph: 13, keep: 1, name: '顧問教員 職' },
  { paragraph: 15, keep: 1, name: '顧問教員 氏名' },
]

async function entries(): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(travelReportTemplateBuffer())
  const out = new Map<string, string>()
  for (const name of Object.keys(zip.files)) {
    const file = zip.files[name]
    if (!file || file.dir) continue
    out.set(name, await file.async('string'))
  }
  return out
}

async function signatureParagraphs(): Promise<string[][]> {
  const doc = (await entries()).get('word/document.xml') ?? ''
  const tbls = tables(doc)
  const trs = rows(tbls[0]!.xml)
  const cs = cells(trs[trs.length - 1]!.xml)
  return paragraphs(cs[cs.length - 1]!.xml).map((p) => runTexts(p.xml))
}

describe('同梱テンプレに原本の個人情報が残っていない', () => {
  it('署名欄の値が入る欄はすべて空白だけ（団体代表者3欄・顧問教員3欄）', async () => {
    const ps = await signatureParagraphs()
    for (const slot of VALUE_SLOTS) {
      const runs = ps[slot.paragraph]
      expect(runs, `${slot.name} の段落が無い`).toBeDefined()
      // 値の run が存在すること自体は確かめる（段落構造が変わっていない印）。
      expect(runs!.length, slot.name).toBeGreaterThan(slot.keep)
      const value = runs!.slice(slot.keep).join('')
      expect(value.trim(), `${slot.name} に値が残っている`).toBe('')
    }
  })

  it('文書のどこにも電話番号らしき数字列が無い', async () => {
    const doc = (await entries()).get('word/document.xml') ?? ''
    const text = tables(doc)
      .flatMap((t) => rows(t.xml))
      .flatMap((r) => cells(r.xml))
      .flatMap((c) => paragraphs(c.xml))
      .flatMap((p) => runTexts(p.xml))
      .join('\n')
    expect(text).not.toMatch(/\d{2,4}-\d{2,4}-\d{3,4}/)
    expect(text).not.toMatch(/0\d{9,10}/)
  })

  it('docProps の作成者・最終更新者が空', async () => {
    const core = (await entries()).get('docProps/core.xml') ?? ''
    expect(core).toContain('<dc:creator></dc:creator>')
    expect(core).toContain('<cp:lastModifiedBy></cp:lastModifiedBy>')
  })

  it('様式の構造（表2枚・ヘッダ12行・名簿41行）と固定文言は原本のまま', async () => {
    const files = await entries()
    // 読めていない（空 zip）のを green と誤認しないための下限。
    expect(files.size).toBeGreaterThan(10)
    const doc = files.get('word/document.xml') ?? ''
    const tbls = tables(doc)
    expect(tbls).toHaveLength(2)
    expect(rows(tbls[0]!.xml)).toHaveLength(12)
    // 名簿は見出し1行 + 40人分。41人以上は fill.ts が行をクローンして足す。
    expect(rows(tbls[1]!.xml)).toHaveLength(41)
    // 個人情報ではない固定文言は消さない（消すと様式が変わる）。
    expect(doc).toContain('北海道大学かるた会')
    expect(doc).toContain('副　学　長　　殿')
    expect(doc).toContain('遠　征　届 ・ 合　宿　届')
    // 様式のラベルも残っている（空欄化が行き過ぎていない印）。
    expect(doc).toContain('団体代表者')
    expect(doc).toContain('顧問教員')
  })
})
