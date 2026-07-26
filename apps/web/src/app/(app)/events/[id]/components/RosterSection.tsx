'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatFlowDate } from '@/lib/event-date'
import { surname } from '@/lib/surname'
import { DisclosureSection } from '@/components/events/detail'

export interface RosterEntryView {
  id: number
  rawName: string
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | null
  rawAffiliation: string | null
  status: 'applied' | 'confirmed' | 'carried_up' | 'carry_up_declined' | 'cancelled'
  userId: string | null
  user: { id: string; name: string | null } | null
}
export interface RosterView {
  id: number
  rosterType: 'applicant' | 'confirmed'
  version: number
  publishedAt: string | null
  entries: RosterEntryView[]
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E'] as const
type Grade = (typeof GRADE_ORDER)[number]

/** 級の若い順（A→E）。級なし（null）は最後（AC-19）。 */
function gradeRank(grade: Grade | null): number {
  if (grade == null) return GRADE_ORDER.length
  const idx = GRADE_ORDER.indexOf(grade)
  return idx === -1 ? GRADE_ORDER.length : idx
}

const NEGATIVE_STATUS_LABEL: Record<'cancelled' | 'carry_up_declined', string> = {
  cancelled: '取消',
  carry_up_declined: '繰上辞退',
}

/**
 * `.rost` の開閉マーカー（▸/▾）。design-spec 準拠だが、この2箇所は summary の
 * スロット構成が `DisclosureRow` と違うためローカル実装（design-mock 移植判断）。
 */
const MARKER_BEFORE_CLASS =
  "before:content-['▸'] before:flex-none before:text-[10px] before:text-ink-meta group-open:before:content-['▾']"

function tabClass(active: boolean) {
  return cn(
    'relative flex-1 whitespace-nowrap px-0.5 pb-2 pt-1.5 text-center text-xs',
    active
      ? "font-bold text-brand after:absolute after:inset-x-[7px] after:bottom-[-1px] after:h-0.5 after:rounded-t-sm after:bg-brand after:content-['']"
      : 'text-neutral-fg',
  )
}

function countLabel(roster: RosterView | undefined): string {
  return roster && roster.entries.length > 0 ? `${roster.entries.length}名` : '未取込'
}

function RosterList({
  title,
  roster,
  currentUserId,
  emptyText,
}: {
  title: string
  roster: RosterView | undefined
  currentUserId: string | null
  /** 未取込時の本文（§3.2.5 の指定文言）。指定しないパネルは本文を出さない。 */
  emptyText?: string
}) {
  const [activeGrade, setActiveGrade] = useState<Grade | null>(null)

  if (!roster || roster.entries.length === 0) {
    return (
      <details className="group border-t border-border-soft first-of-type:border-t-0">
        <summary
          className={cn(
            'flex cursor-pointer list-none items-baseline gap-2 py-[11px]',
            '[&::-webkit-details-marker]:hidden',
            MARKER_BEFORE_CLASS,
          )}
        >
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          <span className="ml-auto text-xs tabular-nums text-neutral-fg">未取込</span>
        </summary>
        {emptyText && (
          <div className="pb-[13px]">
            <p className="text-xs leading-[1.75] text-neutral-fg">{emptyText}</p>
          </div>
        )}
      </details>
    )
  }

  const sortedEntries = [...roster.entries].sort(
    (a, b) => gradeRank(a.grade) - gradeRank(b.grade),
  )
  // タブは「この名簿の entries に実在する級」から導出する（空タブを避ける）。
  const grades = GRADE_ORDER.filter((g) => sortedEntries.some((e) => e.grade === g))
  const visibleEntries =
    activeGrade == null ? sortedEntries : sortedEntries.filter((e) => e.grade === activeGrade)
  const members = roster.entries.filter((e) => e.user)
  const youOnIt =
    currentUserId != null && roster.entries.some((e) => e.userId === currentUserId)

  return (
    <details className="group border-t border-border-soft first-of-type:border-t-0">
      <summary
        className={cn(
          'flex cursor-pointer list-none items-baseline gap-2 py-[11px]',
          '[&::-webkit-details-marker]:hidden',
          MARKER_BEFORE_CLASS,
        )}
      >
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        <span className="font-display text-[13px] tabular-nums text-ink-2">
          {roster.entries.length}名
        </span>
        {roster.publishedAt && (
          <span className="ml-auto text-xs tabular-nums text-neutral-fg">
            発行 {formatFlowDate(roster.publishedAt)}
          </span>
        )}
      </summary>
      <div className="pb-[13px]">
        <div role="tablist" className="mb-[10px] flex border-b border-border">
          <button
            type="button"
            role="tab"
            aria-selected={activeGrade == null}
            onClick={() => setActiveGrade(null)}
            className={tabClass(activeGrade == null)}
          >
            全体
            <span className="ml-[3px] font-display tabular-nums">{roster.entries.length}</span>
          </button>
          {grades.map((g) => {
            const gradeCount = roster.entries.filter((e) => e.grade === g).length
            return (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={activeGrade === g}
                onClick={() => setActiveGrade(g)}
                className={tabClass(activeGrade === g)}
              >
                {g}
                <span className="ml-[3px] font-display tabular-nums">{gradeCount}</span>
              </button>
            )
          })}
        </div>
        <p className="mb-[9px] text-xs text-ink-meta">
          自会員 <b className="font-medium text-ink-2">{members.length}名</b>
          {members.length > 0 &&
            `（${members.map((m) => surname(m.user?.name)).join('・')}）`}
          {currentUserId != null && (
            <>
              ／
              {youOnIt ? (
                <span className="text-brand-fg">あなたはこの名簿に掲載されています</span>
              ) : (
                'あなたはこの名簿に掲載されていません'
              )}
            </>
          )}
        </p>
        <table className="roster-table w-full border-collapse text-[13px]">
          <tbody className="divide-y divide-border-soft">
            {visibleEntries.map((entry) => {
              const negative =
                entry.status === 'cancelled' || entry.status === 'carry_up_declined'
              return (
                <tr key={entry.id}>
                  <td
                    className={cn(
                      'py-1.5 align-baseline whitespace-nowrap',
                      negative
                        ? 'text-neutral-fg'
                        : entry.user
                          ? 'font-semibold text-brand-fg'
                          : 'text-ink',
                    )}
                  >
                    {entry.rawName}
                  </td>
                  <td className="w-[34px] py-1.5 align-baseline whitespace-nowrap font-mono text-xs text-ink-meta">
                    {entry.grade ?? ''}
                  </td>
                  <td className="py-1.5 align-baseline text-right text-xs text-ink-meta">
                    {negative ? (
                      <span className="text-accent-fg">
                        {NEGATIVE_STATUS_LABEL[entry.status as 'cancelled' | 'carry_up_declined']}
                      </span>
                    ) : (
                      <>
                        {entry.rawAffiliation ?? ''}
                        {entry.user && <span className="text-brand-fg">・会員</span>}
                        {entry.status === 'carried_up' && (
                          <span className="ml-1 text-ink-meta">繰上</span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/**
 * event-detail-redesign タスク4: 大会詳細の名簿表示＋会員突合。
 * 名簿は個人戦のみ（AC-30）。級タブ（初期選択=全体）で絞り込み、級の若い順
 * （A→E、級なしは最後）に並べる（AC-19/AC-20）。この画面からの Excel 取込は
 * 廃止（AC-14/AC-15）——名簿はメール取り込み経由のみ。
 */
export function RosterSection({
  kind,
  rosters,
  currentUserId,
}: {
  kind: 'individual' | 'team'
  rosters: RosterView[]
  currentUserId: string | null
}) {
  // 名簿は個人戦のみ（§3.2）。団体戦では出さない。
  if (kind !== 'individual') return null
  // 取込導線が無いので、名簿が一つも無ければ何も出さない。
  if (rosters.length === 0) return null

  const newestFirst = [...rosters].sort((a, b) => b.version - a.version)
  const applicant = newestFirst.find((r) => r.rosterType === 'applicant')
  const confirmed = newestFirst.find((r) => r.rosterType === 'confirmed')

  return (
    <DisclosureSection
      title="名簿"
      aux={`申込者 ${countLabel(applicant)} / 確定 ${countLabel(confirmed)}`}
      nested
      // セクション間余白（モックの `.sec{padding:34px 0 0}`）は自前で持つ。
      // 団体戦・名簿ゼロ件では上で null を返すので、呼び出し側がラッパーで
      // 付けると空の 34px が残ってしまう。
      className="pt-[34px]"
    >
      <RosterList title="申込者名簿" roster={applicant} currentUserId={currentUserId} />
      <RosterList
        title="確定名簿"
        roster={confirmed}
        currentUserId={currentUserId}
        emptyText="まだ取り込まれていません。メール取り込みで登録されると、申込者名簿と同じ形式で確定した出場者が並びます。"
      />
    </DisclosureSection>
  )
}
