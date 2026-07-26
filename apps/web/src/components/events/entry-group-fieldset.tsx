'use client'

import { useState } from 'react'

/**
 * entry-groups タスク2: `/events/[id]/edit` の「申込グループ」欄。
 *
 * - 現在のグループの所属日一覧を表示（requirements §3.2.6）
 * - `entry_group_action`（radio: keep/standalone/merge）で単独化・合流を選ぶ
 * - `entry_group_action='merge'` のときだけ合流先候補（`entry_group_target_id`）を出す。
 *   候補はサーバーが有界なリスト（同一 tournament_draft 由来＋開催日が近い順）を渡し、
 *   ここではテキストフィルタで絞り込むだけ（全件検索はこのタスクのスコープ外）
 *
 * 実際のグループ付け替え・空グループの条件付き削除は `updateEvent`（Server Action）が
 * `applyEntryGroupChange` / `deleteGroupIfEmpty` で同一トランザクション内に行う。ここは
 * 入力欄の描画のみ。
 */

const LABEL_CLASS = 'block text-xs font-semibold text-ink-meta tracking-[0.02em]'
const FIELD_CLASS =
  'mt-1 block w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30'

export interface EntryGroupSiblingView {
  id: number
  title: string
  /** `YYYY-MM-DD`。 */
  eventDate: string
  status: 'published' | 'cancelled' | 'done'
}

export interface EntryGroupMergeCandidateView {
  groupId: number
  name: string
  representativeEventDate: string
  eventCount: number
}

export interface EntryGroupFieldsetProps {
  /** 現在のグループの全日（自分自身を含む・開催日昇順）。 */
  siblings: EntryGroupSiblingView[]
  /** 合流先候補（サーバーで有界に絞ったリスト）。 */
  mergeCandidates: EntryGroupMergeCandidateView[]
}

export function EntryGroupFieldset({ siblings, mergeCandidates }: EntryGroupFieldsetProps) {
  const [action, setAction] = useState<'keep' | 'standalone' | 'merge'>('keep')
  const [filter, setFilter] = useState('')

  const filtered =
    filter.trim() === ''
      ? mergeCandidates
      : mergeCandidates.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="rounded-md border border-border p-3">
      <p className={LABEL_CLASS}>申込グループ</p>
      <ul className="mt-1 space-y-0.5 text-[13px] text-ink-2">
        {siblings.map((s) => (
          <li key={s.id}>
            {s.eventDate} {s.title}
            {s.status === 'cancelled' && <span className="ml-1 text-ink-meta">（中止）</span>}
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="entry_group_action"
            value="keep"
            defaultChecked
            onChange={() => setAction('keep')}
            className="border-border"
          />
          このまま（グループを変更しない）
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="entry_group_action"
            value="standalone"
            onChange={() => setAction('standalone')}
            className="border-border"
          />
          単独化（このイベントだけの新しいグループに分ける）
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="entry_group_action"
            value="merge"
            onChange={() => setAction('merge')}
            className="border-border"
          />
          既存グループへ合流
        </label>
      </div>

      {action === 'merge' && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            placeholder="大会名で絞り込み"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={FIELD_CLASS}
          />
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {filtered.map((c) => (
              <li key={c.groupId}>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="entry_group_target_id" value={c.groupId} className="border-border" />
                  {c.name}（{c.representativeEventDate}・{c.eventCount}日）
                </label>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="text-xs text-ink-meta">該当するグループがありません</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
