'use client'

import { useActionState, useId, useState } from 'react'
import { registerViaInvite, type RegisterViaInviteState } from './actions'

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const
const DAN_OPTIONS = [
  { value: '4', label: '四段' },
  { value: '5', label: '五段' },
  { value: '6', label: '六段' },
  { value: '7', label: '七段' },
  { value: '8', label: '八段' },
] as const
const initialState: RegisterViaInviteState = {}

const gradeAllowsZen = (g: string) => g === 'A' || g === 'B' || g === 'C'

/**
 * Invite-link registration form (A-flat). Staged display driven by 級 + 全日協:
 *   - 級 D/E/未選択 → 氏名＋級のみ
 *   - 級 A          → ＋段位（必須・既定四段）＋全日協チェック
 *   - 級 B/C        → ＋全日協チェック
 *   - 全日協 ON     → ＋全日協登録情報（性別/生年月日/電話/郵便→住所検索/住所1・2）
 *
 * Inputs are controlled so a validation / duplicate error keeps what the user
 * typed (React 19 resets uncontrolled fields after a form action). Server-side
 * invariants in registerViaInvite are authoritative — hidden fields are simply
 * not submitted, so this UI only needs to gate visibility + front-side required.
 * `token` is fixed via `.bind`. On success the action redirects to the
 * dashboard, so there is no success state to render here.
 */
export function RegisterForm({ token }: { token: string }) {
  const [familyName, setFamilyName] = useState('')
  const [givenName, setGivenName] = useState('')
  const [familyKana, setFamilyKana] = useState('')
  const [givenKana, setGivenKana] = useState('')
  const [grade, setGrade] = useState('')
  const [dan, setDan] = useState('4')
  const [zenNichikyo, setZenNichikyo] = useState(true)
  const [gender, setGender] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [phone, setPhone] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  const [detachedHouse, setDetachedHouse] = useState(false)
  const [zipStatus, setZipStatus] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'error'; msg?: string }>(
    { kind: 'idle' },
  )

  const boundAction = registerViaInvite.bind(null, token)
  const [state, formAction, pending] = useActionState(boundAction, initialState)

  const showDan = grade === 'A'
  const showZen = gradeAllowsZen(grade)
  const showPii = showZen && zenNichikyo

  // 級変更で上位限定項目を既定へリセット（隠した値が紛れ込まないよう、
  // 表示も値もクリーンに戻す。サーバーも不変条件で強制する）。
  function changeGrade(next: string) {
    setGrade(next)
    setDan('4')
    setZenNichikyo(true)
    // 全日協 PII も初期化する。B/C/A で入力 → D/E へ降級 → 再び B/C/A に戻す
    // 経路では changeGrade が zenNichikyo を ON に戻すため、PII 状態を残すと
    // 旧入力が再表示時に復活してそのまま送信され得る。表示と値を同時に戻す。
    setGender('')
    setBirthDate('')
    setPhone('')
    setPostalCode('')
    setAddress1('')
    setAddress2('')
    setDetachedHouse(false)
    setZipStatus({ kind: 'idle' })
  }

  async function searchZip() {
    const normalized = postalCode.replace(/[\s-]/g, '')
    if (!/^\d{7}$/.test(normalized)) {
      setZipStatus({ kind: 'error', msg: '郵便番号は7桁で入力してください。' })
      return
    }
    setZipStatus({ kind: 'loading' })
    try {
      const res = await fetch(`/api/zip?zipcode=${normalized}`)
      const data = (await res.json()) as { address?: string; error?: string }
      if (res.ok && data.address) {
        setAddress1(data.address)
        setZipStatus({ kind: 'ok', msg: '住所を補完しました。続けて丁目・番地を入力してください。' })
      } else {
        setZipStatus({ kind: 'error', msg: data.error ?? '住所を取得できませんでした。住所を手入力してください。' })
      }
    } catch {
      setZipStatus({ kind: 'error', msg: '住所を取得できませんでした。住所を手入力してください。' })
    }
  }

  return (
    <form action={formAction} className="space-y-7">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink">お名前</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <Field label="姓（漢字）" htmlFor="fn">
            <UnderlineInput id="fn" name="familyName" required maxLength={20} value={familyName} onChange={setFamilyName} autoComplete="family-name" />
          </Field>
          <Field label="名（漢字）" htmlFor="gn">
            <UnderlineInput id="gn" name="givenName" required maxLength={20} value={givenName} onChange={setGivenName} autoComplete="given-name" />
          </Field>
          <Field label="せい（ふりがな）" htmlFor="fk">
            <UnderlineInput id="fk" name="familyKana" required maxLength={30} value={familyKana} onChange={setFamilyKana} />
          </Field>
          <Field label="めい（ふりがな）" htmlFor="gk">
            <UnderlineInput id="gk" name="givenKana" required maxLength={30} value={givenKana} onChange={setGivenKana} />
          </Field>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">級</h2>
        <SegmentGroup
          name="grade"
          ariaLabel="級"
          value={grade}
          onChange={changeGrade}
          options={GRADES.map((g) => ({ value: g, label: g, ariaLabel: `${g}級` }))}
        />
        <p className="text-xs text-ink-meta">後から会員ページでいつでも変更できます。</p>
      </section>

      {showZen && (
        <section>
          <BoxlessCheckbox
            name="zenNichikyo"
            checked={zenNichikyo}
            onChange={setZenNichikyo}
            label="全日本かるた協会（全日協）に登録済み"
          />
        </section>
      )}

      {showDan && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">段位</h2>
          <SegmentGroup
            name="dan"
            ariaLabel="段位"
            value={dan}
            onChange={setDan}
            options={DAN_OPTIONS.map((d) => ({ value: d.value, label: d.label, ariaLabel: d.label }))}
          />
          <p className="text-xs text-ink-meta">A級の方のみ。該当する段位を選択してください。</p>
        </section>
      )}

      {showPii && (
        <section className="space-y-5 border-t border-border pt-5">
          <h2 className="text-sm font-semibold text-ink">全日協登録情報</h2>

          <Field label="性別" htmlFor="gender-group" asGroup>
            <SegmentGroup
              name="gender"
              ariaLabel="性別"
              value={gender}
              onChange={setGender}
              options={[
                { value: 'male', label: '男性', ariaLabel: '男性' },
                { value: 'female', label: '女性', ariaLabel: '女性' },
              ]}
            />
          </Field>

          <Field label="生年月日" htmlFor="bd">
            <UnderlineInput id="bd" name="birthDate" type="date" required value={birthDate} onChange={setBirthDate} />
          </Field>

          <Field label="電話番号" htmlFor="ph">
            <UnderlineInput id="ph" name="phone" type="tel" inputMode="tel" required value={phone} onChange={setPhone} autoComplete="tel" />
          </Field>

          <div className="space-y-2">
            <Field label="郵便番号" htmlFor="pc">
              <div className="flex items-end gap-2">
                <UnderlineInput id="pc" name="postalCode" inputMode="numeric" required value={postalCode} onChange={(v) => { setPostalCode(v); setZipStatus({ kind: 'idle' }) }} autoComplete="postal-code" className="flex-1" />
                <button
                  type="button"
                  onClick={searchZip}
                  disabled={zipStatus.kind === 'loading'}
                  className="shrink-0 rounded-[4px] border border-brand px-3 py-1.5 text-xs font-semibold text-brand disabled:opacity-60"
                >
                  {zipStatus.kind === 'loading' ? '検索中…' : '住所を検索'}
                </button>
              </div>
            </Field>
            {zipStatus.msg && (
              <p role="status" className={`text-xs ${zipStatus.kind === 'error' ? 'text-accent-fg' : 'text-ink-meta'}`}>
                {zipStatus.msg}
              </p>
            )}
          </div>

          <Field label="住所1（丁目・番地まで）" htmlFor="a1">
            <UnderlineInput id="a1" name="address1" required value={address1} onChange={setAddress1} autoComplete="address-line1" />
          </Field>

          <div className="space-y-2">
            <Field label="住所2（建物名・部屋番号）" htmlFor="a2">
              <UnderlineInput
                id="a2"
                name="address2"
                value={detachedHouse ? '' : address2}
                onChange={setAddress2}
                disabled={detachedHouse}
                required={!detachedHouse}
                autoComplete="address-line2"
              />
            </Field>
            <BoxlessCheckbox
              checked={detachedHouse}
              onChange={(c) => { setDetachedHouse(c); if (c) setAddress2('') }}
              label="集合住宅ではない（一軒家）のため未入力"
              small
            />
          </div>

          <p className="text-xs text-ink-meta">免状・かるた展望などの郵送先になります。</p>
        </section>
      )}

      {state.error && (
        <p role="alert" className="rounded-[4px] border border-accent/40 bg-accent-bg px-3 py-2 text-sm text-accent-fg">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[4px] bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? '登録中…' : '登録する'}
      </button>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  asGroup,
  children,
}: {
  label: string
  htmlFor: string
  asGroup?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={asGroup ? undefined : htmlFor}
        className="block text-xs font-medium text-ink-2"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function UnderlineInput({
  id,
  name,
  value,
  onChange,
  type = 'text',
  required,
  maxLength,
  inputMode,
  disabled,
  autoComplete,
  className = '',
}: {
  id: string
  name: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  maxLength?: number
  inputMode?: 'numeric' | 'tel'
  disabled?: boolean
  autoComplete?: string
  className?: string
}) {
  return (
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      required={required}
      maxLength={maxLength}
      inputMode={inputMode}
      disabled={disabled}
      autoComplete={autoComplete}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full border-0 border-b border-border bg-transparent px-0 py-1.5 text-sm text-ink outline-none focus:border-brand disabled:opacity-50 ${className}`}
    />
  )
}

function SegmentGroup({
  name,
  ariaLabel,
  value,
  onChange,
  options,
}: {
  name: string
  ariaLabel: string
  value: string
  onChange: (v: string) => void
  options: ReadonlyArray<{ value: string; label: string; ariaLabel: string }>
}) {
  const groupId = useId()
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1">
      {options.map((opt) => {
        const selected = value === opt.value
        const inputId = `${groupId}-${name}-${opt.value}`
        return (
          <label
            key={opt.value}
            htmlFor={inputId}
            className={`flex-1 cursor-pointer border-b-2 pb-2 pt-1 text-center text-sm transition-colors ${
              selected ? 'border-brand font-semibold text-ink' : 'border-border text-ink-meta'
            }`}
          >
            <input
              id={inputId}
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              aria-label={opt.ariaLabel}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        )
      })}
    </div>
  )
}

function BoxlessCheckbox({
  name,
  checked,
  onChange,
  label,
  small,
}: {
  name?: string
  checked: boolean
  onChange: (c: boolean) => void
  label: string
  small?: boolean
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 ${small ? 'text-xs text-ink-meta' : 'text-sm text-ink-2'}`}>
      <input
        type="checkbox"
        name={name}
        value="on"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-brand"
      />
      {label}
    </label>
  )
}
