'use client'

import { useActionState } from 'react'
import { deleteMember, type DeleteMemberState } from './actions'

const initialState: DeleteMemberState = {}

/**
 * Hard-delete section, rendered only for members without a LINE binding.
 * Positioned as "undo a mistaken registration" — the server refuses unless
 * the row is unlinked and completely unreferenced.
 */
export function DeleteMemberSection({
  userId,
  memberName,
}: {
  userId: string
  memberName: string
}) {
  const [state, formAction, pending] = useActionState(
    deleteMember,
    initialState,
  )

  return (
    <section className="rounded-lg bg-surface p-4 shadow-sm">
      <h3 className="text-sm font-semibold">会員の削除</h3>
      <p className="mt-1 text-xs text-ink-2">
        誤登録の取り消し用です。LINE
        紐付け前で関連データがない場合のみ削除できます（元に戻せません）。それ以外は退会処理を使ってください。
      </p>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`「${memberName}」を削除します。よろしいですか？`)) {
            e.preventDefault()
          }
        }}
        className="mt-3"
      >
        <input type="hidden" name="userId" value={userId} />
        {/* hover は opacity ではなく brightness で当てる。disabled:opacity-60 と
            同じ property を奪い合うと、どちらが勝つかが Tailwind の出力順依存に
            なり className の順では制御できない（globals.css の .mobile-shell-h
            と同じ罠）。property を分けておけば衝突しようがない。 */}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm text-ink-on-brand hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? '削除中…' : 'この会員を削除する'}
        </button>
      </form>
    </section>
  )
}
