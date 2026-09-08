import { HOME_REGION } from '@kagetra/mail-worker/classify/regional'
import type { RegionalEligibilityPlan } from '../regional-eligibility-utils'

/**
 * mail-ai-extract-refinements §3.2.12(d) / AC-70〜75: 単位カードの「このイベント
 * を登録する」と `<fieldset>` の間に置く、D・E 級の地域制限判定の可視化。
 * `fieldset` の**外**に置くので、未チェック（登録しない）でも読める。
 *
 * `regional_eligibility` を持たない旧ドラフト・登録済み単位では
 * `planRegionalEligibility` の結果が空になり、このコンポーネントは `null` を
 * 返す（呼び出し側の分岐は無し — 常に描いてよい）。
 *
 * 「北海道」はどこにもリテラルで書かず `HOME_REGION` から組む（他かるた会へ
 * 配布するときの差し替え箇所を 1 つに保つ — `classify/regional.ts` 冒頭コメント
 * と同じ方針）。
 */
const WARN_BLOCK = 'rounded-md border border-warn-fg/30 bg-warn-bg px-3 py-2'
const WARN_HEADING = 'font-semibold text-warn-fg'
const QUOTE = 'mt-1 whitespace-pre-wrap break-words text-ink-2'
const SUB = 'mt-1 text-xs text-ink-meta'
const SOFT_BLOCK = 'rounded-md border border-border-soft bg-surface-alt px-3 py-2'

function gradeListLabel(grades: readonly string[]): string {
  return grades.map((g) => `${g}級`).join('・')
}

export function RegionalEligibilityNotice({
  plan,
}: {
  plan: RegionalEligibilityPlan
}) {
  const { notices, allRemoved } = plan
  if (notices.length === 0 && !allRemoved) return null

  const removed = notices.filter((n) => n.kind === 'removed')
  const unverified = notices.filter((n) => n.kind === 'unverified')
  const review = notices.filter((n) => n.kind === 'review')
  const eligible = notices.filter((n) => n.kind === 'eligible')

  return (
    <div className="flex flex-col gap-2">
      {removed.length > 0 && (
        <div className={WARN_BLOCK}>
          {allRemoved && (
            <p className={WARN_HEADING}>{`この日の全ての級が${HOME_REGION}の選手は出場できないため、登録対象から外しました。他に登録する日が無ければ却下してください`}</p>
          )}
          <p className={WARN_HEADING}>{`${gradeListLabel(removed.map((n) => n.grade))}を対象級から外しました（${HOME_REGION}の選手は出場できないため）`}</p>
          {removed.map((n) => (
            <blockquote key={n.grade} className={QUOTE}>
              {n.quote}
            </blockquote>
          ))}
          <p className={SUB}>戻すには下の対象級を再チェックしてください</p>
        </div>
      )}

      {unverified.map((n) => (
        <div key={n.grade} className={WARN_BLOCK}>
          <p className={WARN_HEADING}>{`${n.grade}級は${HOME_REGION}は対象外と判定されましたが、根拠の一文を原文と照合できませんでした。確認してください`}</p>
          <blockquote className={QUOTE}>{n.quote}</blockquote>
        </div>
      ))}

      {review.map((n) => (
        <div key={n.grade} className={WARN_BLOCK}>
          <p className={WARN_HEADING}>{`${n.grade}級の出場資格を確認してください`}</p>
          <p className={QUOTE}>{n.quote ?? '資格の記載が見当たりません'}</p>
        </div>
      ))}

      {eligible.map((n) => (
        <div key={n.grade} className={SOFT_BLOCK}>
          <p className="font-semibold text-ink">{`${n.grade}級は地域制限ありですが${HOME_REGION}は対象です`}</p>
          <p className={QUOTE}>{n.quote}</p>
        </div>
      ))}
    </div>
  )
}
