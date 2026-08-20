import type { ReactNode } from 'react'
import Link from 'next/link'
import type { EntryFlowStep } from '@/lib/events/entry-flow'
import { EntryFlow } from './EntryFlow'

/**
 * 申込グループページの固定ヘッダー（`EventDetailHeader` の兄弟。design-spec §4）。
 *
 * パンくず（申込管理 › グループ名）／グループ名／開催日と共通締切の subline ／
 * 申込フロー帯を **1つのラッパーで** sticky にする。日ページと同じ型にしてあるのは
 * 「行き来しても目が迷わない」ため（design-spec §3）。ここを分割してはならない
 * ——`EventDetailHeader` と同じくオフセット計算が壊れる。
 *
 * 余白の前提も日ページと同じ: ページ根要素が `p-4` を持つので、左右は `-mx-4` で
 * 打ち消して全幅の背景にし、上は `-mt-4` で根要素の上 padding を吸収する。
 *
 * `steps` が null のときはフロー帯を描かない（全日 cancelled のグループ。要件 AC-14
 * ／ design-mock `edge-cases.html` ⑦）。ヘッダー自体は残すので「どのグループを見て
 * いるか」は分かる。
 */
export interface GroupDetailHeaderProps {
  /** `deriveEntryGroupName` の結果（null なら代表イベントのタイトル）。 */
  groupName: string
  /**
   * 見出し下の1行（例 `9/5・9/6 ／ 申込締切 8/7 ／ 抽選 8/16`）。期限超過や
   * 「（日により異なる）」の朱は呼び出し側が組み立てる——どの語に朱を当てるかは
   * 共通値の集約結果を持つページ側にしか分からないため。
   */
  subline: ReactNode
  /** null ならフロー帯を描かない。 */
  steps: readonly EntryFlowStep[] | null
}

export function GroupDetailHeader({
  groupName,
  subline,
  steps,
}: GroupDetailHeaderProps) {
  return (
    <div className="sticky top-0 z-[3] -mx-4 -mt-4 border-b border-border-soft bg-canvas px-4 pt-[14px]">
      <nav className="flex items-baseline gap-[5px] pb-1 text-xs text-ink-meta">
        <Link href="/admin/entries" className="text-brand hover:underline">
          申込管理
        </Link>
        <span aria-hidden>›</span>
        <span className="min-w-0 truncate">{groupName}</span>
      </nav>
      <h1 className="flex min-w-0 items-baseline gap-x-[10px] gap-y-[2px] font-display text-[28px] font-bold leading-tight text-ink">
        {groupName}
      </h1>
      <div className="mt-[3px] pb-[10px] text-xs tabular-nums text-ink-meta">
        {subline}
      </div>
      {steps && <EntryFlow steps={steps} />}
    </div>
  )
}
