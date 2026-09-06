import Link from 'next/link'
import { cn } from '@/lib/utils'
import { LinkActionLink } from './LinkAction'

/**
 * travel-report タスク7 (S7・AC-16): 日ページ「遠征届」セクションの CTA。
 *
 * **表示専用**（Server Action を持たない）。ページ側（`events/[id]/page.tsx`）が
 * 対象者判定・提出権限者判定を組み立て、この値だけを渡す。
 *
 * `cta` と `submitter` の両方が `null` のときはこのコンポーネント自身が `null` を
 * 返す（design-spec §8: 出すものが無い一般会員にはセクションが無い）。呼び出し側は
 * 「表示すべきか」を自分で判定して条件レンダリングする必要がなく、常に
 * `<TravelReportCta data={...} />` を置くだけでよい。
 */
export interface TravelReportCtaTargetState {
  /** 対象者としてこの単位の経路が保存済みか（R5「入力済み」）。 */
  entered: boolean
  /** `/events/{eventId}/travel-route`（単位の代表 eventId）。 */
  routeHref: string
  /** サブ行に出す単位の開催日ラベル（例 `10/10(土)・10/11(日)`）。 */
  unitDatesLabel: string
}

export interface TravelReportCtaSubmitterState {
  /** 原本 `.dotx` ダウンロード route。 */
  templateHref: string
  /** 申込グループページの遠征届セクションへの導線。 */
  groupHref: string
}

export interface TravelReportCtaData {
  /** 対象者でない・経路入力が開いていない・「不要」なら `null`。 */
  cta: TravelReportCtaTargetState | null
  /** 提出権限者でなければ `null`（RSC payload にも載せない責務はページ側にある）。 */
  submitter: TravelReportCtaSubmitterState | null
}

export function TravelReportCta({ data }: { data: TravelReportCtaData | null }) {
  if (data == null) return null
  const { cta, submitter } = data
  if (cta == null && submitter == null) return null

  return (
    <div className="pt-[22px]">
      <div className="mb-[13px] flex items-baseline justify-between gap-2 border-b border-border-strong pb-[7px]">
        <h2 className="font-display text-[18px] font-semibold text-ink">遠征届</h2>
      </div>

      {cta && (
        <Link
          href={cta.routeHref}
          className={cn(
            'flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-ink no-underline',
            cta.entered
              ? 'border-border bg-surface'
              : 'border-accent bg-accent-bg',
          )}
        >
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
              cta.entered
                ? 'bg-brand-bg text-brand-fg'
                : 'bg-accent text-ink-on-brand',
            )}
          >
            {cta.entered ? '入力済み' : '未入力'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {cta.entered ? '遠征経路を確認・修正する' : '遠征経路を入力する'}
            </span>
            <span
              className={cn(
                'mt-0.5 block text-xs',
                cta.entered ? 'text-ink-meta' : 'text-accent-fg',
              )}
            >
              {cta.entered
                ? cta.unitDatesLabel
                : `${cta.unitDatesLabel} の行程と連絡先`}
            </span>
          </span>
          <span
            aria-hidden
            className={cn(
              'shrink-0 text-[13px]',
              cta.entered ? 'text-ink-muted' : 'text-accent-fg',
            )}
          >
            ›
          </span>
        </Link>
      )}

      {submitter && (
        <div
          className={cn(
            'flex items-baseline justify-between gap-2 text-xs',
            cta ? 'mt-3' : 'mt-0',
          )}
        >
          <span className="text-ink-2">大学に出す様式（原本）</span>
          <a
            href={submitter.templateHref}
            download
            className="inline-flex shrink-0 items-baseline gap-1.5 text-xs text-brand"
          >
            遠征届原本.dotx
          </a>
        </div>
      )}

      {submitter && (
        <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs">
          <span className="text-ink-2">作成・入力状況</span>
          <LinkActionLink href={submitter.groupHref}>
            申込グループページの遠征届へ ›
          </LinkActionLink>
        </div>
      )}
    </div>
  )
}
