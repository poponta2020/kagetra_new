'use client'

import { useMemo, useState, useTransition } from 'react'
import { Btn } from '@/components/ui'
import { DisclosureSection } from '@/components/events/detail'
import { formatDateTimeShort } from '@/lib/event-date'
import type { Grade } from '@kagetra/shared/types'
import type { GradeHeadcount } from '@/lib/entry-fee'
import { buildPaymentNoticeMessages } from '@/lib/payment-notice'
import type { SendPaymentNoticeResult } from '../actions'

/**
 * 振込連絡（line-bot-message-revamp §3.3）。名簿確定フェーズのグループにだけ出る。
 *
 * 露出条件（settled ∧ 事前払い ∧ 未振込）は **page.tsx が判定**し、ここは
 * 描かれた時点で「出してよい」前提に立つ（申込管理ボードの `payment_due` と
 * 同じ条件で、判定の正典は `confirmed-roster.ts`）。
 *
 * ★編集できるのは**級ごとの人数だけ**。単価は協会規定額から `resolveEntryFee` が
 * 導出する値で、管理者が上書きしてよい種類の数字ではない（§3.3.2 / Non-goals）。
 * したがって単価の入力欄をこの画面に置いてはならない（AC-13）。
 *
 * プレビューはクライアント側で `buildPaymentNoticeMessages` を呼んで組み立てる
 * （同じ純関数をサーバーの送信経路も使うので、見た目と実際が食い違わない）。
 * メンションは実際には会計担当の表示名に置き換わるが、プレビューでは
 * 素テキストの `@会計` を出す（メンション0件と同じ経路）。
 */

export interface PaymentNoticeRow {
  grade: Grade
  count: number
  unitJpy: number
}

export interface PaymentNoticeSectionProps {
  groupId: number
  /** 級ごとの人数の初期値（保存済みがあればそれ、無ければ参加費集計から）。 */
  rows: readonly PaymentNoticeRow[]
  /** 保存済みの人数があるか（＝初期値が編集後の値か）。表示の注記に使う。 */
  hasSavedCounts: boolean
  /** 振込期限 `YYYY-MM-DD`。NULL なら文面の日付行が消える。 */
  paymentDeadline: string | null
  /** 支払情報（自由記述）。空なら2通目を送らない。 */
  paymentInfo: string | null
  /** 最後に送信できた日時。NULL ならまだ送っていない。 */
  lastSentAt: Date | null
  sendAction: (
    groupId: number,
    counts: Record<string, number>,
  ) => Promise<SendPaymentNoticeResult>
}

const INPUT_CLASS =
  'w-16 rounded-md border border-border bg-canvas px-2 py-1 text-right text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/30'

/** 級・人数・単価だけを見た署名。これが変われば「対象が変わった」とみなす。 */
function rowsSignature(rows: readonly PaymentNoticeRow[]): string {
  return rows.map((r) => `${r.grade}:${r.count}:${r.unitJpy}`).join('|')
}

export function PaymentNoticeSection({
  groupId,
  rows,
  hasSavedCounts,
  paymentDeadline,
  paymentInfo,
  lastSentAt,
  sendAction,
}: PaymentNoticeSectionProps) {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map((r) => [r.grade, r.count])),
  )
  // 画面を開いたまま Server Component が再検証されると props.rows が新しい
  // 人数（例: 対象外になった日を除いた集計）へ更新されるが、counts は
  // useState の初期化関数（初回レンダーのみ実行）のままだと古い値が残る。
  // その古い counts が editedRows / sendAction にそのまま使われ、対象外の
  // 人数で振込連絡を送ってしまうバグを防ぐため、rows の署名が変わったら
  // レンダー中に counts を作り直す（useEffect だと1レンダー遅れる。
  // React 公式の「props が変わったら state を調整する」パターン）。
  const [prevRowsSignature, setPrevRowsSignature] = useState(() => rowsSignature(rows))
  const nextRowsSignature = rowsSignature(rows)
  if (nextRowsSignature !== prevRowsSignature) {
    setPrevRowsSignature(nextRowsSignature)
    setCounts(Object.fromEntries(rows.map((r) => [r.grade, r.count])))
  }
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<SendPaymentNoticeResult | null>(null)

  const editedRows: GradeHeadcount[] = useMemo(
    () => rows.map((r) => ({ grade: r.grade, count: counts[r.grade] ?? 0, unitJpy: r.unitJpy })),
    [rows, counts],
  )

  const preview = useMemo(
    () =>
      buildPaymentNoticeMessages({
        // プレビューは素テキストの `@会計`（実送信では会計担当がメンションされる）。
        mention: { kind: 'users', userIds: [] },
        rows: editedRows,
        paymentDeadlineIso: paymentDeadline,
        paymentInfo,
      }),
    [editedRows, paymentDeadline, paymentInfo],
  )

  const onSend = () => {
    setResult(null)
    startTransition(async () => {
      setResult(await sendAction(groupId, counts))
    })
  }

  return (
    <DisclosureSection
      title="振込連絡"
      aux={lastSentAt ? `送信済 ${formatDateTimeShort(lastSentAt)}` : '未送信'}
      auxTone={lastSentAt ? 'meta' : 'warn'}
    >
      <p className="text-[13px] text-ink-2">
        確定名簿が出たグループの会計へ、振込金額を LINE で連絡します。人数は
        {hasSavedCounts ? '前回送信時の値' : '出欠回答の集計'}
        を初期値にしています。抽選のある大会では落選者が混ざるので、送る前に確認してください。
      </p>

      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-meta">
            参加費を算出できる級がありません（非公認・団体戦のみのグループ）。
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.grade} className="flex items-center gap-2 text-[13px]">
              <span className="w-12 text-ink">{row.grade}級</span>
              {/* 単価は表示のみ。入力欄にしない（AC-13）。 */}
              <span className="w-24 text-ink-2">{row.unitJpy.toLocaleString('ja-JP')}円</span>
              <span className="text-ink-meta">×</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={counts[row.grade] ?? 0}
                onChange={(e) =>
                  setCounts((prev) => ({
                    ...prev,
                    [row.grade]: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                aria-label={`${row.grade}級の人数`}
                className={INPUT_CLASS}
              />
              <span className="text-ink-meta">名</span>
            </div>
          ))
        )}
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-ink-2">プレビュー</p>
        {preview == null ? (
          <p role="alert" className="mt-1 text-[13px] text-accent">
            人数が全級0名です。1名以上にしないと送信できません。
          </p>
        ) : (
          <div className="mt-1 space-y-2">
            {preview.messages.map((m, i) => (
              <pre
                key={i}
                className="whitespace-pre-wrap rounded-md bg-surface-alt p-3 text-[13px] text-ink"
              >
                {m.text}
              </pre>
            ))}
          </div>
        )}
      </div>

      {result?.error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p role="status" className="mt-3 text-[13px] text-success">
          振込連絡を送信しました。
        </p>
      )}

      <div className="mt-3">
        <Btn onClick={onSend} disabled={pending || preview == null}>
          {pending ? '送信中…' : lastSentAt ? '振込連絡を再送する' : '振込連絡を送る'}
        </Btn>
      </div>
    </DisclosureSection>
  )
}
