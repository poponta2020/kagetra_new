#!/usr/bin/env tsx
/**
 * Daily lifecycle reminder sweep for event-lifecycle-notify.
 *
 * Runs at 00:00 JST (systemd timer) and pushes the 6 reminder notification
 * types to linked participant groups, once-ever per (event, type):
 *   - 申込締切    事前 (today+lead) / 当日 (today)   — 未申込のみ
 *   - 事前支払締切 事前 / 当日                        — payment_type='advance' かつ未払
 *   - 現地払い    事前 / 当日 (event_date 起点)       — payment_type='onsite'
 *
 * Preconditions (requirements §3.2.2): the event has a linked LINE group, is
 * not cancelled, and the relevant date column is non-NULL (enforced implicitly
 * by the equality — NULL never matches). The UNIQUE on
 * event_lifecycle_notifications makes a same-day re-run a no-op.
 *
 * Failed pushes are best-effort and NOT retried: the date condition falls out
 * of range tomorrow (§3.2.3).
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @kagetra/web exec tsx \
 *     scripts/send-lifecycle-reminders.ts [--dry-run]
 *
 *   --dry-run lists the candidates WITHOUT claiming the once-ever slot or
 *   pushing — safe for ops verification (does not consume the notification).
 */

import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '..', '.env.local') })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { and, eq, isNotNull, ne, type SQL } from 'drizzle-orm'
import { events, eventLifecycleNotifications, eventLineBroadcasts } from '@kagetra/shared/schema'
import * as schema from '@kagetra/shared/schema'
import {
  addDaysIso,
  buildLifecycleMessage,
  formatDaysLabel,
  formatMMDD,
  jstTodayIso,
  reminderLeadDays,
  sendClaimedNotificationBulk,
  sortDays,
  type LifecycleNotificationType,
} from '../src/lib/event-lifecycle-notify'

// Exactly the db type the lib functions expect — guarantees assignability.
type Db = Parameters<typeof sendClaimedNotificationBulk>[0]

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}

/**
 * entry-groups タスク5: 1件のイベントに対する1種別分のリマインド候補。
 * `message` は従来どおり単一日ロジックで組み立てた文面（dry-run 表示・
 * バケットが1件だけのときの送信文面にそのまま使う。バイト互換の担保はここで
 * `buildLifecycleMessage` を1回だけ呼ぶことで自明にする ―
 * バケット化後に作り直さない）。
 *
 * `entryGroupId` / `dateIso` は AC-12 のバケットキー
 * （グループ, 種別, 締切日）を組むために追加した。`dateIso` は種別ごとに
 * 意味が異なる基準日（entry_deadline / payment_deadline / event_date）で、
 * `collectReminderCandidates` の各 push 呼び出しで実際に使った値
 * （`e.entryDeadline ?? advanceDate` 等）をそのまま転記する。
 */
export interface ReminderCandidate {
  eventId: number
  entryGroupId: number
  type: LifecycleNotificationType
  title: string
  eventDate: string
  feeJpy: number | null
  dateIso: string
  message: string
}

export interface LifecycleReminderResult {
  date: string
  leadDays: number
  sent: number
  skipped: number
  failed: number
  details: Array<{ eventId: number; type: LifecycleNotificationType; outcome: string }>
}

interface LinkedEventRow {
  id: number
  title: string
  feeJpy: number | null
  entryDeadline: string | null
  paymentDeadline: string | null
  eventDate: string
  entryGroupId: number
}

/**
 * Linked, non-cancelled events matching `condition`. The INNER JOIN on a
 * `status='linked'` binding with a non-null group enforces precondition §3.2.2#1.
 */
async function queryLinkedEvents(db: Db, condition: SQL | undefined): Promise<LinkedEventRow[]> {
  return db
    .select({
      id: events.id,
      title: events.title,
      feeJpy: events.feeJpy,
      entryDeadline: events.entryDeadline,
      paymentDeadline: events.paymentDeadline,
      eventDate: events.eventDate,
      entryGroupId: events.entryGroupId,
    })
    .from(events)
    .innerJoin(
      eventLineBroadcasts,
      and(
        // entry-groups タスク3: 帰属は entry_group_id。1グループ1行なので
        // 複数日グループでも各イベントに対して正しく1件だけ一致する。
        eq(eventLineBroadcasts.entryGroupId, events.entryGroupId),
        eq(eventLineBroadcasts.status, 'linked'),
        isNotNull(eventLineBroadcasts.lineGroupId),
      ),
    )
    .where(and(ne(events.status, 'cancelled'), condition))
}

/**
 * Collect the (event, type, message) tuples to send today. Read-only — does
 * not claim or push, so it's safe to call from --dry-run.
 */
export async function collectReminderCandidates(
  db: Db,
  opts: { today: string; advanceDate: string; leadDays: number },
): Promise<ReminderCandidate[]> {
  const { today, advanceDate, leadDays } = opts
  const out: ReminderCandidate[] = []

  // 申込締切（事前 / 当日）— 未申込のみ
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.entryStatus, 'not_applied'), eq(events.entryDeadline, advanceDate)),
  )) {
    const dateIso = e.entryDeadline ?? advanceDate
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'entry_deadline_advance',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: e.feeJpy,
      dateIso,
      message: buildLifecycleMessage('entry_deadline_advance', { title: e.title, dateIso, leadDays }),
    })
  }
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.entryStatus, 'not_applied'), eq(events.entryDeadline, today)),
  )) {
    const dateIso = e.entryDeadline ?? today
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'entry_deadline_day',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: e.feeJpy,
      dateIso,
      message: buildLifecycleMessage('entry_deadline_day', { title: e.title, dateIso }),
    })
  }

  // 事前支払締切（事前 / 当日）— payment_type='advance' かつ未払のみ
  for (const e of await queryLinkedEvents(
    db,
    and(
      eq(events.paymentType, 'advance'),
      eq(events.paymentStatus, 'unpaid'),
      eq(events.paymentDeadline, advanceDate),
    ),
  )) {
    const dateIso = e.paymentDeadline ?? advanceDate
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'payment_deadline_advance',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: e.feeJpy,
      dateIso,
      message: buildLifecycleMessage('payment_deadline_advance', { title: e.title, dateIso, leadDays }),
    })
  }
  for (const e of await queryLinkedEvents(
    db,
    and(
      eq(events.paymentType, 'advance'),
      eq(events.paymentStatus, 'unpaid'),
      eq(events.paymentDeadline, today),
    ),
  )) {
    const dateIso = e.paymentDeadline ?? today
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'payment_deadline_day',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: e.feeJpy,
      dateIso,
      message: buildLifecycleMessage('payment_deadline_day', { title: e.title, dateIso }),
    })
  }

  // 現地払い（事前 / 当日）— payment_type='onsite'、event_date 起点
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.paymentType, 'onsite'), eq(events.eventDate, advanceDate)),
  )) {
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'onsite_payment_advance',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: e.feeJpy,
      dateIso: e.eventDate,
      message: buildLifecycleMessage('onsite_payment_advance', {
        title: e.title,
        feeJpy: e.feeJpy,
        dateIso: e.eventDate,
        leadDays,
      }),
    })
  }
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.paymentType, 'onsite'), eq(events.eventDate, today)),
  )) {
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'onsite_payment_day',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: e.feeJpy,
      dateIso: e.eventDate,
      message: buildLifecycleMessage('onsite_payment_day', {
        title: e.title,
        feeJpy: e.feeJpy,
        dateIso: e.eventDate,
      }),
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// entry-groups タスク5 (AC-12): (グループ, 種別, 締切日) バケット化 + 文面組立
// ---------------------------------------------------------------------------

/** バケット内の1イベント分。日別ラベル（`formatEventDate(eventDate)+title`）に使う。 */
export interface ReminderBucketMember {
  eventId: number
  title: string
  eventDate: string
  feeJpy: number | null
  /**
   * `collectReminderCandidates` が組んだ**このメンバー自身の**単一日メッセージ。
   *
   * ★eventId をキーにした Map から後で引き直してはならない（r1 review blocker）。
   * 1つのイベントは同日に複数の種別の候補になり得る（申込締切日＝現地払い当日など）ため、
   * eventId だけのキーでは後の候補が前の候補を上書きし、N=1 バケットで別種別の文面を
   * 送ってしまう。候補と1:1で持ち回ることで種別の取り違えを構造的に不可能にする。
   */
  message: string
}

export interface ReminderBucket {
  entryGroupId: number
  type: LifecycleNotificationType
  /** バケットキーの締切日（種別により entry_deadline / payment_deadline / event_date）。 */
  dateIso: string
  members: ReminderBucketMember[]
}

/**
 * 純関数。`collectReminderCandidates` の結果を (entryGroupId, type, dateIso) で
 * グルーピングする。グループ内で締切が同じ日同士が1バケットにまとまり、締切が
 * 異なる日は別バケットになる（requirements §3.2.5 / AC-12）。
 *
 * 既存の `collectReminderCandidates` の戻り値・テストは変えない
 * （dry-run の逐次表示、`candidateKeys()` の `${eventId}:${type}` 検証が依存する）。
 */
export function bucketReminderCandidates(
  candidates: readonly ReminderCandidate[],
): ReminderBucket[] {
  const byKey = new Map<string, ReminderBucket>()
  const order: string[] = []
  for (const c of candidates) {
    const key = `${c.entryGroupId}:${c.type}:${c.dateIso}`
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = { entryGroupId: c.entryGroupId, type: c.type, dateIso: c.dateIso, members: [] }
      byKey.set(key, bucket)
      order.push(key)
    }
    bucket.members.push({
      eventId: c.eventId,
      title: c.title,
      eventDate: c.eventDate,
      feeJpy: c.feeJpy,
      message: c.message,
    })
  }
  return order.map((key) => byKey.get(key)!)
}

/**
 * 複数日の日別ラベル。**規則そのものは event-lifecycle-notify.ts の
 * `sortDays` / `formatDaysLabel` が唯一の置き場所**で、ここはその共通実装へ
 * 委譲するだけ（複製すると片方だけ書式を変えたときに経路によって通知の
 * 見た目が食い違う）。`LifecycleDayEntry` は `dateIso`/`title` を持つので、
 * バケットメンバーをその形へ写して渡す。
 */
function formatMembersLabel(members: readonly ReminderBucketMember[]): string {
  return formatDaysLabel(
    sortDays(members.map((m) => ({ dateIso: m.eventDate, title: m.title }))),
  )
}

/**
 * バケット（claim できたメンバーのみに絞り込み済み）から送信文面を組み立てる。
 *
 * - **1件のときはそのメンバーが持つ元の単一日メッセージをそのまま返す**
 *   （`buildLifecycleMessage` を作り直さないので N=1 のバイト互換は自明に保たれる —
 *   タスク4が固めた性質を壊さないため、この経路を経由しない）。文面はメンバー自身が
 *   持っているので、eventId から引き直して別種別の文面を掴む余地がない
 * - 2件以上のときは event-lifecycle-notify.ts の `entry_applied` 等と同じ日別ラベル
 *   規則（`formatEventDate(eventDate)+title` を `・` 連結）でローカルに文面を組む。
 *   `buildLifecycleMessage` はリマインド系6種別の複数日分岐を持たない（タスク4は
 *   一括トグルで使う entry_applied/entry_applied_treasurer/payment_paid のみ拡張済み）
 *   ため、**リマインド系の文面テンプレートはこのスクリプトが所有する**（この6種別を使うのは
 *   このバッチだけなので、文言の持ち主をここに置く）。ただし**日別ラベルの整形規則は
 *   共通化してある** — `sortDays`/`formatDaysLabel` を event-lifecycle-notify.ts から
 *   import しており、一括トグル側とラベル書式が食い違わない
 * - `feeJpy`（現地払いの参加費）は §3.2.7 の伝播対象外で日別に異なりうるため、
 *   `payment_paid` の複数日文面と同じ方針で金額を出し分けず割愛する
 *   （2件以上のときは常に金額なしの最小文面）
 */
function buildBucketMessage(
  bucket: Pick<ReminderBucket, 'type' | 'dateIso' | 'members'>,
  leadDays: number,
): string {
  if (bucket.members.length === 1) return bucket.members[0]!.message

  const daysLabel = formatMembersLabel(bucket.members)
  const date = formatMMDD(bucket.dateIso)

  switch (bucket.type) {
    case 'entry_deadline_advance':
      return `⏰${daysLabel}の申込締切は ${date}（あと ${leadDays} 日）です。まだ申込が完了していません。`
    case 'entry_deadline_day':
      return `⚠️${daysLabel}の申込締切は本日 ${date} です。まだ申込が完了していません。`
    case 'payment_deadline_advance':
      return `⏰${daysLabel}の参加費の支払締切は ${date}（あと ${leadDays} 日）です。まだ支払いが完了していません。`
    case 'payment_deadline_day':
      return `⚠️${daysLabel}の参加費の支払締切は本日 ${date} です。まだ支払いが完了していません。`
    case 'onsite_payment_advance':
      return `💰${daysLabel}は当日現地払いです。参加費を ${date} 当日お持ちください。`
    case 'onsite_payment_day':
      return `💰 本日は${daysLabel}です。参加費の現地払いをお忘れなく。`
    default:
      throw new Error(`send-lifecycle-reminders: unsupported bucket type ${String(bucket.type)}`)
  }
}

/**
 * バケット1件分の once-ever claim を1文の INSERT で原子化する。
 * `INSERT ... VALUES (...) ON CONFLICT (event_id, type) DO NOTHING RETURNING id, event_id`
 * は要件の「INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING event_id」の1文原則と
 * 同じ保証（1回のラウンドトリップ・1つの atomic statement・UNIQUE(event_id,type) による
 * 二重 claim 防止）を満たす。drizzle の型付き insert を使うことで、enum キャストを
 * 手で書く raw SQL 文字列より安全（このタスクはテスト実行なしで確定させる必要があるため、
 * 検証不能な raw SQL 文字列を避けた）。
 *
 * `members` が空なら早期リターン（IN 句 / VALUES を空で発行しない）。
 */
async function claimReminderBucket(
  db: Db,
  bucket: Pick<ReminderBucket, 'type' | 'members'>,
): Promise<Array<{ id: number; eventId: number }>> {
  if (bucket.members.length === 0) return []
  const rows = bucket.members.map((m) => ({
    eventId: m.eventId,
    type: bucket.type,
    status: 'skipped' as const,
  }))
  const inserted = await db
    .insert(eventLifecycleNotifications)
    .values(rows)
    .onConflictDoNothing({
      target: [eventLifecycleNotifications.eventId, eventLifecycleNotifications.type],
    })
    .returning({ id: eventLifecycleNotifications.id, eventId: eventLifecycleNotifications.eventId })
  return inserted
}

/**
 * Collect today's candidates, bucket them by (entryGroupId, type, dateIso),
 * and send each bucket once-ever (AC-12). `today` / `leadDays` are injectable
 * for deterministic tests.
 *
 * once-ever の単位は従来どおり (event_id, type) のまま —
 * `claimReminderBucket` はバケット内の各イベントを個別に claim し、
 * **claim できたイベントだけ**をまとめて1通にする。これにより cron 再実行では
 * 「既送のイベントは skipped のまま・未送のイベントだけの追加1通」が自然に出る
 * （requirements §3.2.5 後段・AC-12 の後半）。
 */
export async function sendLifecycleReminders(
  db: Db,
  options: { today?: string; leadDays?: number; logger?: Logger } = {},
): Promise<LifecycleReminderResult> {
  const today = options.today ?? jstTodayIso()
  const leadDays = options.leadDays ?? reminderLeadDays()
  const advanceDate = addDaysIso(today, leadDays)

  const candidates = await collectReminderCandidates(db, { today, advanceDate, leadDays })
  const buckets = bucketReminderCandidates(candidates)

  let sent = 0
  let skipped = 0
  let failed = 0
  const details: LifecycleReminderResult['details'] = []

  for (const bucket of buckets) {
    const claimed = await claimReminderBucket(db, bucket)
    const claimedEventIds = new Set(claimed.map((c) => c.eventId))

    if (claimed.length === 0) {
      // 全メンバーが既に claim 済み（前回実行で送信済み）。push しない。
      for (const member of bucket.members) {
        skipped++
        details.push({ eventId: member.eventId, type: bucket.type, outcome: 'skipped' })
      }
      continue
    }

    const claimedMembers = bucket.members.filter((m) => claimedEventIds.has(m.eventId))
    const message = buildBucketMessage(
      { type: bucket.type, dateIso: bucket.dateIso, members: claimedMembers },
      leadDays,
    )
    const representativeEventId = claimedMembers[0]!.eventId
    const result = await sendClaimedNotificationBulk(
      db,
      {
        notificationIds: claimed.map((c) => c.id),
        eventId: representativeEventId,
        message,
      },
      { logger: options.logger },
    )

    for (const member of bucket.members) {
      const outcome = claimedEventIds.has(member.eventId) ? result.outcome : 'skipped'
      if (outcome === 'sent') sent++
      else if (outcome === 'failed') failed++
      else skipped++
      details.push({ eventId: member.eventId, type: bucket.type, outcome })
    }
  }

  return { date: today, leadDays, sent, skipped, failed, details }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const dryRun = argv.includes('--dry-run')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL not set')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle(pool, { schema })

    if (dryRun) {
      const today = jstTodayIso()
      const leadDays = reminderLeadDays()
      const advanceDate = addDaysIso(today, leadDays)
      const candidates = await collectReminderCandidates(db, { today, advanceDate, leadDays })
      process.stdout.write(
        `[send-lifecycle-reminders] DRY RUN (today=${today}, lead=${leadDays}, advance=${advanceDate}): ` +
          `${candidates.length} candidate(s)\n`,
      )
      for (const c of candidates) {
        process.stdout.write(`  - event ${c.eventId} [${c.type}] ${c.message}\n`)
      }
      return
    }

    const logger: Logger = {
      info: (msg, ctx) =>
        process.stdout.write(`[send-lifecycle-reminders] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`),
      warn: (msg, ctx) =>
        process.stderr.write(`[send-lifecycle-reminders] ${msg}${ctx ? ' ' + JSON.stringify(ctx) : ''}\n`),
    }
    const result = await sendLifecycleReminders(db, { logger })
    process.stdout.write(
      `[send-lifecycle-reminders] today=${result.date} lead=${result.leadDays}: ` +
        `sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}\n`,
    )
  } finally {
    await pool.end()
  }
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1])
  } catch {
    return false
  }
})()

if (isDirectRun) {
  main().then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(
        `[send-lifecycle-reminders] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
