'use client'

import { useActionState, useState } from 'react'
import type { Grade, Gender } from '@kagetra/shared/types'
import {
  updateMemberName,
  updateMemberProfile,
  type UpdateNameState,
  type UpdateProfileState,
} from './actions'

const initialState: UpdateProfileState = {}
const nameInitialState: UpdateNameState = {}

const GENDER_LABEL: Record<Gender, string> = {
  male: '男',
  female: '女',
}

/**
 * Standalone rename form, shown only while the member has no LINE binding.
 * Kept as its own <form> (separate from the profile form) so a profile save
 * can never accidentally submit a name change. The input is controlled so an
 * error response keeps what the admin typed.
 */
function NameEditForm({ userId, name }: { userId: string; name: string }) {
  const [state, formAction, pending] = useActionState(
    updateMemberName,
    nameInitialState,
  )
  const [value, setValue] = useState(name)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg bg-white p-4 shadow-sm"
    >
      <input type="hidden" name="userId" value={userId} />
      <div>
        <label
          htmlFor="member-name"
          className="block text-sm font-medium text-gray-700"
        >
          名前
        </label>
        <input
          id="member-name"
          name="name"
          type="text"
          required
          maxLength={50}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">
          LINE 紐付け前のため修正できます。
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-green-600">
          名前を変更しました。
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? '保存中…' : '名前を保存'}
      </button>
    </form>
  )
}

export function EditMemberForm({
  userId,
  name,
  nameEditable,
  grade,
  gender,
  affiliation,
  dan,
  zenNichikyo,
  familyName,
  givenName,
  familyKana,
  givenKana,
  birthDate,
  phone,
  postalCode,
  address1,
  address2,
  grades,
  genders,
}: {
  userId: string
  name: string
  // 名前編集を解禁するのは「LINE 未紐付け かつ role=member」のときだけ。
  // 紐付け済み or admin/vice_admin 行は readOnly（page.tsx 側で算出）。
  nameEditable: boolean
  grade: Grade | null
  gender: Gender | null
  affiliation: string
  dan: number | null
  zenNichikyo: boolean
  // invite-register-redesign: 構造化氏名＋全日協 PII（管理者/副管理者のみ閲覧/編集）。
  familyName: string
  givenName: string
  familyKana: string
  givenKana: string
  birthDate: string
  phone: string
  postalCode: string
  address1: string
  address2: string
  grades: readonly Grade[]
  genders: readonly Gender[]
}) {
  const [state, formAction, pending] = useActionState(
    updateMemberProfile,
    initialState,
  )

  return (
    <>
      {nameEditable && <NameEditForm userId={userId} name={name} />}
      <form action={formAction} className="space-y-4 rounded-lg bg-white p-4 shadow-sm">
        <input type="hidden" name="userId" value={userId} />

        {!nameEditable && (
          <div>
            <label className="block text-sm font-medium text-gray-700">名前</label>
            <input
              type="text"
              value={name}
              readOnly
              className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              ユーザー名はログインに使われるため、この画面からは変更できません。
            </p>
          </div>
        )}

        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="mb-1 text-sm font-medium text-gray-700">
            氏名・ふりがな（任意）
          </legend>
          <div>
            <label htmlFor="familyName" className="block text-xs text-gray-600">
              姓（漢字）
            </label>
            <input
              id="familyName"
              name="familyName"
              type="text"
              maxLength={20}
              defaultValue={familyName}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="givenName" className="block text-xs text-gray-600">
              名（漢字）
            </label>
            <input
              id="givenName"
              name="givenName"
              type="text"
              maxLength={20}
              defaultValue={givenName}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="familyKana" className="block text-xs text-gray-600">
              せい（ふりがな）
            </label>
            <input
              id="familyKana"
              name="familyKana"
              type="text"
              maxLength={30}
              defaultValue={familyKana}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="givenKana" className="block text-xs text-gray-600">
              めい（ふりがな）
            </label>
            <input
              id="givenKana"
              name="givenKana"
              type="text"
              maxLength={30}
              defaultValue={givenKana}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <p className="col-span-2 text-xs text-gray-500">
            表示名（ログイン名）は上の「名前」が正典で、ここでは変更されません。
          </p>
        </fieldset>

        <div>
          <label
            htmlFor="grade"
            className="block text-sm font-medium text-gray-700"
          >
            級
          </label>
          <select
            id="grade"
            name="grade"
            defaultValue={grade ?? ''}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">未設定</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}級
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="gender"
            className="block text-sm font-medium text-gray-700"
          >
            性別
          </label>
          <select
            id="gender"
            name="gender"
            defaultValue={gender ?? ''}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">未設定</option>
            {genders.map((g) => (
              <option key={g} value={g}>
                {GENDER_LABEL[g]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="affiliation"
            className="block text-sm font-medium text-gray-700"
          >
            所属（学校名 / 社会人 など）
          </label>
          <input
            id="affiliation"
            name="affiliation"
            type="text"
            defaultValue={affiliation}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="dan"
            className="block text-sm font-medium text-gray-700"
          >
            段位（0〜9）
          </label>
          <input
            id="dan"
            name="dan"
            type="number"
            min={0}
            max={9}
            defaultValue={dan ?? ''}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="zenNichikyo"
            name="zenNichikyo"
            type="checkbox"
            defaultChecked={zenNichikyo}
            className="h-4 w-4"
          />
          <label htmlFor="zenNichikyo" className="text-sm font-medium text-gray-700">
            全日協会員
          </label>
        </div>

        <fieldset className="space-y-3 border-t border-gray-200 pt-4">
          <legend className="text-sm font-medium text-gray-700">
            全日協登録情報（任意・管理者のみ閲覧）
          </legend>
          <div>
            <label htmlFor="birthDate" className="block text-xs text-gray-600">
              生年月日
            </label>
            <input
              id="birthDate"
              name="birthDate"
              type="date"
              defaultValue={birthDate}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-xs text-gray-600">
              電話番号
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={phone}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="postalCode" className="block text-xs text-gray-600">
              郵便番号
            </label>
            <input
              id="postalCode"
              name="postalCode"
              inputMode="numeric"
              defaultValue={postalCode}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="address1" className="block text-xs text-gray-600">
              住所1（丁目・番地まで）
            </label>
            <input
              id="address1"
              name="address1"
              type="text"
              maxLength={100}
              defaultValue={address1}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="address2" className="block text-xs text-gray-600">
              住所2（建物名・部屋番号）
            </label>
            <input
              id="address2"
              name="address2"
              type="text"
              maxLength={100}
              defaultValue={address2}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </fieldset>

        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
        {state.success && (
          <p role="status" className="text-sm text-green-600">
            更新しました。
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? '更新中…' : '保存'}
        </button>
      </form>
    </>
  )
}
