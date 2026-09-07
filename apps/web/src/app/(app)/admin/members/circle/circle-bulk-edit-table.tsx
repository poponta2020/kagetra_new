'use client'

import { useActionState, useState } from 'react'
import { schoolYearOptions } from '@kagetra/shared'
import type { FacultyKind } from '@kagetra/shared/types'
import { FacultyCombobox } from '@/components/members/FacultyCombobox'
import { bulkUpdateCircleMembers, type BulkUpdateCircleState } from './actions'

const initialState: BulkUpdateCircleState = {}

export type CircleMemberRow = {
  id: string
  name: string
  isCircleMember: boolean
  facultyKind: FacultyKind | null
  faculty: string | null
  schoolYear: string | null
}

type RowState = {
  isCircleMember: boolean
  facultyKind: FacultyKind
  faculty: string
  schoolYear: string
}

/**
 * S3 一括編集表（design-spec §10「1人1行: サークル所属チェック・所属・学部等名・
 * 学年、末尾に保存」）。1回の送信で複数人ぶんの値を送るため、行ごとの
 * フィールド名を `<field>_${userId}` にし、対象 userId の集合は同名 hidden
 * input（`userIds`）の繰り返しで持つ（未チェック行はキー自体が来ないため）。
 */
export function CircleBulkEditTable({ members }: { members: CircleMemberRow[] }) {
  const [state, formAction, pending] = useActionState(
    bulkUpdateCircleMembers,
    initialState,
  )
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      members.map((m) => [
        m.id,
        {
          isCircleMember: m.isCircleMember,
          facultyKind: m.facultyKind ?? 'undergraduate',
          faculty: m.faculty ?? '',
          schoolYear: m.schoolYear ?? '',
        },
      ]),
    ),
  )

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => {
      const current = prev[id]
      if (!current) return prev
      return { ...prev, [id]: { ...current, ...patch } }
    })
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-success">
          {state.updatedCount}件のサークル所属を保存しました。
        </p>
      )}
      <div className="overflow-x-auto rounded-lg bg-surface shadow-sm">
        <table className="min-w-full divide-y divide-border-soft">
          <thead className="bg-surface-alt">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-fg">
                名前
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-fg">
                サークル所属
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-fg">
                所属
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-fg">
                学部等名
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-neutral-fg">
                学年
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {members.map((m) => {
              const row = rows[m.id]
              if (!row) return null
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <input type="hidden" name="userIds" value={m.id} />
                    {m.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      name={`isCircleMember_${m.id}`}
                      checked={row.isCircleMember}
                      onChange={(e) =>
                        updateRow(m.id, { isCircleMember: e.target.checked })
                      }
                      aria-label={`${m.name} のサークル所属`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {row.isCircleMember && (
                      <select
                        name={`facultyKind_${m.id}`}
                        value={row.facultyKind}
                        onChange={(e) =>
                          updateRow(m.id, {
                            facultyKind: e.target.value as FacultyKind,
                            faculty: '',
                            schoolYear: '',
                          })
                        }
                        aria-label={`${m.name} の所属`}
                        className="rounded-md border border-border px-2 py-1 text-sm"
                      >
                        <option value="undergraduate">学部</option>
                        <option value="graduate">大学院</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {row.isCircleMember && (
                      <FacultyCombobox
                        id={`faculty-${m.id}`}
                        name={`faculty_${m.id}`}
                        kind={row.facultyKind}
                        value={row.faculty}
                        onChange={(v) => updateRow(m.id, { faculty: v })}
                        required
                        className="w-full min-w-[10rem] rounded-md border border-border px-2 py-1 text-sm"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {row.isCircleMember && (
                      <select
                        name={`schoolYear_${m.id}`}
                        value={row.schoolYear}
                        onChange={(e) =>
                          updateRow(m.id, { schoolYear: e.target.value })
                        }
                        aria-label={`${m.name} の学年`}
                        className="rounded-md border border-border px-2 py-1 text-sm"
                      >
                        <option value="">未設定</option>
                        {schoolYearOptions(row.facultyKind).map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink-on-brand hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? '保存中…' : 'まとめて保存'}
      </button>
    </form>
  )
}
