import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import ExcelJS from 'exceljs'
import { z } from 'zod'
import { loadLlmConfig } from '@kagetra/mail-worker/config'
import type { Grade } from '@kagetra/shared/types'
import type { CellMapSheet, DanFormat, HeaderField, MemberField } from './cell-map'

/**
 * entry-form-autofill タスク5: ヒューリスティック（タスク2 `cell-map.ts`）が低信頼の
 * ときのみ呼ばれる Claude Haiku フォールバックと、案内メール本文からの主催者指定
 * （件名・添付ファイル名・申込先）抽出。requirements §3.2.3 第二段 / §3.2.6。
 *
 * 用途は2つのみ（Non-goals: AI に xlsx を直接生成させない・AI 出力を自動採用しない
 * ＝呼び出し側=タスク7 のプレビューで必ず目視確認する）:
 *   - {@link inferCellMap}: シートのテキスト表現からセルマップ断片を推定する
 *   - {@link extractOrganizerInstructions}: 案内メール本文から主催者指定を抽出する
 *
 * どちらも「推定不可」を例外ではなく `null` 戻り値で表現する（設計点7）。呼び出し側は
 * `null` を「AI 推定失敗」として手動マッピングへ誘導すればよく、この関数が投げる例外を
 * 気にする必要はない — API キー未設定・API エラー・応答の tool_use 欠落・スキーマ検証
 * 失敗はすべてここで握りつぶし `null` にする。
 */

/** 実装手順書タスク5で指定されたモデル ID。テストからも参照する。 */
export const AI_EXTRACT_MODEL_ID = 'claude-haiku-4-5-20251001'

const DEFAULT_MAX_TOKENS = 2048

// ---------------------------------------------------------------------------
// シートのテキスト表現（AI への入力・呼び出し側にも export してプレビュー等で再利用可）
// ---------------------------------------------------------------------------

/**
 * プロンプトに載せる行数の上限（シートごと）。トークン節約のため。実物テンプレは
 * 明細行が数十〜100行超になり得るが、AI の仕事はヘッダ行・記入開始行付近の構造推定
 * だけなので先頭部分で十分。上限を超えた場合はその旨をテキスト末尾に明記する。
 */
const MAX_ROWS_PER_SHEET = 60
const MAX_COLS_PER_SHEET = 40

function formulaResultToText(result: ExcelJS.CellFormulaValue['result']): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  if (typeof result === 'number' || typeof result === 'boolean') return String(result)
  if (result instanceof Date) return result.toISOString()
  return '' // CellErrorValue
}

/**
 * `cell-map.ts` の `valueToText` と同趣旨だが、あちらは private でここからは
 * import できない（cell-map.ts は変更禁止）ため、AI プロンプト用に簡略版を持つ。
 */
function cellValueToText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if ('error' in value) return ''
  if ('richText' in value) return value.richText.map((t) => t.text).join('')
  if ('formula' in value) return formulaResultToText(value.result)
  if ('sharedFormula' in value) return formulaResultToText(value.result)
  if ('text' in value) return value.text // hyperlink
  return ''
}

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

/**
 * ヘッダ欄（clubName 等）の記入先は「ラベルの右隣にある結合セル」のことが多く
 * （`cell-map.ts` の `resolveInputCellAddress` と同じ実物テンプレの実態）、結合セル自体は
 * 中身が空なので {@link sheetsToPromptText} の非空セル走査には出てこない。結合範囲を
 * 別行で明示しないと、AI は「ラベルの右にどのセルがあるか」を答えようがない。
 */
function mergesLine(ws: ExcelJS.Worksheet): string | null {
  const merges = ws.model.merges
  if (!merges || merges.length === 0) return null
  return `[結合セル] ${merges.join(', ')}`
}

/**
 * ワークブックをセルアドレス付きテキスト（例: `B11: 参加級`）に変換する。空セルは
 * 出力しない（ただし結合セル範囲は別行で明示する。上記 {@link mergesLine} 参照）。
 * AI にセル位置そのものを答えさせやすくするための表現（設計点10）。
 * 純関数——ファイル読み込みは呼び出し側の責務（`cell-map.ts` の `estimateCellMap` と同じ
 * 分担）。
 */
export function sheetsToPromptText(workbook: ExcelJS.Workbook): string {
  const sections = workbook.worksheets.map((ws) => {
    const maxRow = Math.min(ws.rowCount, MAX_ROWS_PER_SHEET)
    const maxCol = Math.min(ws.columnCount, MAX_COLS_PER_SHEET)
    const lines: string[] = [`=== シート: ${ws.name} ===`]

    const merges = mergesLine(ws)
    if (merges) lines.push(merges)

    for (let row = 1; row <= maxRow; row++) {
      for (let col = 1; col <= maxCol; col++) {
        const text = cellValueToText(ws.getRow(row).getCell(col).value).trim()
        if (!text) continue
        lines.push(`${colIndexToLetter(col)}${row}: ${text}`)
      }
    }

    if (ws.rowCount > MAX_ROWS_PER_SHEET) {
      lines.push(`（このシートは全${ws.rowCount}行中、先頭${MAX_ROWS_PER_SHEET}行のみ表示。以降は省略しています）`)
    }

    return lines.join('\n')
  })

  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// Anthropic 呼び出し共通ヘルパー（forced tool use。mail-worker の anthropic.ts と同型）
// ---------------------------------------------------------------------------

interface ToolCallParams {
  systemPrompt: string
  userText: string
  toolName: string
  toolDescription: string
  inputSchema: Anthropic.Tool['input_schema']
}

/**
 * `messages.create` を forced tool use で呼び、tool_use ブロックの `input`（パース済み
 * オブジェクト）を返す。設定読み込み・API 呼び出し・tool_use 欠落のいずれの失敗も
 * ここで `null` に畳み込み、例外を外へ投げない（設計点7）。
 *
 * inferCellMap / extractOrganizerInstructions はここより先の JSON 検証をそれぞれ自分で
 * 行う（返す型が違うため共通化できない）。
 */
async function callAnthropicTool(params: ToolCallParams): Promise<unknown | null> {
  let client: Anthropic
  try {
    const { anthropicApiKey } = loadLlmConfig()
    client = new Anthropic({ apiKey: anthropicApiKey, maxRetries: 3 })
  } catch (err) {
    console.error('[entry-form/ai-extract] LLM 設定の読み込みに失敗しました', err)
    return null
  }

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: AI_EXTRACT_MODEL_ID,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: params.systemPrompt,
      tools: [
        {
          name: params.toolName,
          description: params.toolDescription,
          input_schema: params.inputSchema,
        },
      ],
      // Force the specific tool — without this Claude can return a text
      // block instead of invoking the tool (mail-worker anthropic.ts と同じ理由)。
      tool_choice: { type: 'tool', name: params.toolName },
      messages: [{ role: 'user', content: params.userText }],
    })
  } catch (err) {
    console.error('[entry-form/ai-extract] Anthropic API 呼び出しに失敗しました', err)
    return null
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === params.toolName,
  )
  if (!toolUse) {
    console.error(`[entry-form/ai-extract] tool_use ブロック(${params.toolName})が返りませんでした`)
    return null
  }
  // toolUse.input は SDK が既に JSON パース済みのオブジェクト（JSON.parse し直さない。
  // mail-worker anthropic.ts の Phase 0 knowledge と同じ罠）。
  return toolUse.input
}

// ---------------------------------------------------------------------------
// inferCellMap: セルマップ推定フォールバック（AC-7）
// ---------------------------------------------------------------------------

const CELL_MAP_TOOL_NAME = 'record_cell_map'

const CELL_MAP_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    sheets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sheetName: { type: 'string' },
          targetGrades: {
            type: ['array', 'null'],
            items: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E'] },
          },
          startRow: { type: 'integer' },
          columns: { type: 'object', additionalProperties: { type: 'string' } },
          headerCells: { type: 'object', additionalProperties: { type: 'string' } },
          danFormat: { type: 'string', enum: ['n段', '漢数字'] },
        },
        required: ['sheetName', 'startRow', 'columns', 'headerCells'],
      },
    },
  },
  required: ['sheets'],
  // Anthropic accepts arbitrary JSON Schema 7 here; the SDK's own type is a
  // narrow shape (mail-worker anthropic.ts hits the same mismatch and casts).
} as unknown as Anthropic.Tool['input_schema']

const CELL_MAP_SYSTEM_PROMPT = `あなたは競技かるた大会の参加申込書（Excelテンプレート）のセル対応付けを推定するアシスタントです。
入力として、各シートのセルをアドレス付きテキスト（例: "B11: 参加級"）で渡します。
"[結合セル] F3:G3, F4:G4" のような行は、そのシートに存在する結合セルの範囲一覧です。ラベル欄（例: "都道府県"）の記入先は、多くの場合そのラベルの右隣にあるこれらの結合セルの左上セル（例: F3）です。
以下を推定し、必ず record_cell_map ツールを呼び出して構造化データとして返してください。

- sheetName: シート名
- startRow: 会員の記入が始まる行番号（見出し行の次の行）
- columns: 会員1名分の列対応。キーは grade/dan/familyName/givenName/fullName/familyKana/givenKana/fullKana/appearanceCount/note のいずれか、値は列レター（例: "F"）
- headerCells: シート冒頭の申込団体情報欄。キーは prefecture/clubName/managerName/phone/email/transferName のいずれか、値は記入先のセルアドレス（例: "F4"）
- targetGrades: 複数シート型（級ごとにシートが分かれるテンプレ）でこのシートが対象とする級（A〜E）の配列。単一シートで全級を扱う、または級を特定できない場合は null
- danFormat: 段位の入力形式。"初段,2段,…" のような形式なら "n段"、"一,二,三,…" のような漢数字形式なら "漢数字"

対応付けが不明な列・欄は無理に埋めず省略してください。`

/** raw sheet: 検証前の緩い形（想定しない型・キーが混ざっていてもここでは弾かない）。 */
const RawCellMapResponseSchema = z.object({
  sheets: z.array(z.record(z.string(), z.unknown())),
})

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']
const MEMBER_FIELDS = new Set<MemberField>([
  'grade',
  'dan',
  'familyName',
  'givenName',
  'fullName',
  'familyKana',
  'givenKana',
  'fullKana',
  'appearanceCount',
  'note',
])
const HEADER_FIELDS = new Set<HeaderField>([
  'prefecture',
  'clubName',
  'managerName',
  'phone',
  'email',
  'transferName',
])

const COLUMN_LETTER_REGEX = /^[A-Z]{1,2}$/
const CELL_ADDRESS_REGEX = /^[A-Z]{1,2}[1-9][0-9]*$/

/**
 * 列レターとして正規化する。AI が列レター単体（"F"）ではなくセルアドレス（"F12"）を
 * 返すことがあるため、アドレス形式なら列部分だけを取り出す。どちらの形式にも
 * 合わなければ `null`（呼び出し側でそのキーごと捨てる）。
 */
function normalizeColumnLetter(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const upper = raw.trim().toUpperCase()
  if (COLUMN_LETTER_REGEX.test(upper)) return upper
  const m = /^([A-Z]{1,2})[1-9][0-9]*$/.exec(upper)
  return m ? m[1]! : null
}

/** ヘッダ欄はセルアドレス（列＋行）が必須。列レター単体では記入先を特定できないため捨てる。 */
function normalizeCellAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const upper = raw.trim().toUpperCase()
  return CELL_ADDRESS_REGEX.test(upper) ? upper : null
}

/**
 * `columns` の検証・正規化（設計点8）。
 * - 未知のフィールド名（MemberField に無いキー）は黙って捨てる（Non-goal: 特殊列の自動記入はしない）
 * - 列レター・セルアドレスのどちらの形式でもない値を持つキーも黙って捨てる（1つのセル参照が
 *   不正でも、他の正しく推定できた列の対応付けまで無駄にしない方が実用的なため — シート全体を
 *   破棄するのは startRow が不正なときだけにする、という判断をここでしている）
 */
function buildColumns(raw: unknown): Partial<Record<MemberField, string>> {
  const out: Partial<Record<MemberField, string>> = {}
  if (raw == null || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!MEMBER_FIELDS.has(key as MemberField)) continue
    const letter = normalizeColumnLetter(value)
    if (!letter) continue
    out[key as MemberField] = letter
  }
  return out
}

/** `headerCells` の検証・正規化。ロジックは {@link buildColumns} と同趣旨（値の形式のみ異なる）。 */
function buildHeaderCells(raw: unknown): Partial<Record<HeaderField, string>> {
  const out: Partial<Record<HeaderField, string>> = {}
  if (raw == null || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!HEADER_FIELDS.has(key as HeaderField)) continue
    const address = normalizeCellAddress(value)
    if (!address) continue
    out[key as HeaderField] = address
  }
  return out
}

/**
 * `targetGrades` の検証（設計点8）。範囲外の要素（'A'|'B'|'C'|'D'|'E' 以外）は個別に
 * 落とす。全要素が範囲外・配列でない・null の場合は「対象級を特定できない」を意味する
 * `null` にする（呼び出し側は全会員をこのシートへ振り分ける扱いになる — cell-map.ts の
 * `targetGrades: null` の意味と同じ）。
 */
function buildTargetGrades(raw: unknown): Grade[] | null {
  if (raw == null) return null
  if (!Array.isArray(raw)) return null
  const grades = raw.filter((g): g is Grade => typeof g === 'string' && (GRADES as readonly string[]).includes(g))
  return grades.length > 0 ? Array.from(new Set(grades)) : null
}

/** 不正・未指定なら既定 `'n段'`（設計点8: danFormat が不正なら既定にフォールバックする）。 */
function buildDanFormat(raw: unknown): DanFormat {
  return raw === 'n段' || raw === '漢数字' ? raw : 'n段'
}

/**
 * 1シート分の raw オブジェクトを `CellMapSheet` に変換する。`sheetName` が空・
 * `startRow` が正の整数でない場合は、そのシート自体を記入位置不明として破棄する
 * （`null` を返す）— この2つはシート全体の記入位置を左右する情報であり、部分的に
 * 埋めても手動マッピングの助けにならないため（columns/headerCells の個別キーとは
 * 扱いを分けている）。
 */
function buildCellMapSheet(raw: Record<string, unknown>): CellMapSheet | null {
  const sheetName = typeof raw.sheetName === 'string' ? raw.sheetName.trim() : ''
  if (!sheetName) return null

  const rawStartRow = raw.startRow
  const startRow =
    typeof rawStartRow === 'number'
      ? rawStartRow
      : typeof rawStartRow === 'string'
        ? Number(rawStartRow)
        : NaN
  if (!Number.isInteger(startRow) || startRow <= 0) return null

  return {
    sheetName,
    targetGrades: buildTargetGrades(raw.targetGrades),
    startRow,
    columns: buildColumns(raw.columns),
    headerCells: buildHeaderCells(raw.headerCells),
    danFormat: buildDanFormat(raw.danFormat),
  }
}

/**
 * ヒューリスティック（`estimateCellMap` の `confidence: 'low'`）が失敗したときのみ
 * 呼ぶセルマップ推定フォールバック。`sheetsText` は {@link sheetsToPromptText} の出力。
 *
 * 戻り値が `null`（推定不可）になるケース: LLM 設定エラー・API エラー・tool_use 欠落・
 * 応答の形が壊れていて1シートも使える形に変換できなかった場合。呼び出し側（タスク7）は
 * `null` を「AI 推定できず」として手動マッピングへ誘導する。
 */
export async function inferCellMap(sheetsText: string): Promise<CellMapSheet[] | null> {
  const raw = await callAnthropicTool({
    systemPrompt: CELL_MAP_SYSTEM_PROMPT,
    userText: sheetsText,
    toolName: CELL_MAP_TOOL_NAME,
    toolDescription: '申込書テンプレートのシートごとのセル対応付けを記録する。',
    inputSchema: CELL_MAP_INPUT_SCHEMA,
  })
  if (raw === null) return null

  const parsed = RawCellMapResponseSchema.safeParse(raw)
  if (!parsed.success) return null

  const sheets = parsed.data.sheets.map(buildCellMapSheet).filter((s): s is CellMapSheet => s !== null)

  return sheets.length > 0 ? sheets : null
}

// ---------------------------------------------------------------------------
// extractOrganizerInstructions: 主催者指定の件名・添付ファイル名・申込先抽出（AC-12, AC-13）
// ---------------------------------------------------------------------------

const ORGANIZER_TOOL_NAME = 'record_organizer_instructions'

const ORGANIZER_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: ['string', 'null'] },
    attachmentFilename: { type: ['string', 'null'] },
    toEmail: { type: ['string', 'null'] },
  },
  required: ['subject', 'attachmentFilename', 'toEmail'],
} as unknown as Anthropic.Tool['input_schema']

const ORGANIZER_SYSTEM_PROMPT = `あなたは競技かるた大会の参加申込に関するメールを読み、主催者からの指定事項を抽出するアシスタントです。
入力として案内メール本文（と、あれば申込書テンプレートの抜粋テキスト）を渡します。
以下を抽出し、必ず record_organizer_instructions ツールを呼び出して返してください。指定が読み取れない項目は null にしてください。

- subject: 返信メールの件名について主催者が指定している文言（例: 「件名を『(所属会名)○○大会申込み』としてください」のような指示があれば、その指定文言）
- attachmentFilename: 提出ファイルの名称について主催者が指定している文言
- toEmail: 申込書の送付先として案内メール本文に書かれているメールアドレス

指定が全く読み取れない場合は3項目とも null にしてください。推測で埋めないでください。`

/** AI 出力の JSDoc: 各フィールドの `null` は「主催者指定なし」「抽出不能」のどちらも意味し得る
 *（両者とも呼び出し側は定型値へフォールバックするため実害はないが、意味を明記しておく）。 */
export interface OrganizerInstructions {
  /** 主催者指定の返信件名。指定が無い/読み取れない場合は `null`（呼び出し側は定型件名にフォールバック）。 */
  subject: string | null
  /** 主催者指定の添付ファイル名。指定が無い/読み取れない場合は `null`（呼び出し側は既定の命名にフォールバック）。 */
  attachmentFilename: string | null
  /** 案内メール本文から読み取れた申込先メールアドレス。読み取れない場合は `null`（呼び出し側は差出人にフォールバック）。 */
  toEmail: string | null
}

const EMAIL_REGEX = /^[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+$/

function normalizeNullableString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return EMAIL_REGEX.test(trimmed) ? trimmed : null
}

/**
 * 案内メール本文（＋任意でシートのテキスト抜粋）から主催者指定の件名・添付ファイル名・
 * 申込先メールアドレスを抽出する。3項目すべてが `null` になった場合（主催者指定なし、
 * または抽出失敗）は関数全体として `null` を返す — 呼び出し側はどちらの場合も定型値へ
 * フォールバックするだけなので、区別する必要がない（設計点9）。
 *
 * API エラー・tool_use 欠落・応答が object でない場合も同様に `null`。
 */
export async function extractOrganizerInstructions(
  mailBodyText: string,
  sheetsText?: string,
): Promise<OrganizerInstructions | null> {
  const userText = sheetsText
    ? `【案内メール本文】\n${mailBodyText}\n\n【申込書シート抜粋】\n${sheetsText}`
    : `【案内メール本文】\n${mailBodyText}`

  const raw = await callAnthropicTool({
    systemPrompt: ORGANIZER_SYSTEM_PROMPT,
    userText,
    toolName: ORGANIZER_TOOL_NAME,
    toolDescription: '案内メールから読み取った主催者指定の件名・添付ファイル名・申込先を記録する。',
    inputSchema: ORGANIZER_INPUT_SCHEMA,
  })
  if (raw === null || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const subject = normalizeNullableString(record.subject)
  const attachmentFilename = normalizeNullableString(record.attachmentFilename)
  const toEmail = normalizeEmail(record.toEmail)

  if (subject === null && attachmentFilename === null && toEmail === null) return null

  return { subject, attachmentFilename, toEmail }
}
