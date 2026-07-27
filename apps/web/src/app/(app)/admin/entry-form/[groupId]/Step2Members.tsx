'use client'

import { useState } from 'react'
import { Btn } from '@/components/ui'
import { SectionRule } from './SectionRule'
import { formatDanDisplay, tallyGrades } from './entry-form-format'
import type { WizardMember } from './wizard-types'
import type { Grade } from '@kagetra/shared/types'
import type { EntryFormMemberRow } from './actions'
import { asStandardGrade } from '@/lib/entry-form/grade-normalize'

/**
 * entry-form-autofill タスク7 (UI): ステップ2「会員」。design-mock: b-step2.html。
 *
 * 「＋ 会員を追加」は、除外した行の再追加と、会員一覧からの新規追加の両方を扱う
 * （requirements §3.2.1・AC-5）。対象会員が0名のグループでも、ここから足せば
 * 申込書を作れる（要件のエラーケース「行を手動追加すれば作成可」）。
 *
 * 旧コメント: 全会員データベースから検索する Server Action が本タスクの
 * 契約（actions.ts）に存在しないため、初期対象（attend=true の和集合）から除外した
 * 行の再追加に限定する（main への申し送り事項。報告参照）。
 */
export interface Step2MembersProps {
  members: WizardMember[]
  appearanceCompleteness: 'complete' | 'incomplete'
  /**
   * 出場回数が過少になり得る級（AC-9b）。`null` は影響範囲を特定できず全行が対象。
   * `appearanceCompleteness === 'complete'` のときは参照しない。
   */
  appearanceIncompleteGrades: Grade[] | null
  onExclude: (userId: string) => void
  onInclude: (userId: string) => void
  /** 会員一覧から新たに行を足す。候補の取得は呼び出し側（ウィザード）が行う。 */
  onAddMember: (userId: string) => void
  /** 追加候補（初期の対象会員・追加済みを除いた会員）。未取得なら null。 */
  addableMembers: EntryFormMemberRow[] | null
  /** 追加候補の取得を要求する（「＋ 会員を追加」を開いたとき）。 */
  onRequestAddable: () => void
  addableLoading: boolean
  onEditRequest: (userId: string) => void
  onBack: () => void
  onNext: () => void
}

/** 自由入力の参加級が、指定された標準級の集合に含まれるか。 */
function includesStandardGrade(grades: readonly Grade[], value: string | null): boolean {
  const standard = asStandardGrade(value)
  return standard != null && grades.includes(standard)
}

/** 姓名・ふりがなの4フィールドが揃っていないか（現在値で判定）。 */
function needsName(m: WizardMember): boolean {
  return !m.familyName || !m.givenName || !m.familyKana || !m.givenKana
}

export function Step2Members({
  members,
  appearanceCompleteness,
  appearanceIncompleteGrades,
  onExclude,
  onInclude,
  onAddMember,
  addableMembers,
  onRequestAddable,
  addableLoading,
  onEditRequest,
  onBack,
  onNext,
}: Step2MembersProps) {
  const [addOpen, setAddOpen] = useState(false)
  const active = members.filter((m) => !m.excluded)
  const excluded = members.filter((m) => m.excluded)
  // 初期値の needsNameInput ではなく現在値から判定する——編集シートで姓名・かなを
  // 埋めた直後に警告が消えないと、直したのに直っていないように見える。
  const nameWarnings = active.filter(needsName)
  const gradeWarnings = active.filter((m) => m.grade == null)
  const { byGrade, unset, total } = tallyGrades(active.map((m) => m.grade))

  // AC-9b: 出場回数が過少になり得る会員。欠落の級が特定できないとき（null）と、
  // 会員自身の級が未登録で判定できないときは、いずれも対象に含める（見落としより
  // 過剰な警告の方が害が小さい）。
  const appearanceWarnings =
    appearanceCompleteness === 'incomplete'
      ? active.filter(
          (m) =>
            appearanceIncompleteGrades == null ||
            asStandardGrade(m.grade) == null ||
            includesStandardGrade(appearanceIncompleteGrades, m.grade),
        )
      : []
  const appearanceWarnedIds = new Set(appearanceWarnings.map((m) => m.userId))

  const hasWarnings =
    nameWarnings.length > 0 ||
    gradeWarnings.length > 0 ||
    appearanceWarnings.length > 0 ||
    active.length === 0

  return (
    <>
      {hasWarnings && (
        <div className="flex flex-col gap-1 rounded-md bg-warn-bg px-2.5 py-2">
          {nameWarnings.map((m) => (
            <p key={`name-${m.userId}`} className="flex gap-1.5 text-[11px] leading-normal text-warn-fg">
              <span aria-hidden>⚠</span>
              <span>
                <button
                  type="button"
                  className="font-bold underline"
                  onClick={() => onEditRequest(m.userId)}
                >
                  {m.displayName ?? '氏名未登録'}
                </button>
                {' '}— ふりがなが未登録です。タップして入力すると会員情報にも保存されます
              </span>
            </p>
          ))}
          {gradeWarnings.map((m) => (
            <p key={`grade-${m.userId}`} className="flex gap-1.5 text-[11px] leading-normal text-warn-fg">
              <span aria-hidden>⚠</span>
              <span>
                <button
                  type="button"
                  className="font-bold underline"
                  onClick={() => onEditRequest(m.userId)}
                >
                  {m.displayName ?? '氏名未登録'}
                </button>
                {' '}— 参加級が未登録です。タップして選択してください（空欄のままでも作成できます）
              </span>
            </p>
          ))}
          {appearanceWarnings.map((m) => (
            <p key={`appearance-${m.userId}`} className="flex gap-1.5 text-[11px] leading-normal text-warn-fg">
              <span aria-hidden>⚠</span>
              <span>
                <button
                  type="button"
                  className="font-bold underline"
                  onClick={() => onEditRequest(m.userId)}
                >
                  {m.displayName ?? '氏名未登録'}
                </button>
                {' '}— 出場回数の算出に名簿未取込の大会があります。値を確認してください
              </span>
            </p>
          ))}
          {active.length === 0 && (
            <p className="flex gap-1.5 text-[11px] leading-normal text-warn-fg">
              <span aria-hidden>⚠</span>
              <span>対象会員が0名です。空の申込書は作成できません。会員を追加してください</span>
            </p>
          )}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <SectionRule title="記入する会員" meta={`${active.length}名`} />
        <ul>
          {active.map((m) => {
            return (
              <li key={m.userId} className="border-t border-border-soft first:border-t-0">
                <button
                  type="button"
                  onClick={() => onEditRequest(m.userId)}
                  className="flex w-full items-baseline gap-2 py-[7px] text-left text-xs"
                >
                  <span
                    className={
                      m.grade == null
                        ? 'w-[34px] shrink-0 text-[10px] font-bold text-accent-fg'
                        : 'w-[34px] shrink-0 font-display font-bold tabular-nums text-brand-fg'
                    }
                  >
                    {m.grade ? `${m.grade}級` : '未設定'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">{m.displayName ?? '氏名未登録'}</span>
                    <span className={needsName(m) ? 'block text-[10px] font-bold text-accent-fg' : 'block text-[10px] text-ink-meta'}>
                      {needsName(m) ? (
                        <>
                          <span aria-hidden className="text-accent">⚠</span> ふりがな未登録
                        </>
                      ) : (
                        <>
                          {`${m.familyKana ?? ''} ${m.givenKana ?? ''}`.trim()}
                          {m.grade == null && (
                            <span className="ml-1.5 font-bold text-accent-fg">
                              <span aria-hidden className="text-accent">⚠</span> 参加級が未登録
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="w-[34px] shrink-0 text-right text-ink-2 tabular-nums">
                    {formatDanDisplay(m.dan)}
                  </span>
                  <span
                    className={
                      appearanceWarnedIds.has(m.userId)
                        ? 'w-[52px] shrink-0 text-right text-[11px] font-bold text-accent-fg tabular-nums'
                        : 'w-[52px] shrink-0 text-right text-[11px] text-ink-meta tabular-nums'
                    }
                  >
                    {appearanceWarnedIds.has(m.userId) && (
                      <span aria-hidden className="text-accent">⚠ </span>
                    )}
                    {m.appearanceCount != null ? `出場 ${m.appearanceCount}` : ''}
                  </span>
                  <span aria-hidden className="shrink-0 text-[11px] text-ink-muted">›</span>
                </button>
              </li>
            )
          })}
        </ul>

        {active.length > 0 && (
          <div className="flex flex-wrap gap-2.5 pt-1.5 text-[11px] text-ink-2 tabular-nums">
            {byGrade.map(({ grade, count }) => (
              <span key={grade}>
                {grade}級 <b className="font-bold">{count}</b>
              </span>
            ))}
            {unset > 0 && (
              <span className="text-accent-fg">
                級未設定 <b className="font-bold">{unset}</b>
              </span>
            )}
            <span className="ml-auto">
              計 <b className="font-bold">{total}</b>名
            </span>
          </div>
        )}

        <div className="pt-1">
          <button
            type="button"
            className="text-xs text-brand"
            onClick={() => {
              const next = !addOpen
              setAddOpen(next)
              if (next && addableMembers == null) onRequestAddable()
            }}
          >
            ＋ 会員を追加
          </button>
          {addOpen && (
            <div className="mt-1.5 flex flex-col gap-1">
              {excluded.map((m) => (
                <div key={m.userId} className="flex items-center justify-between border-t border-border-soft py-1.5 text-xs first:border-t-0">
                  <span>
                    {m.displayName ?? '氏名未登録'}
                    <span className="ml-1.5 text-[10px] text-ink-meta">除外中</span>
                  </span>
                  <button
                    type="button"
                    className="text-xs font-bold text-brand"
                    onClick={() => onInclude(m.userId)}
                  >
                    戻す
                  </button>
                </div>
              ))}
              {addableLoading && <p className="text-[11px] text-ink-meta">会員を読み込んでいます…</p>}
              {addableMembers?.map((m) => (
                <div key={m.userId} className="flex items-center justify-between border-t border-border-soft py-1.5 text-xs first:border-t-0">
                  <span>
                    {m.displayName ?? '氏名未登録'}
                    {m.grade && (
                      <span className="ml-1.5 font-display text-[11px] text-brand-fg">{m.grade}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="text-xs font-bold text-brand"
                    onClick={() => onAddMember(m.userId)}
                  >
                    追加
                  </button>
                </div>
              ))}
              {!addableLoading && excluded.length === 0 && addableMembers?.length === 0 && (
                <p className="text-[11px] text-ink-meta">追加できる会員はいません</p>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 mt-auto flex gap-2 border-t border-border bg-surface px-4 py-3">
        <Btn kind="secondary" size="lg" onClick={onBack}>
          戻る
        </Btn>
        <Btn kind="primary" size="lg" block onClick={onNext} disabled={active.length === 0}>
          次へ — メールの確認
        </Btn>
      </div>
    </>
  )
}
