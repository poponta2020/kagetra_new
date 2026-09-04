import Link from 'next/link'
import { formatDateTimeShort, formatEventDate } from '@/lib/event-date'
import {
  DisclosureActions,
  DisclosureRow,
  DisclosureSection,
  FlatTable,
  type DisclosureValueTone,
  type FlatTableRow,
} from '@/components/events/detail'
import type { PaymentDeadlineKind } from '@/lib/events/payment-deadline'
import {
  PaymentReportHistory,
  type PaymentReportHistoryRow,
} from './PaymentReportHistory'
import type { ResendPaymentReportResult } from '../actions'

/**
 * 申込グループページの「進行管理」（管理者のみ・**表示専用**）。
 * 視覚の正は `design-mock/page-admin.html` §④。
 *
 * ★**操作コントロールを1つも置かない**（申込書ウィザードへの遷移リンクを除く）。
 * 状態の切り替えは必ず日程表で日を選んでから行う——「どこで申込済にするのか」を
 * 1箇所に定めるため（design-spec §3「進行管理セクションの中に日ごとのトグルを
 * 置かない」）。日ページの `EventLifecycleSection`（単一イベントのトグルを持つ）を
 * 再利用しないのはこのため。
 *
 * Server Component（フックも状態も持たない）。管理者にしか描画されないので、
 * 非管理者には呼び出し側（page.tsx）がそもそも値を計算しない（AC-2）。
 */

/**
 * 申込書下書きの最新作成履歴（`entry_form_drafts` の最新行）。
 * 日ページの `EventLifecycleSection` が持っていた型を、その撤去にあわせて
 * 唯一の利用者であるこの画面へ移した。
 */
export interface EntryFormDraftRow {
  id: number
  createdAt: Date | string
  createdByName: string | null
  attachmentFilename: string
  status: 'pending' | 'appending' | 'created' | 'imap_failed'
}

export type GroupSummaryTone = DisclosureValueTone

export interface GroupSummary {
  label: string
  tone: GroupSummaryTone
}

export interface GroupProgressSectionProps {
  /** 申込状態の集約ラベル（例 `2日とも申込済`）。 */
  entrySummary: GroupSummary
  /** 支払状態の集約ラベル（例 `2日とも未払`）。 */
  paymentSummary: GroupSummary
  /** セクション見出し右の注記（例 `振込まで 8日`）。 */
  aux?: string
  auxTone?: 'meta' | 'warn'
  /** 共通値（グループ集約済み）。 */
  entryMethod: string | null
  entryDeadline: string | null
  internalDeadline: string | null
  paymentDeadline: string | null
  paymentDeadlineKind: PaymentDeadlineKind
  /**
   * payment-receipt-broadcast: 支払報告の履歴（新しい順）。空配列なら何も描かない。
   * ★**操作コントロールを置かない**という原則の唯一の例外が履歴行の「再送」で、
   * これは状態を進める操作ではなく「同じものをもう一度届ける」操作なので、
   * 記録の隣に置くのが正しい（日程表で日を選び直す意味が無い）。
   */
  paymentReports?: readonly PaymentReportHistoryRow[]
  resendPaymentReportAction?: (reportId: number) => Promise<ResendPaymentReportResult>
  paymentMethod: string | null
  paymentInfo: string | null
  /** 振込総額と内訳（`tallyEntryFeesForGroup`）。 */
  totalJpy: number | null
  breakdownLabel: string | null
  /** 級未設定で総額に未算入の人数の注記（整形済み）。 */
  unknownGradeNote: string | null
  /**
   * 申込書ウィザードへの導線。**個人戦のときだけ**渡す（団体戦は Non-goal。
   * 未指定なら「申込書」行ごと出さない）。
   */
  entryFormGroupId?: number
  entryFormLatestDraft?: EntryFormDraftRow | null
}

const ENTRY_FORM_SUMMARY: Record<
  'none' | 'pending' | 'appending' | 'created' | 'imap_failed',
  GroupSummary
> = {
  none: { label: '未作成', tone: 'plain' },
  appending: { label: '作成結果を確認中', tone: 'plain' },
  pending: { label: '作成結果を確認中', tone: 'plain' },
  created: { label: '下書き作成済', tone: 'ok' },
  imap_failed: { label: '下書き未作成（失敗）', tone: 'ng' },
}

export function GroupProgressSection({
  entrySummary,
  paymentSummary,
  aux,
  auxTone = 'meta',
  entryMethod,
  entryDeadline,
  internalDeadline,
  paymentDeadline,
  paymentDeadlineKind,
  paymentMethod,
  paymentInfo,
  totalJpy,
  breakdownLabel,
  unknownGradeNote,
  entryFormGroupId,
  entryFormLatestDraft = null,
  paymentReports = [],
  resendPaymentReportAction,
}: GroupProgressSectionProps) {
  const entryRows: FlatTableRow[] = []
  if (entryMethod != null) entryRows.push({ label: '申込方法', value: entryMethod })
  entryRows.push({
    label: '大会申込締切',
    value: entryDeadline ? formatEventDate(entryDeadline) : '未定',
    variant: 'date',
  })
  entryRows.push({
    label: '会内締切',
    value: internalDeadline ? formatEventDate(internalDeadline) : '未定',
    variant: 'date',
  })

  const paymentRows: FlatTableRow[] = []
  if (totalJpy != null && totalJpy > 0) {
    const lines = [`${totalJpy.toLocaleString('ja-JP')}円`]
    if (breakdownLabel) lines.push(breakdownLabel)
    if (unknownGradeNote) lines.push(unknownGradeNote)
    paymentRows.push({ label: '振込総額', value: lines.join('\n'), variant: 'prewrap' })
  }
  if (paymentDeadline != null) {
    paymentRows.push({
      label: '支払締切',
      value: formatEventDate(paymentDeadline),
      variant: 'date',
    })
  } else if (paymentDeadlineKind === 'later_notice') {
    // 日付が無くても「後日連絡」であることは分かるようにする（日ページと同一規則）。
    paymentRows.push({ label: '支払締切', value: '後日連絡' })
  }
  if (paymentMethod != null) paymentRows.push({ label: '支払方法', value: paymentMethod })
  if (paymentInfo != null) {
    paymentRows.push({ label: '振込先', value: paymentInfo, variant: 'prewrap' })
  }

  const entryFormSummary = ENTRY_FORM_SUMMARY[entryFormLatestDraft?.status ?? 'none']

  return (
    <DisclosureSection
      title="進行管理"
      aux={aux}
      auxTone={auxTone}
      nested
      className="pt-[34px]"
    >
      <DisclosureRow
        label="申込状態"
        value={entrySummary.label}
        valueTone={entrySummary.tone}
      >
        <FlatTable rows={entryRows} />
        <p className="mt-[3px] text-xs text-neutral-fg">
          日ごとの申込は上の「日程」で選んで切り替える。
        </p>
      </DisclosureRow>

      {entryFormGroupId != null && (
        <DisclosureRow
          label="申込書"
          value={entryFormSummary.label}
          valueTone={entryFormSummary.tone}
          aux={
            entryFormLatestDraft
              ? formatDateTimeShort(entryFormLatestDraft.createdAt)
              : undefined
          }
        >
          {entryFormLatestDraft && (
            <FlatTable
              rows={[
                {
                  label: '最終作成',
                  value: `${formatDateTimeShort(entryFormLatestDraft.createdAt)}・${
                    entryFormLatestDraft.createdByName ?? '不明'
                  }`,
                },
                {
                  label: 'ファイル',
                  value: (
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 break-all">
                        {entryFormLatestDraft.attachmentFilename}
                      </span>
                      <a
                        href={`/api/admin/entry-form/drafts/${entryFormLatestDraft.id}`}
                        download
                        className="shrink-0 text-xs text-brand-fg underline"
                      >
                        DL
                      </a>
                    </span>
                  ),
                },
              ]}
            />
          )}
          <DisclosureActions>
            <Link
              href={`/admin/entry-form/${entryFormGroupId}`}
              className="text-[13px] text-brand-fg underline"
            >
              {entryFormLatestDraft ? '再作成' : '申込書を作成'}
            </Link>
          </DisclosureActions>
        </DisclosureRow>
      )}

      <DisclosureRow
        label="支払状態"
        value={paymentSummary.label}
        valueTone={paymentSummary.tone}
      >
        <FlatTable rows={paymentRows} />
        {resendPaymentReportAction && (
          <PaymentReportHistory
            rows={paymentReports}
            resendAction={resendPaymentReportAction}
          />
        )}
      </DisclosureRow>
    </DisclosureSection>
  )
}
