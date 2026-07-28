'use client'

import { Btn } from '@/components/ui'

/**
 * entry-form-autofill タスク7 (UI): 失敗画面。design-mock: b-error.html。
 *
 * mock は常に「生成済み」ダウンロードを前提にしているが、`createEntryFormDraftAction`
 * は xlsx 読み込み・記入自体が失敗した場合（IMAP に辿り着く前）は draft を保存せず
 * 例外を投げる契約（actions.ts の `readTemplate`/`fillEntryForm`）。その場合は
 * `draftId` が無く、ダウンロードできる生成物も存在しないため、成功枠（okline）と
 * ダウンロードリンクを出さない——mock からの意図的な逸脱（報告参照）。
 */
export interface ErrorStepProps {
  message: string
  draftId: number | null
  downloadUrl: string | null
  unassignedCount: number
  overflowCount: number
  onRetry: () => void
  retrying: boolean
}

export function ErrorStep({
  message,
  draftId,
  downloadUrl,
  unassignedCount,
  overflowCount,
  onRetry,
  retrying,
}: ErrorStepProps) {
  return (
    <>
      <div className="flex flex-col items-center gap-2.5 py-7 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-bg text-lg font-bold text-danger-fg">
          ！
        </div>
        <h1 className="font-display text-xl font-bold text-ink">下書きを作成できませんでした</h1>
        <p className="max-w-[280px] text-xs text-ink-meta">
          Yahoo メールへの接続に失敗しました。時間をおいて再試行してください。
        </p>
      </div>

      <div className="rounded-md bg-danger-bg px-2.5 py-2 text-[11px] leading-normal text-danger-fg">
        接続エラー: <code className="font-bold break-words">{message}</code>
      </div>

      {draftId != null && (
        <div className="flex gap-2 rounded-md bg-success-bg px-2.5 py-2 text-[11px] leading-normal text-success-fg">
          <span aria-hidden>✓</span>
          <span>
            <b className="font-bold">記入済みの申込書は生成できています。</b>
            ダウンロードして手動でメールに添付することもできます。編集した内容（ふりがな・出場回数など）は保存済みです。
          </span>
        </div>
      )}

      {(unassignedCount > 0 || overflowCount > 0) && (
        <div className="flex flex-col gap-1 rounded-md bg-warn-bg px-2.5 py-2">
          {unassignedCount > 0 && (
            <p className="text-[11px] leading-normal text-warn-fg">
              ⚠ どの記入シートにも対応しなかった会員が{unassignedCount}名います
            </p>
          )}
          {overflowCount > 0 && (
            <p className="text-[11px] leading-normal text-warn-fg">
              ⚠ テンプレの行数を超えて記入できなかった会員が{overflowCount}名います
            </p>
          )}
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-surface px-4 py-3">
        {downloadUrl && (
          <a
            href={downloadUrl}
            download
            className="block rounded-md border border-border-strong bg-surface py-[11px] text-center text-[13px] text-ink-2"
          >
            生成した申込書をダウンロード
          </a>
        )}
        <Btn kind="primary" size="lg" block onClick={onRetry} disabled={retrying}>
          {retrying ? '作成中…' : 'もう一度下書きを作成する'}
        </Btn>
      </div>
    </>
  )
}
