'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { dismissMail } from '../actions'
import { AIExtractConfirmDialog } from './AIExtractConfirmDialog'
import {
  ExistingEventLinkSheet,
  type LinkableEventOption,
} from './ExistingEventLinkSheet'

/**
 * mail-inbox-mailer タスク4: mail 詳細画面下部の 3 アクションエリア。
 *
 * 要件 §3.1.2:
 *   - (a) 会で流す（AI 抽出） — 確認ダイアログ
 *   - (b) 既存イベントに紐付ける — シート
 *   - (c) 対応不要 — 即実行 → 一覧へ
 *
 * 表示条件: triage_status='unprocessed' かつ draft が無いとき。
 * draft 状態に応じた切替は呼び出し側 (page.tsx) で行う（このコンポーネント
 * は単純な 3 ボタン）。
 */
export function MailDetailActions({
  mailId,
  linkableEvents,
}: {
  mailId: number
  linkableEvents: LinkableEventOption[]
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const onDismiss = () => {
    startTransition(async () => {
      await dismissMail(mailId)
      router.push('/admin/mail-inbox')
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <AIExtractConfirmDialog mailId={mailId} />
      <ExistingEventLinkSheet mailId={mailId} events={linkableEvents} />
      <Btn kind="ghost" size="md" onClick={onDismiss} disabled={pending}>
        {pending ? '処理中…' : '対応不要'}
      </Btn>
    </div>
  )
}
