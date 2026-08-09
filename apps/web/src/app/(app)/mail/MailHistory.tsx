import Link from 'next/link'
import type { HistoryRow, HistorySegment } from '@/lib/mail-history'
import { formatHistoryDate } from '@/lib/member-mail/format'

/**
 * member-mail-search タスク5: 詳細画面「処理の記録」— 縦レール＋ドットのタイムライン
 * （requirements.md §3.4・design-spec.md §3/§4 の `.tl` `.tlrow` `.tlrail` `.tldot`
 * `.tlline` `.tlbody` `.tldate` `.tltext` `.tlnote`）。
 *
 * `rows` は `loadHistories()` が日時昇順で返す前提（並べ替えはここでは行わない）。
 * `at === null`（H5）はドットを砂色に落とし日付見出しを出さない（AC-18）。
 * 大会名は `/events/[id]` への実リンク（一覧カードの `↳` 行は非リンクのテキストだが、
 * 詳細のこの行は design-spec §8 忠実度チェックリストどおりクリック可能にする）。
 */

export interface MailHistoryProps {
  rows: readonly HistoryRow[]
}

function renderSegments(segments: readonly HistorySegment[]) {
  return segments.map((seg, i) =>
    seg.type === 'eventLink' ? (
      <Link
        key={i}
        href={`/events/${seg.eventId}`}
        className="font-semibold text-brand-fg underline underline-offset-2"
      >
        {seg.label}
      </Link>
    ) : (
      <span key={i}>{seg.value}</span>
    ),
  )
}

export function MailHistory({ rows }: MailHistoryProps) {
  return (
    <div data-testid="mail-history" className="flex flex-col">
      {rows.map((row, index) => {
        const isLast = index === rows.length - 1
        return (
          <div key={index} className="flex gap-[9px]">
            <div className="flex w-[13px] shrink-0 flex-col items-center">
              <span
                className={`mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full ${
                  row.at === null ? 'bg-border-strong' : 'bg-brand'
                }`}
              />
              {!isLast && <span className="min-h-[10px] w-px flex-1 bg-border" />}
            </div>
            <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-[13px]'}`}>
              {row.at !== null && (
                <div className="text-[10px] font-semibold tracking-[0.02em] text-ink-meta">
                  {formatHistoryDate(row.at)}
                </div>
              )}
              <div className="mt-px text-xs leading-[1.55] text-ink">
                {renderSegments(row.segments)}
                {row.detail && (
                  <>
                    <br />
                    {row.detail}
                  </>
                )}
              </div>
              {row.note && (
                <div className="mt-0.5 text-[10px] text-ink-muted">{row.note}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
