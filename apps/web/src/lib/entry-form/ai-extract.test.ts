import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadWorkbook } from './workbook'
import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted 必須: factory は hoist されるため、通常の top-level const では TDZ になる
// （mail-worker の anthropic.test.ts / actions.test.ts と同じパターン）。
const { messagesCreateMock } = vi.hoisted(() => ({ messagesCreateMock: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = { create: messagesCreateMock }
    constructor(_opts: unknown) {}
  },
}))

vi.mock('@kagetra/mail-worker/config', () => ({
  loadLlmConfig: () => ({ anthropicApiKey: 'mock-anthropic-key' }),
}))

import { AI_EXTRACT_MODEL_ID, extractOrganizerInstructions, inferCellMap, sheetsToPromptText } from './ai-extract'

// vitest（jsdom 環境）では `import.meta.url` が file: スキームにならず
// `fileURLToPath` が throw する。cell-map.test.ts と同じ解決方法に倣う。
const FIXTURE_DIR = resolve(process.cwd(), 'src/lib/entry-form/__fixtures__')

async function loadFixture(name: string): Promise<ExcelJS.Workbook> {
  return loadWorkbook(await readFile(resolve(FIXTURE_DIR, name)))
}

function buildToolUseResponse(toolName: string, input: unknown) {
  return {
    content: [{ type: 'tool_use' as const, name: toolName, id: 'toolu_test', input }],
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

beforeEach(() => {
  messagesCreateMock.mockReset()
})

describe('inferCellMap', () => {
  it('parses a valid tool_use response into CellMapSheet[] (AC-7)', async () => {
    messagesCreateMock.mockResolvedValue(
      buildToolUseResponse('record_cell_map', {
        sheets: [
          {
            sheetName: 'Sheet1',
            targetGrades: null,
            startRow: 12,
            columns: { familyName: 'F', givenName: 'G', fullKana: 'H' },
            headerCells: { clubName: 'F4' },
            danFormat: 'n段',
          },
        ],
      }),
    )

    const result = await inferCellMap('some sheet text')

    expect(result).toEqual([
      {
        sheetName: 'Sheet1',
        targetGrades: null,
        startRow: 12,
        columns: { familyName: 'F', givenName: 'G', fullKana: 'H' },
        headerCells: { clubName: 'F4' },
        danFormat: 'n段',
      },
    ])
  })

  it('silently drops unknown field names, malformed cell values, and out-of-range grade letters', async () => {
    messagesCreateMock.mockResolvedValue(
      buildToolUseResponse('record_cell_map', {
        sheets: [
          {
            sheetName: 'Sheet1',
            targetGrades: ['A', 'Z'], // 'Z' は範囲外なので落とす
            startRow: 12,
            // schoolName は MemberField に無いキー(黙って捨てる)。dan は列レター/アドレスの
            // どちらの形式でもない値(黙って捨てる)。
            columns: { familyName: 'F', schoolName: 'K', dan: 'not-a-cell' },
            // bogusField は HeaderField に無いキー(黙って捨てる)。
            headerCells: { clubName: 'F4', bogusField: 'Z9' },
            danFormat: '無効な値', // 不正値は既定 'n段' にフォールバック
          },
        ],
      }),
    )

    const result = await inferCellMap('text')

    expect(result).toEqual([
      {
        sheetName: 'Sheet1',
        targetGrades: ['A'],
        startRow: 12,
        columns: { familyName: 'F' },
        headerCells: { clubName: 'F4' },
        danFormat: 'n段',
      },
    ])
  })

  it('drops a sheet with a non-positive-integer startRow, and returns null when no sheet survives', async () => {
    messagesCreateMock.mockResolvedValue(
      buildToolUseResponse('record_cell_map', {
        sheets: [
          { sheetName: 'Sheet1', targetGrades: null, startRow: 0, columns: {}, headerCells: {}, danFormat: 'n段' },
        ],
      }),
    )

    const result = await inferCellMap('text')

    expect(result).toBeNull()
  })

  it('returns null (does not throw) when messages.create rejects with an API error', async () => {
    messagesCreateMock.mockRejectedValue(new Error('network down'))

    const result = await inferCellMap('text')

    expect(result).toBeNull()
  })

  it('returns null when the response has no tool_use block', async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'I refuse to call the tool' }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })

    const result = await inferCellMap('text')

    expect(result).toBeNull()
  })

  it('returns null when the tool_use input fails the top-level shape check (no `sheets` array)', async () => {
    messagesCreateMock.mockResolvedValue(buildToolUseResponse('record_cell_map', { foo: 1 }))

    const result = await inferCellMap('text')

    expect(result).toBeNull()
  })

  it('calls messages.create with the haiku model id and a forced tool_choice', async () => {
    messagesCreateMock.mockResolvedValue(buildToolUseResponse('record_cell_map', { sheets: [] }))

    await inferCellMap('text')

    expect(messagesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: AI_EXTRACT_MODEL_ID,
        tool_choice: { type: 'tool', name: 'record_cell_map' },
      }),
    )
    expect(AI_EXTRACT_MODEL_ID).toBe('claude-haiku-4-5-20251001')
  })
})

describe('extractOrganizerInstructions', () => {
  it('prefills subject / attachment filename / to-email when the response specifies them (AC-12, AC-13)', async () => {
    messagesCreateMock.mockResolvedValue(
      buildToolUseResponse('record_organizer_instructions', {
        subject: '（北海道大学かるた会）○○大会申込み',
        attachmentFilename: '申込書_北海道大学かるた会.xlsx',
        toEmail: 'entry@example.invalid',
      }),
    )

    const result = await extractOrganizerInstructions('メール本文')

    expect(result).toEqual({
      subject: '（北海道大学かるた会）○○大会申込み',
      attachmentFilename: '申込書_北海道大学かるた会.xlsx',
      toEmail: 'entry@example.invalid',
    })
  })

  it('returns null when the response has no instructions (all fields null), so callers fall back to defaults', async () => {
    messagesCreateMock.mockResolvedValue(
      buildToolUseResponse('record_organizer_instructions', {
        subject: null,
        attachmentFilename: null,
        toEmail: null,
      }),
    )

    const result = await extractOrganizerInstructions('メール本文')

    expect(result).toBeNull()
  })

  it('returns null (does not throw) when messages.create rejects with an API error', async () => {
    messagesCreateMock.mockRejectedValue(new Error('network down'))

    const result = await extractOrganizerInstructions('メール本文')

    expect(result).toBeNull()
  })

  it('drops a malformed toEmail value while keeping the other extracted fields', async () => {
    messagesCreateMock.mockResolvedValue(
      buildToolUseResponse('record_organizer_instructions', {
        subject: '件名指定あり',
        attachmentFilename: null,
        toEmail: 'not-an-email',
      }),
    )

    const result = await extractOrganizerInstructions('メール本文')

    expect(result).toEqual({ subject: '件名指定あり', attachmentFilename: null, toEmail: null })
  })

  it('calls messages.create with the haiku model id and a forced tool_choice', async () => {
    messagesCreateMock.mockResolvedValue(
      buildToolUseResponse('record_organizer_instructions', {
        subject: null,
        attachmentFilename: null,
        toEmail: null,
      }),
    )

    await extractOrganizerInstructions('メール本文')

    expect(messagesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: AI_EXTRACT_MODEL_ID,
        tool_choice: { type: 'tool', name: 'record_organizer_instructions' },
      }),
    )
  })

  // requirements §3.2.6: 主催者指定は案内メール本文だけでなく xlsx 内にもあり得る
  // （例: テンプレのメモ欄に「件名を『…』としてください」等）。第2引数を渡した場合、
  // 両方がユーザーメッセージに含まれることを確認する。
  it('includes both the mail body and the sheet excerpt in the user message when sheetsText is given', async () => {
    messagesCreateMock.mockResolvedValue(
      buildToolUseResponse('record_organizer_instructions', {
        subject: null,
        attachmentFilename: null,
        toEmail: null,
      }),
    )

    await extractOrganizerInstructions('案内メール本文の内容', 'B11: 参加級')

    const args = messagesCreateMock.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>
    }
    const userContent = args.messages[0]!.content
    expect(userContent).toContain('案内メール本文の内容')
    expect(userContent).toContain('B11: 参加級')
    expect(userContent).toContain('【案内メール本文】')
    expect(userContent).toContain('【申込書シート抜粋】')
  })
})

describe('sheetsToPromptText', () => {
  // standard.xlsx: 52行・明細ヘッダ行=11（上限60行未満のため全文出力・切り詰め無し）。
  it('renders cell-address-prefixed lines for every non-empty cell', async () => {
    const wb = await loadFixture('standard.xlsx')

    const text = sheetsToPromptText(wb)

    expect(text).toContain('=== シート: Sheet1 ===')
    expect(text).toMatch(/[A-Z]+11: /) // 明細ヘッダ行のセルがアドレス付きで出る
    // ヘッダ欄の記入先(F3:G3等)は中身が空で非空セル走査には出ないため、結合セル範囲を
    // 別行で明示する(cell-map.ts のコメントにある標準型の F3:G3〜F8:G8 結合入力欄)。
    expect(text).toContain('[結合セル]')
    expect(text).toContain('F3:G3')
    expect(text).not.toContain('のみ表示')
  })

  // multisheet-ambiguous.xlsx: 各シート89行（上限60行を超えるため切り詰められる）。
  it('truncates rows beyond the per-sheet limit and notes the truncation in the text', async () => {
    const wb = await loadFixture('multisheet-ambiguous.xlsx')

    const text = sheetsToPromptText(wb)

    expect(text).toContain('先頭60行のみ表示')
  })
})
