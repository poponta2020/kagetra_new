'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { RENEWAL_NOTE_MAX_LENGTH } from '@kagetra/shared'
import { Btn, Pill } from '@/components/ui'
import { buildAnnouncementMessage } from '@/lib/membership-renewal/messages'
import { startRenewalAction, type StartRenewalState } from './actions'
import { formatJstYmd } from './format'

/**
 * S2 未開始（design-mock「未開始 ── 開始フォーム＋前提チェック」）。
 *
 * 入力は 対象年度・回答締切・一言 の3つ＋その場の文面プレビュー。前提
 * （会 LINE グループ・`PUBLIC_BASE_URL`）が揃わないと開始ボタンを無効にし、
 * 理由をボタン直下に出す（design-spec「前提が揃わないと開始は無効で理由を出す」）。
 */
const initialState: StartRenewalState = {}

export interface StartFormProps {
  suggestedFiscalYear: number
  previousRenewal: { fiscalYear: number; completedAt: Date | null } | null
  targets: { zennichikyo: number; circle: number }
  clubLineGroup: { chatRoomName: string; botLabel: string } | null
  baseUrlConfigured: boolean
  /** `PUBLIC_BASE_URL` から解決した S1 の絶対 URL（未設定なら null。文面プレビュー用）。 */
  previewUrl: string | null
}

export function StartForm({
  suggestedFiscalYear,
  previousRenewal,
  targets,
  clubLineGroup,
  baseUrlConfigured,
  previewUrl,
}: StartFormProps) {
  const [state, formAction, pending] = useActionState(startRenewalAction, initialState)
  const [fiscalYear, setFiscalYear] = useState(String(suggestedFiscalYear))
  const [deadline, setDeadline] = useState('')
  const [note, setNote] = useState('')

  const blockReasons: string[] = []
  if (!clubLineGroup) blockReasons.push('会 LINE グループを設定してください（設定 › 会 LINE グループ）')
  if (!baseUrlConfigured) blockReasons.push('PUBLIC_BASE_URL が未設定です（管理者へ連絡してください）')
  const canStart = blockReasons.length === 0

  const preview =
    previewUrl && deadline
      ? buildAnnouncementMessage({
          fiscalYear: Number(fiscalYear) || suggestedFiscalYear,
          deadlineJst: deadline,
          note: note.trim() ? note.trim() : null,
          url: previewUrl,
        })
      : null

  return (
    <div className="flex flex-col gap-1 p-4">
      <nav className="flex items-baseline gap-[5px] pb-1 text-xs text-ink-meta">
        <Link href="/settings" className="text-brand hover:underline">
          設定
        </Link>
        <span aria-hidden>›</span>
        <Link href="/admin/members" className="text-brand hover:underline">
          会員
        </Link>
        <span aria-hidden>›</span>
        <span>年度確認</span>
      </nav>
      <h1 className="font-display text-2xl font-bold leading-tight text-ink">年度確認</h1>
      {previousRenewal && (
        <p className="pb-2 text-xs text-ink-meta">
          前回: {previousRenewal.fiscalYear}年度
          {previousRenewal.completedAt && <> ・完了 {formatJstYmd(previousRenewal.completedAt)}</>}
          <Link
            href={`/admin/members/renewal?view=result`}
            className="ml-1.5 text-brand"
          >
            結果を見る
          </Link>
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-6 pb-4">
        <section className="flex flex-col gap-3 pt-3">
          <div className="border-b border-border-strong pb-2">
            <h2 className="text-sm font-semibold text-ink">開始する</h2>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="renewal-fiscal-year" className="text-xs text-ink-meta">
              対象年度<span className="ml-0.5 text-accent-fg">*</span>
            </label>
            <input
              id="renewal-fiscal-year"
              type="number"
              name="fiscalYear"
              required
              min={2000}
              max={2100}
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              className="w-32 rounded-md border border-border bg-surface px-[10px] py-[9px] text-sm text-ink"
            />
            <p className="text-[11px] leading-relaxed text-ink-meta">3月に開始するので翌年度が既定です。</p>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="renewal-deadline" className="text-xs text-ink-meta">
              回答締切<span className="ml-0.5 text-accent-fg">*</span>
            </label>
            <input
              id="renewal-deadline"
              type="date"
              name="deadline"
              required
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-[10px] py-[9px] text-sm text-ink"
            />
            <p className="text-[11px] leading-relaxed text-ink-meta">
              開始日の3日後から3日おき・締切前日・当日の 20:00 にリマインドします。
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="renewal-note" className="text-xs text-ink-meta">
              案内に添える一言
            </label>
            <textarea
              id="renewal-note"
              name="note"
              maxLength={RENEWAL_NOTE_MAX_LENGTH}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例: 住所が変わった人は郵便番号も直してください"
              className="min-h-16 w-full rounded-md border border-border bg-surface px-[10px] py-2 text-sm text-ink"
            />
          </div>

          {preview && (
            <div className="border-l-2 border-border-strong py-1 pl-[10px] text-xs leading-[1.8] text-ink-2 whitespace-pre-line">
              {preview}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-1">
          <div className="border-b border-border-strong pb-2">
            <h2 className="text-sm font-semibold text-ink">前提</h2>
          </div>
          <div className="flex items-baseline gap-2 py-[7px] text-sm">
            <span className="w-24 shrink-0 text-xs text-ink-meta">会 LINE グループ</span>
            <span className="min-w-0 flex-1 text-ink">
              {clubLineGroup ? clubLineGroup.chatRoomName : '未設定'}
              <span className="block text-xs text-ink-meta">
                {clubLineGroup ? `Bot: ${clubLineGroup.botLabel}` : '設定 › 会 LINE グループ から設定してください'}
              </span>
            </span>
            <Pill tone={clubLineGroup ? 'success' : 'warn'} size="sm">
              {clubLineGroup ? 'OK' : '未設定'}
            </Pill>
          </div>
          <div className="flex items-baseline gap-2 border-t border-border-soft py-[7px] text-sm">
            <span className="w-24 shrink-0 text-xs text-ink-meta">対象者</span>
            <span className="min-w-0 flex-1 text-ink">
              全日協 {targets.zennichikyo}名 ・ サークル {targets.circle}名
              <span className="block text-xs text-ink-meta">
                開始時点の「全日協登録 ON」「サークル所属」で確定します
              </span>
            </span>
          </div>
          <div className="flex items-baseline gap-2 border-t border-border-soft py-[7px] text-sm">
            <span className="w-24 shrink-0 text-xs text-ink-meta">名簿と合わない人</span>
            <span className="min-w-0 flex-1 text-ink">
              <Link href="/admin/members" className="text-brand">
                会員一覧で全日協フラグを確認
              </Link>
              <span className="block text-xs text-ink-meta">開始後は対象者を増減できません</span>
            </span>
          </div>
        </section>

        {!canStart && (
          <ul className="flex flex-col gap-1 text-xs text-accent-fg">
            {blockReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {state.error && (
          <p role="alert" className="text-xs text-accent-fg">
            {state.error}
          </p>
        )}

        <Btn type="submit" size="lg" block disabled={pending || !canStart}>
          {pending ? '開始しています…' : '開始して案内を送る'}
        </Btn>
      </form>
    </div>
  )
}
