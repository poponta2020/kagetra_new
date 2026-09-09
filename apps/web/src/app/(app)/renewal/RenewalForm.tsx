'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import {
  ROSTER_FIELD_LABELS,
  READER_CERTIFICATION_LABELS,
  READER_CERTIFICATION_NONE_LABEL,
} from '@kagetra/shared'
import type { RosterField } from '@kagetra/shared'
import type {
  FacultyKind,
  MembershipKind,
  ReaderCertification,
  RenewalAnswer,
  RenewalSchoolYearKind,
} from '@kagetra/shared/types'
import { Btn } from '@/components/ui'
import { SectionRule, DisclosureRow } from '@/components/events/detail'
import { formatEventDate } from '@/lib/event-date'
import { diffDays, todayInJst } from '@/lib/jst-date'
import { AnswerStatusBar } from '@/components/membership-renewal/AnswerStatusBar'
import { ChoiceCards } from '@/components/membership-renewal/ChoiceCards'
import { RosterKvRow } from '@/components/membership-renewal/RosterKvRow'
import {
  SchoolYearChooser,
  computeInitialSchoolYearAnswer,
  type SchoolYearAnswerState,
} from '@/components/membership-renewal/SchoolYearChooser'
import { MEMBERSHIP_KIND_LABELS, MEMBERSHIP_KIND_NOTE } from '@/lib/membership-renewal/membership-kind'
import { formatRosterValue } from '@/lib/membership-renewal/diff'
import type { RosterDiffEntry } from '@/lib/membership-renewal/diff'
import { formatDanKanji } from '@/lib/membership-renewal/dan-kanji'
import type { RenewalSnapshotSource } from '@/lib/membership-renewal/snapshot'
import { submitRenewalAnswer, type RenewalAnswerState } from './actions'

/**
 * S1 `/renewal` の会員向けフォーム（design-mock `renewal-member.html`）。
 *
 * `RenewalFormView` は `page.tsx`（RSC・認可済み）が `loadMemberRenewalView`
 * の結果を DB 非依存の DTO へ詰め替えたもの。ここは表示とフォーム状態管理だけを
 * 持ち、DB へは一切触れない（`@/lib/membership-renewal/store` を import しない）。
 *
 * 名簿の列は `RosterKvRow` を「値表示＋修正リンク」「行内編集（下線入力）」の
 * 2 モードで使い分ける。編集していない行も `answer==='register'` の間は
 * hidden input で現在値を持ち続ける —— `submitRenewalAnswer` の
 * `rosterPatchSchema` は全項目必須（部分パッチではない）ため、編集していない
 * 行の値を送り忘れると `users` の当該列が空へ上書きされてしまう。
 */

export interface RenewalFormView {
  renewalId: number
  fiscalYear: number
  /** `YYYY-MM-DD`。 */
  deadline: string
  status: 'open' | 'completed'
  isZennichikyoTarget: boolean
  isCircleTarget: boolean
  current: RenewalSnapshotSource
  membershipKind: MembershipKind
  readerCertification: ReaderCertification | null
  isAssociateReferee: boolean
  answer: RenewalAnswer | null
  answeredAtIso: string | null
  schoolYearKind: RenewalSchoolYearKind | null
  nextFacultyKind: FacultyKind | null
  nextFaculty: string | null
  nextSchoolYear: string | null
  schoolYearAnsweredAtIso: string | null
  diff: RosterDiffEntry[]
}

type RowKey =
  | 'name'
  | 'kana'
  | 'birthDate'
  | 'gender'
  | 'dan'
  | 'grade'
  | 'postalCode'
  | 'address1'
  | 'address2'
  | 'phone'

const ROW_ORDER: readonly RowKey[] = [
  'name',
  'kana',
  'birthDate',
  'gender',
  'dan',
  'grade',
  'postalCode',
  'address1',
  'address2',
  'phone',
]

const ROW_LABELS: Record<RowKey, string> = {
  name: '氏名',
  kana: 'ふりがな',
  birthDate: ROSTER_FIELD_LABELS.birthDate,
  gender: ROSTER_FIELD_LABELS.gender,
  dan: ROSTER_FIELD_LABELS.dan,
  grade: ROSTER_FIELD_LABELS.grade,
  postalCode: ROSTER_FIELD_LABELS.postalCode,
  address1: ROSTER_FIELD_LABELS.address1,
  address2: ROSTER_FIELD_LABELS.address2,
  phone: ROSTER_FIELD_LABELS.phone,
}

const ROW_FIELD_MAP: Record<RowKey, readonly RosterField[]> = {
  name: ['familyName', 'givenName'],
  kana: ['familyKana', 'givenKana'],
  birthDate: ['birthDate'],
  gender: ['gender'],
  dan: ['dan'],
  grade: ['grade'],
  postalCode: ['postalCode'],
  address1: ['address1'],
  address2: ['address2'],
  phone: ['phone'],
}

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const
const DAN_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

const UNDERLINE_CLASS =
  'w-full min-w-0 border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm text-ink outline-none focus:border-brand'

/** S1 の「登録する」必須（R3・AC-5）。段位は級が A のときだけ別扱い。 */
function isRowRequired(key: RowKey, v: RenewalSnapshotSource): boolean {
  if (key === 'address2') return false
  if (key === 'dan') return v.grade === 'A'
  return true
}

function isRowMissing(key: RowKey, v: RenewalSnapshotSource): boolean {
  if (!isRowRequired(key, v)) return false
  switch (key) {
    case 'name':
      return !v.familyName || !v.givenName
    case 'kana':
      return !v.familyKana || !v.givenKana
    case 'dan':
      return v.dan === null || v.dan === 0
    default: {
      const value = v[key as RosterField]
      return value === null || value === ''
    }
  }
}

function combinedName(v: Pick<RenewalSnapshotSource, 'familyName' | 'givenName'>): string | null {
  const parts = [v.familyName, v.givenName].filter((s): s is string => !!s)
  return parts.length > 0 ? parts.join(' ') : null
}

function combinedKana(v: Pick<RenewalSnapshotSource, 'familyKana' | 'givenKana'>): string | null {
  const parts = [v.familyKana, v.givenKana].filter((s): s is string => !!s)
  return parts.length > 0 ? parts.join(' ') : null
}

function rowDisplayValue(key: RowKey, v: RenewalSnapshotSource): string | null {
  if (key === 'name') return combinedName(v)
  if (key === 'kana') return combinedKana(v)
  return formatRosterValue(key as RosterField, v)
}

/** 登録内容の要約（「登録しない」で畳んだ行・design-mock「北海 花 ・ 弐段 C ・ 札幌市北区」）。 */
function buildRegisterSummary(v: RenewalSnapshotSource): string {
  const danGrade = [formatDanKanji(v.dan), v.grade].filter((s): s is string => !!s).join(' ')
  const parts = [combinedName(v), danGrade || null, v.address1].filter((s): s is string => !!s)
  return parts.join(' ・ ')
}

function formatDeadlineCountdown(daysLeft: number): string {
  if (daysLeft < 0) return `締切から${-daysLeft}日超過`
  if (daysLeft === 0) return '本日締切'
  return `締切まであと ${daysLeft} 日`
}

function formatAnsweredAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(d)
}

/** 変更のあった行ラベル（氏名・ふりがなは結合。design-mock「変更あり: 住所1・住所2」）。 */
function changedRowLabels(diff: readonly RosterDiffEntry[]): string[] {
  const changed = new Set(diff.map((d) => d.field))
  const labels: string[] = []
  if (changed.has('familyName') || changed.has('givenName')) labels.push('氏名')
  if (changed.has('familyKana') || changed.has('givenKana')) labels.push('ふりがな')
  const nameKana = new Set<RosterField>(['familyName', 'givenName', 'familyKana', 'givenKana'])
  for (const entry of diff) {
    if (nameKana.has(entry.field)) continue
    labels.push(entry.label)
  }
  return labels
}

const initialActionState: RenewalAnswerState = {}

export function RenewalForm({ view }: { view: RenewalFormView | null }) {
  if (view === null) {
    return (
      <div className="py-6 text-center text-sm text-ink-meta">年度確認の対象ではありません。</div>
    )
  }
  return <RenewalFormBody view={view} />
}

function RenewalFormBody({ view }: { view: RenewalFormView }) {
  const [state, formAction, pending] = useActionState(submitRenewalAnswer, initialActionState)

  const readOnly = view.status === 'completed'

  const [answer, setAnswer] = useState<RenewalAnswer>(view.answer ?? 'register')
  const [zenEditMode, setZenEditMode] = useState(view.answer === null)
  const [values, setValues] = useState<RenewalSnapshotSource>(view.current)
  const [editingRows, setEditingRows] = useState<Set<RowKey>>(
    () => new Set(ROW_ORDER.filter((key) => isRowMissing(key, view.current))),
  )

  const [yearEditMode, setYearEditMode] = useState(view.schoolYearAnsweredAtIso === null)
  const [schoolYearAnswer, setSchoolYearAnswer] = useState<SchoolYearAnswerState>(() =>
    view.schoolYearKind !== null
      ? {
          schoolYearKind: view.schoolYearKind,
          nextFacultyKind: view.nextFacultyKind,
          nextFaculty: view.nextFaculty,
          nextSchoolYear: view.nextSchoolYear,
        }
      : computeInitialSchoolYearAnswer(
          view.current.facultyKind,
          view.current.faculty,
          view.current.schoolYear,
        ),
  )

  // サーバー側で未入力が見つかった場合（AC-5）、その行を強制的に編集状態へ開く。
  useEffect(() => {
    const missingLabels = state.missingFields
    if (!missingLabels || missingLabels.length === 0) return
    setEditingRows((prev) => {
      const next = new Set(prev)
      for (const label of missingLabels) {
        const key = ROW_ORDER.find((k) => ROW_LABELS[k] === label)
        if (key) next.add(key)
      }
      return next
    })
    setZenEditMode(true)
  }, [state.missingFields])

  function updateField<K extends keyof RenewalSnapshotSource>(
    field: K,
    val: RenewalSnapshotSource[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: val }))
  }

  function openRow(key: RowKey) {
    setEditingRows((prev) => new Set(prev).add(key))
  }

  const diffFieldSet = useMemo(() => new Set(view.diff.map((d) => d.field)), [view.diff])

  function fieldBefore(field: RosterField): string | null {
    const entry = view.diff.find((d) => d.field === field)
    return entry ? entry.before : formatRosterValue(field, view.current)
  }
  function fieldAfter(field: RosterField): string | null {
    const entry = view.diff.find((d) => d.field === field)
    return entry ? entry.after : formatRosterValue(field, view.current)
  }
  function rowChanged(key: RowKey): boolean {
    return ROW_FIELD_MAP[key].some((f) => diffFieldSet.has(f))
  }
  function rowBefore(key: RowKey): string | null {
    const parts = ROW_FIELD_MAP[key].map(fieldBefore).filter((s): s is string => s != null)
    return parts.length > 0 ? parts.join(' ') : null
  }
  function rowAfter(key: RowKey): string | null {
    const parts = ROW_FIELD_MAP[key].map(fieldAfter).filter((s): s is string => s != null)
    return parts.length > 0 ? parts.join(' ') : null
  }

  const zenShowEdit = view.isZennichikyoTarget && !readOnly && zenEditMode
  const yearShowEdit = view.isCircleTarget && !readOnly && yearEditMode

  const missingRows = zenShowEdit ? ROW_ORDER.filter((key) => isRowMissing(key, values)) : []
  const blockedByMissing = zenShowEdit && answer === 'register' && missingRows.length > 0

  let submitLabel = '回答する'
  if (blockedByMissing) submitLabel = '未入力の項目があります'
  else if (zenShowEdit && answer === 'not_register') submitLabel = 'この内容で回答する'

  const zenAnswered = view.isZennichikyoTarget ? view.answer !== null : true
  const yearAnswered = view.isCircleTarget ? view.schoolYearAnsweredAtIso !== null : true
  const overallAnswered = zenAnswered && yearAnswered

  const statusSummary = overallAnswered
    ? buildAnsweredSummary(view, answer)
    : buildPendingSummary(view, zenAnswered, yearAnswered)
  const statusSub = overallAnswered
    ? buildAnsweredSub(view)
    : formatDeadlineCountdown(diffDays(todayInJst(), view.deadline))

  function hiddenInputsForRow(key: RowKey) {
    return ROW_FIELD_MAP[key].map((field) => (
      <input key={field} type="hidden" name={field} value={rawFieldValue(values, field)} />
    ))
  }

  function renderRowInput(key: RowKey) {
    switch (key) {
      case 'name':
        return (
          <div className="flex gap-2">
            <input
              aria-label="姓"
              name="familyName"
              value={values.familyName ?? ''}
              onChange={(e) => updateField('familyName', e.target.value || null)}
              maxLength={20}
              className={UNDERLINE_CLASS}
              placeholder="姓"
            />
            <input
              aria-label="名"
              name="givenName"
              value={values.givenName ?? ''}
              onChange={(e) => updateField('givenName', e.target.value || null)}
              maxLength={20}
              className={UNDERLINE_CLASS}
              placeholder="名"
            />
          </div>
        )
      case 'kana':
        return (
          <div className="flex gap-2">
            <input
              aria-label="せい"
              name="familyKana"
              value={values.familyKana ?? ''}
              onChange={(e) => updateField('familyKana', e.target.value || null)}
              maxLength={30}
              className={UNDERLINE_CLASS}
              placeholder="せい"
            />
            <input
              aria-label="めい"
              name="givenKana"
              value={values.givenKana ?? ''}
              onChange={(e) => updateField('givenKana', e.target.value || null)}
              maxLength={30}
              className={UNDERLINE_CLASS}
              placeholder="めい"
            />
          </div>
        )
      case 'birthDate':
        return (
          <input
            aria-label="生年月日"
            type="date"
            name="birthDate"
            value={values.birthDate ?? ''}
            onChange={(e) => updateField('birthDate', e.target.value || null)}
            className={UNDERLINE_CLASS}
          />
        )
      case 'gender':
        return (
          <select
            aria-label="性別"
            name="gender"
            value={values.gender ?? ''}
            onChange={(e) =>
              updateField('gender', (e.target.value || null) as RenewalSnapshotSource['gender'])
            }
            className={UNDERLINE_CLASS}
          >
            <option value="">選択してください</option>
            <option value="male">男</option>
            <option value="female">女</option>
          </select>
        )
      case 'dan':
        return (
          <select
            aria-label="段位"
            name="dan"
            value={values.dan && values.dan > 0 ? String(values.dan) : ''}
            onChange={(e) => updateField('dan', e.target.value ? Number(e.target.value) : null)}
            className={UNDERLINE_CLASS}
          >
            <option value="">なし</option>
            {DAN_VALUES.map((d) => (
              <option key={d} value={d}>
                {formatDanKanji(d)}
              </option>
            ))}
          </select>
        )
      case 'grade':
        return (
          <select
            aria-label="級"
            name="grade"
            value={values.grade ?? ''}
            onChange={(e) =>
              updateField('grade', (e.target.value || null) as RenewalSnapshotSource['grade'])
            }
            className={UNDERLINE_CLASS}
          >
            <option value="">選択してください</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )
      case 'postalCode':
        return (
          <input
            aria-label="郵便番号"
            inputMode="numeric"
            name="postalCode"
            value={values.postalCode ?? ''}
            onChange={(e) => updateField('postalCode', e.target.value || null)}
            className={UNDERLINE_CLASS}
          />
        )
      case 'address1':
        return (
          <input
            aria-label="住所1"
            name="address1"
            value={values.address1 ?? ''}
            onChange={(e) => updateField('address1', e.target.value || null)}
            className={UNDERLINE_CLASS}
          />
        )
      case 'address2':
        return (
          <input
            aria-label="住所2"
            name="address2"
            value={values.address2 ?? ''}
            onChange={(e) => updateField('address2', e.target.value || null)}
            className={UNDERLINE_CLASS}
          />
        )
      case 'phone':
        return (
          <input
            aria-label="電話番号"
            inputMode="tel"
            name="phone"
            value={values.phone ?? ''}
            onChange={(e) => updateField('phone', e.target.value || null)}
            className={UNDERLINE_CLASS}
          />
        )
    }
  }

  function renderEditRow(key: RowKey) {
    const required = isRowRequired(key, values)
    const missingNow = isRowMissing(key, values)
    const editing = editingRows.has(key) || missingNow

    if (!editing) {
      return (
        <RosterKvRow
          key={key}
          label={ROW_LABELS[key]}
          required={required}
          action={
            <button
              type="button"
              onClick={() => openRow(key)}
              className="text-xs text-brand"
            >
              修正
            </button>
          }
        >
          <span className="text-sm text-ink">{rowDisplayValue(key, values) ?? '未設定'}</span>
          {hiddenInputsForRow(key)}
        </RosterKvRow>
      )
    }

    return (
      <RosterKvRow key={key} label={ROW_LABELS[key]} required={required}>
        <div className="flex flex-col gap-1">
          {renderRowInput(key)}
          {missingNow && (
            <p className="text-xs text-accent-fg">未入力です。登録するには入力が必要です</p>
          )}
        </div>
      </RosterKvRow>
    )
  }

  function renderViewRow(key: RowKey) {
    if (rowChanged(key)) {
      return (
        <RosterKvRow key={key} label={ROW_LABELS[key]}>
          <span className="block text-[13px] text-ink-muted line-through">{rowBefore(key)}</span>
          <span className="block text-[13px] font-bold text-accent-fg">{rowAfter(key)}</span>
        </RosterKvRow>
      )
    }
    return (
      <RosterKvRow key={key} label={ROW_LABELS[key]}>
        <span className="text-sm text-ink">{rowDisplayValue(key, view.current) ?? '未設定'}</span>
      </RosterKvRow>
    )
  }

  const readerCertText = view.readerCertification
    ? `${READER_CERTIFICATION_LABELS[view.readerCertification]}読手`
    : READER_CERTIFICATION_NONE_LABEL
  const readerCertFull = view.isAssociateReferee ? `${readerCertText}・準公認審判員` : readerCertText

  const readOnlyRows = (
    <>
      <RosterKvRow label="会員区分">
        <span className="text-sm text-ink">
          {MEMBERSHIP_KIND_LABELS[view.membershipKind]}
          <span className="ml-1.5 text-xs text-ink-meta">{MEMBERSHIP_KIND_NOTE}</span>
        </span>
      </RosterKvRow>
      <RosterKvRow label="公認資格">
        <span className="text-sm text-ink">
          {readerCertFull}
          <span className="ml-1.5 text-xs text-ink-meta">変更は管理者へ</span>
        </span>
      </RosterKvRow>
    </>
  )

  const showSubmit = !readOnly && (zenShowEdit || yearShowEdit)

  return (
    <form action={formAction} className="pb-2">
      <input type="hidden" name="renewalId" value={view.renewalId} />

      <div className="sticky top-0 z-[3] -mx-4 -mt-4 border-b border-border-soft bg-canvas px-4 pt-[14px] pb-3">
        <h1 className="font-display text-lg font-bold text-ink">{view.fiscalYear}年度 登録確認</h1>
        <p className="mt-1 text-xs text-ink-meta">
          回答締切 {formatEventDate(view.deadline)} ／ 全日本かるた協会・北海道大学かるた会
        </p>
      </div>

      <AnswerStatusBar
        answered={overallAnswered}
        summary={statusSummary}
        sub={statusSub}
        onEdit={
          overallAnswered && !readOnly
            ? () => {
                setZenEditMode(true)
                setYearEditMode(true)
              }
            : undefined
        }
      />

      <div className="pt-4">
        {view.isZennichikyoTarget && (
          <SectionRule title="全日協の登録" aux={MEMBERSHIP_KIND_LABELS[view.membershipKind]}>
            {zenShowEdit ? (
              <>
                <p className="pb-2.5 text-xs leading-relaxed text-ink-meta">
                  今年度も全日本かるた協会に登録するかを答え、登録する場合は下の内容が今も正しいか確認してください。
                </p>
                <input type="hidden" name="answer" value={answer} />
                <ChoiceCards
                  value={answer}
                  onChange={setAnswer}
                  registerHelp="下の登録内容を確認してください。変わった項目はその場で直せます。"
                  notRegisterHelp="全日協へ退会届を出します（会・アプリの退会ではありません）。移籍する場合は管理者に伝えてください。"
                />
                {answer === 'register' ? (
                  <div className="mt-3.5">
                    {ROW_ORDER.map((key) => renderEditRow(key))}
                    {readOnlyRows}
                  </div>
                ) : (
                  <DisclosureRow
                    className="mt-2.5"
                    label="登録内容"
                    value={buildRegisterSummary(values)}
                    aux="確認だけ"
                  />
                )}
              </>
            ) : (
              <div>
                {answer === 'register' ? (
                  <>
                    {ROW_ORDER.map((key) => renderViewRow(key))}
                    {readOnlyRows}
                  </>
                ) : (
                  <DisclosureRow
                    label="登録内容"
                    value={buildRegisterSummary(view.current)}
                    aux="確認だけ"
                  />
                )}
              </div>
            )}
          </SectionRule>
        )}

        {view.isCircleTarget && (
          <SectionRule title="4月からの学年" aux="サークル所属">
            {yearShowEdit ? (
              <>
                <SchoolYearChooser
                  currentFacultyKind={view.current.facultyKind}
                  currentFaculty={view.current.faculty}
                  currentSchoolYear={view.current.schoolYear}
                  value={schoolYearAnswer}
                  onChange={setSchoolYearAnswer}
                />
                <input type="hidden" name="schoolYearKind" value={schoolYearAnswer.schoolYearKind ?? ''} />
                <input
                  type="hidden"
                  name="nextFacultyKind"
                  value={schoolYearAnswer.nextFacultyKind ?? ''}
                />
                <input type="hidden" name="nextFaculty" value={schoolYearAnswer.nextFaculty ?? ''} />
                <input
                  type="hidden"
                  name="nextSchoolYear"
                  value={schoolYearAnswer.nextSchoolYear ?? ''}
                />
              </>
            ) : (
              <p className="text-sm text-ink">
                {view.current.faculty ?? '未設定'}{' '}
                <b className="font-semibold">{view.current.schoolYear ?? '未設定'}</b>
                {view.nextSchoolYear && (
                  <>
                    <span className="mx-1.5 text-ink-muted" aria-hidden>
                      →
                    </span>
                    {view.nextSchoolYear}
                  </>
                )}
              </p>
            )}
          </SectionRule>
        )}

        {view.isCircleTarget && !view.isZennichikyoTarget && (
          <p className="pt-3.5 text-xs leading-relaxed text-ink-meta">
            全日本かるた協会の登録確認は対象外です（登録者ではありません）。
          </p>
        )}
      </div>

      {state.error && (
        <p
          role="alert"
          className="mx-4 mt-4 rounded-[4px] border border-accent/40 bg-accent-bg px-3 py-2 text-sm text-accent-fg"
        >
          {state.error}
        </p>
      )}

      {showSubmit && (
        <div className="sticky bottom-0 z-[3] mt-4 -mx-4 border-t border-border bg-surface px-4 py-3">
          <Btn type="submit" size="lg" block disabled={pending || blockedByMissing}>
            {pending ? '送信中…' : submitLabel}
          </Btn>
        </div>
      )}
    </form>
  )
}

function rawFieldValue(values: RenewalSnapshotSource, field: RosterField): string {
  const v = values[field]
  if (v === null || v === undefined) return ''
  return String(v)
}

function buildPendingSummary(
  view: RenewalFormView,
  zenAnswered: boolean,
  yearAnswered: boolean,
): string {
  const parts: string[] = []
  if (view.isZennichikyoTarget && !zenAnswered) parts.push('全日協の登録')
  if (view.isCircleTarget && !yearAnswered) parts.push('4月からの学年')
  if (parts.length === 2) return `${parts[0]}と ${parts[1]}`
  return parts[0] ?? ''
}

function buildAnsweredSummary(view: RenewalFormView, answer: RenewalAnswer): string {
  const parts: string[] = []
  if (view.isZennichikyoTarget) {
    parts.push(answer === 'register' ? '今年度も登録する' : '今年度は登録しない')
  }
  if (view.isCircleTarget && view.nextSchoolYear) parts.push(view.nextSchoolYear)
  return parts.join(' ・ ')
}

function buildAnsweredSub(view: RenewalFormView): string {
  const isoCandidates = [
    view.isZennichikyoTarget ? view.answeredAtIso : null,
    view.isCircleTarget ? view.schoolYearAnsweredAtIso : null,
  ].filter((s): s is string => s !== null)
  const latestIso = isoCandidates.sort().at(-1) ?? null
  const dateText = latestIso ? `${formatAnsweredAt(latestIso)} に回答` : ''
  const changed = changedRowLabels(view.diff)
  return changed.length > 0 ? `${dateText} ・ 変更あり: ${changed.join('・')}` : dateText
}
