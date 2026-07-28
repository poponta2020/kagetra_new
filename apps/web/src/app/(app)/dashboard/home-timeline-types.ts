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
   * - `hoped`: `event_attendances.user_id`
   * - `confirmed`: `tournament_entry_roster_entries.user_id`
   *
   * **サーバー側の組み立てでは常に非 null**（希望パスは出欠の `user_id`、確定パスは
   * `users` への innerJoin ＝「自会員として同定できた行」だけを出場者にする）。
   * 型が nullable なのは表示側の防御 —— チップの自分ハイライトは
   * `viewerUserId != null && entrant.userId === viewerUserId` で判定するので、
   * 将来 DTO の作り方が変わって null が混ざっても他人を自分と誤認しない。
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
   * 「出場する人」の定義（design-spec §6 で確定）:
   * `status IN ('confirmed', 'carried_up')` ∧
   * `selection_outcome NOT IN ('waitlisted', 'rejected')` ∧ `user_id IS NOT NULL`。
   * `status` を主軸に置くのは、確定名簿の行には `roster-import/materialize.ts` の
   * `mapEntryStatus` が必ず `status` を埋める一方、`selection_outcome` は `unknown` の
   * まま残ることがあるため。`selection_outcome` は明示的な補欠/落選の除外にだけ使う。
   * 繰上り辞退（`carry_up_declined`）・取消（`cancelled`）は出場しないので落ちる。
   *
   * **現在の `users.grade` では絞らない**（確定パスの絞りは上の 3 条件だけ）——
   * 名簿がその大会の出場者の唯一の権威で、現在の級で絞ると昇級者が名簿から消える。
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
