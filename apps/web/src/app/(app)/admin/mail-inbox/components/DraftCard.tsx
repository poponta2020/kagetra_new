import { Pill } from '@/components/ui'
import { formatEventDate } from '@/lib/event-date'

export interface DraftCardProps {
  draft: {
    // mail-inbox-mailer: 'ai_processing' は AI 抽出ジョブ起動〜完了の間だけ
    // 立つ中間状態。一覧 (page.tsx) で DraftCard を表示する場面ではほぼ
    // 出現しないが、ジョブ実行中に一覧を開けば見える可能性があるため型に含める。
    // 表示は StatusPill 側で「AI 抽出中」として扱う。
    status:
      | 'pending_review'
      | 'approved'
      | 'rejected'
      | 'ai_failed'
      | 'superseded'
      | 'ai_processing'
    isCorrection: boolean
    referencesSubject: string | null
    extractedPayload: unknown // jsonb — narrow defensively below
  }
}

/**
 * mail-ai-extract-refinements タスク10 (§3.2.8 / AC-18 / AC-33): カード表示名は
 * 各単位の `formal_name`。`formal_name` が無い単位は「開催日＋級」を組み立てて
 * 代替する。開催日・級のどちらも無ければ「（名称不明）」で空文字を避ける。
 */
function unitDisplayName(unit: {
  formal_name?: string | null
  event_date?: string | null
  eligible_grades?: ('A' | 'B' | 'C' | 'D' | 'E')[] | null
}): string {
  if (unit.formal_name) return unit.formal_name
  const datePart = unit.event_date ? formatEventDate(unit.event_date) : null
  const gradePart =
    unit.eligible_grades && unit.eligible_grades.length > 0
      ? `${unit.eligible_grades.join('・')}級`
      : null
  if (datePart && gradePart) return `${datePart} ${gradePart}`
  if (datePart) return datePart
  if (gradePart) return gradePart
  return '（名称不明）'
}

/**
 * One-line summary of a tournament_drafts row, shown inline under each mail
 * card on /admin/mail-inbox. Detail view lives in /admin/mail-inbox/[id]
 * which is built by PR4.
 *
 * Layout mirrors AttachmentList: small row of inline pills + a single line
 * of extracted text underneath. The component renders no extracted text
 * row when the LLM extracted no title (ai_failed or empty payload) — pills
 * are always shown so the operator knows the draft exists.
 */
export function DraftCard({ draft }: DraftCardProps) {
  // Defensive narrowing: extracted_payload jsonb is `unknown` until we trust
  // the row. Read top-level fields without re-running the Zod schema (would
  // pull mail-worker's Zod into the web bundle); the admin UI already trusts
  // the worker's output since the row only exists if extraction completed.
  //
  // mail-ai-extract-refinements タスク10: `short_name_stem` + `composeTitle` は
  // 廃止（stem を出す AI 側フィールドが無くなったため）。各単位の `formal_name`
  // をそのままカード表示名にし、無い単位は「開催日＋級」で代替する。2.x の
  // ペイロード（`events[]` は無いが `extracted.title` を持つ最古形式）は従来
  // どおりのフォールバックを維持する。
  const payload = (draft.extractedPayload ?? {}) as {
    events?: {
      event_date?: string | null
      eligible_grades?: ('A' | 'B' | 'C' | 'D' | 'E')[] | null
      formal_name?: string | null
    }[]
    extracted?: { title?: string | null; event_date?: string | null }
  }

  let title: string | null = null
  let eventDate: string | null = null
  if (Array.isArray(payload.events) && payload.events.length > 0) {
    const names = payload.events.map((u) => unitDisplayName(u))
    title =
      names.length > 1
        ? `${names.join(', ')}（${names.length}件）`
        : (names[0] ?? null)
    // Single-unit drafts show the date; multi-date splits omit it (each unit
    // has its own date, shown on the detail page).
    eventDate =
      payload.events.length === 1
        ? (payload.events[0]?.event_date ?? null)
        : null
  } else {
    title = payload?.extracted?.title ?? null
    eventDate = payload?.extracted?.event_date ?? null
  }

  return (
    <div className="mt-2 flex flex-col gap-1 rounded-[6px] border border-border-soft bg-surface-alt p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill status={draft.status} />
        {draft.isCorrection && (
          <Pill tone="warn" size="sm">
            ⚠{' '}
            {draft.referencesSubject
              ? `${draft.referencesSubject} の訂正版?`
              : '訂正版?'}
          </Pill>
        )}
      </div>
      {(title || eventDate) && (
        <div className="text-ink-2">
          {title && <span className="font-medium">{title}</span>}
          {title && eventDate && (
            <span className="text-ink-muted"> · </span>
          )}
          {eventDate && <span>{eventDate}</span>}
        </div>
      )}
    </div>
  )
}

function StatusPill({
  status,
}: {
  status: DraftCardProps['draft']['status']
}) {
  switch (status) {
    case 'pending_review':
      return (
        <Pill tone="info" size="sm">
          承認待ち
        </Pill>
      )
    case 'approved':
      return (
        <Pill tone="success" size="sm">
          承認済
        </Pill>
      )
    case 'rejected':
      return (
        <Pill tone="neutral" size="sm">
          却下
        </Pill>
      )
    case 'ai_failed':
      return (
        <Pill tone="danger" size="sm">
          AI 失敗
        </Pill>
      )
    case 'superseded':
      return (
        <Pill tone="neutral" size="sm">
          差替済
        </Pill>
      )
    case 'ai_processing':
      // mail-inbox-mailer: AI 抽出ジョブ起動〜完了の中間状態。
      // 詳細画面側 (タスク4) で本格的な進捗カード（ExtractionInProgressCard）
      // に切り替える。一覧では汎用ピルで状態だけ伝える。
      return (
        <Pill tone="info" size="sm">
          AI 抽出中
        </Pill>
      )
  }
}
