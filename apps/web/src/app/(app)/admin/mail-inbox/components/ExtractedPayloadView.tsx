import type { ExtractionPayload } from '@kagetra/mail-worker/classify/schema'
import { Card } from '@/components/ui'

export interface ExtractedPayloadViewProps {
  payload: ExtractionPayload | null
  confidence: string | null
  aiModel: string
  promptVersion: string
  aiCostUsd: string | null
}

const EXTRACTED_LABELS: Record<string, string> = {
  title: 'タイトル',
  formal_name: '正式名称',
  event_date: '開催日',
  venue: '会場',
  fee_jpy: '参加費 (円)',
  payment_deadline: '支払締切',
  payment_info_text: '支払情報',
  payment_method: '支払方法',
  entry_method: '申込方法',
  organizer_text: '主催',
  entry_deadline: '申込締切',
  eligible_grades: '対象級',
  kind: '種別',
  capacity_total: '定員',
  capacity_a: 'A 級定員',
  capacity_b: 'B 級定員',
  capacity_c: 'C 級定員',
  capacity_d: 'D 級定員',
  capacity_e: 'E 級定員',
  official: '公認大会',
}

const EXTRAS_LABELS: Record<string, string> = {
  fee_raw_text: '参加費 (原文)',
  eligible_grades_raw: '対象級 (原文)',
  target_grades_raw: '推奨級 (原文)',
  local_rules_summary: 'ローカルルール',
  timetable_summary: 'タイムテーブル',
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ')
  return String(v)
}

/**
 * Read-only collapsible dump of the AI extraction result. Sits below the
 * approval form on the draft detail page so an operator can sanity-check
 * what the LLM saw vs what they're about to submit. Collapsed by default
 * via plain `<details>` to keep the page short.
 *
 * The component never re-runs Zod parsing on `payload`; the worker already
 * validated it on insert, and pulling Zod into the web bundle for a
 * read-only view would be wasteful (mirrors {@link DraftCard} comment).
 */
export function ExtractedPayloadView({
  payload,
  confidence,
  aiModel,
  promptVersion,
  aiCostUsd,
}: ExtractedPayloadViewProps) {
  if (payload === null) {
    return (
      <Card>
        <div className="text-sm text-ink-2">
          AI 抽出に失敗しました（再抽出してください）
        </div>
      </Card>
    )
  }

  const extracted = payload.extracted
  const extras = payload.extras ?? null
  const confidenceLabel = confidence ?? '—'
  const costLabel = aiCostUsd ? `$${aiCostUsd}` : '—'

  return (
    <Card>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          AI 抽出結果
        </summary>

        <div className="mt-3 space-y-3">
          <div className="text-xs text-ink-meta">
            モデル: {aiModel} / プロンプト: {promptVersion} / 信頼度:{' '}
            {confidenceLabel} / コスト: {costLabel}
          </div>

          <table className="w-full text-xs">
            <tbody>
              {Object.entries(extracted).map(([key, value]) => (
                <tr key={key} className="border-t border-border-soft">
                  <th className="w-1/3 py-1.5 pr-3 text-left font-medium text-ink-meta align-top">
                    {EXTRACTED_LABELS[key] ?? key}
                  </th>
                  <td className="py-1.5 text-ink align-top break-words">
                    {formatValue(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {extras && Object.values(extras).some((v) => v != null) && (
            <div className="border-t border-border-soft pt-3">
              <div className="mb-1.5 text-xs font-semibold text-ink-meta">
                補足情報
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(extras)
                    .filter(([, v]) => v != null)
                    .map(([key, value]) => (
                      <tr key={key} className="border-t border-border-soft">
                        <th className="w-1/3 py-1.5 pr-3 text-left font-medium text-ink-meta align-top">
                          {EXTRAS_LABELS[key] ?? key}
                        </th>
                        <td className="py-1.5 text-ink align-top break-words whitespace-pre-line">
                          {formatValue(value)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {(payload.is_correction || payload.references_subject) && (
            <div className="border-t border-border-soft pt-3 text-xs text-ink-2">
              <div>
                <span className="font-medium text-ink-meta">訂正版判定:</span>{' '}
                {payload.is_correction ? 'はい' : 'いいえ'}
              </div>
              {payload.references_subject && (
                <div>
                  <span className="font-medium text-ink-meta">
                    参照件名:
                  </span>{' '}
                  {payload.references_subject}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-border-soft pt-3 text-xs text-ink-2">
            <div>
              <span className="font-medium text-ink-meta">判定理由:</span>{' '}
              {payload.reason}
            </div>
          </div>
        </div>
      </details>
    </Card>
  )
}
