import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { detectExcelFormat, readExcel } from '../../src/result-import/reader.js'

async function buildWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const a = workbook.addWorksheet('A級')
  a.addRow(['氏名', '当落'])
  a.addRow(['札幌太郎', '当選'])
  const b = workbook.addWorksheet('B級')
  b.addRow(['氏名'])
  b.addRow(['函館花子'])
  const bytes = await workbook.xlsx.writeBuffer()
  return Buffer.from(bytes as unknown as Uint8Array)
}

describe('result-import Excel reader', () => {
  it.each(['roster.xlsx', 'roster.xlsm'])('reads every OOXML sheet from %s', async (filename) => {
    const sheets = await readExcel(await buildWorkbook(), filename)
    expect(sheets.map((sheet) => sheet.name)).toEqual(['A級', 'B級'])
    expect(sheets[0]?.grid[1]?.[0]).toBe('札幌太郎')
    expect(sheets[1]?.grid[1]?.[0]).toBe('函館花子')
  })

  it('routes legacy .xls separately and rejects non-Excel extensions', () => {
    expect(detectExcelFormat('ROSTER.XLS')).toBe('xls')
    expect(detectExcelFormat('roster.xlsx')).toBe('ooxml')
    expect(detectExcelFormat('roster.xlsm')).toBe('ooxml')
    expect(() => detectExcelFormat('roster.csv')).toThrow(/Unsupported Excel extension/)
  })
})
