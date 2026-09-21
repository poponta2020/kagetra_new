'use client'

import { startTransition, useActionState, useState, type FormEvent } from 'react'
import { schoolYearOptions } from '@kagetra/shared'
import type { FacultyKind } from '@kagetra/shared/types'
import { FacultyCombobox } from '@/components/members/FacultyCombobox'
import { BoxlessCheckbox, Field, SegmentGroup, UNDERLINE_INPUT_CLASS, UnderlineInput, UnderlineSelect } from '@/components/register/flat-fields'
import type { RosterCandidate } from '@/lib/roster-claim-input'

export type RosterClaimFormState = { error?: string }

/**
 * roster-claim（名簿突合）の共通フォーム部品。`/register/[token]`（S2a）と
 * `/self-identify`（S3）の両方から、見た目（A-flat）を共用して使う。
 *
 * `candidates` はサーバーから渡された名簿候補の一覧で、氏名と「電話・生年月日
 * が未入力かどうか」の印だけを持つ（PII そのものは載らない）。入力はすべて
 * controlled にしている — action がエラーを返しても選択・入力内容を保った
 * まま再表示できるようにする。
 *
 * 送信は `<form action>` ではなく onSubmit から action を呼ぶ。`<form action>`
 * だと React 19 が action の完了後に form.reset() をかけ、controlled でも
 * ラジオ・チェックボックスの見た目がマウント時の値（未選択・OFF）へ戻る
 * （React は checked の変化を defaultChecked に反映しないため）。すると
 * 「サークル所属」が外れて見えたまま再送信され、所属 OFF として紐付いてしまう。
 */
export function RosterClaimForm({
  action,
  candidates,
  submitLabel,
}: {
  action: (prev: RosterClaimFormState, formData: FormData) => Promise<RosterClaimFormState>
  candidates: RosterCandidate[]
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, {})
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [isCircleMember, setIsCircleMember] = useState(false)
  const [facultyKind, setFacultyKind] = useState<FacultyKind>('undergraduate')
  const [faculty, setFaculty] = useState('')
  const [schoolYear, setSchoolYear] = useState('')
  const [phone, setPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')

  const selected = candidates.find((c) => c.id === selectedId)

  const q = query.trim().toLowerCase()
  const filtered = candidates.filter((c) => {
    if (c.id === selectedId) return true
    if (!q) return true
    return (c.name ?? '').toLowerCase().includes(q)
  })

  function toggleCircleMember(checked: boolean) {
    setIsCircleMember(checked)
    if (checked) {
      setFacultyKind('undergraduate')
    } else {
      setFaculty('')
      setSchoolYear('')
      setPhone('')
      setBirthDate('')
    }
  }

  function changeFacultyKind(next: FacultyKind) {
    setFacultyKind(next)
    setFaculty('')
    setSchoolYear('')
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(() => formAction(formData))
  }

  const showPhone = isCircleMember && !!selected?.needsPhone
  const showBirthDate = isCircleMember && !!selected?.needsBirthDate

  return (
    <form onSubmit={handleSubmit} className="space-y-7">
      <div>
        <label htmlFor="roster-search" className="sr-only">
          会員を検索
        </label>
        <input
          id="roster-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="お名前で検索"
          autoComplete="off"
          className={UNDERLINE_INPUT_CLASS}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink">お名前</legend>
        {filtered.length === 0 ? (
          <p className="py-3 text-sm text-ink-meta">一致する会員が見つかりません。</p>
        ) : (
          <div className="max-h-72 divide-y divide-border-soft overflow-y-auto border-y border-border">
            {filtered.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-3 px-1 py-3 hover:bg-surface-alt"
              >
                <input
                  type="radio"
                  name="userId"
                  value={c.id}
                  checked={selected?.id === c.id}
                  onChange={() => setSelectedId(c.id)}
                  required
                  className="h-4 w-4 shrink-0 accent-brand"
                />
                <span className="text-sm text-ink">{c.name ?? '(名前未設定)'}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <section className="space-y-3 border-t border-border pt-5">
        <BoxlessCheckbox
          name="isCircleMember"
          checked={isCircleMember}
          onChange={toggleCircleMember}
          label="北海道大学のサークル「北大かるた会」に所属している"
        />
        <p className="text-xs text-ink-meta">
          大会の遠征届（大学へ提出）に必要な情報を登録します。学年は毎年4月に見直してください。
        </p>

        {isCircleMember && (
          <div className="space-y-5">
            <Field label="所属" htmlFor="roster-faculty-kind-group" asGroup>
              <SegmentGroup
                name="facultyKind"
                ariaLabel="所属"
                value={facultyKind}
                onChange={(v) => changeFacultyKind(v as FacultyKind)}
                options={[
                  { value: 'undergraduate', label: '学部', ariaLabel: '学部' },
                  { value: 'graduate', label: '大学院', ariaLabel: '大学院' },
                ]}
              />
            </Field>

            <Field label="学部等名" htmlFor="roster-faculty">
              <FacultyCombobox
                id="roster-faculty"
                name="faculty"
                kind={facultyKind}
                value={faculty}
                onChange={setFaculty}
                required
                className={UNDERLINE_INPUT_CLASS}
              />
              <p className="text-xs text-ink-meta">候補から選ぶか、そのまま入力できます。</p>
            </Field>

            <Field label="学年" htmlFor="roster-school-year">
              <UnderlineSelect
                id="roster-school-year"
                name="schoolYear"
                required
                value={schoolYear}
                onChange={setSchoolYear}
                options={schoolYearOptions(facultyKind)}
              />
            </Field>

            {(showPhone || showBirthDate) && (
              <p className="text-xs text-ink-meta">
                名簿に登録がないため、次の項目も入力してください。
              </p>
            )}

            {showPhone && (
              <Field label="電話番号" htmlFor="roster-phone">
                <UnderlineInput
                  id="roster-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  required
                  value={phone}
                  onChange={setPhone}
                  autoComplete="tel"
                />
              </Field>
            )}

            {showBirthDate && (
              <Field label="生年月日" htmlFor="roster-birth-date">
                <UnderlineInput
                  id="roster-birth-date"
                  name="birthDate"
                  type="date"
                  required
                  value={birthDate}
                  onChange={setBirthDate}
                />
              </Field>
            )}
          </div>
        )}
      </section>

      {state.error && (
        <p role="alert" className="rounded-[4px] border border-accent/40 bg-accent-bg px-3 py-2 text-sm text-accent-fg">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[4px] bg-brand px-4 py-3 text-sm font-semibold text-ink-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? '送信中…' : submitLabel}
      </button>
    </form>
  )
}
