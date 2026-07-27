import 'server-only'
import ExcelJS from 'exceljs'
import type { Grade } from '@kagetra/shared/types'

/**
 * entry-form-autofill タスク2: 申込書テンプレ (xlsx) のセル対応付けをヒューリスティックで
 * 推定する。requirements §3.2.3 / §3.2.4 / §3.2.6。
 *
 * `estimateCellMap()` は「読み込み済みの Workbook」を受け取る純関数（ファイル I/O は
 * 呼び出し側=Server Action の責務。テストは fixture を readFile して Workbook 化してから渡す）。
 *
 * ここで返す `CellMapSheet` はヒューリスティック／AI フォールバック（タスク5）／
 * 手動修正（タスク7）が共有する契約なので、フィールドの意味をここでのみ変更しないこと。
 */

/** 記入対象になり得る会員1名分のフィールド。マップできない列（学校名・学年など）は含めない。 */
export type MemberField =
  | 'grade'
  | 'dan'
  | 'familyName'
  | 'givenName'
  | 'fullName'
  | 'familyKana'
  | 'givenKana'
  | 'fullKana'
  | 'appearanceCount'
  | 'note'

/** シート冒頭のヘッダ欄（都道府県・所属会名など、申込団体につき1回だけ記入する欄）。 */
export type HeaderField = 'prefecture' | 'clubName' | 'managerName' | 'phone' | 'email' | 'transferName'

/**
 * 段位入力規則（ドロップダウン）の選択肢形式。入力規則が無いテンプレの既定は `'n段'`。
 * 将来の系統追加に備えユニオン型で定義する（現状はこの2つ）。
 */
export type DanFormat = 'n段' | '漢数字'

/** 1シート分のセル対応付け。 */
export interface CellMapSheet {
  sheetName: string
  /** 複数シート型の振分先。単一シートの場合や級を特定できない場合は `null`（全会員をこのシートへ）。 */
  targetGrades: Grade[] | null
  startRow: number
  /** `'familyName' -> 'F'` のような列対応。マップできないフィールドはキー自体を持たない。 */
  columns: Partial<Record<MemberField, string>>
  /** `'clubName' -> 'F4'` のような記入先セルアドレス（ラベルのアドレスではない）。 */
  headerCells: Partial<Record<HeaderField, string>>
  danFormat: DanFormat
}

/** ヒューリスティック／AI／手動修正が共有するセルマップの中身。 */
export interface CellMap {
  sheets: CellMapSheet[]
}

/** ヒューリスティック推定の結果。`confidence: 'low'` は呼び出し側が AI フォールバックへ回す判断材料。 */
export interface CellMapEstimate extends CellMap {
  confidence: 'high' | 'low'
  /** 低信頼の理由・部分的な検出失敗を日本語で説明する（プレビュー UI にそのまま出す想定）。 */
  warnings: string[]
  /** メール下書きの宛先プレフィル優先順位①（requirements §3.2.6）。見つからなければ `null`。 */
  organizerEmail: string | null
}

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

// ---------------------------------------------------------------------------
// セル値の読み取り（richText・数式結果・エラー値を平文テキストへ畳み込む）
// ---------------------------------------------------------------------------

function resultToText(result: ExcelJS.CellFormulaValue['result']): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  if (typeof result === 'number' || typeof result === 'boolean') return String(result)
  if (result instanceof Date) return result.toISOString()
  return '' // CellErrorValue
}

function valueToText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if ('error' in value) return ''
  if ('richText' in value) return value.richText.map((t) => t.text).join('')
  if ('formula' in value) return resultToText(value.result)
  if ('sharedFormula' in value) return resultToText(value.result)
  if ('text' in value) return value.text // hyperlink
  return ''
}

/** 結合セルの非アンカー側も exceljs がアンカー側の値を返すため、merge 解決は不要。 */
function cellText(ws: ExcelJS.Worksheet, row: number, col: number): string {
  return valueToText(ws.getRow(row).getCell(col).value)
}

/** 空白（半角・全角・改行）を除去して小文字化する。日本語部分は小文字化しても変化しない。 */
function normalizeCellText(text: string): string {
  return text.replace(/[\s　]/g, '').toLowerCase()
}

/** ヘッダ欄ラベルは末尾のコロン（全角/半角）付きの語形があるため、比較前に落とす。 */
function normalizeLabel(text: string): string {
  return normalizeCellText(text).replace(/[:：]+$/, '')
}

// ---------------------------------------------------------------------------
// 列レター <-> 列インデックス
// ---------------------------------------------------------------------------

function colIndexToLetter(index: number): string {
  let n = index
  let letter = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letter = String.fromCharCode(65 + rem) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

function colLetterToIndex(letter: string): number {
  let n = 0
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

// ---------------------------------------------------------------------------
// 明細ヘッダ行の探索・列対応（AC-6, AC-11 判定部）
// ---------------------------------------------------------------------------

type FieldMatch = MemberField | 'no'

/**
 * 単一セルの正規化テキストからフィールドを判定する（文脈非依存の一次判定）。
 * `familyName`/`givenName` は「氏/名」だけでなく「姓/名」の語形も拾うが、
 * ふりがな2段見出し（例: split-kana.xlsx の「ふりがな／姓」）と区別できないため、
 * 呼び出し側 {@link resolveFieldForCell} で1行上の見出しを見て familyKana/givenKana へ
 * 読み替える。
 */
function matchPlainField(normalized: string): FieldMatch | null {
  if (normalized === 'no' || normalized === 'no.' || normalized === '番号') return 'no'
  if (normalized === '参加級') return 'grade'
  if (normalized === '段位') return 'dan'
  if (normalized === '氏名') return 'fullName'
  if (normalized === '氏' || normalized === '姓') return 'familyName'
  if (normalized === '名') return 'givenName'
  if (normalized === 'ふりがな' || normalized === 'フリガナ') return 'fullKana'
  if (normalized === 'ふり') return 'familyKana'
  if (normalized === 'がな') return 'givenKana'
  if (normalized.includes('出場回数')) return 'appearanceCount'
  if (normalized.startsWith('備考')) return 'note'
  return null
}

function resolveFieldForCell(ws: ExcelJS.Worksheet, row: number, col: number): FieldMatch | null {
  const base = matchPlainField(normalizeCellText(cellText(ws, row, col)))
  if (base !== 'familyName' && base !== 'givenName') return base
  if (row <= 1) return base
  const above = normalizeCellText(cellText(ws, row - 1, col))
  if (!above.includes('ふりがな') && !above.includes('フリガナ')) return base
  return base === 'familyName' ? 'familyKana' : 'givenKana'
}

interface HeaderRowCandidate {
  row: number
  columns: Partial<Record<MemberField, string>>
}

/** ヘッダ行と認めるための最低限のフィールド数（会員1名分の情報として薄すぎる行を弾く）。 */
const MIN_HEADER_FIELDS = 2

/**
 * 明細ヘッダ行を探す。「同じフィールドが複数列にまたがる」候補行（例: split-kana.xlsx の
 * 2段見出しのうち上段=r5 だけを見た場合、氏名/ふりがなが2列とも同一フィールドになり
 * 対応付けが破綻する）は重複ペナルティで弾き、より具体的な下段見出し行を選ぶ。
 */
function findHeaderRow(ws: ExcelJS.Worksheet): HeaderRowCandidate | null {
  const maxRow = Math.min(ws.rowCount, 200)
  const maxCol = Math.min(ws.columnCount, 40)
  let best: HeaderRowCandidate | null = null
  let bestScore = -Infinity

  for (let row = 1; row <= maxRow; row++) {
    const columns: Partial<Record<MemberField, string>> = {}
    let duplicates = 0
    for (let col = 1; col <= maxCol; col++) {
      const field = resolveFieldForCell(ws, row, col)
      if (field == null || field === 'no') continue
      if (columns[field]) {
        duplicates++
        continue
      }
      columns[field] = colIndexToLetter(col)
    }
    const fieldCount = Object.keys(columns).length
    if (fieldCount === 0) continue
    const score = fieldCount - duplicates * 10
    // 後段（より具体的な下段見出し）を優先するため、同点以上なら常に上書きする。
    if (score >= bestScore) {
      best = { row, columns }
      bestScore = score
    }
  }

  if (!best || Object.keys(best.columns).length < MIN_HEADER_FIELDS) return null
  return best
}

// ---------------------------------------------------------------------------
// 結合セル（記入先アドレスの解決に使う）
// ---------------------------------------------------------------------------

/** 行番号 -> その行を左上行とする結合セルの開始列インデックス一覧。 */
function buildMergesByRow(ws: ExcelJS.Worksheet): Map<number, number[]> {
  const byRow = new Map<number, number[]>()
  for (const range of ws.model.merges) {
    const m = /^([A-Z]+)(\d+):[A-Z]+\d+$/.exec(range)
    if (!m) continue
    const row = Number(m[2])
    const col = colLetterToIndex(m[1]!)
    const existing = byRow.get(row)
    if (existing) existing.push(col)
    else byRow.set(row, [col])
  }
  return byRow
}

/**
 * ラベルセルの記入先アドレスを決める（設計点9）。「ラベルの右隣の空セル」が原則だが、
 * 実物テンプレはラベルとの間に空の飾り列を挟んで結合入力欄を置くことが多い（例:
 * standard.xlsx の `A3`ラベル→`F3:G3`結合入力欄）。そのため同じ行にラベルより右側の
 * 結合セルがあればそれを優先し、無ければ隣接セルにフォールバックする。
 */
function resolveInputCellAddress(
  mergesByRow: Map<number, number[]>,
  labelRow: number,
  labelCol: number,
): string {
  const rowMerges = (mergesByRow.get(labelRow) ?? []).filter((c) => c > labelCol).sort((a, b) => a - b)
  const targetCol = rowMerges[0] ?? labelCol + 1
  return `${colIndexToLetter(targetCol)}${labelRow}`
}

// ---------------------------------------------------------------------------
// ヘッダ欄（都道府県・所属会名など）の検出（設計点9）
// ---------------------------------------------------------------------------

const HEADER_LABEL_SPECS: { field: HeaderField; keywords: string[] }[] = [
  { field: 'prefecture', keywords: ['都道府県'] },
  { field: 'clubName', keywords: ['所属会名', '所属会'] },
  { field: 'managerName', keywords: ['申込責任者氏名', '申込責任者', '代表者名'] },
  { field: 'phone', keywords: ['連絡先電話番号', '電話番号'] },
  { field: 'email', keywords: ['連絡先e-mail', 'e-mail', 'eメール'] },
  { field: 'transferName', keywords: ['振込名義人'] },
]

/**
 * ヘッダ欄ラベルを探す。明細ヘッダ行そのもの・その直上（2段見出しの上段）は除外する —
 * 会員ごとの列見出し（例: multisheet-grades.xlsx の「所属会（学校名）」、split-kana.xlsx の
 * 「所属会」）を誤ってヘッダ欄（`clubName`）として拾ってしまうため（実害を確認済み）。
 */
function findHeaderCells(
  ws: ExcelJS.Worksheet,
  mergesByRow: Map<number, number[]>,
  detailHeaderRow: number,
): Partial<Record<HeaderField, string>> {
  const cells: Partial<Record<HeaderField, string>> = {}
  const scanEnd = detailHeaderRow - 2
  const maxCol = Math.min(ws.columnCount, 40)

  for (let row = 1; row <= scanEnd; row++) {
    for (let col = 1; col <= maxCol; col++) {
      const normalized = normalizeLabel(cellText(ws, row, col))
      if (!normalized) continue
      const spec = HEADER_LABEL_SPECS.find((s) => s.keywords.some((k) => normalized.includes(k)))
      if (!spec || cells[spec.field]) continue
      cells[spec.field] = resolveInputCellAddress(mergesByRow, row, col)
    }
  }
  return cells
}

// ---------------------------------------------------------------------------
// 入力規則（ドロップダウン選択肢）の読み取り
// ---------------------------------------------------------------------------

/**
 * 列の入力規則を読む。実物では同じ入力規則が数百セルに散らばり（standard.xlsx は
 * 640セル）、内部モデルのアドレスが行範囲を大きく外れることもある（設計点5）ため、
 * 内部モデルを直接読まず、**その列の記入開始行セル1件**の `cell.dataValidation`
 * （exceljs の公開 API）を代表値として読む。同じ列には同じ入力規則が適用されている
 * 前提（実物テンプレの実態に合う）。
 */
function dataValidationForColumn(
  ws: ExcelJS.Worksheet,
  dataRow: number,
  colLetter: string,
): ExcelJS.DataValidation | undefined {
  return ws.getCell(`${colLetter}${dataRow}`).dataValidation
}

/** list 型 DV の選択肢文字列（`"初段,2段,…"` の外側の引用符を落として分割）を返す。 */
function parseListDvChoices(dv: ExcelJS.DataValidation | undefined): string[] | null {
  if (!dv || dv.type !== 'list' || !dv.formulae || dv.formulae.length === 0) return null
  const first: unknown = dv.formulae[0]
  const raw = typeof first === 'string' ? first : ''
  const stripped = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
  const choices = stripped
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return choices.length > 0 ? choices : null
}

const KANJI_DAN_NUMERALS = new Set(['初', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'])

/** 段位の入力規則からフォーマットを判定する（設計点6）。DV が無ければ既定の `'n段'`。 */
function detectDanFormat(choices: string[] | null): DanFormat {
  if (!choices || choices.length === 0) return 'n段'
  const allKanji = choices.every((c) => KANJI_DAN_NUMERALS.has(c))
  return allKanji ? '漢数字' : 'n段'
}

// ---------------------------------------------------------------------------
// 対象級（targetGrades）の判定（設計点8）
// ---------------------------------------------------------------------------

/** テキスト中の「[A-E]+級」パターンから級を抽出する（シート名・表題セルの両方で使う）。 */
function extractGradesFromText(text: string): Grade[] | null {
  const m = /([A-E]+)級/.exec(text)
  if (!m) return null
  const letters = Array.from(new Set(m[1]!.split(''))) as Grade[]
  return letters.length > 0 ? letters : null
}

/** 参加級 DV の1選択肢（`"D"` や `"A級"`）を級1文字に変換する。 */
function extractSingleGradeFromChoice(choice: string): Grade | null {
  const trimmed = choice.trim()
  if ((GRADES as readonly string[]).includes(trimmed)) return trimmed as Grade
  const m = /^([A-E])級$/.exec(trimmed)
  return m ? (m[1] as Grade) : null
}

function determineTargetGrades(ws: ExcelJS.Worksheet, gradeDv: ExcelJS.DataValidation | undefined): Grade[] | null {
  const fromName = extractGradesFromText(ws.name)
  if (fromName) return fromName

  const choices = parseListDvChoices(gradeDv)
  if (choices) {
    const mapped = choices.map(extractSingleGradeFromChoice)
    if (mapped.every((g): g is Grade => g != null)) {
      const unique = Array.from(new Set(mapped))
      if (unique.length === 1) return unique
    }
  }

  const titleText = cellText(ws, 1, 1)
  return extractGradesFromText(titleText)
}

// ---------------------------------------------------------------------------
// 申込先メールアドレスの抽出（設計点10・AC-12）
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g
const ORGANIZER_EMAIL_KEYWORDS = ['申込先', '送信先', '宛先', 'emailアドレス', 'e-mailアドレス']

function hasOrganizerKeyword(text: string): boolean {
  const lower = text.toLowerCase()
  return ORGANIZER_EMAIL_KEYWORDS.some((k) => lower.includes(k))
}

interface EmailCandidate {
  sheetIndex: number
  row: number
  col: number
  email: string
}

/** 近傍（同一セル→同一行→同一列±4行）に「申込先」等のキーワードがあるかでスコア化する。 */
function scoreEmailCandidate(ws: ExcelJS.Worksheet, candidate: EmailCandidate): number {
  if (hasOrganizerKeyword(cellText(ws, candidate.row, candidate.col))) return 3

  const maxCol = Math.min(ws.columnCount, 40)
  for (let col = 1; col <= maxCol; col++) {
    if (col === candidate.col) continue
    if (hasOrganizerKeyword(cellText(ws, candidate.row, col))) return 2
  }

  const WINDOW = 4
  for (let dr = -WINDOW; dr <= WINDOW; dr++) {
    if (dr === 0) continue
    const row = candidate.row + dr
    if (row < 1) continue
    if (hasOrganizerKeyword(cellText(ws, row, candidate.col))) return 1
  }

  return 0
}

/**
 * 「申込先」メールアドレスをワークブック全体（振分対象から除外したシートも含む）から
 * 探す。運営使用シートに申込先が書かれている実物があり得るため（設計点7の管理シート想定）。
 */
function findOrganizerEmail(workbook: ExcelJS.Workbook): string | null {
  const candidates: EmailCandidate[] = []
  workbook.worksheets.forEach((ws, sheetIndex) => {
    const maxRow = Math.min(ws.rowCount, 200)
    const maxCol = Math.min(ws.columnCount, 40)
    for (let row = 1; row <= maxRow; row++) {
      for (let col = 1; col <= maxCol; col++) {
        const text = cellText(ws, row, col)
        if (!text) continue
        const matches = text.match(EMAIL_REGEX)
        if (!matches) continue
        for (const email of matches) candidates.push({ sheetIndex, row, col, email })
      }
    }
  })
  if (candidates.length === 0) return null

  let best = candidates[0]!
  let bestScore = scoreEmailCandidate(workbook.worksheets[best.sheetIndex]!, best)
  for (const candidate of candidates.slice(1)) {
    const ws = workbook.worksheets[candidate.sheetIndex]!
    const score = scoreEmailCandidate(ws, candidate)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  // 「申込先」等の語と結び付かないアドレス（問い合わせ先・所属会の連絡先・
  // 記入例）は宛先の根拠にならない。宛先プレフィルの優先順①は「申込先として
  // 書かれているアドレス」なので、関連を確認できないなら AI 抽出・案内メール
  // 差出人へ譲る。
  if (bestScore <= 0) return null
  return best.email
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/**
 * テンプレ xlsx のセルマップをヒューリスティックで推定する（requirements §3.2.3 第一段）。
 * 純関数——ファイル読み込みは呼び出し側の責務。
 */
export function estimateCellMap(workbook: ExcelJS.Workbook): CellMapEstimate {
  const sheets: CellMapSheet[] = []

  for (const ws of workbook.worksheets) {
    const header = findHeaderRow(ws)
    if (!header) continue // 明細ヘッダ行が見つからないシートは記入対象から除外する（設計点7）

    const startRow = header.row + 1
    const mergesByRow = buildMergesByRow(ws)
    const gradeDv = header.columns.grade
      ? dataValidationForColumn(ws, startRow, header.columns.grade)
      : undefined
    const danDv = header.columns.dan ? dataValidationForColumn(ws, startRow, header.columns.dan) : undefined

    sheets.push({
      sheetName: ws.name,
      targetGrades: determineTargetGrades(ws, gradeDv),
      startRow,
      columns: header.columns,
      headerCells: findHeaderCells(ws, mergesByRow, header.row),
      danFormat: detectDanFormat(parseListDvChoices(danDv)),
    })
  }

  const warnings: string[] = []
  let confidence: 'high' | 'low' = 'high'

  if (sheets.length === 0) {
    confidence = 'low'
    warnings.push('記入対象のヘッダ行を特定できませんでした')
  }

  for (const sheet of sheets) {
    const hasName = Boolean(sheet.columns.fullName) || Boolean(sheet.columns.familyName && sheet.columns.givenName)
    const hasKana = Boolean(sheet.columns.fullKana) || Boolean(sheet.columns.familyKana && sheet.columns.givenKana)
    if (!hasName || !hasKana) {
      confidence = 'low'
      warnings.push(`シート「${sheet.sheetName}」で氏名またはふりがなの列を特定できませんでした`)
    }
  }

  if (sheets.length > 1 && sheets.some((s) => s.targetGrades === null)) {
    confidence = 'low'
    warnings.push('複数シートですが、シート名などから対象級を特定できないシートがあります')
  }

  return {
    sheets,
    confidence,
    warnings,
    organizerEmail: findOrganizerEmail(workbook),
  }
}
