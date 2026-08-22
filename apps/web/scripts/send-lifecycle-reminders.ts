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
import type { EventKind, Grade } from '@kagetra/shared/types'
import {
  addDaysIso,
  buildLifecycleMessage,
  jstTodayIso,
  reminderLeadDays,
  sendClaimedNotificationBulk,
  type LifecycleNotificationType,
} from '../src/lib/event-lifecycle-notify'
import { resolveEntryFee } from '../src/lib/entry-fee'
import { tallyEntryFeesForGroup, type FeeTallyResult } from '../src/lib/entry-fee-tally'

// Exactly the db type the lib functions expect — guarantees assignability.
type Db = Parameters<typeof sendClaimedNotificationBulk>[0]

interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
}

/**
 * entry-groups タスク5: 1件のイベントに対する1種別分のリマインド候補。
 * `message` は `buildLifecycleMessage` を1回だけ呼んで組み立てた文面（dry-run 表示用）。
 *
 * line-bot-message-revamp タスク5: `buildBucketMessage`（バケット化後の送信文面）は
 * もうこの `message` を読まない — 大会名・金額を出さなくなったため
 * `bucket.type`/`bucket.dateIso` だけで文面が一意に決まるようになった。
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
  /**
   * grade-entry-fee タスク5 (AC-13) で導入した振込総額。`tallyEntryFeesForGroup` が
   * 返す**グループ全日の合算**（イベント単体ではない）。line-bot-message-revamp
   * タスク5で文面から金額を撤去したため `buildBucketMessage` はもう読まない
   * （情報としてフィールドは残す）。
   */
  totalJpy?: number | null
  breakdownLabel?: string | null
  unknownGradeCount?: number
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
  // grade-entry-fee タスク5 (AC-15/16): 現地払いの単価導出（`resolveEntryFee`）に要る3列。
  official: boolean
  kind: EventKind
  eligibleGrades: Grade[] | null
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
      official: events.official,
      kind: events.kind,
      eligibleGrades: events.eligibleGrades,
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

  // grade-entry-fee タスク5 (AC-13): グループ単位の振込総額メモ。
  // payment_deadline_advance/_day の両ループ、および同一グループの複数日で
  // `tallyEntryFeesForGroup` を何度も引かないためのキャッシュ。
  // **必ず呼び出しごとに作り直す**（module-level に置くと別テストの値が
  // 残る）ので、この関数のローカル変数にする。
  const groupTallyCache = new Map<number, FeeTallyResult>()
  async function getGroupTally(entryGroupId: number): Promise<FeeTallyResult> {
    const cached = groupTallyCache.get(entryGroupId)
    if (cached) return cached
    const result = await tallyEntryFeesForGroup(db, entryGroupId)
    groupTallyCache.set(entryGroupId, result)
    return result
  }

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
    // AC-13: 総額はイベント単位ではなくグループ単位（グループ全日の合算）。
    const tally = await getGroupTally(e.entryGroupId)
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'payment_deadline_advance',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: e.feeJpy,
      dateIso,
      totalJpy: tally.totalJpy,
      breakdownLabel: tally.breakdownLabel,
      unknownGradeCount: tally.unknownGradeCount,
      // line-bot-message-revamp タスク5 (AC-26): 文面から金額を撤去したため
      // totalJpy 等は buildLifecycleMessage へ渡さない（候補フィールドには引き続き
      // 残す — 他画面表示等の情報として今後使う可能性があるため未使用化に留める）。
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
    const tally = await getGroupTally(e.entryGroupId)
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'payment_deadline_day',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: e.feeJpy,
      dateIso,
      totalJpy: tally.totalJpy,
      breakdownLabel: tally.breakdownLabel,
      unknownGradeCount: tally.unknownGradeCount,
      // line-bot-message-revamp タスク5 (AC-26): 上と同じ理由で金額は渡さない。
      message: buildLifecycleMessage('payment_deadline_day', { title: e.title, dateIso }),
    })
  }

  // 現地払い（事前 / 当日）— payment_type='onsite'、event_date 起点
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.paymentType, 'onsite'), eq(events.eventDate, advanceDate)),
  )) {
    // grade-entry-fee タスク5 (AC-15/16): 現地払いの金額は events.fee_jpy を直接渡さず
    // `resolveEntryFee` の導出値へ移す。official な個人戦では単価が級別規定額へ
    // 常に導出され、格納値は一切参照されない（entry-fee.ts の分岐に委譲）。
    const resolution = resolveEntryFee({
      official: e.official,
      kind: e.kind,
      eligibleGrades: e.eligibleGrades,
      feeJpy: e.feeJpy,
    })
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'onsite_payment_advance',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: resolution.singleUnitJpy,
      dateIso: e.eventDate,
      // line-bot-message-revamp タスク5 (AC-26): 現地払いも文面から金額を撤去した。
      // `resolveEntryFee` の呼び出し・`feeJpy`/`unitPricesLabel` フィールド自体は
      // 候補の情報として残すが、buildLifecycleMessage へは渡さない（固定文言）。
      message: buildLifecycleMessage('onsite_payment_advance', { title: e.title }),
    })
  }
  for (const e of await queryLinkedEvents(
    db,
    and(eq(events.paymentType, 'onsite'), eq(events.eventDate, today)),
  )) {
    const resolution = resolveEntryFee({
      official: e.official,
      kind: e.kind,
      eligibleGrades: e.eligibleGrades,
      feeJpy: e.feeJpy,
    })
    out.push({
      eventId: e.id,
      entryGroupId: e.entryGroupId,
      type: 'onsite_payment_day',
      title: e.title,
      eventDate: e.eventDate,
      feeJpy: resolution.singleUnitJpy,
      dateIso: e.eventDate,
      message: buildLifecycleMessage('onsite_payment_day', { title: e.title }),
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
   * line-bot-message-revamp タスク5: `buildBucketMessage` は大会名・日別ラベル・
   * 金額を一切出さなくなったため `bucket.type` + `bucket.dateIso` だけで文面が
   * 一意に決まるようになり、この `message` はもう `buildBucketMessage` からは
   * 読まれない（r1 review blocker で守っていた「eventId 取り違え」の懸念自体が
   * 構造的に解消された）。dry-run 表示（`collectReminderCandidates` の呼び出し元）
   * 用の情報としてフィールド自体は残す。
   */
  message: string
  /**
   * grade-entry-fee タスク5 (AC-13) で導入した振込総額。line-bot-message-revamp
   * タスク5で文面から金額を撤去したため `buildBucketMessage` はもう読まない
   * （情報としてフィールドは残す）。
   */
  totalJpy?: number | null
  breakdownLabel?: string | null
  unknownGradeCount?: number
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
      totalJpy: c.totalJpy,
      breakdownLabel: c.breakdownLabel,
      unknownGradeCount: c.unknownGradeCount,
    })
  }
  return order.map((key) => byKey.get(key)!)
}

/**
 * バケットから送信文面を組み立てる。
 *
 * **2026-08-22 line-bot-message-revamp タスク5で全面簡略化。** 大会名を出さなく
 * なったため、束ねた結果の文面は単一日と完全に同一になった（日別ラベルの列挙・
 * 振込総額行は全種別で撤去 — requirements §3.2.1）。そのためバケットの文面は
 * `bucket.type` と `bucket.dateIso`（バケットキーの一部＝メンバー全員で共通）だけ
 * から一意に決まり、`buildLifecycleMessage` をそのまま呼べば足りる。
 * `bucket.members` はもう読まない（旧実装は N=1/N>1 で分岐し、日別ラベル整形や
 * 振込総額行の合成をここで担っていたが、その分岐ごと不要になった）。
 */
function buildBucketMessage(
  bucket: Pick<ReminderBucket, 'type' | 'dateIso'>,
  leadDays: number,
): string {
  return buildLifecycleMessage(bucket.type, { title: '', dateIso: bucket.dateIso, leadDays })
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
    const message = buildBucketMessage({ type: bucket.type, dateIso: bucket.dateIso }, leadDays)
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
