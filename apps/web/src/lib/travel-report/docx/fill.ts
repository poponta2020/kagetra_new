import JSZip from 'jszip'
import { toEraDate } from '../render'
import {
  cells,
  paragraphs,
  replaceRunTexts,
  rewriteCell,
  rows,
  spliceAll,
  tables,
  textOf,
} from './xml'

/**
 * travel-report: 同梱テンプレ（クリーン版 .dotx）へ値を書き込んで **.docx** を作る
 * （requirements R10・AC-22）。
 *
 * 方針は「**構造に触れず中身だけ差し替える**」。見出し・罫線・フォントは原本のまま
 * でなければならない（大学へ提出する様式）ので、DOM で組み直さず文字列レベルで
 * セルの中身を書き換える。テンプレの形が変わったら黙って壊れた docx を作らないよう、
 * 書き込みの前に**構造を検査して不一致なら throw** する（drift ガード）。
 *
 * 想定するテンプレの形（`遠征届原本2025.dotx` 由来）:
 * - 表は2枚。表1＝届の本体（12 行）、表2＝名簿（見出し1行 + 40 行）
 * - 表1: r3 目的 / r4 場所 / r5 遠征先連絡者 / r6 留守連絡先 氏名 / r7 留守連絡先 TEL /
 *   r8 期間 / r9 人数 / r10 備考 / r11 署名欄（1セルに令和日付・団体名・団体代表者・顧問教員）
 * - 表2 のデータ行はセル5つ（役職・氏名・学部等名・学年・連絡先）
 */

export interface TravelReportContact {
  name: string
  phone: string | null
}

export interface TravelReportRosterRow {
  name: string
  faculty: string
  schoolYear: string
  phone: string
}

export interface TravelReportDocData {
  /** 目的（例「第3回 全国競技かるた青森大会(AB級)への参加」）。 */
  purpose: string
  /** 場所（会場名。複数なら「・」で連結済み）。 */
  place: string
  /** 遠征先 連絡者（同着で複数になることがある）。 */
  destinationContacts: readonly TravelReportContact[]
  /** 留守連絡先。未設定なら `null`（欄は空欄）。 */
  homeContact: TravelReportContact | null
  /** 期間。行が1つも無ければ `null`（欄は空欄）。 */
  period: { from: string; to: string; days: number } | null
  memberCount: number
  /** 備考の行（1日1行）。 */
  remarks: readonly string[]
  /** 届の日付（`YYYY-MM-DD`）。 */
  reportDate: string
  /** 承認日（`YYYY-MM-DD`）。未入力なら `null`（テンプレの空欄のまま）。 */
  approvalDate: string | null
  /** 団体代表者＝サークル長。未設定なら各欄が空文字。 */
  representative: { affiliation: string; name: string; phone: string }
  /** 顧問教員（遠征届設定の3値）。未設定なら空文字。 */
  advisor: { department: string; title: string; name: string }
  /** 名簿（学年降順→かな順に並べ替え済み）。 */
  roster: readonly TravelReportRosterRow[]
}

/** テンプレの構造が想定と違うときに投げる。 */
export class TravelReportTemplateDriftError extends Error {
  constructor(message: string) {
    super(`遠征届テンプレの構造が想定と違います: ${message}`)
    this.name = 'TravelReportTemplateDriftError'
  }
}

/** 表1の行番号（0 起点）。 */
const HEADER_ROW = {
  purpose: 3,
  place: 4,
  destinationContact: 5,
  homeContactName: 6,
  homeContactPhone: 7,
  period: 8,
  memberCount: 9,
  remarks: 10,
  signature: 11,
} as const

/** 署名欄セルの段落番号（0 起点）。 */
const SIGNATURE_PARAGRAPH = {
  reportDate: 1,
  representativeAffiliation: 5,
  representativeName: 7,
  representativePhone: 9,
  advisorDepartment: 11,
  advisorTitle: 13,
  advisorName: 15,
  approval: 16,
} as const

const HEADER_ROWS = 12
const ROSTER_ROWS = 41
const ROSTER_DATA_ROWS = ROSTER_ROWS - 1
const ROSTER_CELLS = 5

/** 空欄を作るときの全角スペース。下線の幅を保つために使う。 */
const padTo = (value: string, width: number) =>
  value.length >= width ? value : value + '　'.repeat(width - value.length)

/** 令和の「N年　　M月　　D日」（テンプレの表記に合わせる）。 */
function eraSuffix(isoDate: string): string {
  const d = toEraDate(isoDate)
  return `年　　${d.month}月　　${d.day}日`
}

function eraYear(isoDate: string): string {
  return String(toEraDate(isoDate).reiwa)
}

/** 表1 r8（期間）の3段落。 */
function periodLines(period: TravelReportDocData['period'], template: readonly string[]): string[] {
  if (!period) return [...template]
  const middle = (template[1] ?? '').replace(/（[\s\S]*?日間）/, `（　　　　　${period.days}日間）`)
  return [
    `自　　令和　　　　${eraYear(period.from)}${eraSuffix(period.from)}`,
    middle,
    `至　　令和　　　　${eraYear(period.to)}${eraSuffix(period.to)}`,
  ]
}

/** 遠征先連絡者のセル（氏名と TEL を交互に並べる）。 */
function destinationContactLines(contacts: readonly TravelReportContact[]): string[] {
  const lines: string[] = []
  for (const c of contacts) {
    lines.push(c.name)
    if (c.phone) lines.push(c.phone)
  }
  return lines
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TravelReportTemplateDriftError(message)
}

/** 添字アクセスの結果が無ければ drift として止める（`noUncheckedIndexedAccess` 対策）。 */
function must<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new TravelReportTemplateDriftError(message)
  return value
}

/**
 * テンプレへ値を書き込んだ .docx のバイト列を返す。
 * テンプレ自体は変更しない（毎回 zip を読み直す）。
 */
export async function fillTravelReportDocx(
  template: Buffer,
  data: TravelReportDocData,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(template)
  const docFile = zip.file('word/document.xml')
  assert(docFile !== null, 'word/document.xml が無い')
  let xml = await docFile.async('string')

  // ---- drift ガード（構造の検査） -----------------------------------------
  const tbls = tables(xml)
  assert(tbls.length === 2, `表が2枚でない（${tbls.length}枚）`)
  const headerTable = must(tbls[0], '表1が無い')
  const rosterTable = must(tbls[1], '表2が無い')
  const headerRows = rows(headerTable.xml)
  assert(headerRows.length === HEADER_ROWS, `表1の行数が${HEADER_ROWS}でない（${headerRows.length}）`)
  const rosterRows = rows(rosterTable.xml)
  assert(rosterRows.length === ROSTER_ROWS, `表2の行数が${ROSTER_ROWS}でない（${rosterRows.length}）`)
  const headerRow = (i: number) => must(headerRows[i], `表1 r${i} が無い`)
  // 見出しラベルが期待どおりの行に居るか（行が入れ替わっていないか）。
  const labelOf = (rowIndex: number) => textOf(cells(headerRow(rowIndex).xml)[0]?.xml ?? '')
  assert(labelOf(HEADER_ROW.purpose).includes('目'), '表1 r3 が「目的」でない')
  assert(labelOf(HEADER_ROW.place).includes('場'), '表1 r4 が「場所」でない')
  assert(labelOf(HEADER_ROW.destinationContact).includes('連絡先'), '表1 r5 が「連絡先」でない')
  assert(labelOf(HEADER_ROW.period).includes('期'), '表1 r8 が「期間」でない')
  assert(labelOf(HEADER_ROW.memberCount).includes('人'), '表1 r9 が「人数」でない')
  assert(labelOf(HEADER_ROW.remarks).includes('備'), '表1 r10 が「備考」でない')
  const rosterTemplateRow = must(rosterRows[1], '名簿にデータ行が無い')
  const rosterDataCells = cells(rosterTemplateRow.xml)
  assert(
    rosterDataCells.length === ROSTER_CELLS,
    `名簿のデータ行のセル数が${ROSTER_CELLS}でない（${rosterDataCells.length}）`,
  )

  // ---- 表1: セル単位の書き換え ---------------------------------------------
  const periodCell = cells(headerRow(HEADER_ROW.period).xml)[1]
  assert(periodCell !== undefined, '表1 r8 に値セルが無い')
  const periodTemplate = paragraphs(periodCell.xml).map((p) => textOf(p.xml))
  assert(periodTemplate.length === 3, `表1 r8 の段落数が3でない（${periodTemplate.length}）`)

  const memberCountCell = cells(headerRow(HEADER_ROW.memberCount).xml)[1]
  assert(memberCountCell !== undefined, '表1 r9 に値セルが無い')
  const memberCountParagraphs = paragraphs(memberCountCell.xml).length
  assert(memberCountParagraphs === 3, `表1 r9 の段落数が3でない（${memberCountParagraphs}）`)

  /** (行, セル) → 書き込む行たち。 */
  const cellEdits: { row: number; cell: number; lines: string[] }[] = [
    { row: HEADER_ROW.purpose, cell: 1, lines: [data.purpose] },
    { row: HEADER_ROW.place, cell: 1, lines: [data.place] },
    {
      row: HEADER_ROW.destinationContact,
      cell: 2,
      lines: destinationContactLines(data.destinationContacts),
    },
    { row: HEADER_ROW.homeContactName, cell: 2, lines: [data.homeContact?.name ?? ''] },
    { row: HEADER_ROW.homeContactPhone, cell: 2, lines: [data.homeContact?.phone ?? ''] },
    { row: HEADER_ROW.period, cell: 1, lines: periodLines(data.period, periodTemplate) },
    { row: HEADER_ROW.memberCount, cell: 1, lines: ['', `${data.memberCount}人`, ''] },
    { row: HEADER_ROW.remarks, cell: 1, lines: [...data.remarks] },
  ]

  let headerXml = headerTable.xml
  const rowEdits = new Map<number, { start: number; end: number; xml: string }>()
  for (const edit of cellEdits) {
    const rowBlock = headerRow(edit.row)
    const current = rowEdits.get(edit.row)?.xml ?? rowBlock.xml
    const cs = cells(current)
    const target = cs[edit.cell]
    assert(target !== undefined, `表1 r${edit.row} に c${edit.cell} が無い`)
    const nextRow =
      current.slice(0, target.start) + rewriteCell(target.xml, edit.lines) + current.slice(target.end)
    rowEdits.set(edit.row, { start: rowBlock.start, end: rowBlock.end, xml: nextRow })
  }

  // ---- 表1 r11: 署名欄は run 単位で差し替える（下線・レイアウトを保つ） --------
  const signatureRow = headerRow(HEADER_ROW.signature)
  const signatureCells = cells(signatureRow.xml)
  const signatureCell = signatureCells[signatureCells.length - 1]
  assert(signatureCell !== undefined, '表1 r11 に署名欄セルが無い')
  const sigParagraphs = paragraphs(signatureCell.xml)
  assert(
    sigParagraphs.length > SIGNATURE_PARAGRAPH.approval,
    `署名欄の段落数が足りない（${sigParagraphs.length}）`,
  )

  /** 段落 → { run 番号: 値 }。空欄の幅は元の run の長さに合わせる。 */
  const paragraphEdits = new Map<number, Record<number, string>>()
  const setRuns = (paragraphIndex: number, values: Record<number, string>) => {
    paragraphEdits.set(paragraphIndex, { ...(paragraphEdits.get(paragraphIndex) ?? {}), ...values })
  }

  // 届の日付（令和）。
  setRuns(SIGNATURE_PARAGRAPH.reportDate, {
    1: eraYear(data.reportDate),
    2: eraSuffix(data.reportDate),
  })
  // 団体代表者 所属・氏名・連絡先。値を先頭の run へ入れ、続く run は空にする
  // （元の幅ぶんの全角スペースで埋めて下線の長さを保つ）。
  writeSpannedValue(setRuns, sigParagraphs, SIGNATURE_PARAGRAPH.representativeAffiliation, 2, 5, data.representative.affiliation)
  writeSpannedValue(setRuns, sigParagraphs, SIGNATURE_PARAGRAPH.representativeName, 1, 3, data.representative.name)
  writeSpannedValue(setRuns, sigParagraphs, SIGNATURE_PARAGRAPH.representativePhone, 3, 4, data.representative.phone)
  writeSpannedValue(setRuns, sigParagraphs, SIGNATURE_PARAGRAPH.advisorDepartment, 2, 2, data.advisor.department, 7)
  writeSpannedValue(setRuns, sigParagraphs, SIGNATURE_PARAGRAPH.advisorTitle, 1, 1, data.advisor.title, 9)
  writeSpannedValue(setRuns, sigParagraphs, SIGNATURE_PARAGRAPH.advisorName, 1, 1, data.advisor.name, 8)
  if (data.approvalDate) {
    const d = toEraDate(data.approvalDate)
    const approvalParagraph = must(
      sigParagraphs[SIGNATURE_PARAGRAPH.approval],
      '署名欄に承認日の段落が無い',
    )
    const runs = paragraphRuns(approvalParagraph.xml)
    const idx = runs.findIndex((t) => t.includes('メールにて承認済'))
    const run = runs[idx]
    if (idx !== -1 && run !== undefined) {
      setRuns(SIGNATURE_PARAGRAPH.approval, {
        [idx]: run.replace('（　　月　　日', `（　${d.month}月　${d.day}日`),
      })
    }
  }

  let signatureCellXml = signatureCell.xml
  const sigEdits = [...paragraphEdits.entries()]
    .map(([paragraphIndex, values]) => {
      const p = must(sigParagraphs[paragraphIndex], `署名欄 p${paragraphIndex} が無い`)
      return { start: p.start, end: p.end, xml: replaceRunTexts(p.xml, values) }
    })
  signatureCellXml = spliceAll(signatureCellXml, sigEdits)
  const nextSignatureRow =
    signatureRow.xml.slice(0, signatureCell.start) +
    signatureCellXml +
    signatureRow.xml.slice(signatureCell.end)
  rowEdits.set(HEADER_ROW.signature, {
    start: signatureRow.start,
    end: signatureRow.end,
    xml: nextSignatureRow,
  })

  headerXml = spliceAll(headerXml, [...rowEdits.values()])

  // ---- 表2: 名簿 ------------------------------------------------------------
  const templateDataRow = rosterTemplateRow.xml
  const filledRows: string[] = []
  const rowCount = Math.max(data.roster.length, ROSTER_DATA_ROWS)
  for (let i = 0; i < rowCount; i++) {
    // 41 人目以降はテンプレのデータ行をクローンして足す（別紙は作らない。R10）。
    const base = rosterRows[i + 1]?.xml ?? templateDataRow
    const person = data.roster[i]
    const values = person
      ? ['', person.name, person.faculty, person.schoolYear, person.phone]
      : ['', '', '', '', '']
    const cs = cells(base)
    let rowXml = base
    for (let c = cs.length - 1; c >= 0; c--) {
      const cell = must(cs[c], `名簿 r${i + 1} c${c} が無い`)
      rowXml =
        rowXml.slice(0, cell.start) + rewriteCell(cell.xml, [values[c] ?? '']) + rowXml.slice(cell.end)
    }
    filledRows.push(rowXml)
  }
  const rosterLastRow = must(rosterRows[ROSTER_ROWS - 1], '名簿の最終行が無い')
  const rosterXml =
    rosterTable.xml.slice(0, rosterTemplateRow.start) +
    filledRows.join('') +
    rosterTable.xml.slice(rosterLastRow.end)

  xml = spliceAll(xml, [
    { start: headerTable.start, end: headerTable.end, xml: headerXml },
    { start: rosterTable.start, end: rosterTable.end, xml: rosterXml },
  ])
  zip.file('word/document.xml', xml)

  // ---- .dotx → .docx: 本体パートの content type を差し替える ------------------
  const ctFile = zip.file('[Content_Types].xml')
  assert(ctFile !== null, '[Content_Types].xml が無い')
  const ct = await ctFile.async('string')
  const TEMPLATE_CT =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'
  const DOCUMENT_CT =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  assert(ct.includes(TEMPLATE_CT), '[Content_Types].xml にテンプレの content type が無い')
  zip.file('[Content_Types].xml', ct.replace(TEMPLATE_CT, DOCUMENT_CT))

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// ---------------------------------------------------------------------------
// 署名欄の run 操作
// ---------------------------------------------------------------------------

function paragraphRuns(paragraphXml: string): string[] {
  return [...paragraphXml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1] ?? '')
}

/**
 * 下線が複数 run にまたがる欄へ値を書く。
 * `firstRun` に値を入れ、`firstRun+1..lastRun` は空にする。元の run の合計幅ぶんの
 * 全角スペースで右詰めして、**下線の長さを変えない**。
 * `indent` は先頭に残す全角スペース（テンプレの字下げ）。
 */
function writeSpannedValue(
  setRuns: (paragraphIndex: number, values: Record<number, string>) => void,
  sigParagraphs: readonly { xml: string }[],
  paragraphIndex: number,
  firstRun: number,
  lastRun: number,
  value: string,
  indent = 0,
): void {
  const runs = paragraphRuns(sigParagraphs[paragraphIndex]?.xml ?? '')
  let width = 0
  for (let i = firstRun; i <= lastRun; i++) width += runs[i]?.length ?? 0
  const head = '　'.repeat(indent)
  const values: Record<number, string> = {
    [firstRun]: padTo(`${head}${value}`, width),
  }
  for (let i = firstRun + 1; i <= lastRun; i++) values[i] = ''
  setRuns(paragraphIndex, values)
}
