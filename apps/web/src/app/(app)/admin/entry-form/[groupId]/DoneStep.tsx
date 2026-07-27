'use client'

import Link from 'next/link'
import { SectionRule } from './SectionRule'

/**
 * entry-form-autofill タスク7 (UI): 完了画面。design-mock: b-done.html。
 *
 * mock は単一イベントの「イベントに戻る」導線だが、申込グループは複数イベントを
 * 束ね得るため戻り先は申込管理ボード（/admin/entries）に変更している（報告参照）。
 */
export interface DoneStepProps {
  toEmail: string
  subject: string
  attachmentFilename: string
  memberCount: number
  createdAt: string
  createdByName: string | null
  unassignedCount: number
  overflowCount: number
  downloadUrl: string
}

export function DoneStep({
  toEmail,
  subject,
  attachmentFilename,
  memberCount,
  createdAt,
  createdByName,
  unassignedCount,
  overflowCount,
  downloadUrl,
}: DoneStepProps) {
  return (
    <>
      <div className="flex flex-col items-center gap-2.5 py-7 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success-bg text-xl font-bold text-success-fg">
          ✓
        </div>
        <h1 className="font-display text-xl font-bold text-ink">下書きを作成しました</h1>
        <p className="text-xs text-ink-meta">
          Yahoo メールの下書きフォルダに保存済み・送信はされていません
        </p>
      </div>

      {(unassignedCount > 0 || overflowCount > 0) && (
        <div className="flex flex-col gap-1 rounded-md bg-warn-bg px-2.5 py-2">
          {unassignedCount > 0 && (
            <p className="text-[11px] leading-normal text-warn-fg">
              ⚠ どの記入シートにも対応しなかった会員が{unassignedCount}名います。別途対応してください
            </p>
          )}
          {overflowCount > 0 && (
            <p className="text-[11px] leading-normal text-warn-fg">
              ⚠ テンプレの行数を超えて記入できなかった会員が{overflowCount}名います。別紙などで対応してください
            </p>
          )}
        </div>
      )}

      <section className="flex flex-col gap-1">
        <SectionRule title="作成した下書き" />
        <ul>
          <li className="flex gap-2.5 border-t border-border-soft py-[7px] text-xs first:border-t-0">
            <span className="w-[76px] shrink-0 text-ink-meta">宛先</span>
            <span className="min-w-0 flex-1">{toEmail}</span>
          </li>
          <li className="flex gap-2.5 border-t border-border-soft py-[7px] text-xs">
            <span className="w-[76px] shrink-0 text-ink-meta">件名</span>
            <span className="min-w-0 flex-1">{subject}</span>
          </li>
          <li className="flex gap-2.5 border-t border-border-soft py-[7px] text-xs">
            <span className="w-[76px] shrink-0 text-ink-meta">添付</span>
            <span className="min-w-0 flex-1">
              <b className="font-bold">{attachmentFilename}</b>（{memberCount}名記入済み）
            </span>
          </li>
          <li className="flex gap-2.5 border-t border-border-soft py-[7px] text-xs">
            <span className="w-[76px] shrink-0 text-ink-meta">作成</span>
            <span className="min-w-0 flex-1">
              {createdAt}
              {createdByName ? `・${createdByName}` : ''}
            </span>
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-1">
        <SectionRule title="この後の流れ" />
        <ul className="flex flex-col gap-2">
          <li className="flex gap-2.5 text-xs leading-normal">
            <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-brand-bg text-[11px] font-bold text-brand-fg">
              1
            </span>
            <span>
              <b className="font-bold">Yahoo メール</b>（アプリ / Web）の下書きを開き、内容を確認して
              <b className="font-bold">送信</b>
              <span className="block text-[10px] text-ink-muted">
                以前作成した下書きが残っている場合は Yahoo 側で削除してください
              </span>
            </span>
          </li>
          <li className="flex gap-2.5 text-xs leading-normal">
            <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-brand-bg text-[11px] font-bold text-brand-fg">
              2
            </span>
            <span>
              送信したら進行管理で<b className="font-bold">「申込済にする」</b>を押す
              <span className="block text-[10px] text-ink-muted">
                参加者への LINE 通知は従来どおりそのタイミングで送られます
              </span>
            </span>
          </li>
        </ul>
      </section>

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-surface px-4 py-3">
        <a
          href={downloadUrl}
          download
          className="block rounded-md border border-border-strong bg-surface py-[11px] text-center text-[13px] text-ink-2"
        >
          生成した申込書をダウンロード
        </a>
        <Link
          href="/admin/entries"
          className="block rounded-md bg-brand py-3 text-center text-sm font-bold text-ink-on-brand"
        >
          申込管理に戻る
        </Link>
      </div>
    </>
  )
}
