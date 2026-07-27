import Link from 'next/link'
import { HomeTimeline } from './HomeTimeline'
// DESIGN-PROTO: ダミーデータ源。実装時はこの import ごと消し、`loadHomeTimeline()` を
// 実クエリ（母集団・絞り込みの規約は home-timeline-types.ts の doc コメント）へ置換する。
import {
  PROTO_STATES,
  loadHomeTimeline,
  type ProtoState,
} from './home-timeline-proto-data'

/**
 * ホーム（`/dashboard`）= 会の出場予定。
 *
 * 実装時のサーバー側の仕事は `HomeTimelineData` を組むことだけで、表示は
 * HomeTimeline.tsx が全部持つ。あいさつ・権限カードは撤去済み。
 */
export default async function DashboardPage({
  searchParams,
}: {
  // DESIGN-PROTO: 状態切替用。実装時は searchParams ごと不要。
  searchParams: Promise<{ state?: string }>
}) {
  // DESIGN-PROTO: ここから — 実装時は実クエリで data を組む
  const sp = await searchParams
  const state: ProtoState = PROTO_STATES.some((s) => s.id === sp.state)
    ? (sp.state as ProtoState)
    : 'normal'
  const data = loadHomeTimeline(state)
  // DESIGN-PROTO: ここまで

  return (
    <>
      {/* DESIGN-PROTO: 状態切替バー。実装時は削除する */}
      <div className="flex flex-wrap gap-1 border-b border-dashed border-border-strong bg-surface-alt px-3 py-1.5">
        {PROTO_STATES.map((s) => (
          <Link
            key={s.id}
            href={`/dashboard?state=${s.id}`}
            className={
              s.id === state
                ? 'rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-ink-on-brand'
                : 'rounded-full px-2 py-0.5 text-[11px] text-ink-meta'
            }
          >
            {s.label}
          </Link>
        ))}
      </div>

      <HomeTimeline data={data} />
    </>
  )
}
