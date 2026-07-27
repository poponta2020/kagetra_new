import type { Grade } from '@kagetra/shared/types'

/**
 * ホーム（`/dashboard`）「会の出場予定」の表示 DTO。
 *
 * サーバー（page.tsx）が既存テーブルから組み立て、表示側（HomeTimeline.tsx）は
 * この形だけを見る。**新テーブル・新カラムは不要** —— 母集団と絞り込みは既存画面の
 * 規約をそのまま流用する:
 *
 * - 母集団: `/admin/entries` と同じ（`event_date >= 今日` ∧ `status <> 'cancelled'`
 *   ∧ `kind = 'individual'`）。出場者が 0 名の大会はホームに載せない
 * - 出場者「希望」: `event_attendances.attend = true`
 * - 出場者「確定」: `tournament_entry_rosters` の `roster_type = 'confirmed'` かつ
 *   `superseded_at IS NULL` の版に属する `tournament_entry_roster_entries`
 *   （名簿の帰属は event ではなく `entry_group_id`）
 * - 対象級外の stale 行除外: イベント詳細 AC-26 と同じ
 *   （`users.is_invited = true` ∧ `users.grade ∈ events.eligible_grades`）
 */

/** 出場者リストの確度。確定名簿があれば `confirmed`、無ければ出欠○の `hoped`。 */
export type EntrantConfidence = 'confirmed' | 'hoped'

export interface HomeEntrant {
  /**
   * 会員 id。自分ハイライトの判定に使う。
   * - `hoped`: `event_attendances.user_id`（常に非 null）
   * - `confirmed`: `tournament_entry_roster_entries.user_id`。会員として同定
   *   できていない名簿行は null。自会の名簿なので通常は非 null だが、
   *   同定漏れを黙って落とさないため nullable のまま持つ
   */
  userId: string | null
  /**
   * チップの表示文字列 = **姓のみ**（`@/lib/surname` の `surname()` 適用後）。
   * `/events` 一覧・イベント詳細の参加者チップと同じ規約。
   */
  surname: string
  /** 級。未設定なら null（チップの級注記を出さない）。 */
  grade: Grade | null
}

export interface HomeTimelineEvent {
  eventId: number
  /**
   * 表示名 = 通称 + 対象級（例「札幌CD」）。通称が引けない大会は `events.title`。
   * `entry-board-utils.displayName` と同じ規約なので、実装時はその純関数を使う。
   */
  displayName: string
  /** `YYYY-MM-DD`。 */
  eventDate: string
  /** `events.location`。**今日カードでのみ**描画する（タイムライン行には出さない）。 */
  venue: string | null
  confidence: EntrantConfidence
  /**
   * 出場者。`confidence === 'confirmed'` のときは**出場する人だけ**を含める
   * （補欠・落選はホームに出さない）。
   *
   * ★実装前に確定が必要（design-spec `## 要件への宿題`）:
   * `tournament_entry_roster_entries` には独立した 2 軸がある——
   * `status`（applied / confirmed / carried_up / carry_up_declined / cancelled）と
   * `selection_outcome`（accepted / waitlisted / rejected / unknown）。
   * どちらの軸で「出場する人」を定義するか（および繰上り辞退・キャンセルの扱い、
   * 実データで `selection_outcome` が埋まっているか）は要件側の決めごと。
   */
  entrants: HomeEntrant[]
}

/**
 * 未回答アラート 1 行分。
 *
 * 対象は「自分の級が `events.eligible_grades` に含まれる」大会のみ。
 * 基準締切 = `COALESCE(internal_deadline, entry_deadline)`（entry-overdue-alert
 * および `entry-board-utils.baseDeadlineOf` と同じ規約）で、その **7 日前**から
 * 締切当日まで表示する。自分が出欠回答済み（`event_attendances` に行がある）なら出さない。
 */
export interface HomeUnansweredAlert {
  eventId: number
  displayName: string
  /** 基準締切 `YYYY-MM-DD`。 */
  baseDeadline: string
  /** 今日から基準締切までの日数（0 = 本日締切）。負値は想定しない。 */
  daysLeft: number
}

export interface HomeTimelineData {
  /** JST の今日（`todayInJst()`）。クライアントで `Date.now()` を呼ばないため。 */
  todayStr: string
  /** ログイン中の会員 id。チップのハイライト判定にのみ使う。 */
  viewerUserId: string | null
  /** 今日開催で自会から出る大会（通常 0 件、大会当日のみ 1 件以上）。 */
  today: HomeTimelineEvent[]
  /** 明日以降。開催日昇順。 */
  upcoming: HomeTimelineEvent[]
  /** 未回答アラート。基準締切の早い順。 */
  alerts: HomeUnansweredAlert[]
}
