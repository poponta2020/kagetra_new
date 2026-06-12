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
  lineLinked,
  grade,
  gender,
  affiliation,
  dan,
  zenNichikyo,
  grades,
  genders,
}: {
  userId: string
  name: string
  lineLinked: boolean
  grade: Grade | null
  gender: Gender | null
  affiliation: string
  dan: number | null
  zenNichikyo: boolean
  grades: readonly Grade[]
  genders: readonly Gender[]
}) {
  const [state, formAction, pending] = useActionState(
    updateMemberProfile,
    initialState,
  )

  return (
    <>
      {!lineLinked && <NameEditForm userId={userId} name={name} />}
      <form action={formAction} className="space-y-4 rounded-lg bg-white p-4 shadow-sm">
        <input type="hidden" name="userId" value={userId} />

        {lineLinked && (
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
