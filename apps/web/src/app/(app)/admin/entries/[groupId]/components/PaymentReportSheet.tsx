'use client'

import { useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Btn } from '@/components/ui'
import type { PaymentReceiptInput, ReportPaymentResult } from '../actions'

/**
 * payment-receipt-broadcast タスク8: 支払報告のボトムシート。
 *
 * 1枚のシートの中で「写真を選ぶ → 送信内容プレビュー → 実行」を縦に並べる
 * （要件 §8。ステップ分割はしない）。`createPortal(document.body)` +
 * `.modal-overlay-h`（svh カスケード）はプロジェクト規約
 * （feedback_bottom_sheet_url_bar_hidden）。
 *
 * ★**証憑は任意**。0枚のまま実行すると現行の「支払済にする」と完全に同一の挙動に
 * なるので、スキップ用の別ボタンは作らない（実行ボタンは常に「支払報告」）。
 */

/** 1回の支払報告に添えられる証憑の上限（サーバー側でも同じ値で再検証する）。 */
const MAX_RECEIPTS = 3
/** クライアント側で縮小する長辺（明細の文字が読める範囲で最小に寄せる）。 */
const CLIENT_MAX_DIMENSION = 2048
const CLIENT_JPEG_QUALITY = 0.85

const UNSUPPORTED_MESSAGE =
  'この画像は読み込めませんでした。HEIC は非対応です。カメラロールから選び直すか、JPEG / PNG を選んでください。'

export interface SelectedReceipt {
  id: string
  filename: string
  /** 縮小後の JPEG（素の base64。データ URL ではない）。 */
  base64: string
  /** プレビュー表示用のデータ URL。 */
  dataUrl: string
}

export interface PaymentReportSheetProps {
  /** 対象の日数（シート見出しの補足に出す）。 */
  dayCount: number
  /** 証憑0枚のときに送られる本文（サーバーで組んだ実物）。 */
  messageWithoutReceipts: string
  /** 証憑1枚以上のときに送られる本文（サーバーで組んだ実物）。 */
  messageWithReceipts: string
  /** グループに linked な LINE 連携があるか。無ければ送信されない旨を出す。 */
  isLineLinked: boolean
  onClose: () => void
  onSubmit: (receipts: PaymentReceiptInput[]) => Promise<ReportPaymentResult>
}

/**
 * 選んだ画像を canvas で長辺 2048px・JPEG q0.85 へ再エンコードする。
 * デコードできない形式（HEIC 等）はここで失敗するので、その場で日本語のエラーを出す。
 */
async function downscaleToJpeg(file: File): Promise<{ base64: string; dataUrl: string }> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(UNSUPPORTED_MESSAGE))
      img.src = objectUrl
    })
    const scale = Math.min(1, CLIENT_MAX_DIMENSION / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(UNSUPPORTED_MESSAGE)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', CLIENT_JPEG_QUALITY)
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    if (!base64) throw new Error(UNSUPPORTED_MESSAGE)
    return { base64, dataUrl }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function PaymentReportSheet({
  dayCount,
  messageWithoutReceipts,
  messageWithReceipts,
  isLineLinked,
  onClose,
  onSubmit,
}: PaymentReportSheetProps) {
  const [receipts, setReceipts] = useState<SelectedReceipt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const preview = receipts.length > 0 ? messageWithReceipts : messageWithoutReceipts
  const canAdd = receipts.length < MAX_RECEIPTS

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    const room = MAX_RECEIPTS - receipts.length
    const picked = Array.from(files).slice(0, room)
    if (files.length > room) {
      setError(`証憑は${MAX_RECEIPTS}枚までです`)
    }
    const added: SelectedReceipt[] = []
    for (const file of picked) {
      try {
        const { base64, dataUrl } = await downscaleToJpeg(file)
        added.push({ id: crypto.randomUUID(), filename: file.name, base64, dataUrl })
      } catch {
        setError(UNSUPPORTED_MESSAGE)
      }
    }
    if (added.length > 0) setReceipts((prev) => [...prev, ...added])
  }

  function remove(id: string) {
    setReceipts((prev) => prev.filter((r) => r.id !== id))
  }

  function submit() {
    setError(null)
    setNotice([])
    // 通知を伴う操作の確認文言は `GroupDayTable` の既存文言をそのまま使う。
    if (isLineLinked && typeof window !== 'undefined') {
      const ok = window.confirm('参加者の LINE グループに通知が送られます。よろしいですか？')
      if (!ok) return
    }
    startTransition(async () => {
      try {
        const result = await onSubmit(
          receipts.map((r) => ({ filename: r.filename, base64: r.base64 })),
        )
        if ('error' in result) {
          setError(result.error)
          return
        }
        const messages: string[] = [...result.excluded]
        if (result.status === 'skipped_unlinked') {
          messages.push('LINE グループが紐付いていないため送信していません（記録は残りました）。')
        }
        if (result.status === 'skipped_no_change') {
          // 紐付けはあるが送るものが無かった（証憑0枚 ∧ 完了通知は送信済み）。
          messages.push('この日の完了通知は送信済みのため、今回は通知を送っていません。')
        }
        if (result.status === 'failed') {
          messages.push(
            `LINE 送信に失敗しました: ${result.sendError ?? '不明なエラー'}（履歴から再送できます）`,
          )
        }
        if (messages.length > 0) {
          setNotice(messages)
          return
        }
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : '支払報告に失敗しました')
      }
    })
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-report-sheet-title"
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col gap-3 rounded-t-[14px] bg-surface p-4 pb-[18px] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="mx-auto h-1 w-9 rounded-full bg-border-strong" />

        <h2
          id="payment-report-sheet-title"
          className="font-display text-base font-bold text-ink"
        >
          支払報告
          <span className="ml-2 text-xs font-normal text-ink-meta">{dayCount}日が対象</span>
        </h2>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <section className="flex flex-col gap-2">
            <p className="text-xs text-ink-meta">
              振込明細の写真（任意・最大{MAX_RECEIPTS}枚）
            </p>
            <div className="flex flex-wrap gap-2">
              {receipts.map((receipt) => (
                <span key={receipt.id} className="relative block h-20 w-20">
                  {/* next/image は data URL を扱えないので素の img を使う。 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={receipt.dataUrl}
                    alt={receipt.filename}
                    className="h-20 w-20 rounded-md border border-border object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`${receipt.filename} を外す`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] text-surface"
                    onClick={() => remove(receipt.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {canAdd && (
                <button
                  type="button"
                  className="flex h-20 w-20 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-border-strong text-[11px] text-ink-meta"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span aria-hidden className="text-base leading-none">
                    ＋
                  </span>
                  写真を選ぶ
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </section>

          <section className="flex flex-col gap-1">
            <p className="text-xs text-ink-meta">送信内容</p>
            <p
              data-testid="payment-report-preview"
              className="whitespace-pre-wrap rounded-md bg-surface-alt px-3 py-2 text-[13px] leading-relaxed text-ink"
            >
              {preview}
            </p>
            {receipts.length > 0 && (
              <p className="text-xs text-ink-meta">＋ 明細の写真 {receipts.length}枚</p>
            )}
            {!isLineLinked && (
              <p className="rounded-md bg-warn-bg px-2.5 py-1.5 text-[11px] leading-normal text-warn-fg">
                LINE グループが紐付いていないため、送信は行われません（支払済への変更と証憑の保存だけ行います）。
              </p>
            )}
          </section>

          {notice.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md bg-warn-bg px-2.5 py-1.5 text-[11px] leading-normal text-warn-fg">
              {notice.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {error && <p className="text-xs text-danger-fg">{error}</p>}
        </div>

        <div className="flex items-center gap-2">
          <Btn
            type="button"
            kind="secondary"
            size="sm"
            className="h-[34px] rounded-md"
            disabled={isPending}
            onClick={onClose}
          >
            {notice.length > 0 ? '閉じる' : 'やめる'}
          </Btn>
          <Btn
            type="button"
            size="sm"
            className="h-[34px] flex-1 rounded-md"
            disabled={isPending}
            onClick={submit}
          >
            支払報告
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  )
}
