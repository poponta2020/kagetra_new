import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Hoisted mock so the `import Anthropic from '@anthropic-ai/sdk'` at the top of
 * `anthropic.ts` is intercepted at module load. `vi.hoisted` is the canonical
 * pattern for sharing a spy with the factory while keeping the factory itself
 * hoist-safe — vitest hoists `vi.mock` calls above all imports and any
 * variable declarations (which is why a plain `const messagesCreate = vi.fn()`
 * outside the factory would TDZ at hoist time).
 */
const { messagesCreate } = vi.hoisted(() => ({ messagesCreate: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class FakeAnthropic {
      messages = { create: messagesCreate }
      constructor(_opts: unknown) {
        // capture nothing — the call shape under test is on `messages.create`,
        // not the constructor itself.
      }
    },
  }
})

import {
  AnthropicSonnet46Extractor,
  LLMNoToolUseError,
} from '../../src/classify/llm/anthropic.js'
import type { LLMExtractionInput } from '../../src/classify/llm/types.js'

const VALID_PAYLOAD = {
  is_tournament_announcement: true,
  confidence: 0.9,
  reason: 'unit-test fixture',
  is_correction: false,
  references_subject: null,
  extracted: {
    title: 'Test Tournament',
    formal_name: null,
    event_date: '2026-05-30',
    venue: 'Tokyo',
    fee_jpy: 5000,
    payment_deadline: null,
    payment_info_text: null,
    payment_method: null,
    entry_method: null,
    organizer_text: null,
    entry_deadline: null,
    eligible_grades: null,
    kind: null,
    capacity_total: null,
    capacity_a: null,
    capacity_b: null,
    capacity_c: null,
    capacity_d: null,
    capacity_e: null,
    official: null,
  },
}

function buildInput(
  overrides: Partial<LLMExtractionInput> = {},
): LLMExtractionInput {
  return {
    systemPrompt: 'system prompt body',
    promptVersion: '1.0.0',
    emailMeta: {
      subject: 'unit test subject',
      from: 'org@example.com',
      date: new Date('2026-04-15T09:00:00+09:00'),
    },
    emailBodyText: 'body text',
    attachments: [],
    ...overrides,
  }
}

function buildSuccessResponse(input: unknown = VALID_PAYLOAD) {
  return {
    content: [
      {
        type: 'tool_use' as const,
        name: 'record_extraction',
        id: 'toolu_test',
        input,
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
}

describe('AnthropicSonnet46Extractor', () => {
  beforeEach(() => {
    messagesCreate.mockReset()
  })

  it('uses model id "claude-sonnet-4-6" (no date suffix)', async () => {
    messagesCreate.mockResolvedValue(buildSuccessResponse())
    const llm = new AnthropicSonnet46Extractor({ apiKey: 'test' })
    await llm.extract(buildInput())

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    )
  })

  it('forces tool_choice to record_extraction', async () => {
    messagesCreate.mockResolvedValue(buildSuccessResponse())
    const llm = new AnthropicSonnet46Extractor({ apiKey: 'test' })
    await llm.extract(buildInput())

    const args = messagesCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(args.tool_choice).toEqual({
      type: 'tool',
      name: 'record_extraction',
    })
  })

  it('attaches cache_control { type: "ephemeral", ttl: "1h" } to the system block', async () => {
    messagesCreate.mockResolvedValue(buildSuccessResponse())
    const llm = new AnthropicSonnet46Extractor({ apiKey: 'test' })
    await llm.extract(buildInput())

    const args = messagesCreate.mock.calls[0]![0] as {
      system: Array<{
        type: string
        text: string
        cache_control?: { type: string; ttl?: string }
      }>
    }
    expect(args.system).toHaveLength(1)
    expect(args.system[0]!.cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    })
  })

  it('passes a populated JSON Schema (type=object, required+properties) as input_schema', async () => {
    // Locks in the Zod-v4 → JSON Schema conversion. The earlier
    // `zod-to-json-schema` (v3) library returned `{ "$schema": "..." }` for
    // a Zod-v4 schema, so the live API was effectively called with no
    // schema constraints — review r1 Blocker. Any future swap of the
    // conversion library must keep this assertion green.
    messagesCreate.mockResolvedValue(buildSuccessResponse())
    const llm = new AnthropicSonnet46Extractor({ apiKey: 'test' })
    await llm.extract(buildInput())

    const args = messagesCreate.mock.calls[0]![0] as {
      tools: Array<{
        name: string
        input_schema: {
          type?: string
          properties?: Record<string, unknown>
          required?: string[]
          $schema?: string
        }
      }>
    }
    const schema = args.tools[0]!.input_schema
    expect(schema.type).toBe('object')
    expect(schema.properties).toBeDefined()
    expect(Object.keys(schema.properties!)).toEqual(
      expect.arrayContaining([
        'is_tournament_announcement',
        'confidence',
        'reason',
        'extracted',
      ]),
    )
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'is_tournament_announcement',
        'confidence',
        'reason',
        'extracted',
      ]),
    )
    // `$schema` is metadata Anthropic warns on; we strip it before sending.
    expect(schema.$schema).toBeUndefined()
  })

  it('places PDF document blocks before the text block in user content', async () => {
    messagesCreate.mockResolvedValue(buildSuccessResponse())
    const llm = new AnthropicSonnet46Extractor({ apiKey: 'test' })
    await llm.extract(
      buildInput({
        attachments: [
          { kind: 'pdf', filename: 'a.pdf', base64: 'AAAA' },
          { kind: 'pdf', filename: 'b.pdf', base64: 'BBBB' },
        ],
      }),
    )

    const args = messagesCreate.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: Array<{ type: string }> }>
    }
    const content = args.messages[0]!.content
    // Two PDFs, then exactly one text block at the end.
    expect(content).toHaveLength(3)
    expect(content[0]!.type).toBe('document')
    expect(content[1]!.type).toBe('document')
    expect(content[2]!.type).toBe('text')
  })

  it('throws LLMNoToolUseError when the response has no tool_use block', async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'I refuse to call the tool' }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    })
    const llm = new AnthropicSonnet46Extractor({ apiKey: 'test' })
    await expect(llm.extract(buildInput())).rejects.toBeInstanceOf(
      LLMNoToolUseError,
    )
  })

  it('rejects (Zod) when the tool input fails schema validation', async () => {
    messagesCreate.mockResolvedValue(
      buildSuccessResponse({
        // Missing required field `confidence` and bad type on `extracted`.
        is_tournament_announcement: true,
        reason: 'oops',
        extracted: 'this should be an object',
      }),
    )
    const llm = new AnthropicSonnet46Extractor({ apiKey: 'test' })
    await expect(llm.extract(buildInput())).rejects.toThrow()
  })

  it('reports cost + token usage on the result and includes prompt version', async () => {
    messagesCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use' as const,
          name: 'record_extraction',
          id: 'toolu_cost',
          input: VALID_PAYLOAD,
        },
      ],
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    })
    const llm = new AnthropicSonnet46Extractor({ apiKey: 'test' })
    const result = await llm.extract(buildInput())

    expect(result.tokensInput).toBe(1000)
    expect(result.tokensOutput).toBe(500)
    expect(result.model).toBe('claude-sonnet-4-6')
    expect(result.promptVersion).toBe('1.0.0')
    expect(result.costUsd).toBeGreaterThan(0)
  })
})
