import type { ExtractionPayload } from '@kagetra/mail-worker/classify/schema'
import { REGIONAL_ELIGIBILITY_GRADES } from '@kagetra/mail-worker/classify/regional'
import { Card } from '@/components/ui'

// mail-ai-extract-refinements §3.2.12(e) / AC-76: 地域制限の小表見出し。
// `REGIONAL_ELIGIBILITY_GRADES` から組むことで、対象級を広げたときに追随する。
const REGIONAL_ELIGIBILITY_HEADING = `地域制限（${REGIONAL_ELIGIBILITY_GRADES.join('・')} 級）`

export interface ExtractedPayloadViewProps {
  payload: ExtractionPayload | null
  aiModel: string
  promptVersion: string
  aiCostUsd: string | null
}

// EventUnit のフィールド名 → 表示ラベル。`unit_key` は内部配線なので出さない。
// 3.0.0 で消えたフィールド（`fee_jpy` 等）のラベルも**残す** —— 2.x のドラフトを
// 開いたときに値だけ出てラベルが欠ける事故を避けるため（AC-34）。
const EXTRACTED_LABELS: Record<string, string> = {
  event_date: '開催日',
  eligible_grades: '対象級',
  formal_name: '正式名称',
  venue: '会場',
  fee_jpy: '参加費 (円)',
  payment_deadline: '支払締切',
  payment_deadline_kind: '支払締切の状態',
  capacity_total: '全体定員',
  payment_info_text: '支払情報',
  payment_method: '支払方法',
  entry_method: '申込方法',
  organizer_text: '主催',
  entry_deadline: '申込締切',
  kind: '種別',
  capacity_a: 'A 級定員',
  capacity_b: 'B 級定員',
  capacity_c: 'C 級定員',
  capacity_d: 'D 級定員',
  capacity_e: 'E 級定員',
  official: '公認大会',
  // mail-ai-extract-refinements §3.2.12(e) / AC-76: ループからは除外するが、
  // ラベル表と実データのキーを揃えておく。
  regional_eligibility: REGIONAL_ELIGIBILITY_HEADING,
  // legacy-only field (old single `extracted` payload):
  title: 'タイトル',
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

// mail-ai-extract-refinements §3.2.12(e) / AC-76: 保存済み payload には Zod を
// 再実行しない方針のため、3.0.x 以前のドラフトは `regional_eligibility` を
// 持たない。実データから防御的に読み、`String()` で `[object Object]` を
// 出さないよう各フィールドを個別に拾う。
function renderRegionalEligibility(unit: Record<string, unknown>) {
  const regional = unit.regional_eligibility
  if (!Array.isArray(regional) || regional.length === 0) return null

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-t border-border-soft">
          <th className="py-1.5 pr-3 text-left font-medium text-ink-meta">
            級
          </th>
          <th className="py-1.5 pr-3 text-left font-medium text-ink-meta">
            判定
          </th>
          <th className="py-1.5 pr-3 text-left font-medium text-ink-meta">
            根拠の一文
          </th>
          <th className="py-1.5 text-left font-medium text-ink-meta">
            照合
          </th>
        </tr>
      </thead>
      <tbody>
        {regional.map((entry, i) => {
          const item = entry as {
            grade?: unknown
            verdict?: unknown
            evidence_quote?: unknown
            evidence_verified?: unknown
          }
          const grade = typeof item.grade === 'string' ? item.grade : '—'
          const verdict = typeof item.verdict === 'string' ? item.verdict : '—'
          const evidenceQuote =
            typeof item.evidence_quote === 'string' ? item.evidence_quote : '—'
          const verified =
            item.evidence_verified === true
              ? '照合済み'
              : item.evidence_verified === false
                ? '未照合'
                : '—'
          return (
            <tr key={i} className="border-t border-border-soft">
              <td className="py-1.5 pr-3 align-top text-ink">{grade}級</td>
              <td className="py-1.5 pr-3 align-top text-ink">{verdict}</td>
              <td className="py-1.5 pr-3 align-top text-ink break-words whitespace-pre-wrap">
                {evidenceQuote}
              </td>
              <td className="py-1.5 align-top text-ink">{verified}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
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

  // 3.0.0 payloads carry `events[]`; pre-2.0.0 payloads carry a single
  // `extracted` object. Normalize to a list of {key,value} record tables so
  // both render through one loop. Rows are rendered generically from the
  // payload's own keys, so 2.x drafts (with `fee_jpy`, `short_name_stem` …)
  // still display everything they stored — AC-34 後方互換。
  const legacy = (payload as { extracted?: Record<string, unknown> }).extracted
  const units: Record<string, unknown>[] =
    Array.isArray(payload.events) && payload.events.length > 0
      ? (payload.events as unknown as Record<string, unknown>[])
      : legacy != null
        ? [legacy]
        : []
  // `short_name_stem` left the schema (通称は承認フォームで人が入力する)。過去の
  // 2.x ドラフトは値を持っているので、型ではなく実データから拾って表示する。
  const stemRaw = (payload as { short_name_stem?: unknown }).short_name_stem
  const stem = typeof stemRaw === 'string' ? stemRaw : null
  const extras = payload.extras ?? null
  const costLabel = aiCostUsd ? `$${aiCostUsd}` : '—'

  return (
    <Card>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          AI 抽出結果
        </summary>

        <div className="mt-3 space-y-3">
          <div className="text-xs text-ink-meta">
            モデル: {aiModel} / プロンプト: {promptVersion} / コスト: {costLabel}
          </div>

          {stem != null && (
            <div className="text-xs text-ink-2">
              <span className="font-medium text-ink-meta">大会名 stem:</span>{' '}
              {stem}
            </div>
          )}

          {units.map((unit, idx) => {
            // mail-ai-extract-refinements §3.2.12(e) / AC-76: 汎用ループから外した
            // `regional_eligibility` を、単位の表の直後に専用の小表で描く。
            const regionalTable = renderRegionalEligibility(unit)
            return (
              <div key={(unit.unit_key as string) ?? idx} className="space-y-1">
                {units.length > 1 && (
                  <div className="text-xs font-semibold text-ink-meta">
                    イベント {idx + 1}
                  </div>
                )}
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(unit)
                      .filter(
                        ([key]) => key !== 'unit_key' && key !== 'regional_eligibility',
                      )
                      .map(([key, value]) => (
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
                {regionalTable && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-ink-meta">
                      {REGIONAL_ELIGIBILITY_HEADING}
                    </div>
                    {regionalTable}
                  </div>
                )}
              </div>
            )
          })}

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
