import { ALL_GRADES, type Grade } from '@/lib/stats/types'
import { GRADE_TONES } from '@/lib/stats/grade-tones'
import { cn } from '@/lib/utils'

/**
 * 級構成トーンドット（design-spec §3.4 / §4：藍→砂トーンランプ）。大会一覧の各行で、その大会に
 * ある級（A〜E）を小さな丸で示す。色は `GRADE_TONES`（虹色でない・級順が読める）。純粋な
 * 見た目コンポーネント（サーバー描画可）。
 */
export function GradeDots({ grades, className }: { grades: Grade[]; className?: string }) {
  // 正規順（A→E）で安定表示。
  const ordered = ALL_GRADES.filter((g) => grades.includes(g))
  if (ordered.length === 0) return null
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-label={`級構成 ${ordered.join('・')}`}>
      {ordered.map((g) => (
        <span
          key={g}
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: GRADE_TONES[g] }}
          title={`${g}級`}
        />
      ))}
    </span>
  )
}
