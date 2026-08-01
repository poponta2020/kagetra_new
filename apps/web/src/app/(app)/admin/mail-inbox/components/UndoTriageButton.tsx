'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { undoTriage } from '../actions'

/**
 * mail-inbox-mailer: 処理済画面の「未処理に戻す」ボタン。
 *
 * 2026-08-02 改修 (AC-24): `processMail` の 1 回の実行で作られたものを 1 回で
 * 戻すため、`undoTriage` が **種別・大会紐付け・そのメール由来の名簿採用**を
 * まとめて取り消す。旧 `unlinkMailFromEvent` との使い分け（linked_event_id の
 * 有無で呼び分ける）は不要になったので、常に `undoTriage` を呼ぶ。
 *
 * LINE 配信済メッセージの取消は LINE API 仕様上できない（呼び出し側の画面が
 * その旨を明示する）。AI 抽出済み draft は残す（再度開けば編集可）。
 */
export function UndoTriageButton({ mailId }: { mailId: number }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const onUndo = () => {
    startTransition(async () => {
      await undoTriage(mailId)
      router.refresh()
    })
  }

  return (
    <Btn kind="secondary" size="md" onClick={onUndo} disabled={pending}>
      {pending ? '処理中…' : '未処理に戻す'}
    </Btn>
  )
}
