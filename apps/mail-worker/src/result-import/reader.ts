import ExcelJS from 'exceljs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

const execFileAsync = promisify(execFile)

export type CellValue = string | null
export type CellGrid = CellValue[][]
export interface SheetData {
  name: string
  grid: CellGrid
}

function cellToString(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)
  }
  if (typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  // RichText
  if (typeof v === 'object' && 'richText' in v && Array.isArray((v as ExcelJS.CellRichTextValue).richText)) {
    return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('').trim() || null
  }
  // Shared string / formula result
  if (typeof v === 'object' && 'result' in v) {
    return cellToString((v as ExcelJS.CellFormulaValue).result ?? null)
  }
  if (typeof v === 'object' && 'text' in v) {
    return cellToString((v as { text: ExcelJS.CellValue }).text)
  }
  return null
}

// ExcelJS's type for xlsx.load() expects the old Buffer type (non-generic).
// Node.js 22 + newer @types/node defines Buffer<ArrayBufferLike>, causing an
// incompatibility. Cast via unknown to bypass — the runtime accepts any Buffer.
type ExcelJsBuffer = Parameters<ExcelJS.Xlsx['load']>[0]

async function readXlsxBuffer(buf: Buffer): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ExcelJsBuffer)

  const sheets: SheetData[] = []
  wb.worksheets.forEach((ws) => {
    const grid: CellGrid = []
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      const rIdx = rowNum - 1
      while (grid.length <= rIdx) grid.push([])
      const cells: CellValue[] = []
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const cIdx = colNum - 1
        while (cells.length <= cIdx) cells.push(null)
        cells[cIdx] = cellToString(cell.value)
      })
      grid[rIdx] = cells
    })
    sheets.push({ name: ws.name, grid })
  })
  return sheets
}

/**
 * Convert .xls → .xlsx via libreoffice then read.
 * libreoffice must be on PATH (production host has it for mail-body-as-image).
 */
async function readXlsBuffer(buf: Buffer): Promise<SheetData[]> {
  const id = randomBytes(8).toString('hex')
  const tmpIn = join(tmpdir(), `kagetra_xls_${id}.xls`)
  const tmpOut = join(tmpdir(), `kagetra_xls_${id}.xlsx`)
  try {
    await writeFile(tmpIn, buf)
    await execFileAsync('libreoffice', [
      '--headless',
      '--convert-to',
      'xlsx',
      '--outdir',
      tmpdir(),
      tmpIn,
    ])
    const outBuf = await readFile(tmpOut)
    return readXlsxBuffer(outBuf)
  } finally {
    await unlink(tmpIn).catch(() => undefined)
    await unlink(tmpOut).catch(() => undefined)
  }
}

/**
 * Read an Excel file (buffer) and return per-sheet cell grids.
 * filename is used only to decide the format (.xls vs .xlsx).
 */
export async function readExcel(buf: Buffer, filename: string): Promise<SheetData[]> {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.xlsx')) return readXlsxBuffer(buf)
  if (lower.endsWith('.xls')) return readXlsBuffer(buf)
  throw new Error(`Unsupported Excel extension: ${filename}`)
}
