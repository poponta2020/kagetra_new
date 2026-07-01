import { SectionTabs } from '@/components/stats/section-tabs'
import { Card } from '@/components/ui'

/**
 * /players/ranking — ③ 選手ランキング（統計）。senseki-stats PR-3 で実装予定。
 * PR-2（ナビ）では 4 セクションシェル（SectionTabs）配下のプレースホルダ scaffold。
 * 静的セグメント `ranking` は動的 `/players/[id]` より優先されるため衝突しない。
 */
export default function PlayerRankingPage() {
  return (
    <div>
      <SectionTabs />
      <div className="flex flex-col gap-4 p-4">
        <h1 className="font-display text-xl font-bold text-ink">
          選手ランキング
        </h1>
        <Card>
          <p className="py-10 text-center text-sm text-ink-meta">
            選手ランキングは準備中です（PR-3 で実装）。
          </p>
        </Card>
      </div>
    </div>
  )
}
