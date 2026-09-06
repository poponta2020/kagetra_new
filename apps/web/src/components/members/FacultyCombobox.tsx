'use client'

import { useId } from 'react'
import { facultyOptions } from '@kagetra/shared'
import type { FacultyKind } from '@kagetra/shared/types'

/**
 * 学部等名の候補つき自由入力（travel-report design-spec §4 `FacultyCombobox`）。
 *
 * `kind`（学部／大学院）で候補セットを切り替える（requirements R1）。候補は
 * ネイティブ `<datalist>` で提示するだけで、**候補外の文字列もそのまま保存できる**
 * （`<input list>` は自由入力を妨げない）。S1（登録）・S2（会員編集）・S3（一括編集）
 * の3箇所で使うため、見た目（className）は呼び出し側が完全に指定する。
 */
export function FacultyCombobox({
  id,
  name,
  kind,
  value,
  onChange,
  required,
  className,
}: {
  id: string
  name: string
  kind: FacultyKind
  value: string
  onChange: (v: string) => void
  required?: boolean
  className: string
}) {
  const listId = useId()
  const options = facultyOptions(kind)

  return (
    <>
      <input
        id={id}
        name={name}
        type="text"
        list={listId}
        value={value}
        required={required}
        maxLength={50}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={className}
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </>
  )
}
