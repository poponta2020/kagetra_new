import JSZip from 'jszip'
import { cells, paragraphs, rows, tables, textOf } from './xml'

/**
 * travel-report: 生成した docx を**読み戻す**ためのヘルパー。
 *
 * テストが「書いたものが本当にその欄へ入ったか」を確かめるために使う（AC-22）。
 * 本番の画面からは使わない——生成物の正は `travel_report_documents.docx` のバイト列で、
 * 説明に必要な値は `header`（jsonb）へスナップショットしてある。
 */

export interface TravelReportDocView {
  /** 表1のセルごとのテキスト（段落は `\n` 区切り）。`[行][セル]` で引く。 */
  headerCells: string[][]
  /** 表2（名簿）のデータ行。`[行][セル]`。見出し行は含まない。 */
  rosterRows: string[][]
  /** 署名欄（表1 の最終行の最後のセル）の段落テキスト。 */
  signatureParagraphs: string[]
  /** 本体パートの content type。 */
  mainContentType: 'document' | 'template' | 'unknown'
}

/**
 * XML の実体参照を戻す。`textOf` は生の XML テキストを返すので、書き込んだ値と
 * 突き合わせるにはここで戻す必要がある（`&` を含む会場名など）。
 */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const cellText = (xml: string) =>
  paragraphs(xml)
    .map((p) => unescapeXml(textOf(p.xml)))
    .join('\n')

export async function readTravelReportDocx(buf: Buffer): Promise<TravelReportDocView> {
  const zip = await JSZip.loadAsync(buf)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('word/document.xml が無い')
  const xml = await docFile.async('string')
  const tbls = tables(xml)
  if (tbls.length < 2) throw new Error(`表が2枚無い（${tbls.length}）`)

  const headerCells = rows(tbls[0].xml).map((r) => cells(r.xml).map((c) => cellText(c.xml)))
  const rosterRows = rows(tbls[1].xml)
    .slice(1)
    .map((r) => cells(r.xml).map((c) => cellText(c.xml)))

  const signatureRow = rows(tbls[0].xml).at(-1)
  const signatureCells = signatureRow ? cells(signatureRow.xml) : []
  const signatureCell = signatureCells.at(-1)
  const signatureParagraphs = signatureCell
    ? paragraphs(signatureCell.xml).map((p) => unescapeXml(textOf(p.xml)))
    : []

  const ct = (await zip.file('[Content_Types].xml')?.async('string')) ?? ''
  const mainContentType = ct.includes('wordprocessingml.document.main+xml')
    ? 'document'
    : ct.includes('wordprocessingml.template.main+xml')
      ? 'template'
      : 'unknown'

  return { headerCells, rosterRows, signatureParagraphs, mainContentType }
}
