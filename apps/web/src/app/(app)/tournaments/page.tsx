import { SectionTabs } from '@/components/stats/section-tabs'
import { Card } from '@/components/ui'

/**
 * /tournaments — ② 大会結果（年別ビュー・閲覧）。senseki-stats PR-5 で実装予定。
 * PR-2（ナビ）では 4 セクションシェル配下のプレースホルダ scaffold。
 * `/tournaments/series`（大会別トグル）と `/tournaments/stats`（大会統計）は
 * 静的セグメントで、動的 `/tournaments/[id]`（大会詳細）より優先される。
 */
export default function TournamentsPage() {
  return (
    <div>
      <SectionTabs />
      <div className="flex flex-col gap-4 p-4">
        <h1 className="font-display text-xl font-bold text-ink">大会結果</h1>
        <Card>
          <p className="py-10 text-center text-sm text-ink-meta">
            大会結果一覧（年別／大会別）は準備中です（PR-5 で実装）。
          </p>
        </Card>
      </div>
    </div>
  )
}
