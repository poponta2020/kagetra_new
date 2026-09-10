import { addDays, diffDays } from '@/lib/jst-date'
import {
  LINE_CHAT_SLOT_MINUTES,
  RENEWAL_ANNOUNCEMENT_LEAD_MINUTES,
  RENEWAL_REMINDER_INTERVAL_DAYS,
  RENEWAL_REMINDER_SEND_HOUR,
  RENEWAL_REMINDER_SEND_MINUTE,
} from '@kagetra/shared'

/**
 * 送信タスクの日程・時刻計算（requirements R7・AC-15・AC-16b・AC-17）。
 *
 * JST はサマータイムが無く UTC+9（＝9 時間ぴったり＝540 分）固定なので、
 * 「分」の値は UTC と JST の壁時計で常に一致する（10 分境界の判定・10 分刻みの
 * ずらしは UTC のまま計算してよい）。日付をまたぐ時刻計算だけは JST の壁時計から
 * 明示的に 9 時間引いて UTC の絶対時刻を作る（`jstWallClockToUtc`）。
 * 日付の加減算・日数差分は既存の `@/lib/jst-date`（`addDays`/`diffDays`）を再利用し、
 * 同じ計算をここで再実装しない。
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` の JST 壁時計 `hour:minute` を UTC の絶対時刻（Date）へ変換する。 */
function jstWallClockToUtc(dateJst: string, hour: number, minute: number): Date {
  const m = DATE_RE.exec(dateJst)
  if (!m) return new Date(Number.NaN)
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  // JST = UTC+9 なので、時刻から 9 時間引けば UTC 絶対時刻になる（日付またぎは
  // Date.UTC が自動で繰り上げ/繰り下げる）。
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute))
}

/**
 * `at` を `slotMinutes`（既定 10 分）の境界へ切り上げる。既に境界上ならそのまま。
 * エポック（1970-01-01T00:00:00Z）は JST でも 10 分境界（JST オフセット 540 分は
 * 10 の倍数）なので、UTC のミリ秒だけで JST の 10 分境界判定ができる。
 */
export function ceilToSlot(at: Date, slotMinutes: number = LINE_CHAT_SLOT_MINUTES): Date {
  const slotMs = slotMinutes * 60_000
  const ms = at.getTime()
  const remainder = ((ms % slotMs) + slotMs) % slotMs
  if (remainder === 0) return new Date(ms)
  return new Date(ms + (slotMs - remainder))
}

/** 案内タスクの送信予定＝現在時刻 + `RENEWAL_ANNOUNCEMENT_LEAD_MINUTES` 分を 10 分境界へ切り上げ。 */
export function announcementSendAt(now: Date): Date {
  return ceilToSlot(new Date(now.getTime() + RENEWAL_ANNOUNCEMENT_LEAD_MINUTES * 60_000))
}

/**
 * リマインドタスクの送信予定＝ `targetDateJst` の 20:00 JST + 10 分 × `splitIndex`。
 * `splitIndex` は 0 始まり（分割していない 1 通目は 0）。
 */
export function reminderSendAt(targetDateJst: string, splitIndex: number): Date {
  const base = jstWallClockToUtc(
    targetDateJst,
    RENEWAL_REMINDER_SEND_HOUR,
    RENEWAL_REMINDER_SEND_MINUTE,
  )
  return new Date(base.getTime() + splitIndex * LINE_CHAT_SLOT_MINUTES * 60_000)
}

/**
 * リマインドの対象日集合（requirements R7）。
 * 開始日の `RENEWAL_REMINDER_INTERVAL_DAYS` 日後から同じ間隔で並ぶ日 ＋
 * 締切前日 ＋ 締切当日。重なる日は 1 件（Set で重複排除）、締切を過ぎる日は
 * 含めない。開始日そのものは対象日に含めない（締切前日が開始日の翌日に
 * なるケースで一致したら取り除く）。締切が開始日以前（0 日以下）なら空配列。
 * 昇順の `YYYY-MM-DD[]` を返す。
 */
export function reminderTargetDates(startedOnJst: string, deadlineJst: string): string[] {
  const totalDays = diffDays(startedOnJst, deadlineJst)
  if (!(totalDays > 0)) return []

  const dates = new Set<string>()
  for (let n = RENEWAL_REMINDER_INTERVAL_DAYS; n <= totalDays; n += RENEWAL_REMINDER_INTERVAL_DAYS) {
    dates.add(addDays(startedOnJst, n))
  }
  dates.add(addDays(deadlineJst, -1))
  dates.add(deadlineJst)
  dates.delete(startedOnJst)
  return [...dates].sort()
}

/** `dates`（`reminderTargetDates` の戻り値等）のうち `todayJst` 以降で最も早い日。無ければ `null`。 */
export function nextReminderDate(dates: readonly string[], todayJst: string): string | null {
  const sorted = [...dates].sort()
  return sorted.find((date) => date >= todayJst) ?? null
}

/**
 * `candidate` が `taken`（同じ年度確認の未取消タスクの送信予定）と同時刻なら、
 * 空くまで 10 分ずつ後ろへずらす。
 */
export function avoidSlotCollision(candidate: Date, taken: readonly Date[]): Date {
  const takenMs = new Set(taken.map((d) => d.getTime()))
  let result = candidate
  while (takenMs.has(result.getTime())) {
    result = new Date(result.getTime() + LINE_CHAT_SLOT_MINUTES * 60_000)
  }
  return result
}

/**
 * `targets` を `limit` 件ごとに分割する（R7・AC-16b）。空配列は `[]`。
 * `limit` が 0 以下（設定ミス）のときは分割せず 1 チャンクへフォールバックする
 * （無限ループを避けるための防御）。
 */
export function splitTargets<T>(targets: readonly T[], limit: number): T[][] {
  if (targets.length === 0) return []
  if (limit <= 0) return [[...targets]]
  const chunks: T[][] = []
  for (let i = 0; i < targets.length; i += limit) {
    chunks.push(targets.slice(i, i + limit))
  }
  return chunks
}
