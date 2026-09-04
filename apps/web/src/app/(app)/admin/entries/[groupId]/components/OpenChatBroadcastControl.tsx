'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Btn } from '@/components/ui'
import {
  broadcastOpenChats,
  loadOpenChatBroadcastSummary,
} from '@/app/(app)/admin/mail-inbox/open-chat-actions'

/**
 * openchat-broadcast 2026-09-04 改修: 申込グループページのオープンチャット再配信。
 *
 * 通常の配信はメール詳細の統合処理フォーム（`processMail`）が本文・添付と同じ
 * タイミングで起こす。ただし**その配信が失敗しても、やり直す場所がどこにも無い**
 * ——統合処理フォームは未処理のメールにしか出ず、「未処理に戻す」は名簿の採用まで
 * 取り消してしまうため代替にならない。ここがその唯一のやり直し導線。
 *
 * ★**管理者・副管理者だけ**に描画する（呼び出し側の `isAdmin` 判定が境界。
 * Server Action 側にも `requireAdminSession()` があり二重に守られている）。
 * ★保存済みが 0 件のときは何も描画しない（送るものが無い）。
 * ★2回目以降は AC-35 の確認を挟む——配信は**毎回全件を送る**ので、誤って押すと
 * 同じ Flex がもう一度会員へ届く。
 */

interface SummaryState {
  broadcastCount: number
  items: { id: number; label: string; isNew: boolean }[]
  lastFailed: boolean
}

export function OpenChatBroadcastControl({
  entryGroupId,
  lineLinked,
}: {
  entryGroupId: number
  lineLinked: boolean
}) {
  const [summary, setSummary] = useState<SummaryState | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    loadOpenChatBroadcastSummary(entryGroupId)
      .then((s) => {
        if (cancelled) return
        setSummary({
          broadcastCount: s.broadcastCount,
          items: s.rows.map((r) => ({ id: r.id, label: r.label, isNew: r.isNew })),
          lastFailed: s.lastAttempt != null && s.lastAttempt.status !== 'sent',
        })
      })
      .catch(() => {
        // 引けなくてもページの他の部分は壊さない。ボタンを出さないだけにする。
        if (!cancelled) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [entryGroupId])

  if (!summary || summary.items.length === 0) return null

  async function send() {
    setConfirming(false)
    setMessage(null)
    const outcome = await broadcastOpenChats(entryGroupId)
    if (outcome.status === 'sent') {
      setMessage({ tone: 'ok', text: `${outcome.sentCount}件を配信しました` })
      // ★まずローカルで配信回数を進める（Codex R3 blocker）。この後のサマリー
      // 再取得が失敗しても「未配信」に留まると、もう一度押したときに再配信確認を
      // 迂回して保存済み全件が二重に届く。
      setSummary((prev) =>
        prev ? { ...prev, broadcastCount: prev.broadcastCount + 1, lastFailed: false } : prev,
      )
      // 「（今回追加）」印と正確な回数を引き直す（失敗しても上の暫定値で安全側）。
      const next = await loadOpenChatBroadcastSummary(entryGroupId).catch(() => null)
      if (next) {
        setSummary({
          broadcastCount: next.broadcastCount,
          items: next.rows.map((r) => ({ id: r.id, label: r.label, isNew: r.isNew })),
          lastFailed: false,
        })
      }
      return
    }
    setMessage({
      tone: 'error',
      text:
        outcome.status === 'not_linked'
          ? 'LINE グループが未紐付けのため配信できません。再紐付けしてから配信してください'
          : outcome.status === 'failed'
            ? `配信に失敗しました（${outcome.error}）`
            : outcome.status === 'binding_changed'
              ? '紐付けが変わったため配信を中止しました'
              : '配信を中止しました',
    })
  }

  function onClick() {
    if (summary!.broadcastCount > 0) {
      setConfirming(true)
      return
    }
    startTransition(send)
  }

  const totalCount = summary.items.length

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <div className="text-[10px] leading-relaxed text-ink-meta">
        通常はメール詳細の「LINE 配信」で本文・添付と一緒に送られます。
        {summary.broadcastCount > 0
          ? `配信済み ${summary.broadcastCount} 回。`
          : '未配信。'}
        {summary.lastFailed && (
          <span className="text-danger">前回の配信は届いていません（失敗または中止）。</span>
        )}
      </div>
      <div>
        <Btn
          kind="ghost"
          size="sm"
          disabled={pending || !lineLinked}
          onClick={onClick}
        >
          オープンチャットを配信（{totalCount}件）
        </Btn>
      </div>
      {!lineLinked && (
        <p className="text-[10px] text-ink-meta">
          LINE グループが未紐付けのため配信できません。
        </p>
      )}
      {message && (
        <p
          className={`text-xs ${message.tone === 'ok' ? 'text-ink-2' : 'text-danger'}`}
          role={message.tone === 'error' ? 'alert' : undefined}
        >
          {message.text}
        </p>
      )}

      {confirming &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-chat-rebroadcast-title"
            className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
            // 処理中は背景クリックで閉じさせない（結果の表示先を失わないため）。
            onClick={pending ? undefined : () => setConfirming(false)}
          >
            <div
              className="w-full rounded-lg bg-surface p-4 shadow-lg sm:max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="open-chat-rebroadcast-title"
                className="font-display text-base font-bold text-ink"
              >
                もう一度配信しますか
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">
                この大会には<b>すでに {summary.broadcastCount} 回</b>配信しています。
                <br />
                保存済みの<b>全 {totalCount} 件</b>を改めて送ります。
              </p>
              <div className="mt-2 flex flex-col gap-0.5">
                {summary.items.map((item) => (
                  <span key={item.id} className="text-xs text-ink-meta">
                    ・{item.label}
                    {item.isNew && '（今回追加）'}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Btn
                  kind="ghost"
                  size="md"
                  className="w-24 flex-none"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                >
                  やめる
                </Btn>
                <Btn
                  kind="primary"
                  size="md"
                  block
                  disabled={pending}
                  onClick={() => startTransition(send)}
                >
                  {totalCount}件を配信
                </Btn>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
