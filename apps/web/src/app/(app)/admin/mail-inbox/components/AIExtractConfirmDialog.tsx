'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  ATTACHMENT_TOTAL_LIMIT_BYTES,
  exceededAttachmentTotalBytes,
} from '@kagetra/mail-worker/classify/attachment-budget'
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

/**
 * 「サイズが大きめの PDF」判定。**送信可否ではなく、注意を促すかどうか**を決める。
 *
 * かつてこれは `MAIL_WORKER_PDF_SIZE_LIMIT_KB` を超えた添付を**選択不能**にする
 * ための判定だった。しきい値の根拠は AI 利用コストの目安でしかなく、物理的に
 * 送れないサイズではないのに、管理者が中身を見て選んだ PDF を送信不能にして
 * いた。いまは行の注意書きと実行前の確認ステップを出すだけで、続行すれば
 * そのまま AI に渡る。送信を止めるのは Anthropic の 32MB 予算だけ
 * （`exceededAttachmentTotalBytes`）。
 *
 * PDF に対してのみ判定するのは、リクエスト本体を占めるのが base64 の document
 * ブロックだから（サーバー側の合計判定が `application/pdf` だけを見るのとも揃う）。
 */
function isLargePdf(
  attachment: AIExtractAttachment,
  pdfSizeLimitKb: number,
): boolean {
  if (pdfSizeLimitKb <= 0) return false
  if (attachment.contentType !== 'application/pdf') return false
  return attachment.sizeBytes > pdfSizeLimitKb * 1024
}

/**
 * 復元する選択を「いま実際に選べるもの」へ正規化する。
 *
 * 落とすのは**添付そのものが消えている id** だけ。サイズが大きいという理由では
 * 落とさない —— 大きい PDF も選べるようになった以上、外すことも実行することも
 * できる（AC-31 の「そのうえで選び直せる」は満たされる）。ここでサイズを見て
 * 落とすと、管理者が前回わざわざ確認して選んだ大きい PDF が、開くたび黙って
 * 外れることになる。
 */
function restorableSelection(
  initial: number[] | undefined,
  attachments: AIExtractAttachment[],
): { ids: number[]; droppedCount: number } {
  if (!initial || initial.length === 0) return { ids: [], droppedCount: 0 }
  const ids = initial.filter((id) => attachments.some((x) => x.id === id))
  return { ids, droppedCount: initial.length - ids.length }
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
  const [phase, setPhase] = useState<
    'select' | 'confirmBodyOnly' | 'confirmLarge'
  >(attachments.length > 0 ? 'select' : 'confirmBodyOnly')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () =>
      new Set(restorableSelection(initialSelectedAttachmentIds, attachments).ids),
  )
  const [droppedFromRestore, setDroppedFromRestore] = useState(0)
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
      const restored = restorableSelection(initialSelectedAttachmentIds, attachments)
      setSelectedIds(new Set(restored.ids))
      setDroppedFromRestore(restored.droppedCount)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toggleAttachment = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 合計サイズ（要件 §6）。1件ずつが小さくても複数選べば Anthropic の 32MB を
  // 超え得る。ここだけは超えると 413 で必ず失敗するので、確認では通せない。
  // サーバー側でも拒否するが、実行前に理由が分かるようにする。
  const selectedAttachments = attachments.filter((a) => selectedIds.has(a.id))
  const totalOverBytes = exceededAttachmentTotalBytes(selectedAttachments)
  // 選択の中に「大きめの PDF」があるか。あれば実行前に確認を 1 段挟む。
  const selectedLargePdfs = selectedAttachments.filter((a) =>
    isLargePdf(a, pdfSizeLimitKb),
  )

  const onExecuteFromList = () => {
    if (totalOverBytes !== null) return
    if (selectedIds.size === 0) {
      // 添付が 1 件以上あるのに全て未チェック（AC-28）: 確認を 1 段挟む。
      setPhase('confirmBodyOnly')
      return
    }
    if (selectedLargePdfs.length > 0) {
      // 大きめの PDF を含む選択: 時間・コスト・失敗の可能性を伝えて確認を取る。
      setPhase('confirmLarge')
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
                    const large = isLargePdf(a, pdfSizeLimitKb)
                    const checked = selectedIds.has(a.id)
                    return (
                      <label
                        key={a.id}
                        className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${
                          checked ? 'border-brand bg-brand-bg' : 'border-border-soft bg-surface'
                        }`}
                      >
                        <input
                          type="checkbox"
                          aria-label={a.filename}
                          checked={checked}
                          disabled={pending}
                          onChange={() => toggleAttachment(a.id)}
                          className="mt-1"
                        />
                        <div className="flex flex-1 flex-col">
                          <span className="font-medium text-ink">{a.filename}</span>
                          <span className="text-xs text-ink-meta">
                            {attachmentKindLabel(a.contentType, a.filename)} ・{' '}
                            {formatSize(a.sizeBytes)}
                          </span>
                          {large && (
                            <span className="text-xs text-warn-fg" role="status">
                              サイズが大きめです（送信できますが、確認が入ります）
                            </span>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>

                {droppedFromRestore > 0 && (
                  <p className="mt-2 text-xs text-warn-fg" role="status">
                    前回選択した添付のうち {droppedFromRestore} 件は、削除されている
                    ため選択から外しました。
                  </p>
                )}

                {totalOverBytes !== null && (
                  <p className="mt-2 text-xs text-danger" role="alert">
                    選択した添付の合計が、AI が一度に受け取れる上限（
                    {Math.floor(ATTACHMENT_TOTAL_LIMIT_BYTES / 1024 / 1024)}MB）を超えています
                    （合計 {(totalOverBytes / 1024 / 1024).toFixed(1)}MB）。
                    ここは AI 側の仕様なので、添付を減らしてください。
                  </p>
                )}

                {error && (
                  <p className="mt-2 text-xs text-danger" role="alert">
                    {error}
                  </p>
                )}

                <div className="mt-4 flex justify-end gap-2">
                  <Btn kind="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                    キャンセル
                  </Btn>
                  <Btn
                    kind="primary"
                    size="sm"
                    onClick={onExecuteFromList}
                    disabled={pending || totalOverBytes !== null}
                  >
                    {pending ? '送信中…' : '実行'}
                  </Btn>
                </div>
              </>
            ) : phase === 'confirmLarge' ? (
              <>
                <h2
                  id="ai-extract-confirm-title"
                  className="font-display text-base font-bold text-ink"
                >
                  サイズの大きい添付があります
                </h2>
                <p className="mt-2 text-sm text-ink-2">
                  次の添付は目安のサイズ（{formatSize(pdfSizeLimitKb * 1024)}）を超えています。
                  AI には送れますが、処理に時間がかかり、AI 利用料も多くかかります。
                  ページ数が非常に多い PDF では失敗することもあります。
                  このまま実行しますか？
                </p>
                <ul className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                  {selectedLargePdfs.map((a) => (
                    <li key={a.id} className="text-sm text-ink">
                      {a.filename}
                      <span className="ml-1 text-xs text-ink-meta">
                        （{formatSize(a.sizeBytes)}）
                      </span>
                    </li>
                  ))}
                </ul>
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
                  <Btn
                    kind="primary"
                    size="sm"
                    onClick={() => runAction(Array.from(selectedIds))}
                    disabled={pending}
                  >
                    {pending ? '送信中…' : 'はい'}
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
