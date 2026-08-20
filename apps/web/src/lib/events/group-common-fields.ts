import type { EventStatus } from '@kagetra/shared/types'
import type { PaymentDeadlineKind } from './payment-deadline'

/**
 * 申込グループの共通値（締切4種・支払方法・振込先・申込方法）を対象日から集約する
 * 純関数。要件 §3.2.4「共通値の決め方」:
 *
 * - 対象日で値が一致していればその値を出す
 * - 食い違う場合は最も早い日付（日付以外の項目は代表イベントの値）を出し、
 *   `varies: true` を立てる（食い違いは §3.2.6 の共通項目編集で解消する運用なので、
 *   この表示はその検知手段——食い違ったまま運用することも許容する）
 *
 * `@/lib/entry-groups` の `selectRepresentativeEvent` は import しない。あちらは
 * `@kagetra/shared/schema` / `drizzle-orm` を値 import する DB 層で、ここから import
 * すると純関数のはずのこのモジュールに DB 依存が漏れる（entry-board-utils.ts の
 * 同種の注記を参照）。代わりに同じ規則を {@link pickRepresentative} として複製する。
 * ★この重複は意図的。
 */

/** 集約に必要な1日ぶんの入力。`pickRepresentative` の要求を満たすため id/eventDate を持つ。 */
export interface GroupCommonFieldsDay {
  id: number
  /** `YYYY-MM-DD` */
  eventDate: string
  status: EventStatus
  entryDeadline: string | null
  internalDeadline: string | null
  lotteryDate: string | null
  paymentDeadline: string | null
  paymentDeadlineKind: PaymentDeadlineKind
  paymentMethod: string | null
  paymentInfo: string | null
  entryMethod: string | null
}

/** 集約結果1項目。`varies` = グループ内で値が食い違っている。 */
export interface GroupCommonValue<T> {
  value: T
  varies: boolean
}

export interface GroupCommonFields {
  entryDeadline: GroupCommonValue<string | null>
  internalDeadline: GroupCommonValue<string | null>
  lotteryDate: GroupCommonValue<string | null>
  paymentDeadline: GroupCommonValue<string | null>
  paymentDeadlineKind: GroupCommonValue<PaymentDeadlineKind>
  paymentMethod: GroupCommonValue<string | null>
  paymentInfo: GroupCommonValue<string | null>
  entryMethod: GroupCommonValue<string | null>
}

/**
 * `selectRepresentativeEvent`（`@/lib/entry-groups`）と同じ規則の複製版。
 * 今日以降で最も近い日、無ければ全体で最も遅い日。同着は id 昇順。
 */
function pickRepresentative<T extends { id: number; eventDate: string }>(
  days: readonly T[],
  todayStr: string,
): T {
  const future = days.filter((d) => d.eventDate >= todayStr)
  const pool = future.length > 0 ? future : days
  const pickMin = future.length > 0

  return pool.reduce((best, d) => {
    if (pickMin) {
      if (d.eventDate < best.eventDate) return d
      if (d.eventDate === best.eventDate && d.id < best.id) return d
      return best
    }
    if (d.eventDate > best.eventDate) return d
    if (d.eventDate === best.eventDate && d.id < best.id) return d
    return best
  })
}

/** 母集団の日付4項目のうち1つを集約する。全 null もすべて同値として扱う。 */
function aggregateDate(
  days: readonly GroupCommonFieldsDay[],
  pick: (d: GroupCommonFieldsDay) => string | null,
): GroupCommonValue<string | null> {
  const values = days.map(pick)
  const first = values[0] ?? null
  if (values.every((v) => v === first)) return { value: first, varies: false }

  // 食い違う場合は非 null のうち最小（YYYY-MM-DD は辞書順＝時系列順）。
  // 「すべて同値」ではじかれるので、ここに来る時点で非 null が1件以上ある。
  const nonNull = values.filter((v): v is string => v != null)
  const min = nonNull.reduce((m, v) => (v < m ? v : m))
  return { value: min, varies: true }
}

/** 母集団の日付以外の項目1つを集約する。食い違えば代表イベントの値を出す。 */
function aggregateRepresentative<T>(
  days: readonly GroupCommonFieldsDay[],
  representative: GroupCommonFieldsDay,
  pick: (d: GroupCommonFieldsDay) => T,
): GroupCommonValue<T> {
  const values = days.map(pick)
  const first = values[0] as T
  if (values.every((v) => v === first)) return { value: first, varies: false }
  return { value: pick(representative), varies: true }
}

export function aggregateGroupCommonFields(
  days: readonly GroupCommonFieldsDay[],
  todayStr: string,
): GroupCommonFields | null {
  if (days.length === 0) return null

  // 母集団 = cancelled を除いた対象日。ただし全日 cancelled のグループでも
  // 共通項目セクションは描画する必要がある（要件のエラーケース節・design-mock
  // edge-cases.html ⑦）ため、その場合だけ全日へフォールバックする。
  // フロー帯（group-entry-flow.ts）の「対象日が空なら描かない」規則とは
  // 意図的に異なる——共通項目は締切等の属性なので、判定不能でも値そのものは出す。
  const activeDays = days.filter((d) => d.status !== 'cancelled')
  const population = activeDays.length > 0 ? activeDays : days

  const representative = pickRepresentative(population, todayStr)

  return {
    entryDeadline: aggregateDate(population, (d) => d.entryDeadline),
    internalDeadline: aggregateDate(population, (d) => d.internalDeadline),
    lotteryDate: aggregateDate(population, (d) => d.lotteryDate),
    paymentDeadline: aggregateDate(population, (d) => d.paymentDeadline),
    paymentDeadlineKind: aggregateRepresentative(population, representative, (d) => d.paymentDeadlineKind),
    paymentMethod: aggregateRepresentative(population, representative, (d) => d.paymentMethod),
    paymentInfo: aggregateRepresentative(population, representative, (d) => d.paymentInfo),
    entryMethod: aggregateRepresentative(population, representative, (d) => d.entryMethod),
  }
}
