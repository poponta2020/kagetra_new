'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Btn, Card, Pill } from '@/components/ui'
import { adoptRosterFile, releaseRosterFile } from '../actions'
import {
  formatGradeLabel,
  listGradeCandidates,
  listUnifiedCandidates,
  type RosterAdoptGrade,
  type RosterAdoptGroup,
} from '../roster-adopt-utils'

/**
 * roster-file-adoption: メール詳細の各添付に出す「名簿ファイルとして採用」導線。
 * 未採用なら採用フォーム（名簿種別・取込単位・対象・発表日）を出すボトムシート、
 * 採用済みなら採用状態（種別・級・対象大会名）表示 + 解除ボタンに切り替わる。
 *
 * 2026-08-01 改修: 対象がイベントから**申込グループ**になり、取込単位
 * （グループ統一 / 級別）を選べるようになった。候補は既定で「いま取り込むべき
 * 対象」（申込済み × 未取込）だけに絞り、「すべて表示」トグルで基本条件のみの
 * 全候補へ広げる（複数ファイル採用・申込済みマーク忘れの逃げ道 = AC-17）。
 * 仕分けの計算は `roster-adopt-utils.ts` の純関数が持ち、ここは選択状態と送信だけ。
 *
 * ボトムシートの様式は ExistingEventLinkSheet と同じ
 * （createPortal(document.body) + `.modal-overlay-h`、overflow-y-auto コンテナに
 * min-h-0）。
 */

const ROSTER_TYPE_LABEL: Record<'applicant' | 'confirmed', string> = {
  applicant: '申込者名簿',
  confirmed: '確定名簿',
}

/** 取込単位。`group` = グループ統一名簿（全級カバー）/ `grade` = 級別名簿。 */
type AdoptUnit = 'group' | 'grade'

const UNIT_LABEL: Record<AdoptUnit, string> = {
  group: 'グループ統一名簿',
  grade: '級別名簿',
}

export interface RosterFileAdoptionInfo {
  id: number
  rosterType: 'applicant' | 'confirmed'
  /** 取込単位。null = グループ統一（ラベルなし）。 */
  grades: RosterAdoptGrade[] | null
  /** 帰属する entry_group が持つ全イベントのタイトル（採用は entry_group 単位）。 */
  eventTitles: string[]
}

export function RosterFileAdoptSheet({
  attachmentId,
  attachmentFilename,
  groups,
  adoption,
}: {
  attachmentId: number
  attachmentFilename: string
  /** 基本条件を満たす候補グループ（サーバーが絞った母集団）。 */
  groups: RosterAdoptGroup[]
  adoption: RosterFileAdoptionInfo | null
}) {
  const [open, setOpen] = useState(false)
  const [unit, setUnit] = useState<AdoptUnit>('group')
  const [rosterType, setRosterType] = useState<'applicant' | 'confirmed'>('applicant')
  const [showAll, setShowAll] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  // 級別は**同一グループ内でのみ**複数選択できる（「A・B級名簿」のように 1 ファイルが
  // 複数級をカバーするケース）。別グループの級を触ったら選択はそちらへ移る
  // （1 採用レコード = 1 グループなので、跨いだ選択は保存できない）。
  const [selectedGrades, setSelectedGrades] = useState<RosterAdoptGrade[]>([])
  const [publishedAt, setPublishedAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const unifiedCandidates = useMemo(
    () => listUnifiedCandidates(groups, rosterType, showAll),
    [groups, rosterType, showAll],
  )
  const gradeCandidates = useMemo(
    () => listGradeCandidates(groups, rosterType, showAll),
    [groups, rosterType, showAll],
  )

  // Sheet を開いた時に状態をリセット（ExistingEventLinkSheet と同じ規約）。
  useEffect(() => {
    if (open) {
      setUnit('group')
      setRosterType('applicant')
      setShowAll(false)
      setSelectedGroupId(null)
      setSelectedGrades([])
      setPublishedAt('')
      setError(null)
    }
  }, [open])

  // 種別・単位・トグルを切り替えると候補の母集団が変わり、前の選択が候補外に
  // なりうる。残したまま送信すると画面に出ていない対象へ採用してしまうので毎回捨てる。
  const resetSelection = () => {
    setSelectedGroupId(null)
    setSelectedGrades([])
  }

  const toggleGrade = (groupId: number, grade: RosterAdoptGrade) => {
    if (selectedGroupId !== groupId) {
      setSelectedGroupId(groupId)
      setSelectedGrades([grade])
      return
    }
    setSelectedGrades((prev) =>
      prev.includes(grade) ? prev.filter((g) => g !== grade) : [...prev, grade],
    )
  }

  const canSubmit = selectedGroupId != null && (unit === 'group' || selectedGrades.length > 0)

  const onAdopt = () => {
    if (!canSubmit || selectedGroupId == null) return
    setError(null)
    startTransition(async () => {
      const result = await adoptRosterFile(
        attachmentId,
        selectedGroupId,
        rosterType,
        unit === 'group' ? null : selectedGrades,
        publishedAt.trim() || null,
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  const onRelease = () => {
    if (adoption == null) return
    setError(null)
    startTransition(async () => {
      const result = await releaseRosterFile(adoption.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  if (adoption) {
    const adoptedGradeLabel = adoption.grades ? formatGradeLabel(adoption.grades) : ''
    return (
      <Card>
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="max-w-[65%] truncate text-ink-2">{attachmentFilename}</span>
            <div className="flex flex-none items-center gap-1">
              <Pill tone="success" size="sm">
                {ROSTER_TYPE_LABEL[adoption.rosterType]}
              </Pill>
              {/* AC-18: 級別採用にだけ級ラベルを添える（統一採用・既存データは出さない）。 */}
              {adoptedGradeLabel && (
                <Pill tone="neutral" size="sm">
                  {adoptedGradeLabel}
                </Pill>
              )}
            </div>
          </div>
          <span className="text-xs text-ink-meta">
            対象大会: {adoption.eventTitles.length > 0 ? adoption.eventTitles.join('・') : '(不明)'}
          </span>
          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          <div>
            <Btn kind="ghost" size="sm" onClick={onRelease} disabled={pending}>
              {pending ? '処理中…' : '採用を解除'}
            </Btn>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="max-w-[60%] truncate text-ink-2">{attachmentFilename}</span>
          <Btn kind="secondary" size="sm" onClick={() => setOpen(true)} disabled={pending}>
            名簿ファイルとして採用
          </Btn>
        </div>
      </Card>
      {/* Portal + .modal-overlay-h (svh cascade): ExistingEventLinkSheet と同じ既知バグ回避。 */}
      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="adopt-roster-file-sheet-title"
          className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col rounded-t-lg bg-surface p-4 shadow-lg sm:max-w-md sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="adopt-roster-file-sheet-title"
              className="font-display text-base font-bold text-ink"
            >
              名簿ファイルとして採用
            </h2>
            <p className="mt-1 text-xs text-ink-meta">
              {attachmentFilename} を対象の名簿ファイルとして採用します。
            </p>

            <div className="mt-3 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink">名簿種別</span>
              <div className="flex gap-3">
                {(['applicant', 'confirmed'] as const).map((rt) => (
                  <label key={rt} className="flex items-center gap-1 text-sm text-ink">
                    <input
                      type="radio"
                      name="roster-file-type"
                      value={rt}
                      checked={rosterType === rt}
                      onChange={() => {
                        setRosterType(rt)
                        resetSelection()
                      }}
                      disabled={pending}
                    />
                    {ROSTER_TYPE_LABEL[rt]}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink">取込単位</span>
              <div className="flex gap-3">
                {(['group', 'grade'] as const).map((u) => (
                  <label key={u} className="flex items-center gap-1 text-sm text-ink">
                    <input
                      type="radio"
                      name="roster-file-unit"
                      value={u}
                      checked={unit === u}
                      onChange={() => {
                        setUnit(u)
                        resetSelection()
                      }}
                      disabled={pending}
                    />
                    {UNIT_LABEL[u]}
                  </label>
                ))}
              </div>
              <p className="text-xs text-ink-meta">
                グループの全級が 1 ファイルなら「グループ統一名簿」、級ごとに分かれて
                届いたなら「級別名簿」（同じグループ内なら複数の級を選べます）。
              </p>
            </div>

            <div className="mt-3 flex flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink">
                  {unit === 'group' ? '対象グループ' : '対象グループ・級'}
                </span>
                {/* AC-17: 既定フィルタ（申込済み × 未取込）を外す逃げ道。複数ファイル
                    採用・申込済みマーク忘れの大会への採用はここから行う。 */}
                <label className="flex items-center gap-1 text-xs text-ink-meta">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={() => {
                      setShowAll((prev) => !prev)
                      resetSelection()
                    }}
                    disabled={pending}
                  />
                  すべて表示
                </label>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {unit === 'group' ? (
                  unifiedCandidates.length === 0 ? (
                    <Card>
                      <div className="py-4 text-center text-xs text-ink-meta">
                        候補がありません
                      </div>
                    </Card>
                  ) : (
                    unifiedCandidates.map((candidate) => {
                      const checked = selectedGroupId === candidate.groupId
                      return (
                        <label
                          key={candidate.groupId}
                          className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${
                            checked
                              ? 'border-brand bg-brand-bg'
                              : 'border-border-soft bg-surface'
                          }`}
                        >
                          <input
                            type="radio"
                            name="roster-file-group"
                            value={candidate.groupId}
                            checked={checked}
                            onChange={() => {
                              setSelectedGroupId(candidate.groupId)
                              setSelectedGrades([])
                            }}
                            disabled={pending}
                            className="mt-1"
                          />
                          <span className="flex-1 font-medium text-ink">
                            {candidate.displayName}
                          </span>
                        </label>
                      )
                    })
                  )
                ) : gradeCandidates.length === 0 ? (
                  <Card>
                    <div className="py-4 text-center text-xs text-ink-meta">
                      候補がありません
                    </div>
                  </Card>
                ) : (
                  gradeCandidates.map((candidate) => {
                    const checked =
                      selectedGroupId === candidate.groupId &&
                      selectedGrades.includes(candidate.grade)
                    return (
                      <label
                        key={`${candidate.groupId}-${candidate.grade}`}
                        className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${
                          checked
                            ? 'border-brand bg-brand-bg'
                            : 'border-border-soft bg-surface'
                        }`}
                      >
                        <input
                          type="checkbox"
                          name="roster-file-group-grade"
                          value={`${candidate.groupId}-${candidate.grade}`}
                          checked={checked}
                          onChange={() => toggleGrade(candidate.groupId, candidate.grade)}
                          disabled={pending}
                          className="mt-1"
                        />
                        <span className="flex-1 font-medium text-ink">{candidate.label}</span>
                      </label>
                    )
                  })
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink">
                発表日（任意・未入力ならメール受信日）
              </span>
              <input
                type="date"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
                disabled={pending}
                className="rounded border border-border-soft bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </div>

            {error && (
              <p className="mt-2 text-xs text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <Btn kind="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                キャンセル
              </Btn>
              <Btn kind="primary" size="sm" onClick={onAdopt} disabled={pending || !canSubmit}>
                {pending ? '送信中…' : '採用する'}
              </Btn>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
