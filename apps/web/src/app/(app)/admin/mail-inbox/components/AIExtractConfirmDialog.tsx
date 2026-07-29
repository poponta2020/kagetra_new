'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { triggerExtractDraft } from '../actions'

/**
 * mail-ai-extract-refinements タスク8: 「会で流す（AI 抽出）」を添付選択
 * ダイアログへ拡張する（要件 §3.2.4 / AC-26〜29）。
 *
 * このコンポーネントの仕事は「選択を集めて渡す」ことだけ。サイズ上限判定は
 * UX のための表示であり、正の検証は Server Action（`validateAttachmentSelection`）
 * 側にある。
 *
 * ボトムシートの様式は ExistingEventLinkSheet / RosterFileAdoptSheet と同じ
 * （createPortal(document.body) + `.modal-overlay-h`、overflow-y-auto コンテナに
 * min-h-0）。
 */
export interface AIExtractAttachment {
  id: number
  filename: string
  contentType: string
  sizeBytes: number
}

type ActionResult = { ok: true } | { ok: false; error: string }

function attachmentKindLabel(contentType: string, filename: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('pdf')) return 'PDF'
  if (ct.includes('wordprocessingml') || ct === 'application/msword') return 'Word'
  if (ct.includes('spreadsheetml') || ct === 'application/vnd.ms-excel') return 'Excel'
  if (ct.startsWith('image/')) return '画像'
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'PDF'
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'Word'
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) return 'Excel'
  return 'その他'
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** PDF に対してのみ上限判定する（サーバー側ガードが application/pdf だけを見るため）。 */
function isOversizePdf(
  attachment: AIExtractAttachment,
  pdfSizeLimitKb: number,
): boolean {
  if (pdfSizeLimitKb <= 0) return false
  if (attachment.contentType !== 'application/pdf') return false
  return attachment.sizeBytes > pdfSizeLimitKb * 1024
}

export function AIExtractConfirmDialog({
  mailId,
  attachments = [],
  pdfSizeLimitKb = 0,
  initialSelectedAttachmentIds,
  buttonLabel = '会で流す（AI 抽出）',
  buttonKind = 'primary',
  action,
}: {
  mailId: number
  attachments?: AIExtractAttachment[]
  pdfSizeLimitKb?: number
  /** 「再 AI 抽出」で前回の選択を初期値として復元する場合に渡す（AC-31 対応・task9 が利用）。 */
  initialSelectedAttachmentIds?: number[]
  buttonLabel?: string
  buttonKind?: 'primary' | 'secondary'
  /** 実行する Server Action。既定は triggerExtractDraft(mailId, ids)。task9 が再 AI 抽出用に差し替える。 */
  action?: (ids: number[]) => Promise<ActionResult>
}) {
  const [open, setOpen] = useState(false)
  // 添付が 1 件以上あるときだけ 'select' で始まり、実行時に未選択なら
  // 'confirmBodyOnly' へ進む。添付 0 件は最初から 'confirmBodyOnly'
  // （現行の「AI で抽出します」確認 1 回だけ）。
  const [phase, setPhase] = useState<'select' | 'confirmBodyOnly'>(
    attachments.length > 0 ? 'select' : 'confirmBodyOnly',
  )
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(initialSelectedAttachmentIds ?? []),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const runAction = (ids: number[]) => {
    const doAction = action ?? ((selected: number[]) => triggerExtractDraft(mailId, selected))
    setError(null)
    startTransition(async () => {
      const result = await doAction(ids)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  // 開く度に状態をリセット（ExistingEventLinkSheet と同じ規約）。
  useEffect(() => {
    if (open) {
      setError(null)
      setPhase(attachments.length > 0 ? 'select' : 'confirmBodyOnly')
      setSelectedIds(new Set(initialSelectedAttachmentIds ?? []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggleAttachment = (id: number) => {
    // `disabled` だけに頼らない。上限超過の添付は状態にも入れない
    // （実ブラウザでは disabled 入力の onChange は発火しないが、それは
    // 「押せない」ことの保証であって「選ばれない」ことの保証ではない）。
    const target = attachments.find((a) => a.id === id)
    if (target && isOversizePdf(target, pdfSizeLimitKb)) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onExecuteFromList = () => {
    if (selectedIds.size === 0) {
      // 添付が 1 件以上あるのに全て未チェック（AC-28）: 確認を 1 段挟む。
      setPhase('confirmBodyOnly')
      return
    }
    runAction(Array.from(selectedIds))
  }

  const onConfirmBodyOnly = () => {
    runAction(Array.from(selectedIds))
  }

  return (
    <>
      <Btn kind={buttonKind} size="md" onClick={() => setOpen(true)} disabled={pending}>
        {buttonLabel}
      </Btn>
      {/* Portal + .modal-overlay-h (svh cascade): ExistingEventLinkSheet と同じ既知バグ回避。 */}
      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-extract-confirm-title"
          className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col rounded-t-lg bg-surface p-4 shadow-lg sm:max-w-md sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {phase === 'select' ? (
              <>
                <h2
                  id="ai-extract-confirm-title"
                  className="font-display text-base font-bold text-ink"
                >
                  AI で抽出します
                </h2>
                <p className="mt-2 text-sm text-ink-2">
                  会で流す添付を選択してください（任意）。本文は選択によらず必ず
                  AI に渡ります。
                </p>

                <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                  {attachments.map((a) => {
                    const oversize = isOversizePdf(a, pdfSizeLimitKb)
                    const checked = selectedIds.has(a.id)
                    return (
                      <label
                        key={a.id}
                        className={`flex items-start gap-2 rounded border p-2 text-sm ${
                          oversize ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                        } ${checked ? 'border-brand bg-brand-bg' : 'border-border-soft bg-surface'}`}
                      >
                        <input
                          type="checkbox"
                          aria-label={a.filename}
                          checked={checked}
                          disabled={oversize || pending}
                          onChange={() => toggleAttachment(a.id)}
                          className="mt-1"
                        />
                        <div className="flex flex-1 flex-col">
                          <span className="font-medium text-ink">{a.filename}</span>
                          <span className="text-xs text-ink-meta">
                            {attachmentKindLabel(a.contentType, a.filename)} ・{' '}
                            {formatSize(a.sizeBytes)}
                          </span>
                          {oversize && (
                            <span className="text-xs text-danger" role="alert">
                              サイズ上限超過のため送信できません
                            </span>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>

                {error && (
                  <p className="mt-2 text-xs text-danger" role="alert">
                    {error}
                  </p>
                )}

                <div className="mt-4 flex justify-end gap-2">
                  <Btn kind="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                    キャンセル
                  </Btn>
                  <Btn kind="primary" size="sm" onClick={onExecuteFromList} disabled={pending}>
                    {pending ? '送信中…' : '実行'}
                  </Btn>
                </div>
              </>
            ) : attachments.length > 0 ? (
              <>
                <h2
                  id="ai-extract-confirm-title"
                  className="font-display text-base font-bold text-ink"
                >
                  本文だけで実行しますか？
                </h2>
                <p className="mt-2 text-sm text-ink-2">
                  添付を選択していません。メール本文だけを AI に渡して抽出します。
                  よろしいですか？
                </p>
                {error && (
                  <p className="mt-2 text-xs text-danger" role="alert">
                    {error}
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <Btn
                    kind="ghost"
                    size="sm"
                    onClick={() => setPhase('select')}
                    disabled={pending}
                  >
                    いいえ
                  </Btn>
                  <Btn kind="primary" size="sm" onClick={onConfirmBodyOnly} disabled={pending}>
                    {pending ? '送信中…' : 'はい'}
                  </Btn>
                </div>
              </>
            ) : (
              <>
                <h2
                  id="ai-extract-confirm-title"
                  className="font-display text-base font-bold text-ink"
                >
                  AI で抽出します
                </h2>
                <p className="mt-2 text-sm text-ink-2">
                  このメールを大会案内として AI で抽出し、ドラフトを作ります。よろしいですか？
                  （完了後に通知します）
                </p>
                {error && (
                  <p className="mt-2 text-xs text-danger" role="alert">
                    {error}
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <Btn
                    kind="ghost"
                    size="sm"
                    onClick={() => setOpen(false)}
                    disabled={pending}
                  >
                    いいえ
                  </Btn>
                  <Btn kind="primary" size="sm" onClick={onConfirmBodyOnly} disabled={pending}>
                    {pending ? '送信中…' : 'はい'}
                  </Btn>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
