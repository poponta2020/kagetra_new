'use client'

import { useRef, useState } from 'react'
import type { CellMap, MemberField } from '@/lib/entry-form/cell-map'
import type { EntryFormMemberRow, EntryFormTemplateCandidate, TemplateAnalysis } from './actions'
import type { TemplateSelection } from './wizard-types'
import { Btn, Pill } from '@/components/ui'
import { SectionRule } from './SectionRule'
import { buildMappingRows } from './cell-map-view'
import { formatReceivedDate, fileToBase64 } from './entry-form-format'

/**
 * entry-form-autofill タスク7 (UI): ステップ1「テンプレート」。
 * design-mock: b-step1.html / b-step1-multisheet.html / b-step1-aifallback.html。
 */
export interface Step1TemplateProps {
  candidates: EntryFormTemplateCandidate[]
  memberCount: number
  selection: TemplateSelection | null
  onSelectionChange: (selection: TemplateSelection) => void
  analysis: TemplateAnalysis | null
  analyzing: boolean
  analyzeError: string | null
  cellMap: CellMap | null
  activeSheetIndex: number
  onActiveSheetChange: (index: number) => void
  onColumnChange: (sheetIndex: number, field: MemberField, value: string | null) => void
  /** シートへの振分プレビュー用（ステップ2の除外前・グループ内全対象会員）。 */
  members: EntryFormMemberRow[]
  onNext: () => void
}

function MappingEditRow({
  sheetIndex,
  field,
  label,
  column,
  note,
  showAiTag,
  onColumnChange,
}: {
  sheetIndex: number
  field: MemberField
  label: string
  column: string | null
  note: string | null
  showAiTag: boolean
  onColumnChange: (sheetIndex: number, field: MemberField, value: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(column ?? '')

  if (editing) {
    return (
      <li className="flex items-baseline gap-2 border-t border-border-soft py-1.5 text-xs first:border-t-0">
        <span className="w-[76px] shrink-0 text-ink-2">{label}</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          placeholder="例: F"
          className="w-16 rounded border border-border bg-canvas px-1.5 py-1 text-xs text-ink"
        />
        <button
          type="button"
          className="text-xs font-bold text-brand"
          onClick={() => {
            onColumnChange(sheetIndex, field, draft.trim() || null)
            setEditing(false)
          }}
        >
          確定
        </button>
      </li>
    )
  }

  return (
    <li className="flex items-baseline gap-2 border-t border-border-soft py-1.5 text-xs first:border-t-0">
      <span className="w-[76px] shrink-0 text-ink-2">{label}</span>
      <span className="flex-1 tabular-nums">
        {column ? (
          <>
            <b className="font-bold">{column}列</b>
            {note && <span className="ml-1 text-ink-2">{note}</span>}
            {showAiTag && <Pill tone="brand" size="sm" className="ml-1.5">AI</Pill>}
          </>
        ) : (
          <span className="text-ink-muted">対応なし — 空欄のまま（会員ごとに手入力可）</span>
        )}
      </span>
      <button
        type="button"
        className="shrink-0 text-xs text-brand"
        onClick={() => {
          setDraft(column ?? '')
          setEditing(true)
        }}
      >
        {column ? '変更' : '指定'}
      </button>
    </li>
  )
}

export function Step1Template({
  candidates,
  memberCount,
  selection,
  onSelectionChange,
  analysis,
  analyzing,
  analyzeError,
  cellMap,
  activeSheetIndex,
  onActiveSheetChange,
  onColumnChange,
  members,
  onNext,
}: Step1TemplateProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (file: File) => {
    const base64 = await fileToBase64(file)
    onSelectionChange({ kind: 'upload', file: { filename: file.name, base64 } })
  }

  const sheets = cellMap?.sheets ?? []
  const activeSheet = sheets[activeSheetIndex] ?? sheets[0] ?? null
  const isMultiSheet = sheets.length > 1

  const canProceed = analysis != null && sheets.length > 0 && !analyzing

  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionRule title="申込書テンプレート" />
        {candidates.length === 0 ? (
          <p className="text-xs text-ink-meta">
            案内メールに xlsx 添付が見つかりませんでした。申込書ファイルをアップロードしてください。
          </p>
        ) : (
          <ul className="mt-1">
            {candidates.map((c) => {
              const checked = selection?.kind === 'candidate' && selection.attachmentId === c.attachmentId
              return (
                <li key={c.attachmentId} className="border-t border-border-soft first:border-t-0">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 py-2.5 text-left text-xs"
                    onClick={() =>
                      onSelectionChange({
                        kind: 'candidate',
                        attachmentId: c.attachmentId,
                        filename: c.filename,
                      })
                    }
                  >
                    <span
                      aria-hidden
                      className={
                        checked
                          ? 'inline-block h-4 w-4 shrink-0 rounded-full bg-brand shadow-[inset_0_0_0_3.5px_var(--kg-surface)]'
                          : 'inline-block h-4 w-4 shrink-0 rounded-full border-[1.5px] border-border-strong bg-surface'
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-ink">{c.filename}</span>
                      <span className="block text-[10px] text-ink-meta">
                        案内メール添付・{formatReceivedDate(c.receivedAt)}受信
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <button
          type="button"
          className="py-1 text-left text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="block font-bold text-brand">ファイルをアップロード…</span>
          <span className="block text-[10px] text-ink-meta">添付以外の申込書を使う場合</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void handleUpload(file)
          }}
        />
      </section>

      {selection && (
        <section className="flex flex-col gap-2">
          <SectionRule title="列の対応" />

          {analyzing && <p className="text-xs text-ink-meta">解析中…</p>}

          {analyzeError && (
            <p className="rounded-md bg-danger-bg px-2.5 py-2 text-xs text-danger-fg">{analyzeError}</p>
          )}

          {!analyzing && analysis && (
            <>
              {analysis.source === 'ai' && (
                <div className="flex gap-2 rounded-md bg-brand-bg px-2.5 py-2">
                  <p className="text-[11px] leading-normal text-brand-fg">
                    <b className="font-bold">AI が列の対応を推定しました。</b>
                    この様式は自動判定できなかったため、各列の対応を必ず確認してから進んでください。
                  </p>
                </div>
              )}
              {analysis.source === 'unresolved' && (
                <div className="flex gap-2 rounded-md bg-warn-bg px-2.5 py-2">
                  <p className="text-[11px] leading-normal text-warn-fg">
                    列の対応を自動推定できませんでした。下の一覧から手動で指定してください（作成は続行できます）。
                  </p>
                </div>
              )}
              {analysis.source === 'heuristic' && !isMultiSheet && (
                <div className="mt-1 flex items-baseline gap-1.5 text-[11px]">
                  <span className="font-bold text-success-fg">✓ 自動判定に成功</span>
                  {activeSheet && (
                    <span className="text-ink-meta">
                      {activeSheet.sheetName}・{activeSheet.startRow}行目から記入
                    </span>
                  )}
                </div>
              )}

              {isMultiSheet && (
                <div className="mt-1 flex gap-4 overflow-x-auto border-b border-border-soft">
                  {sheets.map((s, i) => {
                    const count = members.filter(
                      (m) => s.targetGrades === null || (m.grade != null && s.targetGrades.includes(m.grade)),
                    ).length
                    const on = i === activeSheetIndex
                    return (
                      <button
                        key={s.sheetName}
                        type="button"
                        onClick={() => onActiveSheetChange(i)}
                        className={
                          on
                            ? 'relative shrink-0 border-b-2 border-brand pb-[7px] pt-1.5 text-xs font-bold whitespace-nowrap text-brand-fg'
                            : 'shrink-0 pb-[7px] pt-1.5 text-xs whitespace-nowrap text-ink-meta'
                        }
                      >
                        {s.sheetName}
                        <span className="ml-1 text-[10px] tabular-nums text-ink-muted">{count}名</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {activeSheet && (
                <ul className="mt-1">
                  {buildMappingRows(activeSheet).map((row) => (
                    <MappingEditRow
                      key={row.field}
                      sheetIndex={activeSheetIndex}
                      field={row.field}
                      label={row.label}
                      column={row.column}
                      note={row.note}
                      showAiTag={analysis.source === 'ai'}
                      onColumnChange={onColumnChange}
                    />
                  ))}
                </ul>
              )}

              {isMultiSheet && (
                <div className="flex flex-wrap gap-2.5 pt-1 text-[11px] text-ink-2">
                  <span>シートへの振分:</span>
                  {sheets.map((s) => {
                    const names = members
                      .filter((m) => s.targetGrades === null || (m.grade != null && s.targetGrades.includes(m.grade)))
                      .map((m) => m.displayName ?? '?')
                    return (
                      <span key={s.sheetName}>
                        {s.sheetName.replace(/申込書$/, '')} <b className="font-bold">{names.join('・') || 'なし'}</b>
                      </span>
                    )
                  })}
                </div>
              )}

              <p className="pt-1.5 text-[10px] text-ink-muted">
                人数・参加費の集計セルは数式が入っているため書き込みません
              </p>
              {analysis.warnings.map((w) => (
                <p key={w} className="text-[10px] text-warn-fg">
                  {w}
                </p>
              ))}
            </>
          )}
        </section>
      )}

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-1.5 border-t border-border bg-surface px-4 py-3">
        <Btn kind="primary" size="lg" block disabled={!canProceed} onClick={onNext}>
          次へ — 会員の確認（{memberCount}名）
        </Btn>
      </div>
    </>
  )
}
