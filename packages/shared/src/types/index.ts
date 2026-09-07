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
