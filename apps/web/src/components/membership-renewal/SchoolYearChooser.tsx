'use client'

import { useId, useState, type ReactNode } from 'react'
import { ADVANCE_TO_GRADUATE_YEARS, schoolYearOptions } from '@kagetra/shared'
import type { FacultyKind, RenewalSchoolYearKind } from '@kagetra/shared/types'
import { FacultyCombobox } from '@/components/members/FacultyCombobox'
import { cn } from '@/lib/utils'
import { defaultNextSchoolYear, isFinalSchoolYear } from '@/lib/membership-renewal/school-year'

/**
 * `SchoolYearChooser`（design-spec §4・§8）— S1・S2 の「4月からの学年」。
 *
 * 最終学年は `isFinalSchoolYear` で判定し（★呼び出し順が要 — `defaultNextSchoolYear`
 * は最終学年を見ないので、必ずこちらを先に呼ぶ。`school-year.ts` の申し送り）、
 * 既定値を置かず「進学／卒業／留年」の3択（`RadioList`）にする。最終学年でなければ
 * 「現在 → 4月から（既定 +1）」の1行を示し、下の2つのリンクで例外（学部等名を
 * 変える＝学年を自分で選ぶ／サークルを離れる）を開ける。
 */

export interface SchoolYearAnswerState {
  schoolYearKind: RenewalSchoolYearKind | null
  nextFacultyKind: FacultyKind | null
  nextFaculty: string | null
  nextSchoolYear: string | null
}

export interface SchoolYearChooserProps {
  currentFacultyKind: FacultyKind | null
  currentFaculty: string | null
  currentSchoolYear: string | null
  value: SchoolYearAnswerState
  onChange: (next: SchoolYearAnswerState) => void
}

const UNDERLINE_CLASS =
  'w-full min-w-0 border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm text-ink outline-none focus:border-brand'

/**
 * 初期表示の回答値（`RenewalForm` が `useState` の初期値に使う）。
 * 非最終学年で既定値があれば `advance`＋既定の学年を先取りし、それ以外
 * （最終学年・既定値なし）は「まだ選ばれていない」（`schoolYearKind: null`）
 * —— 送信ボタンの必須チェックが「未選択」を検出できるようにする。
 */
export function computeInitialSchoolYearAnswer(
  currentFacultyKind: FacultyKind | null,
  currentFaculty: string | null,
  currentSchoolYear: string | null,
): SchoolYearAnswerState {
  const isFinal = isFinalSchoolYear(currentFacultyKind, currentFaculty, currentSchoolYear)
  const defaultNext = !isFinal
    ? defaultNextSchoolYear(currentFacultyKind, currentSchoolYear)
    : null
  if (defaultNext !== null) {
    return {
      schoolYearKind: 'advance',
      nextFacultyKind: null,
      nextFaculty: null,
      nextSchoolYear: defaultNext,
    }
  }
  return { schoolYearKind: null, nextFacultyKind: null, nextFaculty: null, nextSchoolYear: null }
}

export function SchoolYearChooser({
  currentFacultyKind,
  currentFaculty,
  currentSchoolYear,
  value,
  onChange,
}: SchoolYearChooserProps) {
  const formId = useId()
  const isFinal = isFinalSchoolYear(currentFacultyKind, currentFaculty, currentSchoolYear)
  const defaultNext = !isFinal
    ? defaultNextSchoolYear(currentFacultyKind, currentSchoolYear)
    : null
  const hasDefault = !isFinal && defaultNext !== null

  // 例外 UI を開くかどうか。最終学年、既定値が無い（現在の学年が未設定）、または
  // 既に「既定」以外の回答が入っている（修正で開いた・前回サークルを離れる等を
  // 選んでいた）ときは最初から開いておく（design-spec §3・R4）。
  const [showExceptions, setShowExceptions] = useState(() => {
    if (isFinal || !hasDefault) return true
    return !(value.schoolYearKind === 'advance' && value.nextSchoolYear === defaultNext)
  })

  function chooseAdvanceDefault() {
    setShowExceptions(false)
    onChange({
      schoolYearKind: 'advance',
      nextFacultyKind: null,
      nextFaculty: null,
      nextSchoolYear: defaultNext,
    })
  }

  function openExceptions(preset: RenewalSchoolYearKind) {
    setShowExceptions(true)
    if (preset === 'leave') {
      onChange({ schoolYearKind: 'leave', nextFacultyKind: null, nextFaculty: null, nextSchoolYear: null })
      return
    }
    if (preset === 'custom' && isFinal) {
      // 最終学年の「留年」は現在の学年をそのまま据え置く（サブフォーム不要）。
      onChange({
        schoolYearKind: 'custom',
        nextFacultyKind: null,
        nextFaculty: null,
        nextSchoolYear: currentSchoolYear,
      })
      return
    }
    // 学部等名を変える（非最終学年の「学年を自分で選ぶ」）・進学（最終学年）は
    // サブフォームが必要なので、まだ確定値が無い（未入力のまま送らせない）。
    onChange({
      schoolYearKind: preset,
      nextFacultyKind: preset === 'advance' ? 'graduate' : (currentFacultyKind ?? 'undergraduate'),
      nextFaculty: preset === 'advance' ? '' : (currentFaculty ?? ''),
      nextSchoolYear: '',
    })
  }

  const showAdvanceSubform = value.schoolYearKind === 'advance' && isFinal
  const showCustomSubform = value.schoolYearKind === 'custom' && !isFinal

  function updateSubform(patch: Partial<SchoolYearAnswerState>) {
    onChange({ ...value, ...patch })
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 pb-2 text-sm text-ink-2">
        <span className="text-xs text-ink-meta">現在</span>
        <span>
          {currentFaculty ?? '未設定'} <b className="font-semibold text-ink">{currentSchoolYear ?? '未設定'}</b>
          {isFinal && <span className="ml-1 text-xs text-ink-meta">（最終学年）</span>}
        </span>
        {!showExceptions && hasDefault && (
          <>
            <span className="text-ink-muted" aria-hidden>
              →
            </span>
            <span className="text-xs text-ink-meta">4月から</span>
            <span className="font-semibold text-ink">{defaultNext}</span>
          </>
        )}
      </div>

      {!showExceptions ? (
        <>
          <p className="text-xs leading-relaxed text-ink-meta">
            学年は 4/1 に反映されます。学部等名が変わる場合や、サークルを離れる場合は下から選んでください。
          </p>
          <div className="mt-2 flex gap-3.5">
            <button
              type="button"
              onClick={() => openExceptions('custom')}
              className="text-xs text-brand"
            >
              学部等名を変える
            </button>
            <button
              type="button"
              onClick={() => openExceptions('leave')}
              className="text-xs text-brand"
            >
              サークルを離れる
            </button>
          </div>
        </>
      ) : isFinal ? (
        // 最終学年の3択（design-spec renewal-member.html 2列目）: 進学する → 卒業する → 留年。
        <div role="radiogroup" aria-label="4月からの学年" className="flex flex-col">
          <ExceptionOption
            selected={value.schoolYearKind === 'advance'}
            onSelect={() => openExceptions('advance')}
            label="進学する"
            sub="大学院・専門職大学院へ。新しい学部等名と学年を入力"
          >
            {showAdvanceSubform && (
              <AdvanceSubform formId={formId} value={value} onChange={updateSubform} />
            )}
          </ExceptionOption>
          <ExceptionOption
            selected={value.schoolYearKind === 'leave'}
            onSelect={() => openExceptions('leave')}
            label="卒業する"
            sub="サークルを離れます（全日協の登録とは別）"
          />
          <ExceptionOption
            selected={value.schoolYearKind === 'custom'}
            onSelect={() => openExceptions('custom')}
            label={`留年（${currentSchoolYear ?? ''}のまま）`}
          />
        </div>
      ) : (
        // 非最終学年の例外（design-spec renewal-member.html 2列目下）: 既定 → 学年を自分で選ぶ → サークルを離れる。
        <div role="radiogroup" aria-label="4月からの学年" className="flex flex-col">
          {hasDefault && (
            <ExceptionOption
              selected={value.schoolYearKind === 'advance'}
              onSelect={chooseAdvanceDefault}
              label={`${defaultNext}に進む`}
              sub="既定"
            />
          )}
          <ExceptionOption
            selected={value.schoolYearKind === 'custom'}
            onSelect={() => openExceptions('custom')}
            label="学年を自分で選ぶ"
            sub="留年・転学部など"
          >
            {showCustomSubform && (
              <CustomSubform formId={formId} value={value} onChange={updateSubform} />
            )}
          </ExceptionOption>
          <ExceptionOption
            selected={value.schoolYearKind === 'leave'}
            onSelect={() => openExceptions('leave')}
            label="サークルを離れる"
            sub="4/1 にサークル所属が外れます。学部等名・学年は残ります"
          />
        </div>
      )}
    </div>
  )
}

function ExceptionOption({
  selected,
  onSelect,
  label,
  sub,
  children,
}: {
  selected: boolean
  onSelect: () => void
  label: string
  sub?: string
  children?: ReactNode
}) {
  return (
    <div className="border-t border-border-soft py-[9px] first:border-t-0">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <span
          className={cn(
            'mt-[3px] h-4 w-4 flex-none rounded-full border',
            selected ? 'border-brand' : 'border-border-strong',
          )}
        >
          {selected && <span className="block h-full w-full scale-50 rounded-full bg-brand" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">{label}</span>
          {sub && <span className="mt-0.5 block text-xs text-ink-2">{sub}</span>}
        </span>
      </button>
      {selected && children && <div className="ml-[26px] mt-2.5 flex flex-col gap-2.5">{children}</div>}
    </div>
  )
}

function AdvanceSubform({
  formId,
  value,
  onChange,
}: {
  formId: string
  value: SchoolYearAnswerState
  onChange: (patch: Partial<SchoolYearAnswerState>) => void
}) {
  const kind = value.nextFacultyKind ?? 'graduate'
  const yearOptions = kind === 'graduate' ? ADVANCE_TO_GRADUATE_YEARS : schoolYearOptions(kind)
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="w-14 flex-none text-xs text-ink-meta">所属</span>
        <div role="radiogroup" aria-label="所属" className="inline-flex gap-3">
          {(['undergraduate', 'graduate'] as const).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-1 text-sm">
              <input
                type="radio"
                checked={kind === k}
                onChange={() =>
                  onChange({ nextFacultyKind: k, nextFaculty: '', nextSchoolYear: '' })
                }
                className="accent-brand"
              />
              {k === 'undergraduate' ? '学部' : '大学院'}
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor={`${formId}-advance-faculty`} className="w-14 flex-none text-xs text-ink-meta">
          学部等名
        </label>
        <FacultyCombobox
          id={`${formId}-advance-faculty`}
          name="__advanceFaculty"
          kind={kind}
          value={value.nextFaculty ?? ''}
          onChange={(v) => onChange({ nextFaculty: v })}
          required
          className={UNDERLINE_CLASS}
        />
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor={`${formId}-advance-year`} className="w-14 flex-none text-xs text-ink-meta">
          学年
        </label>
        <select
          id={`${formId}-advance-year`}
          value={value.nextSchoolYear ?? ''}
          onChange={(e) => onChange({ nextSchoolYear: e.target.value })}
          className={UNDERLINE_CLASS}
        >
          <option value="" disabled>
            選択してください
          </option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}

function CustomSubform({
  formId,
  value,
  onChange,
}: {
  formId: string
  value: SchoolYearAnswerState
  onChange: (patch: Partial<SchoolYearAnswerState>) => void
}) {
  const kind = value.nextFacultyKind ?? 'undergraduate'
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="w-14 flex-none text-xs text-ink-meta">所属</span>
        <div role="radiogroup" aria-label="所属" className="inline-flex gap-3">
          {(['undergraduate', 'graduate'] as const).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-1 text-sm">
              <input
                type="radio"
                checked={kind === k}
                onChange={() =>
                  onChange({ nextFacultyKind: k, nextFaculty: '', nextSchoolYear: '' })
                }
                className="accent-brand"
              />
              {k === 'undergraduate' ? '学部' : '大学院'}
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor={`${formId}-custom-faculty`} className="w-14 flex-none text-xs text-ink-meta">
          学部等名
        </label>
        <FacultyCombobox
          id={`${formId}-custom-faculty`}
          name="__customFaculty"
          kind={kind}
          value={value.nextFaculty ?? ''}
          onChange={(v) => onChange({ nextFaculty: v })}
          required
          className={UNDERLINE_CLASS}
        />
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor={`${formId}-custom-year`} className="w-14 flex-none text-xs text-ink-meta">
          学年
        </label>
        <select
          id={`${formId}-custom-year`}
          value={value.nextSchoolYear ?? ''}
          onChange={(e) => onChange({ nextSchoolYear: e.target.value })}
          className={UNDERLINE_CLASS}
        >
          <option value="" disabled>
            選択してください
          </option>
          {schoolYearOptions(kind).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
