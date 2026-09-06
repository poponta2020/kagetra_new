import type { FacultyKind, TravelWayKind } from '../types'

/**
 * 遠征届（travel-report）の共有定数。
 *
 * 学部等名の候補・学年の選択肢は requirements R1 の列挙が正典。**enum にせず定数に
 * している**のは、届にこの文字列をそのまま出力する仕様で、課程の新設・改組を
 * migration 無しで追える形にしたいため（値の検証はここを参照して行う）。
 */

/** 学部の候補（requirements R1）。候補外の文字列も保存できる（自由入力）。 */
export const UNDERGRADUATE_FACULTIES = [
  '総合教育部',
  '文学部',
  '教育学部',
  '法学部',
  '経済学部',
  '理学部',
  '医学部',
  '歯学部',
  '薬学部',
  '工学部',
  '農学部',
  '獣医学部',
  '水産学部',
] as const

/** 大学院の候補（requirements R1）。候補外の文字列も保存できる（自由入力）。 */
export const GRADUATE_SCHOOLS = [
  '文学院',
  '教育学院',
  '法学研究科',
  '情報科学院',
  '水産科学院',
  '環境科学院',
  '理学院',
  '農学院',
  '生命科学院',
  '国際広報メディア',
  '観光学院',
  '保健科学院',
  '工学院',
  '総合化学院',
  '経済学院',
  '医学院',
  '歯学院',
  '獣医学院',
  '医理工学院',
  '国際感染症学院',
  '国際食資源学院',
  '公共政策学教育部',
] as const

/** 区分に応じた学部等名の候補を返す。 */
export function facultyOptions(kind: FacultyKind): readonly string[] {
  return kind === 'undergraduate' ? UNDERGRADUATE_FACULTIES : GRADUATE_SCHOOLS
}

/** 学部の学年（requirements R1）。 */
export const UNDERGRADUATE_SCHOOL_YEARS = ['1年', '2年', '3年', '4年', '5年', '6年'] as const

/** 大学院の学年（requirements R1）。修士 → 博士 → 専門職 の順で提示する。 */
export const GRADUATE_SCHOOL_YEARS = [
  '修士1年',
  '修士2年',
  '博士1年',
  '博士2年',
  '博士3年',
  '博士4年',
  '専門職1年',
  '専門職2年',
  '専門職3年',
] as const

/** 区分に応じた学年の選択肢を返す。学年は選択のみ（自由入力を許さない）。 */
export function schoolYearOptions(kind: FacultyKind): readonly string[] {
  return kind === 'undergraduate' ? UNDERGRADUATE_SCHOOL_YEARS : GRADUATE_SCHOOL_YEARS
}

/** 保存を許す学年の全集合（区分をまたいだ検証用）。 */
export const ALL_SCHOOL_YEARS: readonly string[] = [
  ...UNDERGRADUATE_SCHOOL_YEARS,
  ...GRADUATE_SCHOOL_YEARS,
]

/**
 * 遠征届の名簿表の並び順（requirements R10）。**学年の高い順**＝この配列の順。
 * 博士4年 → … → 博士1年 → 修士2年 → 修士1年 → 専門職3年 → … → 専門職1年 → 6年 → … → 1年。
 * 同学年はかな順（かなが無いゲストは末尾・氏名順）で並べる。
 */
export const SCHOOL_YEAR_ORDER: readonly string[] = [
  '博士4年',
  '博士3年',
  '博士2年',
  '博士1年',
  '修士2年',
  '修士1年',
  '専門職3年',
  '専門職2年',
  '専門職1年',
  '6年',
  '5年',
  '4年',
  '3年',
  '2年',
  '1年',
]

/**
 * 名簿の並び替えに使う学年の順位。未設定・候補外の学年は末尾へ送る
 * （`Number.MAX_SAFE_INTEGER` ではなく配列長を使い、同順内は次のキーで安定させる）。
 */
export function schoolYearRank(schoolYear: string | null | undefined): number {
  if (!schoolYear) return SCHOOL_YEAR_ORDER.length
  const i = SCHOOL_YEAR_ORDER.indexOf(schoolYear)
  return i === -1 ? SCHOOL_YEAR_ORDER.length : i
}

/** 学年が保存できる値か（区分を問わない）。 */
export function isValidSchoolYear(value: string): boolean {
  return ALL_SCHOOL_YEARS.includes(value)
}

/** 学年が区分と整合するか（学部に「修士1年」を入れさせない）。 */
export function isSchoolYearForKind(value: string, kind: FacultyKind): boolean {
  return schoolYearOptions(kind).includes(value)
}

/** 行きの種別ラベル（S8 のセグメント3択）。 */
export const DEPARTURE_KIND_LABELS: Record<TravelWayKind, string> = {
  sapporo: '札幌から',
  hometown: '帰省先から出場',
  other: 'その他',
}

/** 帰りの種別ラベル（S8 のセグメント3択）。 */
export const RETURN_KIND_LABELS: Record<TravelWayKind, string> = {
  sapporo: '札幌へ戻る',
  hometown: 'そのまま帰省',
  other: 'その他',
}

/** 遠征届の団体名（テンプレの既定値と同じ）。 */
export const TRAVEL_REPORT_ORGANIZATION_NAME = '北海道大学かるた会'

/** 既定の出発地。行き `札幌から` の既定行「札幌→{開催地}」に入る。 */
export const DEFAULT_DEPARTURE_PLACE = '札幌'

/** 大会出場行の表記（`travel_routes.legs` には保存せず出欠から導出する）。 */
export const ATTENDANCE_LABEL = '大会出場'
/** 行きが `帰省先から出場` のときだけ使う出場表記（R6）。 */
export const ATTENDANCE_LABEL_FROM_HOMETOWN = '大会出場（帰省先から出場）'

/** 遠征届設定（顧問教員）の `app_settings` キー。 */
export const TRAVEL_REPORT_SETTING_KEYS = {
  advisorDepartment: 'travel_report.advisor_department',
  advisorTitle: 'travel_report.advisor_title',
  advisorName: 'travel_report.advisor_name',
} as const
