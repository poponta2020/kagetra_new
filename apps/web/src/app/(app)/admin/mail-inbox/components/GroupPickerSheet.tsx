'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Btn, Card } from '@/components/ui'
import {
  formatGroupDayRange,
  formatGroupEntryStatus,
  listProcessCandidates,
  type ProcessCandidateGroup,
  type ProcessCandidateKind,
} from '../process-candidate-utils'

/**
 * mail-inbox-mailer 2026-08-02 改修: 統合処理フォームの「大会を選ぶ」ボトムシート
 * （design-mock/sheet-picker.html）。
 *
 * 選択単位は**申込グループ**なので、複数日開催でも候補は 1 行（AC-5）。候補の
 * 仕分け（種別による母集団の出し分けと、名簿種別の既定フィルタ）は
 * `process-candidate-utils.ts` の純関数が持ち、ここは選択状態と絞り込み文字列
 * だけを扱う。
 *
 * ボトムシートの様式は既存規約どおり `createPortal(document.body)` +
 * `.modal-overlay-h`（svh カスケード）、スクロールコンテナに `min-h-0`。
 */

const ROSTER_KIND_LABEL: Record<'applicant_roster' | 'confirmed_roster', string> = {
  applicant_roster: '申込名簿',
  confirmed_roster: '確定名簿',
}

export function GroupPickerSheet({
  open,
  onClose,
  onConfirm,
  groups,
  kind,
  cutoffStr,
  selectedGroupId,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (groupId: number) => void
  /** 基本条件を満たす候補（サーバーが絞った母集団）。 */
  groups: ProcessCandidateGroup[]
  /** 現在の種別。'tournament_notice' はこのシートを開かない。 */
  kind: ProcessCandidateKind
  cutoffStr: string
  selectedGroupId: number | null
}) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [draftId, setDraftId] = useState<number | null>(selectedGroupId)

  // 開くたびに状態をリセット（ExistingEventLinkSheet と同じ規約）。現在の選択は
  // 初期値として復元する（「変更」で開いたときに選び直しやすい）。
  useEffect(() => {
    if (open) {
      setQuery('')
      setShowAll(false)
      setDraftId(selectedGroupId)
    }
  }, [open, selectedGroupId])

  const candidates = useMemo(
    () => listProcessCandidates(groups, { kind, cutoffStr, showAll }),
    [groups, kind, cutoffStr, showAll],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((g) => g.displayName.toLowerCase().includes(q))
  }, [candidates, query])

  const rosterKind = kind === 'none' ? null : kind

  if (!open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-picker-sheet-title"
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full flex-col rounded-t-lg bg-surface p-4 shadow-lg sm:max-w-md sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="group-picker-sheet-title"
          className="font-display text-base font-bold text-ink"
        >
          大会を選ぶ
        </h2>
        <p className="mt-0.5 text-[10px] text-ink-meta">
          申込グループの単位です。2 日開催でも 1 行にまとまります。
        </p>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="大会名で絞り込み"
          className="mt-2 rounded-md border border-border-soft bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted"
          autoFocus
        />

        {/* 「すべて表示」は名簿種別だけ（未選択には既定フィルタが無い）。 */}
        {rosterKind && (
          <label className="mt-2.5 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="mt-0.5"
            />
            <span className="flex-1 text-xs text-ink">
              すべて表示
              <span className="block text-[10px] font-normal text-ink-meta">
                既定は「申込済み × {ROSTER_KIND_LABEL[rosterKind]}が未取込」のグループだけ
              </span>
            </span>
          </label>
        )}

        <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {filtered.length === 0 ? (
            <Card>
              <div className="py-4 text-center text-xs text-ink-meta">候補がありません</div>
            </Card>
          ) : (
            filtered.map((group) => {
              const checked = draftId === group.groupId
              return (
                <label
                  key={group.groupId}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${
                    checked ? 'border-brand bg-brand-bg' : 'border-border-soft bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name="process-group"
                    value={group.groupId}
                    checked={checked}
                    onChange={() => setDraftId(group.groupId)}
                    className="mt-1"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-bold text-ink">{group.displayName}</span>
                    <span className="text-[10px] text-ink-meta">
                      {[
                        formatGroupDayRange(group.days),
                        formatGroupEntryStatus(group),
                        // 「未取込」は既定フィルタが効いているときだけ正しい
                        // （すべて表示では取込済みのグループも並ぶ）。
                        rosterKind && !showAll
                          ? `${ROSTER_KIND_LABEL[rosterKind]} 未取込`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' ・ ')}
                    </span>
                  </span>
                </label>
              )
            })
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <Btn kind="ghost" size="md" className="w-24 flex-none" onClick={onClose}>
            キャンセル
          </Btn>
          <Btn
            kind="primary"
            size="md"
            block
            disabled={draftId == null}
            onClick={() => {
              if (draftId != null) onConfirm(draftId)
            }}
          >
            決定
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  )
}
