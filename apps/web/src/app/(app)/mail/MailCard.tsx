import Link from 'next/link'
import type { ReactNode } from 'react'
import { Pill } from '@/components/ui'
import { pickAttachmentIcon } from '@/app/(app)/admin/mail-inbox/components/AttachmentList'
import { formatHistorySummaryDate, formatMailListDateTime } from '@/lib/member-mail/format'
import type { MailSearchRow } from '@/lib/member-mail/search'
import type { HistoryRow } from '@/lib/mail-history'

/**
 * member-mail-search タスク4: 一覧カード（requirements.md §3.5b・design-spec.md §3/§8）。
 *
 * カード全体が `/mail/[id]` へのリンクだが、添付チップは個別リンクを持つため
 * `<a>` の入れ子は作れない（AC 相当・design-spec §7）。overlay Link（`absolute
 * inset-0 z-0`）をカード直下に敷き、チップだけ `relative z-10` にして CSS の
 * ペイント順（positioned 要素は z-index 順に非 positioned コンテンツより手前に
 * 描画される）でチップをオーバーレイより手前に出す。他の静的コンテンツ（日時・
 * ピル・件名・抜粋・履歴サマリ）は非 positioned のままでよく、pointer-events の
 * 調整は不要（overlay が positioned 層で最後に描画されるため自然に手前へ回る）。
 *
 * ただし `relative` だけではカードは `z-index: auto` のままでスタッキングコンテキストを
 * 作らないため、チップの `z-10` はカードの外へ抜ける。すると `/mail` の sticky 検索バー
 * （`sticky top-0 z-10`）と z-10 同士のタイになり、DOM 順で後ろのチップがヘッダーの手前に
 * 描画されてスクロール時に重なった（Issue #528）。ルートの `isolate`（`isolation: isolate`）
 * でカード内へ閉じ込める — 内部の overlay(`z-0`) < チップ(`z-10`) は保ったまま、カード全体は
 * 検索バーより後ろへ回る。検索バー側の z を上げる対症療法は採らない（`players/page.tsx` /
 * `components/stats/section-tabs.tsx` の「検索バー=z-10 / タブ=z-20」慣習に合わせる）。
 */

const MAIL_KIND_LABEL: Record<string, string> = {
  tournament_notice: '大会案内',
  applicant_roster: '申込名簿',
  confirmed_roster: '確定名簿',
}

export interface MailCardProps {
  row: MailSearchRow
  /** 処理履歴の最新1行。未処理などで履歴が無ければ null（design-spec §3: 一覧は最新1行のみ）。 */
  historySummary: HistoryRow | null
  /** ハイライト対象の検索語（キーワード未入力なら空配列）。 */
  terms: string[]
  /** 添付ビューアの `?from=` に載せる現在画面のパス。 */
  from: string
}

/**
 * `text` 中の `terms`（大文字小文字を区別しない）を `<mark>` で囲んだ ReactNode を返す
 * 純関数（単体テスト対象）。`dangerouslySetInnerHTML` は使わない。正規表現メタ文字を
 * 含む語（`%` `(` `.` 等）でも壊れないようエスケープする。terms が空なら text をそのまま返す。
 */
export function highlightTerms(text: string, terms: string[]): ReactNode {
  const cleaned = terms.map((t) => t.trim()).filter((t) => t.length > 0)
  if (cleaned.length === 0) return text

  const escaped = cleaned.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  // 1 つのキャプチャグループを含む正規表現で split すると、マッチした部分文字列が
  // 奇数インデックスに挟まって返る（String.prototype.split の仕様）。
  const parts = text.split(pattern)

  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-xs bg-brand-bg px-px text-brand-fg">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

export function MailCard({ row, historySummary, terms, from }: MailCardProps) {
  const kindLabel = row.mailKind ? MAIL_KIND_LABEL[row.mailKind] : undefined
  const fromQuery = `?from=${encodeURIComponent(from)}`
  const subject = row.subject || '(件名なし)'

  return (
    <div className="relative isolate flex flex-col gap-[5px] rounded-lg border border-border-soft bg-surface px-3 py-[11px] shadow-sm">
      <Link
        href={`/mail/${row.id}`}
        aria-label={subject}
        className="absolute inset-0 z-0 rounded-lg"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-[10px] text-ink-meta">
          {formatMailListDateTime(row.receivedAt)}
        </span>
        <span className="flex shrink-0 gap-1">
          {kindLabel ? (
            <Pill tone="brand" size="sm">
              {kindLabel}
            </Pill>
          ) : null}
          {row.triageStatus === 'processed' ? (
            <Pill tone="success" size="sm">
              処理済み
            </Pill>
          ) : (
            <Pill tone="warn" size="sm">
              未処理
            </Pill>
          )}
        </span>
      </div>

      <div className="line-clamp-2 text-[13px] font-semibold leading-tight text-ink">
        {row.subjectMatched ? highlightTerms(subject, terms) : subject}
      </div>

      {row.excerpt ? (
        <div className="line-clamp-2 border-l-2 border-border pl-[7px] text-[10px] leading-[1.55] text-ink-2">
          <span className="text-ink-meta">
            {row.excerpt.source === 'body'
              ? '本文 ／'
              : `添付 ${row.excerpt.attachmentFilename} ／`}
          </span>
          {row.excerpt.text ? ` ${row.excerpt.text}` : null}
        </div>
      ) : null}

      {row.attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.attachments.map((a) => (
            <Link
              key={a.id}
              href={`/mail/attachments/${a.id}${fromQuery}`}
              className="relative z-10 inline-flex min-w-0"
            >
              <Pill tone="info" size="sm" className="min-w-0">
                <span className="mr-1">{pickAttachmentIcon(a.contentType, a.filename)}</span>
                <span className="min-w-0 truncate">{a.filename}</span>
              </Pill>
            </Link>
          ))}
        </div>
      ) : null}

      {historySummary ? (
        <div className="flex items-baseline gap-[5px] pt-0.5 text-[10px] text-ink-meta">
          <span className="shrink-0 text-ink-muted">↳</span>
          <span>
            {historySummary.at ? `${formatHistorySummaryDate(historySummary.at)} ` : null}
            {historySummary.summarySegments.map((seg, i) =>
              seg.type === 'text' ? (
                <span key={i}>{seg.value}</span>
              ) : (
                <span key={i} className="font-medium text-brand-fg">
                  {seg.label}
                </span>
              ),
            )}
          </span>
        </div>
      ) : null}
    </div>
  )
}
