import { Fragment } from 'react'
import Link from 'next/link'
import { formatFlowDate } from '@/lib/event-date'
import type { GroupSiblingEvent } from '@/lib/entry-groups'

export interface GroupDayLinksProps {
  /** `listGroupSiblings` の結果（開催日昇順・自分を含む）。 */
  siblings: readonly GroupSiblingEvent[]
  currentEventId: number
}

/**
 * entry-groups タスク4 (AC-16): 「同じ申込グループ」の日リンク（requirements §3.1）。
 * 全ロールに表示し相互遷移可能。シングルトングループ（`siblings.length <= 1`）
 * では何も描画しない。配置は sticky ヘッダー（`EventDetailHeader`）の**外**
 * （design-spec の明示指定 — sticky ラッパーを分割・追加すると崩れる）。
 * 現在見ている日はリンクにせず現在地として示す。
 */
export function GroupDayLinks({ siblings, currentEventId }: GroupDayLinksProps) {
  if (siblings.length <= 1) return null

  return (
    <nav
      aria-label="同じ申込グループの日程"
      className="flex flex-wrap items-baseline gap-x-1 gap-y-1 pt-[10px] text-xs text-ink-meta"
    >
      {siblings.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <em className="not-italic text-ink-meta">・</em>}
          {s.id === currentEventId ? (
            <span className="font-semibold text-ink">
              {s.title} {formatFlowDate(s.eventDate)}
            </span>
          ) : (
            <Link href={`/events/${s.id}`} className="text-brand hover:underline">
              {s.title} {formatFlowDate(s.eventDate)}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
