/**
 * D・E 級の地域制限判定（mail-ai-extract-refinements §3.2.12）で、プロンプトと
 * Web の UI 文言が共有する定数。**依存ゼロの leaf** であること —— `'use client'`
 * の承認フォームから `@kagetra/mail-worker/classify/regional` として直接 import
 * される（`classify/title` と同じ経路）ので、ここに zod / drizzle / node: を
 * 持ち込むとクライアントバンドルが壊れる。
 *
 * ホーム地域と判定対象級を **1 箇所** に置くのは、他かるた会へ配布するときに
 * 差し替える場所を 1 つにするため（requirements §6 利用技術上の制約）。4 値の
 * ラベルも `HOME_REGION` から合成し、「北海道」というリテラルがプロンプト・
 * スキーマ・UI に散らばらないようにしている。
 */
export const HOME_REGION = '北海道'

/**
 * 判定対象の級。C 級にも地域制限の実例はある（北九州）が、今回はユーザー判断で
 * D・E のみ（requirements §5）。ここを広げれば schema / prompt / UI が追随する。
 */
export const REGIONAL_ELIGIBILITY_GRADES = ['D', 'E'] as const
export type RegionalEligibilityGrade = (typeof REGIONAL_ELIGIBILITY_GRADES)[number]

/**
 * 4 値の判定（requirements §3.2.12(b)）。順序は UI の表示順・プロンプトの
 * 定義順と一致させている。
 *
 *   - 制限なし: 出場資格に地域の条件が無い
 *   - 北海道は対象: 地域の条件があり、ホーム地域が含まれる
 *   - 北海道は対象外: 地域の条件があり、ホーム地域が含まれない
 *   - 要確認: 条件付き・緩和条項あり・地域を特定できない・資格の記載が見当たらない
 */
export const VERDICT_UNRESTRICTED = '制限なし'
export const VERDICT_HOME_ELIGIBLE = `${HOME_REGION}は対象`
export const VERDICT_HOME_INELIGIBLE = `${HOME_REGION}は対象外`
export const VERDICT_NEEDS_REVIEW = '要確認'

export const REGIONAL_VERDICTS = [
  VERDICT_UNRESTRICTED,
  VERDICT_HOME_ELIGIBLE,
  VERDICT_HOME_INELIGIBLE,
  VERDICT_NEEDS_REVIEW,
] as const
export type RegionalVerdict = (typeof REGIONAL_VERDICTS)[number]
