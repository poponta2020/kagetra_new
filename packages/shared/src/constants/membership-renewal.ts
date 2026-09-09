import type { FacultyKind, ReaderCertification, RenewalSnapshot } from '../types'
import { GRADUATE_SCHOOL_YEARS, UNDERGRADUATE_SCHOOL_YEARS } from './travel-report'

/**
 * 年度確認（annual-registration-renewal）の共有定数。
 *
 * 名簿の列・最終学年の判定材料・スナップショットのキー集合は web の純ロジックと
 * バッチの両方が使うのでここに置く。**検証（zod）は置かない** —— `packages/shared`
 * は zod に依存しない（`travel_routes.legs` と同じで、入力検証は Server Action
 * 境界＝`apps/web/src/lib/membership-renewal/snapshot.ts` の責務）。
 */

/** `RenewalSnapshot.v`。読み出し側はこの値だけを受け入れる。 */
export const RENEWAL_SNAPSHOT_VERSION = 1 as const

/**
 * 名簿の列（全日協「会員名簿（確認用）」の項目順・requirements R2/R3）。
 * スナップショットのキーであり、差分計算・S1 の行順・S2 の名簿の写しの順でもある。
 * ★並びを変えると画面の行順が変わる（design-spec §8 の忠実度チェック対象）。
 */
export const ROSTER_FIELDS = [
  'familyName',
  'givenName',
  'familyKana',
  'givenKana',
  'birthDate',
  'gender',
  'dan',
  'grade',
  'postalCode',
  'address1',
  'address2',
  'phone',
] as const

export type RosterField = (typeof ROSTER_FIELDS)[number]

/** 学年セクションのスナップショット項目（名簿の列ではないので差分の対象外）。 */
export const RENEWAL_SCHOOL_YEAR_FIELDS = ['facultyKind', 'faculty', 'schoolYear'] as const

export type RenewalSchoolYearField = (typeof RENEWAL_SCHOOL_YEAR_FIELDS)[number]

/** 名簿の列のラベル（S1 の行ラベル・S2 の差分の項目名）。 */
export const ROSTER_FIELD_LABELS: Record<RosterField, string> = {
  familyName: '姓',
  givenName: '名',
  familyKana: 'せい',
  givenKana: 'めい',
  birthDate: '生年月日',
  gender: '性別',
  dan: '段位',
  grade: '級',
  postalCode: '郵便番号',
  address1: '住所1',
  address2: '住所2',
  phone: '電話番号',
}

/** 全項目 `null` のスナップショット（キー欠落を作らないための土台）。 */
export const EMPTY_RENEWAL_SNAPSHOT: RenewalSnapshot = {
  v: RENEWAL_SNAPSHOT_VERSION,
  familyName: null,
  givenName: null,
  familyKana: null,
  givenKana: null,
  birthDate: null,
  gender: null,
  dan: null,
  grade: null,
  postalCode: null,
  address1: null,
  address2: null,
  phone: null,
  facultyKind: null,
  faculty: null,
  schoolYear: null,
}

/**
 * 6 年制の学部（最終学年＝6 年）。他の学部は 4 年が最終学年。
 * requirements R4 の「医・歯・薬・獣医」。★候補外の自由入力（`users.faculty` は
 * 自由入力）は前方一致ではなく**完全一致**で判定する（「医学部保健学科」のような
 * 4 年制の名称を 6 年制と誤判定しないため）。
 */
export const SIX_YEAR_FACULTIES: readonly string[] = [
  '医学部',
  '歯学部',
  '薬学部',
  '獣医学部',
]

/** 学部の最終学年（6 年制以外）。 */
export const UNDERGRADUATE_FINAL_YEAR = '4年'
/** 6 年制学部の最終学年。 */
export const SIX_YEAR_FINAL_YEAR = '6年'

/**
 * 大学院の課程ごとの最終学年（requirements R4）。修士 2 年／博士 3 年／専門職 3 年。
 * ★博士は 4 年も選択肢にあるが、最終学年の**既定判定**は 3 年（R4 の明文）。
 */
export const GRADUATE_FINAL_YEARS: readonly string[] = ['修士2年', '博士3年', '専門職3年']

/** 進学（大学院へ）で選べる学年。 */
export const ADVANCE_TO_GRADUATE_YEARS: readonly string[] = ['修士1年', '博士1年', '専門職1年']

/** 区分ごとの学年選択肢（`schoolYearOptions` の再輸出。並びが +1 の根拠）。 */
export const RENEWAL_SCHOOL_YEAR_OPTIONS: Record<FacultyKind, readonly string[]> = {
  undergraduate: UNDERGRADUATE_SCHOOL_YEARS,
  graduate: GRADUATE_SCHOOL_YEARS,
}

/** 公認資格・読手のラベル（S1 の読み取り専用行・S2 の名簿の写し・S5 の 3 択）。 */
export const READER_CERTIFICATION_LABELS: Record<ReaderCertification, string> = {
  B: 'B級公認',
  A: 'A級公認',
}

/** 読手なしのラベル（列の値が NULL のとき）。 */
export const READER_CERTIFICATION_NONE_LABEL = 'なし'

/**
 * リマインド 1 通あたりのメンション上限（requirements R7・AC-16b）。
 * OAM の実上限は PoC（AC-31）で実測して更新する。超えた分は 10 分ずらした
 * 別タスクへ分割する。
 */
export const RENEWAL_MENTION_LIMIT_PER_MESSAGE = 20

/** リマインドの間隔（開始日 +3n 日）。 */
export const RENEWAL_REMINDER_INTERVAL_DAYS = 3

/** 予約送信の時刻の刻み（分）。OAM の予約は 10 分単位。 */
export const LINE_CHAT_SLOT_MINUTES = 10

/**
 * 予約の締切マージン（分）。送信予定の何分前を過ぎたらワーカーへ渡さない／
 * 未予約のまま期限切れ（`PENDING_EXPIRED`）にするか。
 * ★match-tracker の 30 分ではなく 5 分（19:30 バッチ→20:00 送信の設計が成立しない）。
 */
export const LINE_CHAT_RESERVE_MARGIN_MINUTES = 5

/** 案内タスクの送信予定＝作成時刻 + この分数を 10 分境界へ切り上げ。 */
export const RENEWAL_ANNOUNCEMENT_LEAD_MINUTES = 15

/** リマインドの送信時刻（JST の時・分）。 */
export const RENEWAL_REMINDER_SEND_HOUR = 20
export const RENEWAL_REMINDER_SEND_MINUTE = 0

/** `RESERVING` のまま滞留したタスクを要確認へ倒すまでの分数。 */
export const LINE_CHAT_RESERVING_STALE_MINUTES = 30

/** 管理者の一言（案内文に添える自由文）の上限文字数（requirements R2）。 */
export const RENEWAL_NOTE_MAX_LENGTH = 200
