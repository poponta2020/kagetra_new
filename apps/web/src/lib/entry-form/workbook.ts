import 'server-only'
import ExcelJS from 'exceljs'

/**
 * ExcelJS の `xlsx.load()` / `writeBuffer()` は非ジェネリックな旧 `Buffer` 型で
 * 宣言されている。Node.js 22 + 新しい @types/node の `Buffer<ArrayBufferLike>` と
 * 型が噛み合わないため、境界を1箇所に閉じ込めてキャストする
 * （`apps/mail-worker/src/result-import/reader.ts` と同じ回避）。
 */
type ExcelJsBuffer = Parameters<ExcelJS.Xlsx['load']>[0]

/** xlsx のバイト列から Workbook を読む。 */
export async function loadWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as unknown as ExcelJsBuffer)
  return workbook
}

/** Workbook を xlsx のバイト列へ書き出す。 */
export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
