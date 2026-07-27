'use client'

import { useRef, useState } from 'react'
import type { Grade } from '@kagetra/shared/types'
import type { CellMap, MemberField } from '@/lib/entry-form/cell-map'
import type { EntryFormMemberRow, EntryFormTemplateCandidate, TemplateAnalysis } from './actions'
import type { TemplateSelection } from './wizard-types'
import { Btn, Pill } from '@/components/ui'
import { SectionRule } from './SectionRule'
import {
  buildMappingRows,
  hasUnresolvedSheetGrades,
  isSheetFillable,
  matchesSheetGrades,
} from './cell-map-view'
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
  /** 自動推定が空のとき、シートを選んで手動マッピングを始める。 */
  onAddManualSheet: (sheetName: string) => void
  /** 手動マッピング中の記入開始行を変更する。 */
  onStartRowChange: (sheetIndex: number, startRow: number) => void
  /** 複数シートで対象級が決まらないシートの級を指定する。 */
  onTargetGradesChange: (sheetIndex: number, grades: Grade[]) => void
  /** 記入対象から外す。 */
  onRemoveSheet: (sheetIndex: number) => void
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

/**
 * 手動アップロードの上限。Server Action へ base64 で渡すため実サイズの約4/3に
 * 膨らむ。next.config の `serverActions.bodySizeLimit`（4MB）に対して余裕を取る。
 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

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
  onAddManualSheet,
  onStartRowChange,
  onTargetGradesChange,
  onRemoveSheet,
  members,
  onNext,
}: Step1TemplateProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleUpload = async (file: File) => {
    // Server Action の本文サイズ上限（next.config の bodySizeLimit）を超えると
    // 413 になり原因が分かりにくい。base64 化で約4/3に膨らむ分も見込んで手前で弾く。
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        `ファイルが大きすぎます（${Math.round(file.size / 1024)}KB）。${Math.round(MAX_UPLOAD_BYTES / 1024)}KB 以下の xlsx を選んでください`,
      )
      return
    }
    setUploadError(null)
    const base64 = await fileToBase64(file)
    onSelectionChange({ kind: 'upload', file: { filename: file.name, base64 } })
  }

  const sheets = cellMap?.sheets ?? []
  const activeSheet = sheets[activeSheetIndex] ?? sheets[0] ?? null
  const isMultiSheet = sheets.length > 1

  // 自動推定が空でも、シートを選んで手で列対応を組めば先へ進める
  // （requirements §3.2.3「手動修正可能」・エラーケースの手動マッピング誘導）。
  const unmappedSheetNames = (analysis?.sheetNames ?? []).filter(
    (name) => !sheets.some((s) => s.sheetName === name),
  )
  const unresolvedGrades = cellMap != null && hasUnresolvedSheetGrades(cellMap)
  const canProceed =
    analysis != null &&
    sheets.length > 0 &&
    sheets.every(isSheetFillable) &&
    !unresolvedGrades &&
    !analyzing

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

      {uploadError && (
        <p className="rounded-md bg-danger-bg px-2.5 py-2 text-xs text-danger-fg">{uploadError}</p>
      )}

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

              {/* 自動推定が1シートも返せなかった場合の出口。シートを選ぶと空の対応表が
                  でき、そこから列と記入開始行を手で埋められる（行き止まりにしない）。 */}
              {unmappedSheetNames.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-md bg-surface-alt px-2.5 py-2">
                  <p className="text-[11px] leading-normal text-ink-2">
                    {sheets.length === 0
                      ? '記入するシートを選んでください。列の対応はこの後に指定します。'
                      : '別のシートにも記入する場合は追加してください。'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {unmappedSheetNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="rounded-md border border-border-strong px-2 py-1 text-[11px] text-ink-2"
                        onClick={() => onAddManualSheet(name)}
                      >
                        ＋ {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeSheet && (
                <label className="flex items-baseline gap-2 text-[11px] text-ink-meta">
                  記入開始行
                  <input
                    type="number"
                    min={1}
                    value={activeSheet.startRow}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (Number.isInteger(next) && next > 0) {
                        onStartRowChange(activeSheetIndex, next)
                      }
                    }}
                    className="w-[72px] rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink tabular-nums"
                  />
                  <span>行目から会員を記入します</span>
                </label>
              )}

              {unresolvedGrades && (
                <div className="flex flex-col gap-1.5 rounded-md bg-warn-bg px-2.5 py-2">
                  <p className="text-[11px] leading-normal text-warn-fg">
                    ⚠ 複数のシートがありますが、対象の級が決まっていないシートがあります。
                    このまま作成すると全員が全シートに重複して記入されます。各シートの級を指定するか、
                    使わないシートは除外してください
                  </p>
                  {sheets.map((s, i) =>
                    s.targetGrades === null ? (
                      <div key={s.sheetName} className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
                        <span className="font-bold text-ink-2">{s.sheetName}</span>
                        {(['A', 'B', 'C', 'D', 'E'] as const).map((g) => (
                          <button
                            key={g}
                            type="button"
                            className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-ink-2"
                            onClick={() => onTargetGradesChange(i, [g])}
                          >
                            {g}級
                          </button>
                        ))}
                        <button
                          type="button"
                          className="ml-auto text-[11px] text-accent-fg underline"
                          onClick={() => onRemoveSheet(i)}
                        >
                          このシートを使わない
                        </button>
                      </div>
                    ) : null,
                  )}
                </div>
              )}

              {activeSheet && !isSheetFillable(activeSheet) && (
                <p className="rounded-md bg-warn-bg px-2.5 py-2 text-[11px] leading-normal text-warn-fg">
                  ⚠ 氏名の列（「氏名」または「姓」と「名」）が未指定です。指定すると次へ進めます
                </p>
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
                      (m) => matchesSheetGrades(s.targetGrades, m.grade),
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
                      .filter((m) => matchesSheetGrades(s.targetGrades, m.grade))
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
