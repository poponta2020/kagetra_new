import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { fillTravelReportDocx, TravelReportTemplateDriftError, type TravelReportDocData } from './fill'
import { readTravelReportDocx } from './read'
import { travelReportTemplateBuffer } from './template.b64'

const base: TravelReportDocData = {
  purpose: '第3回 全国競技かるた青森大会(AB級)への参加',
  place: '青森県武道館',
  destinationContacts: [{ name: '北海太郎', phone: '090-0000-0001' }],
  homeContact: { name: '旭川さくら', phone: '090-0000-0002' },
  period: { from: '2026-06-12', to: '2026-06-15', days: 4 },
  memberCount: 3,
  remarks: ['6/12 [北海、藤野、室蘭]札幌→青森', '6/13 [北海、藤野、室蘭]大会出場'],
  reportDate: '2026-06-01',
  approvalDate: null,
  representative: { affiliation: '法学部 2年', name: '旭川さくら', phone: '090-0000-0002' },
  advisor: { department: '北海道大学大学院工学研究院', title: '教授', name: '山田花子' },
  roster: [
    { name: '北海太郎', faculty: '法学部', schoolYear: '4年', phone: '090-0000-0001' },
    { name: '藤野美咲', faculty: '工学部', schoolYear: '3年', phone: '090-0000-0003' },
    { name: '室蘭凛', faculty: '医学部', schoolYear: '2年', phone: '090-0000-0009' },
  ],
}

const fill = (over: Partial<TravelReportDocData> = {}) =>
  fillTravelReportDocx(travelReportTemplateBuffer(), { ...base, ...over })

describe('遠征届 docx の生成（AC-22）', () => {
  it('目的・場所・連絡先・期間・人数・備考が指定の欄に入る', async () => {
    const view = await readTravelReportDocx(await fill())
    expect(view.headerCells[3][1]).toBe(base.purpose)
    expect(view.headerCells[4][1]).toBe(base.place)
    // 遠征先連絡者は氏名と TEL を並べる。
    expect(view.headerCells[5][2]).toBe('北海太郎\n090-0000-0001')
    expect(view.headerCells[6][2]).toBe('旭川さくら')
    expect(view.headerCells[7][2]).toBe('090-0000-0002')
    expect(view.headerCells[9][1]).toContain('3人')
    expect(view.headerCells[10][1]).toBe(base.remarks.join('\n'))
  })

  it('期間は令和表記で自至と日数が入る（AC-24）', async () => {
    const view = await readTravelReportDocx(await fill())
    const period = view.headerCells[8][1].split('\n')
    // 2026 → 令和8年。
    expect(period[0]).toBe('自　　令和　　　　8年　　6月　　12日')
    expect(period[1]).toContain('（　　　　　4日間）')
    expect(period[2]).toBe('至　　令和　　　　8年　　6月　　15日')
  })

  it('期間が無ければテンプレの空欄のまま（作成は成功する。R13）', async () => {
    const view = await readTravelReportDocx(await fill({ period: null }))
    expect(view.headerCells[8][1]).toContain('令和')
    expect(view.headerCells[8][1]).not.toContain('8年')
  })

  it('名簿に氏名・学部等名・学年・電話が並ぶ（役職は空欄）', async () => {
    const view = await readTravelReportDocx(await fill())
    expect(view.rosterRows).toHaveLength(40)
    expect(view.rosterRows[0]).toEqual(['', '北海太郎', '法学部', '4年', '090-0000-0001'])
    expect(view.rosterRows[2]).toEqual(['', '室蘭凛', '医学部', '2年', '090-0000-0009'])
    // 余った行は空のまま残る（テンプレの罫線を保つ）。
    expect(view.rosterRows[3]).toEqual(['', '', '', '', ''])
  })

  it('41人以上でも全員載る（行を足す。別紙は作らない）', async () => {
    const roster = Array.from({ length: 45 }, (_, i) => ({
      name: `会員${i + 1}`,
      faculty: '法学部',
      schoolYear: '1年',
      phone: `090-0000-${String(i).padStart(4, '0')}`,
    }))
    const view = await readTravelReportDocx(await fill({ roster, memberCount: 45 }))
    expect(view.rosterRows).toHaveLength(45)
    expect(view.rosterRows[44][1]).toBe('会員45')
    expect(view.rosterRows[40][1]).toBe('会員41')
  })

  it('団体代表者3欄・顧問教員3欄・届の日付が署名欄に入る（AC-26）', async () => {
    const view = await readTravelReportDocx(await fill())
    const joined = view.signatureParagraphs.join('\n')
    expect(view.signatureParagraphs[1]).toBe('　令和　　　　8年　　6月　　1日')
    expect(joined).toContain('法学部 2年')
    expect(joined).toContain('旭川さくら')
    expect(joined).toContain('090-0000-0002')
    expect(joined).toContain('北海道大学大学院工学研究院')
    expect(joined).toContain('教授')
    expect(joined).toContain('山田花子')
    // 固定文言は残る。
    expect(joined).toContain('北海道大学かるた会')
    expect(joined).toContain('副　学　長　　殿')
  })

  it('サークル長・顧問教員が未設定でも作成でき、欄が空になる（R13・AC-26）', async () => {
    const view = await readTravelReportDocx(
      await fill({
        representative: { affiliation: '', name: '', phone: '' },
        advisor: { department: '', title: '', name: '' },
        homeContact: null,
      }),
    )
    const joined = view.signatureParagraphs.join('\n')
    expect(joined).toContain('北海道大学かるた会')
    expect(joined).not.toContain('法学部')
    expect(view.headerCells[6][2]).toBe('')
    expect(view.headerCells[7][2]).toBe('')
  })

  it('承認日を入れると「（M月D日メールにて承認済）」になる', async () => {
    const view = await readTravelReportDocx(await fill({ approvalDate: '2026-06-05' }))
    expect(view.signatureParagraphs.join('\n')).toContain('（　6月　5日メールにて承認済）')
  })

  it('本体パートの content type が document になる（.dotx → .docx）', async () => {
    const view = await readTravelReportDocx(await fill())
    expect(view.mainContentType).toBe('document')
  })

  it('同着の遠征先連絡者が2人でも両方載る（AC-25）', async () => {
    const view = await readTravelReportDocx(
      await fill({
        destinationContacts: [
          { name: '北海太郎', phone: '090-0000-0001' },
          { name: '藤野美咲', phone: null },
        ],
      }),
    )
    expect(view.headerCells[5][2]).toBe('北海太郎\n090-0000-0001\n藤野美咲')
  })

  it('XML 特殊文字を含む値でも壊れない', async () => {
    const view = await readTravelReportDocx(await fill({ place: 'A&B <会場>' }))
    expect(view.headerCells[4][1]).toBe('A&B <会場>')
  })

  it('テンプレを毎回読み直すので、続けて作っても互いに影響しない', async () => {
    const a = await readTravelReportDocx(await fill({ purpose: '1回目' }))
    const b = await readTravelReportDocx(await fill({ purpose: '2回目' }))
    expect(a.headerCells[3][1]).toBe('1回目')
    expect(b.headerCells[3][1]).toBe('2回目')
  })
})

describe('テンプレの構造 drift ガード', () => {
  it('表が1枚しか無いテンプレは throw する', async () => {
    const zip = await JSZip.loadAsync(travelReportTemplateBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    // 表2（名簿）を丸ごと落とす。
    const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []
    zip.file('word/document.xml', xml.replace(tables[1], ''))
    const broken = await zip.generateAsync({ type: 'nodebuffer' })
    await expect(fillTravelReportDocx(broken, base)).rejects.toBeInstanceOf(
      TravelReportTemplateDriftError,
    )
  })

  it('表1の行数が変わったら throw する', async () => {
    const zip = await JSZip.loadAsync(travelReportTemplateBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []
    const trs = tables[0].match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []
    // 行を1つ増やす。
    zip.file('word/document.xml', xml.replace(tables[0], tables[0].replace(trs[1], trs[1] + trs[1])))
    const broken = await zip.generateAsync({ type: 'nodebuffer' })
    await expect(fillTravelReportDocx(broken, base)).rejects.toThrow('表1の行数が12でない')
  })
})
