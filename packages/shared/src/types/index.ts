// Shared type definitions
export type UserRole = 'admin' | 'vice_admin' | 'member' | 'guest'
export type EventStatus = 'published' | 'cancelled' | 'done'
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
export type Gender = 'male' | 'female'
export type EventKind = 'individual' | 'team'

// ── travel-report（遠征届）────────────────────────────────────────────────
/** 学部／大学院の区分（`users.faculty_kind`）。 */
export type FacultyKind = 'undergraduate' | 'graduate'
/** 行き／帰りの種別（`travel_routes.departure_kind` / `return_kind`）。 */
export type TravelWayKind = 'sapporo' | 'hometown' | 'other'
/** 確定状況の手入力値（`entry_group_selection_statuses.status`）。 */
export type TravelSelectionStatus = 'confirmed' | 'waitlisted' | 'not_participating'
/** 開催地（経路表記名）の出所（`entry_group_travel_settings.destination_source`）。 */
export type TravelDestinationSource = 'ai' | 'manual'

/**
 * 経路の移動行 1 行（`travel_routes.legs` の要素）。順序は配列の順を保持する。
 * `date` は `YYYY-MM-DD`。大会出場の行はここに保存せず出欠から導出する（R6）。
 */
export type TravelLeg = {
  date: string
  from: string
  to: string
}

// ── annual-registration-renewal（年度確認）──────────────────────────────
/** 公認資格・読手（`users.reader_certification`）。NULL＝なし。 */
export type ReaderCertification = 'B' | 'A'
/** 年度確認の状態（`membership_renewals.status`）。 */
export type MembershipRenewalStatus = 'open' | 'completed'
/** 全日協セクションの回答（`membership_renewal_members.answer`）。 */
export type RenewalAnswer = 'register' | 'not_register'
/**
 * 学年セクションの回答種別（`membership_renewal_members.school_year_kind`）。
 * advance=進級／進学 / custom=学年を自分で選ぶ（留年・転学部など） /
 * leave=卒業・サークルを離れる。★いずれの場合も反映する学年は
 * `next_school_year` に**絶対値**で持つ（4/1 の反映時に再計算しない）。
 */
export type RenewalSchoolYearKind = 'advance' | 'custom' | 'leave'
/** 会員区分（生年月日から導出。保存しない）。 */
export type MembershipKind = 'regular' | 'associate' | 'unknown'
/** 送信タスクの種別（`line_chat_tasks.kind`）。 */
export type LineChatTaskKind = 'announcement' | 'reminder'
/**
 * 送信タスクの状態（`line_chat_tasks.status`）。値は match-tracker
 * `line-chat-worker` の `WorkerTask` 契約に合わせた大文字（要件 §6）。
 */
export type LineChatTaskStatus =
  | 'PENDING'
  | 'RESERVING'
  | 'RESERVED'
  | 'FAILED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'DRY_RUN_SUCCEEDED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'

/**
 * 年度確認の開始時スナップショット（`membership_renewal_members.snapshot`）。
 *
 * 差分表示（前→後）の基準。**キーは固定**で、値が無い項目も `null` を明示的に
 * 持つ（キー欠落と NULL を区別しない＝差分計算で `undefined` を踏まない）。
 * `v` はスキーマ版で、読み出し側（`apps/web/src/lib/membership-renewal/snapshot.ts`
 * の zod）が検証する。住所・電話・生年月日を含む PII なので `users` と同じ扱い。
 */
export type RenewalSnapshot = {
  v: 1
  /** 名簿の列（`ROSTER_FIELDS` と同じキー集合）。 */
  familyName: string | null
  givenName: string | null
  familyKana: string | null
  givenKana: string | null
  birthDate: string | null
  gender: Gender | null
  dan: number | null
  grade: Grade | null
  postalCode: string | null
  address1: string | null
  address2: string | null
  phone: string | null
  /** 学年セクションの基準値。 */
  facultyKind: FacultyKind | null
  faculty: string | null
  schoolYear: string | null
}

/**
 * リマインドのメンション対象 1 件（`line_chat_tasks.mentions` の要素）。
 * `displayName`＝LINE の表示名（OAM の `@` 候補の照合キー）、
 * `placeholder`＝本文中に既に入っている氏名文字列（ワーカーがこれを
 * メンションへ置き換える。置換できなければテキストのまま＝フォールバック）。
 * ★氏名以外の PII を載せない。
 */
export type RenewalMentionTarget = {
  displayName: string
  placeholder: string
}
