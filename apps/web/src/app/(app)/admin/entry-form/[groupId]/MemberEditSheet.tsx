'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { Grade } from '@kagetra/shared/types'
import { Btn } from '@/components/ui'
import type { MemberEditValues, WizardMember } from './wizard-types'

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E']

/**
 * entry-form-autofill タスク7 (UI): 会員行の編集ボトムシート。design-mock: b-step2-edit.html。
 * `createPortal(document.body)` + `.modal-overlay-h`（svh カスケード）— プロジェクト規約
 * （feedback_bottom_sheet_url_bar_hidden）を踏襲。オーバーレイは design-spec 指定の
 * `rgba(30,27,19,0.4)`（他画面共通の `bg-black/40` とは別の、和紙寄りの色指定）。
 */
export interface MemberEditSheetProps {
  member: WizardMember
  onClose: () => void
  onSave: (values: MemberEditValues) => void
  onExclude: () => void
}

export function MemberEditSheet({ member, onClose, onSave, onExclude }: MemberEditSheetProps) {
  const [familyName, setFamilyName] = useState(member.familyName ?? '')
  const [givenName, setGivenName] = useState(member.givenName ?? '')
  const [familyKana, setFamilyKana] = useState(member.familyKana ?? '')
  const [givenKana, setGivenKana] = useState(member.givenKana ?? '')
  const [grade, setGrade] = useState(member.grade ?? '')
  const [dan, setDan] = useState(member.dan != null ? String(member.dan) : '')
  const [appearanceCount, setAppearanceCount] = useState(
    member.appearanceCount != null ? String(member.appearanceCount) : '',
  )
  const [note, setNote] = useState(member.note ?? '')

  const kanaMissing = !familyKana.trim() || !givenKana.trim()

  const handleSave = () => {
    onSave({
      familyName: familyName.trim() || null,
      givenName: givenName.trim() || null,
      familyKana: familyKana.trim() || null,
      givenKana: givenKana.trim() || null,
      grade: grade || null,
      dan: dan.trim() ? Number(dan) : null,
      appearanceCount: appearanceCount.trim() ? Number(appearanceCount) : null,
      note: note.trim() || null,
    })
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-edit-sheet-title"
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-[rgba(30,27,19,0.4)]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col gap-3 rounded-t-[14px] bg-surface p-4 pb-[18px] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="mx-auto h-1 w-9 rounded-full bg-border-strong" />

        <div className="flex items-baseline gap-2">
          <h2 id="member-edit-sheet-title" className="flex-1 font-display text-base font-bold text-ink">
            {member.displayName ?? '氏名未登録'}
          </h2>
          <button
            type="button"
            className="text-[11px] text-danger-fg"
            onClick={() => {
              onExclude()
              onClose()
            }}
          >
            この会員を外す
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {kanaMissing && (
          <p className="flex gap-1.5 rounded-md bg-warn-bg px-2.5 py-1.5 text-[11px] leading-normal text-warn-fg">
            <span aria-hidden>⚠</span>
            <span>ふりがなが未登録です。入力すると会員情報にも保存され、次回から自動で記入されます。</span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-meta">姓</span>
            <input
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              className="rounded-md border border-border bg-canvas px-2.5 py-2 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-meta">名</span>
            <input
              value={givenName}
              onChange={(e) => setGivenName(e.target.value)}
              className="rounded-md border border-border bg-canvas px-2.5 py-2 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-meta">
              ふりがな（姓）{!familyKana.trim() && <span className="text-accent">*</span>}
            </span>
            <input
              value={familyKana}
              onChange={(e) => setFamilyKana(e.target.value)}
              placeholder="まつだ"
              className={
                familyKana.trim()
                  ? 'rounded-md border border-border bg-canvas px-2.5 py-2 text-sm text-ink'
                  : 'rounded-md border border-accent bg-canvas px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted'
              }
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-meta">
              ふりがな（名）{!givenKana.trim() && <span className="text-accent">*</span>}
            </span>
            <input
              value={givenKana}
              onChange={(e) => setGivenKana(e.target.value)}
              placeholder="ゆいな"
              className={
                givenKana.trim()
                  ? 'rounded-md border border-border bg-canvas px-2.5 py-2 text-sm text-ink'
                  : 'rounded-md border border-accent bg-canvas px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted'
              }
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-meta">参加級</span>
            {/* 参加級は自由入力（requirements §3.2.1: F級など大会独自級・当日昇級）。
                よく使う A〜E はボタンで選べるようにし、それ以外は直接入力する。 */}
            <div className="flex flex-wrap gap-1">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={
                    grade === g
                      ? 'rounded-md border border-brand bg-brand-bg px-2 py-1 text-xs font-bold text-brand-fg'
                      : 'rounded-md border border-border px-2 py-1 text-xs text-ink-2'
                  }
                  onClick={() => setGrade(grade === g ? '' : g)}
                >
                  {g}級
                </button>
              ))}
            </div>
            <input
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="未設定（F級など独自級は直接入力）"
              className="rounded-md border border-border bg-canvas px-2 py-2 text-sm text-ink placeholder:text-ink-muted"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-meta">段位</span>
            <input
              type="number"
              min={0}
              max={10}
              value={dan}
              onChange={(e) => setDan(e.target.value)}
              className="rounded-md border border-border bg-canvas px-2 py-2 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ink-meta">出場回数</span>
            <input
              type="number"
              min={0}
              value={appearanceCount}
              onChange={(e) => setAppearanceCount(e.target.value)}
              className="rounded-md border border-border bg-canvas px-2 py-2 text-sm text-ink"
            />
          </label>
        </div>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-ink-meta">備考</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="（初段位申請中 など）"
            className="rounded-md border border-border bg-canvas px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
        </label>

        <p className="text-[10px] text-ink-meta">
          参加級・段位・出場回数・備考の変更はこの申込書だけに反映されます（会員情報は変わりません）
        </p>
        </div>

        {/* 保存 CTA は固定。短い画面やソフトキーボード表示時に本文があふれても、
            スクロール領域は上の div 側なのでボタンが画面外へ出ない
            （flex 子で overflow-y-auto するには min-h-0 が要る）。 */}
        <Btn kind="primary" size="lg" block onClick={handleSave}>
          保存
        </Btn>
      </div>
    </div>,
    document.body,
  )
}
