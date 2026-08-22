'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatFlowDate } from '@/lib/event-date'
import { surname } from '@/lib/surname'
import { Btn } from '@/components/ui'
import { DisclosureActions, DisclosureSection } from '@/components/events/detail'

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

/**
 * roster-file-adoption タスク4: パースせず**原本ファイルのまま採用**した名簿
 * （tournament_entry_roster_files）の会員向け DTO。一般会員へ渡してよいのは
 * ファイル名・採用種別・発表日・ビューア導線（id）だけ——取込元メール ID・
 * 採用者・管理メモは含めない（要件 §3.2.3, PR #376 の教訓）。
 */
export interface RosterFileView {
  id: number
  rosterType: 'applicant' | 'confirmed'
  publishedAt: string | null
  filename: string
  /**
   * roster-file-adoption 2026-08-01 改修: 取込単位。**null = グループ統一名簿**
   * （ラベルなし。既存データはすべてこれ＝AC-22 の回帰対象）。非 null はその級
   * だけ（複数級カバーなら `['A','B']`）をカバーする級別採用（AC-18）。
   */
  grades: Grade[] | null
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E'] as const
type Grade = (typeof GRADE_ORDER)[number]

/** 級の若い順（A→E）。級なし（null）は最後（AC-19）。 */
function gradeRank(grade: Grade | null): number {
  if (grade == null) return GRADE_ORDER.length
  const idx = GRADE_ORDER.indexOf(grade)
  return idx === -1 ? GRADE_ORDER.length : idx
}

/**
 * roster-file-adoption 2026-08-01 改修 (AC-18): 級別採用のラベル整形。
 * `null` または空配列（本来 DB には入らないが防御的に）は「グループ統一」
 * としてラベルなし＝ null を返す。それ以外は A→E 昇順で「・」連結 + 「級」。
 * `admin/mail-inbox/` 側にも同種のラベル整形があるが、機能境界が違うため
 * ここではローカルに実装する（3 行の関数を跨がせない）。
 */
function formatRosterFileGradeLabel(grades: Grade[] | null): string | null {
  if (grades == null || grades.length === 0) return null
  return (
    [...grades].sort((a, b) => gradeRank(a) - gradeRank(b)).join('・') + '級'
  )
}

const NEGATIVE_STATUS_LABEL: Record<'cancelled' | 'carry_up_declined', string> = {
  cancelled: '取消',
  carry_up_declined: '繰上辞退',
}

/**
 * `.rost` の開閉マーカー。design-spec 準拠だが、この2箇所は summary の
 * スロット構成が `DisclosureRow` と違うためローカル実装（design-mock 移植判断）。
 *
 * 開いた状態の `▾` は `MARKER_OPEN_CLASS` を **details 側**に当てて上書きする。
 * `group-open:` は使えない — 「開いている任意の `.group` 祖先」に一致するため、
 * 外側の「名簿」トグルを開いただけで、閉じている申込者/確定名簿のマーカーまで
 * `▾` になってしまう。
 */
const MARKER_BEFORE_CLASS =
  "before:content-['▸'] before:flex-none before:text-[10px] before:text-ink-meta"
const MARKER_OPEN_CLASS = "[&[open]>summary]:before:content-['▾']"

function tabClass(active: boolean) {
  return cn(
    'relative flex-1 whitespace-nowrap px-0.5 pb-2 pt-1.5 text-center text-xs',
    active
      ? "font-bold text-brand after:absolute after:inset-x-[7px] after:bottom-[-1px] after:h-0.5 after:rounded-t-sm after:bg-brand after:content-['']"
      : 'text-neutral-fg',
  )
}

function countLabel(roster: RosterView | undefined, files: RosterFileView[]): string {
  if (roster && roster.entries.length > 0) return `${roster.entries.length}名`
  // roster-file-adoption: パース済みが無くても原本ファイルが採用済みなら「未取込」
  // ではない。折りたたみ見出しだけを見て「まだ何も無い」と誤読されると、
  // ファイル採用でフェーズを進める本機能の意味が消える。
  if (files.length > 0) return `原本${files.length}件`
  return '未取込'
}

/**
 * 採用済み原本ファイルへのリンク一覧（ビューアは `/roster-files/{id}`。
 * roster-file-adoption タスク3が実装）。1種別に複数ファイルが採用されうる
 * （例: 「参加者一覧」と「参加費一覧」）ので配列前提で並べる。
 */
function RosterFileLinks({ files }: { files: RosterFileView[] }) {
  if (files.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {files.map((file) => {
        // roster-file-adoption 2026-08-01 改修 (AC-18): 級別採用のファイルにだけ
        // 級ラベルを添える。ファイル名の直後（発表日より前）に置き、
        // `ml-auto` の発表日は常に右寄せのまま崩れない。
        const gradeLabel = formatRosterFileGradeLabel(file.grades)
        return (
          <li key={file.id}>
            <Link
              href={`/roster-files/${file.id}`}
              className="flex items-baseline gap-2 text-xs text-brand hover:underline"
            >
              <span className="truncate">{file.filename}</span>
              {gradeLabel && (
                <span className="flex-none text-neutral-fg">{gradeLabel}</span>
              )}
              {file.publishedAt && (
                <span className="ml-auto flex-none tabular-nums text-neutral-fg">
                  発表 {formatFlowDate(file.publishedAt)}
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function RosterList({
  title,
  roster,
  files,
  currentUserId,
  emptyText,
}: {
  title: string
  roster: RosterView | undefined
  /** 同じ種別（申込者/確定）に採用された原本ファイル。§3.2.3 の表示規則。 */
  files: RosterFileView[]
  currentUserId: string | null
  /** 未取込時の本文（§3.2.5 の指定文言）。指定しないパネルは本文を出さない。 */
  emptyText?: string
}) {
  const [activeGrade, setActiveGrade] = useState<Grade | null>(null)

  if (!roster || roster.entries.length === 0) {
    // パース済み名簿は無いが、原本ファイルが採用済みならファイル名の一覧カードを
    // 出す（要件 §3.2.3「パース済みがなく、採用済みファイルがある」分岐）。
    // 現行の「未取込」文言はファイルも無いときだけ維持する（回帰禁止）。
    if (files.length > 0) {
      return (
        <details
          className={cn(
            'border-t border-border-soft first-of-type:border-t-0',
            MARKER_OPEN_CLASS,
          )}
        >
          <summary
            className={cn(
              'flex cursor-pointer list-none items-baseline gap-2 py-[11px]',
              '[&::-webkit-details-marker]:hidden',
              MARKER_BEFORE_CLASS,
            )}
          >
            <span className="text-[13px] font-semibold text-ink">{`${title}（原本ファイル）`}</span>
            <span className="ml-auto text-xs tabular-nums text-neutral-fg">
              {files.length}件
            </span>
          </summary>
          <div className="pb-[13px]">
            <RosterFileLinks files={files} />
          </div>
        </details>
      )
    }
    return (
      <details
        className={cn(
          'border-t border-border-soft first-of-type:border-t-0',
          MARKER_OPEN_CLASS,
        )}
      >
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
    <details
      className={cn(
        'border-t border-border-soft first-of-type:border-t-0',
        MARKER_OPEN_CLASS,
      )}
    >
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
        {files.length > 0 && (
          // パース済み名簿が主で、採用済み原本ファイルは補助リンクとして併記
          // する（要件 §3.2.3「パース済みがある」分岐）。
          <div className="mt-3 border-t border-border-soft pt-3">
            <p className="mb-1.5 text-xs text-neutral-fg">原本ファイル</p>
            <RosterFileLinks files={files} />
          </div>
        )}
      </div>
    </details>
  )
}

/**
 * confirmed-roster-signal タスク2: 管理者だけに渡す値と Server Action を **1つの
 * optional prop に束ねる**。
 *
 * ★`isAdmin` を受けて `{isAdmin && <JSX>}` で隠すだけにしない。この
 * コンポーネントは `'use client'` なので、props は全ロールぶん RSC payload に
 * 載る——非管理者には**この prop 自体を渡さない**（`undefined`）ことで、操作 UI も
 * Server Action の参照も payload に現れない（PR #376 の教訓。要件 §6 / AC-11）。
 */
export interface RosterAdminControls {
  /** そのグループの `entry_groups.confirmed_roster_override` の現在値。 */
  confirmedRosterOverride: boolean
  /** `setConfirmedRosterOverride` を entryGroupId で bind したもの。 */
  setConfirmedRosterOverride: (value: boolean) => Promise<void>
}

/**
 * 「確定名簿ありとして扱う」トグル（管理者・副管理者のみ）。
 *
 * 確定連絡が別経路（会場掲示・口頭・他会からの連絡）で届いたときに、名簿も
 * メールも無いまま申込フローを次（振込）へ進めるための逃げ道。効くのは
 * **申込済みのグループの抽選→支払だけ**で、任意のフェーズを選ぶ機能ではない
 * （要件 §3.2.2 / §5 Non-goals）。
 */
function ConfirmedRosterOverrideRow({ controls }: { controls: RosterAdminControls }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const on = controls.confirmedRosterOverride

  function toggle() {
    setError(null)
    startTransition(async () => {
      try {
        await controls.setConfirmedRosterOverride(!on)
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新に失敗しました')
      }
    })
  }

  return (
    <div className="border-t border-border-soft pt-[11px]">
      <p className="text-xs leading-[1.75] text-ink-meta">
        確定連絡が別の経路で届いていて名簿もメールも登録できないときは、ここで
        「確定名簿あり」として扱えます（申込済みの大会の抽選→支払だけが進みます）。
      </p>
      <DisclosureActions>
        <span className={cn('text-xs', on ? 'text-brand-fg' : 'text-ink-meta')}>
          {on ? '確定名簿ありとして扱っています' : '確定名簿ありとして扱っていません'}
        </span>
        <Btn
          kind={on ? 'secondary' : 'primary'}
          size="sm"
          disabled={isPending}
          aria-pressed={on}
          onClick={toggle}
        >
          {on ? '扱いを解除' : '確定名簿ありとして扱う'}
        </Btn>
      </DisclosureActions>
      {error && <p className="mt-1.5 text-right text-xs text-accent-fg">{error}</p>}
    </div>
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
  rosterFiles = [],
  currentUserId,
  adminControls,
}: {
  kind: 'individual' | 'team'
  rosters: RosterView[]
  /**
   * roster-file-adoption タスク4: entry_group に採用済みの原本ファイル
   * （パース済み名簿の有無に関わらず渡ってよい。表示の出し分けはここで行う）。
   */
  rosterFiles?: RosterFileView[]
  currentUserId: string | null
  /**
   * confirmed-roster-signal タスク2: 管理者向けの値＋操作。**管理者のときだけ
   * 渡す**（非管理者は `undefined`）。詳細は {@link RosterAdminControls}。
   */
  adminControls?: RosterAdminControls
}) {
  // 名簿は個人戦のみ（AC-30）。団体戦では出さない。
  if (kind !== 'individual') return null
  // 名簿が 1 件も無い（メール取込前の新規大会）場合もセクションは出す — AC-21 の
  // 「確定名簿が未取込のとき指定文言を表示する」は rosters が空のときにも成立
  // しなければならない。ここで null を返すと、その状態に到達できなくなる。

  const newestFirst = [...rosters].sort((a, b) => b.version - a.version)
  const applicant = newestFirst.find((r) => r.rosterType === 'applicant')
  const confirmed = newestFirst.find((r) => r.rosterType === 'confirmed')
  const applicantFiles = rosterFiles.filter((f) => f.rosterType === 'applicant')
  const confirmedFiles = rosterFiles.filter((f) => f.rosterType === 'confirmed')

  return (
    <DisclosureSection
      title="名簿"
      aux={`申込者 ${countLabel(applicant, applicantFiles)} / 確定 ${countLabel(confirmed, confirmedFiles)}`}
      nested
      // セクション間余白（モックの `.sec{padding:34px 0 0}`）は自前で持つ。
      // 団体戦では上で null を返すので、呼び出し側がラッパー div で付けると
      // 空の 34px が残ってしまう。
      className="pt-[34px]"
    >
      <RosterList
        title="申込者名簿"
        roster={applicant}
        files={applicantFiles}
        currentUserId={currentUserId}
      />
      <RosterList
        title="確定名簿"
        roster={confirmed}
        files={confirmedFiles}
        currentUserId={currentUserId}
        emptyText="まだ取り込まれていません。メール取り込みで登録されると、申込者名簿と同じ形式で確定した出場者が並びます。"
      />
      {adminControls && <ConfirmedRosterOverrideRow controls={adminControls} />}
    </DisclosureSection>
  )
}
