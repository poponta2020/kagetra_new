import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))
vi.mock('@kagetra/mail-worker/config', () => ({
  loadLlmConfig: () => ({ anthropicApiKey: 'test-key' }),
}))

const { DESTINATION_AI_MODEL_ID, estimateDestination } = await import('./destination-ai')

const toolUse = (input: unknown) => ({
  content: [{ type: 'tool_use', name: 'report_destination', input }],
})

describe('開催地の AI 推定（R7・AC-19）', () => {
  beforeEach(() => {
    createMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('会場名と大会名から都道府県・市区町村・経路表記名を返す', async () => {
    createMock.mockResolvedValue(
      toolUse({ prefecture: '青森県', city: '八戸市', label: '八戸' }),
    )
    const result = await estimateDestination({
      location: '八戸市体育館',
      title: '第3回 全国競技かるた八戸大会',
    })
    expect(result).toEqual({ prefecture: '青森県', city: '八戸市', label: '八戸' })
    expect(createMock).toHaveBeenCalledTimes(1)
    const args = createMock.mock.calls[0]![0] as { model: string; messages: { content: string }[] }
    expect(args.model).toBe(DESTINATION_AI_MODEL_ID)
    expect(args.messages[0]!.content).toContain('八戸市体育館')
  })

  it('会場が空なら AI を呼ばずに null（R7）', async () => {
    expect(await estimateDestination({ location: null, title: 'X大会' })).toBeNull()
    expect(await estimateDestination({ location: '   ', title: 'X大会' })).toBeNull()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('API が失敗しても例外を投げず null を返す（機能が止まらない）', async () => {
    createMock.mockRejectedValue(new Error('boom'))
    expect(await estimateDestination({ location: '会場', title: 'X大会' })).toBeNull()
  })

  it('モデルが tool_use を返さない（＝わからない）と null', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'わかりません' }] })
    expect(await estimateDestination({ location: '謎の会場', title: 'X大会' })).toBeNull()
  })

  it('応答が想定の形でなければ null', async () => {
    createMock.mockResolvedValue(toolUse({ prefecture: '青森県' }))
    expect(await estimateDestination({ location: '会場', title: 'X大会' })).toBeNull()
    createMock.mockResolvedValue(toolUse({ prefecture: '', city: '', label: '' }))
    expect(await estimateDestination({ location: '会場', title: 'X大会' })).toBeNull()
  })

  it('forced tool use にしない（「わからない」を表現できるようにするため）', async () => {
    createMock.mockResolvedValue(toolUse({ prefecture: '青森県', city: '八戸市', label: '八戸' }))
    await estimateDestination({ location: '会場', title: 'X大会' })
    const args = createMock.mock.calls[0]![0] as { tool_choice: { type: string } }
    expect(args.tool_choice).toEqual({ type: 'auto' })
  })
})
