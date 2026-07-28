'use client'

import { Btn, Pill } from '@/components/ui'
import { isValidMailbox } from '@/lib/entry-form/mailbox'
import { SectionRule } from './SectionRule'
import type { PrefillSource, ToEmailSource } from './wizard-types'

/**
 * entry-form-autofill タスク7 (UI): ステップ3「メール」。design-mock: b-step3.html。
 *
 * 添付ファイル名は既定（定型のプレフィックス付与）ではバッジを出さない
 * ——モックの `.frow` のうちここだけ badge span を持たないため。主催者指定を
 * 抽出したときだけ、その事実を出所バッジで示す。
 */
export interface Step3MailProps {
  attachmentFilename: string
  memberCount: number
  toEmail: string
  toSource: ToEmailSource
  subject: string
  subjectSource: PrefillSource
  attachmentFilenameSource: PrefillSource
  body: string
  /** 会員構成が変わったのに本文が手編集済みで作り直されていない。 */
  bodyStale: boolean
  /** 本文を現在の会員構成で作り直す（手編集は破棄される）。 */
  onRegenerateBody: () => void
  onChange: (patch: { toEmail?: string; subject?: string; attachmentFilename?: string; body?: string }) => void
  onBack: () => void
  onSubmit: () => void
  submitting: boolean
  /** 履歴を作る前に弾かれたエラー（宛先の形式ミス等）。この画面で直せる。 */
  submitError: string | null
}

function toBadge(source: ToEmailSource) {
  if (source === 'template') return <Pill tone="brand" size="sm">申込書から抽出</Pill>
  if (source === 'ai') return <Pill tone="brand" size="sm">主催者指定を抽出</Pill>
  if (source === 'sourceMail') return <Pill tone="info" size="sm">案内メールの差出人</Pill>
  return null
}

function prefillBadge(source: PrefillSource) {
  return source === 'organizer'
    ? <Pill tone="brand" size="sm">主催者指定を抽出</Pill>
    : <Pill tone="info" size="sm">定型</Pill>
}

export function Step3Mail({
  attachmentFilename,
  memberCount,
  toEmail,
  toSource,
  subject,
  subjectSource,
  attachmentFilenameSource,
  body,
  bodyStale,
  onRegenerateBody,
  onChange,
  onBack,
  onSubmit,
  submitting,
  submitError,
}: Step3MailProps) {
  const toValid = isValidMailbox(toEmail)
  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionRule title="添付する申込書" />
        <div className="flex items-baseline gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate font-bold text-ink">{attachmentFilename}</span>
          <span className="shrink-0 text-[10px] text-ink-meta">{memberCount}名分を記入</span>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionRule title="メール下書き" />

        {memberCount === 0 && (
          <p className="rounded-md bg-warn-bg px-2.5 py-2 text-[11px] leading-normal text-warn-fg">
            ⚠ 記入する会員が0名です。空の申込書は作成できません。前のステップで会員を追加してください
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="flex items-baseline gap-1.5 text-[11px] text-ink-meta">
            宛先 {toBadge(toSource)}
          </span>
          <input
            value={toEmail}
            onChange={(e) => onChange({ toEmail: e.target.value })}
            type="email"
            placeholder="申込先メールアドレス"
            className={
              toEmail.trim().length > 0 && !toValid
                ? 'rounded-md border border-accent bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted'
                : 'rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted'
            }
          />
          {toEmail.trim().length > 0 && !toValid && (
            <span className="text-[10px] font-bold text-accent-fg">
              メールアドレスの形式が正しくありません
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="flex items-baseline gap-1.5 text-[11px] text-ink-meta">
            件名 {prefillBadge(subjectSource)}
          </span>
          <input
            value={subject}
            onChange={(e) => onChange({ subject: e.target.value })}
            className="rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="flex items-baseline gap-1.5 text-[11px] text-ink-meta">
            添付ファイル名{' '}
            {attachmentFilenameSource === 'organizer' ? prefillBadge(attachmentFilenameSource) : null}
          </span>
          <input
            value={attachmentFilename}
            onChange={(e) => onChange({ attachmentFilename: e.target.value })}
            className="rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-ink"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-meta">本文</span>
          {bodyStale && (
            <span className="flex flex-wrap items-baseline gap-1.5 rounded-md bg-warn-bg px-2 py-1.5 text-[11px] leading-normal text-warn-fg">
              <span aria-hidden>⚠</span>
              <span>会員の構成が変わりました。本文の人数・級別内訳を確認してください</span>
              <button type="button" className="font-bold underline" onClick={onRegenerateBody}>
                定型で作り直す
              </button>
            </span>
          )}
          <textarea
            value={body}
            onChange={(e) => onChange({ body: e.target.value })}
            rows={9}
            className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs leading-normal text-ink"
          />
        </label>
      </section>

      {submitError && (
        <p className="rounded-md bg-danger-bg px-2.5 py-2 text-[11px] leading-normal text-danger-fg break-words">
          {submitError}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-1.5 border-t border-border bg-surface px-4 py-3">
        <div className="flex gap-2">
          <Btn kind="secondary" size="lg" onClick={onBack} disabled={submitting}>
            戻る
          </Btn>
          <Btn kind="primary" size="lg" block onClick={onSubmit} disabled={submitting || !toValid || memberCount === 0}>
            {submitting ? '作成中…' : 'Yahoo メールに下書きを作成'}
          </Btn>
        </div>
        <p className="text-center text-[10px] text-ink-meta">
          送信はされません — 下書きを確認し、Yahoo メールから手動で送信します
        </p>
      </div>
    </>
  )
}
