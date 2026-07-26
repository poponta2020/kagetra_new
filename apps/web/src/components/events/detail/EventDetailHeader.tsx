import { formatEventDate } from '@/lib/event-date'
import type { EntryFlowStep } from '@/lib/events/entry-flow'
import { EntryFlow } from './EntryFlow'
import { LinkActionLink } from './LinkAction'

/**
 * 大会詳細の固定ヘッダー。日付+大会名 / 会場 / 申込フローを **1つのラッパーで**
 * sticky にする。design-spec §3 の明示指定 —「3要素を個別に sticky にすると
 * オフセット計算が壊れやすい」ため、ここを分割してはならない。
 *
 * 余白の前提: ページ根要素が `p-4`（nav-settings-hub 由来。`<main>` には padding を
 * 足さない = AC-23）を持つので、左右は `-mx-4` で打ち消して全幅の背景にし、上は
 * `-mt-4` で根要素の上 padding を吸収してから自前の `pt-[14px]` を持つ。
 * モックの `.page` は `padding:0 16px`（上下 padding なし）前提なので、この
 * 打ち消しが実スタックとの差分を埋める。
 */
export interface EventDetailHeaderProps {
  eventId: number
  title: string
  /** `YYYY-MM-DD`。`M/D(曜)` に整形して大会名の脇へ置く。 */
  eventDate: string
  location: string | null
  steps: readonly EntryFlowStep[]
  /** 管理者・副管理者のみ「編集」リンクを出す。 */
  canEdit: boolean
}

export function EventDetailHeader({
  eventId,
  title,
  eventDate,
  location,
  steps,
  canEdit,
}: EventDetailHeaderProps) {
  return (
    <div className="sticky top-0 z-[3] -mx-4 -mt-4 border-b border-border-soft bg-canvas px-4 pt-[14px]">
      <h1 className="flex min-w-0 items-baseline gap-x-[10px] gap-y-[2px] font-display text-[28px] font-bold leading-tight text-ink">
        <span className="flex-none whitespace-nowrap text-[19px] tabular-nums text-ink-2">
          {formatEventDate(eventDate)}
        </span>
        {title}
        {canEdit && (
          <LinkActionLink
            href={`/events/${eventId}/edit`}
            className="ml-auto flex-none font-sans text-[13px] font-normal"
          >
            編集
          </LinkActionLink>
        )}
      </h1>
      {location ? (
        <div className="mt-[3px] pb-[10px] text-xs text-ink-meta">{location}</div>
      ) : null}
      {/* 会場行が無いときは、その分（10px）をフロー側の上余白へ寄せて律動を保つ。 */}
      <EntryFlow steps={steps} className={location ? undefined : 'pt-[21px]'} />
    </div>
  )
}
