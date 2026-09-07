import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { loadLlmConfig } from '@kagetra/mail-worker/config'

/**
 * travel-report: 開催地（経路表記用の地名）の AI 推定（requirements R7・AC-19）。
 *
 * 会場名（`events.location`）と大会名から 都道府県・市区町村・**経路表記名**
 * （例「八戸」）を1回だけ推定する。経路表記名は S8 の既定行「札幌→{ここ}」に入る短い
 * 地名で、市区町村から「市」「区」「町」「村」を落としたものが基本。
 *
 * ★**失敗は例外ではなく `null`。** 設定エラー・API エラー・tool_use 欠落・スキーマ検証
 * 失敗はすべてここで握りつぶす（`entry-form/ai-extract.ts` と同じ設計）。推定できなくても
 * 空欄で保存して手入力を促すだけで、機能は止まらない（R7）。
 *
 * ★呼び出し側の責務: **RSC のレンダー中に await しない。**
 * - 「経路入力を開始」Action では同期実行してよい
 * - 自動で開いた（確定名簿あり）場合は、S5 のロードで
 *   `UPDATE … SET destination_attempted_at = now() WHERE destination_attempted_at IS NULL`
 *   を claim にして Next の `after()` の中で実行する（多重呼び出し防止）
 * - 書き込みは `destination_source IS NULL` のときだけ（並行する手入力を潰さない）
 */

/** 軽量モデル（`entry-form/ai-extract.ts` と同じ）。テストからも参照する。 */
export const DESTINATION_AI_MODEL_ID = 'claude-haiku-4-5-20251001'

const MAX_TOKENS = 256

const TOOL_NAME = 'report_destination'

const SYSTEM_PROMPT = `あなたは日本の競技かるた大会の会場情報から開催地を特定する担当です。
与えられた会場名と大会名から、その会場が所在する都道府県・市区町村と、
移動経路の表記に使う短い地名を1つ決めてください。

- 経路表記名は市区町村名から「市」「区」「町」「村」を除いた短い形にします
  （例: 「八戸市」→「八戸」、「十和田市」→「十和田」、「千代田区」→「千代田」）
- 政令市の区は市名を使います（例: 「札幌市中央区」→「札幌」）
- 会場名だけでは所在地が判断できない場合は、推測せずツールを呼ばずに「わからない」と答えてください
- 日本語で答えてください`

const responseSchema = z.object({
  prefecture: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(20),
})

export type EstimatedDestination = z.infer<typeof responseSchema>

export interface EstimateDestinationInput {
  /** `events.location`（会場名）。空なら推定しない。 */
  location: string | null
  /** 大会名（`formal_name` があればそれ、無ければ `title`）。 */
  title: string
}

/**
 * 会場名と大会名から開催地を推定する。推定できなければ `null`。
 * **例外を外へ投げない。**
 */
export async function estimateDestination(
  input: EstimateDestinationInput,
): Promise<EstimatedDestination | null> {
  const location = input.location?.trim() ?? ''
  // 会場が空なら AI を呼ぶまでもない（R7: 会場が空のときは空欄で保存する）。
  if (location.length === 0) return null

  let client: Anthropic
  try {
    const { anthropicApiKey } = loadLlmConfig()
    client = new Anthropic({ apiKey: anthropicApiKey, maxRetries: 2 })
  } catch (err) {
    console.error('[travel-report/destination-ai] LLM 設定の読み込みに失敗しました', err)
    return null
  }

  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: DESTINATION_AI_MODEL_ID,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: TOOL_NAME,
          description: '会場の所在地と経路表記名を報告する',
          input_schema: {
            type: 'object',
            properties: {
              prefecture: { type: 'string', description: '都道府県名（例: 青森県）' },
              city: { type: 'string', description: '市区町村名（例: 八戸市）' },
              label: { type: 'string', description: '経路表記に使う短い地名（例: 八戸）' },
            },
            required: ['prefecture', 'city', 'label'],
          },
        },
      ],
      // 「わからない」を表現できるよう **forced tool use にしない**。会場名から所在地が
      // 判断できないときにモデルが無理やり県名を捏造するのを避ける（R7: 推定失敗は空欄）。
      tool_choice: { type: 'auto' },
      messages: [
        {
          role: 'user',
          content: `大会名: ${input.title}\n会場: ${location}`,
        },
      ],
    })
  } catch (err) {
    console.error('[travel-report/destination-ai] Anthropic API 呼び出しに失敗しました', err)
    return null
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
  )
  // tool_use が無い＝モデルが「わからない」と答えた（または応答が壊れている）。
  if (!toolUse) return null

  // `toolUse.input` は SDK がパース済みのオブジェクト（JSON.parse し直さない）。
  const parsed = responseSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    console.error('[travel-report/destination-ai] 応答が想定の形ではありません', parsed.error)
    return null
  }
  return parsed.data
}
