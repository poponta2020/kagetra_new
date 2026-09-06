import 'server-only'
import { and, asc, eq, ne } from 'drizzle-orm'
import { entryGroupPaymentNotices, eventLineBroadcasts, events } from '@kagetra/shared/schema'
import type { Grade } from '@kagetra/shared/types'
import { db } from '@/lib/db'
import { resolveEntryFee } from '@/lib/entry-fee'
import type { GradeHeadcount } from '@/lib/entry-fee'
import { tallyEntryFees } from '@/lib/entry-fee-tally'
import { loadConfirmedRosterState } from '@/lib/events/confirmed-roster'
import type { PaymentDeadlineKind } from '@/lib/events/payment-deadline'
import {
  PAYMENT_NOTICE_GRADES,
  resolvePaymentNoticeAvailability,
  selectDueDays,
  type PaymentNoticeAvailability,
  type PaymentNoticeUnavailableReason,
} from '@/lib/events/payment-notice-availability'

/**
 * payment-notice-context: 振込連絡（line-bot-message-revamp §3.3）の露出条件と
 * 初期値を**1箇所で**組む。
 *
 * グループページ（`/admin/entries/[groupId]`）・その Server Action・
 * メール処理画面（§3.3.5）の**すべて**がこれを呼ぶ。Server Action は client から
 * 直接叩けるので、画面が出していない状況で送られないよう同じ判定を再実行する
 * （fail-closed）。**メール画面用に別のローダーを書かない**（requirements §6）。
 *
 * 露出条件（§3.3.1・AC-9/10/11）= 申込管理ボードの `payment_due` 区画と同じ:
 * ```
 * settled（確定名簿あり）∧ 事前払い（payment_type='advance'）∧ 未振込（payment_status='unpaid'）
 * ```
 * - `settled` の判定は [confirmed-roster.ts] が正典。4材料の OR をここで再実装しない
 * - 現地払い・支払済のグループはこの条件に入らないのでボタンが出ない（AC-11）
 * - 複数日グループでは「非中止の日に1日でも 申込済 ∧ 事前払い ∧ 未振込 があるか」で判定する
 *
 * ★**メール処理画面は `settled` を条件に入れない**（`requireSettled: false`・§3.3.5.1）。
 * 処理の実行そのものが `mail_kind='confirmed_roster'` かつ `triage_status='processed'` を
 * 書いてシグナル3を成立させるので、処理**前**に見ると必ず false になる（§7-6）。
 *
 * ★**金額・単価・支払情報はすべて「未振込の日」（`dueDays`）だけから引く**
 * （レビュー指摘。旧実装は `tallyEntryFeesForGroup` をそのまま使っていた）。
 * あちらの母集団は「非中止 かつ 事前払い」で、**支払済みの日を除外しない**。日ごとに
 * 支払済みトグルを進められる以上、同一グループに未振込日と支払済み日が混在しうるので、
 * そのまま使うと支払済み分まで振込依頼に載り**二重請求**になる。
 */

/**
 * グループ共通の振込条件（§3.3.5.3 でメール処理画面が編集・保存する2項目）。
 *
 * ★**送信できない状態でも返す。** セクションが描かれている限り支払締切・振込先は
 * 保存できる、というのが要件の契約（ゲートが掛かるのは push だけ）なので、
 * 「送れないから初期値も返さない」にすると入力欄に前の値が出せない。
 */
export interface PaymentNoticeCommonFields {
  /** 振込期限（グループ共通。日により違えば最も早い日を採る）。 */
  paymentDeadline: string | null
  /** 振込期限の状態。`paymentDeadline` と CHECK で双条件に縛られている。 */
  paymentDeadlineKind: PaymentDeadlineKind
  /** 支払情報（グループ共通。空なら2通目を送らない）。 */
  paymentInfo: string | null
}

export interface PaymentNoticeContext extends PaymentNoticeCommonFields {
  /**
   * 級ごとの人数（初期値）と単価。保存済みがあればその人数、無ければ参加費集計から。
   *
   * ★**単価が解決できる対象級はすべて含める（人数0でも行を出す）**（レビュー指摘）。
   * 出欠回答が0人の級を落とすと入力欄自体が消え、「集計の母集団は確定名簿ではないから
   * 人数を人間が直す」というこの機能の目的（§3.3.2）が果たせない級が出る。
   * 文面側は `normalizeNoticeRows` が人数0の行を落とすので、送信結果は変わらない。
   */
  rows: GradeHeadcount[]
  /** 保存済みの人数を初期値にしたか（画面の注記に使う）。 */
  hasSavedCounts: boolean
  /** 級 -> 単価。人数から金額を組み直すのに使う（単価は保存しない）。 */
  unitPriceByGrade: Partial<Record<Grade, number>>
  lastSentAt: Date | null
  /** 最後に送信を試みた日時（成否を問わない）。§3.3.5.6 の失敗表示に使う。 */
  lastAttemptedAt: Date | null
  /** 直近の送信失敗の理由。成功でクリアされる（AC-45b）。 */
  lastError: string | null
  hasLineBinding: boolean
  /**
   * 送信可否の最終判定。**`no_priced_grade` だけはここに残す**（`ok: false` にして
   * ローダーごと弾かない）。グループページは従来どおりセクションを出して
   * 「参加費を算出できる級がありません」を本文に表示する仕様で、露出条件へ
   * 単価の項を足すと AC-48 の回帰になるため。メール画面はこの値をそのまま
   * 「送信できない理由」として出す（§3.3.5.2 の5行目）。
   */
  availability: PaymentNoticeAvailability
}

export type PaymentNoticeContextResult =
  | { ok: true; context: PaymentNoticeContext }
  | {
      ok: false
      reason: PaymentNoticeUnavailableReason
      message: string
      /**
       * 送れない状態でも共通項目は返す（§3.3.5.3）。メール処理画面はこれを初期値に
       * 支払締切・振込先を編集・保存できる。グループページは `ok` しか見ないので
       * 従来どおりセクションごと出ない（AC-48 の回帰）。
       */
      commonFields: PaymentNoticeCommonFields
    }

export interface LoadPaymentNoticeContextOptions {
  /**
   * `settled`（確定名簿あり）を露出条件に含めるか。既定 `true`（グループページ）。
   * メール処理画面だけが `false` を渡す（§3.3.5.1）。
   */
  requireSettled?: boolean
}

/**
 * 露出条件を満たすなら文脈を返し、満たさなければ理由を返す（= ボタンを出さない・
 * Server Action も拒否する）。
 */
export async function loadPaymentNoticeContext(
  entryGroupId: number,
  options: LoadPaymentNoticeContextOptions = {},
): Promise<PaymentNoticeContextResult> {
  const requireSettled = options.requireSettled ?? true
  const [{ settled }, dayRows, binding] = await Promise.all([
    loadConfirmedRosterState(entryGroupId),
    db
      .select({
        id: events.id,
        official: events.official,
        kind: events.kind,
        eligibleGrades: events.eligibleGrades,
        feeJpy: events.feeJpy,
        entryStatus: events.entryStatus,
        paymentType: events.paymentType,
        paymentStatus: events.paymentStatus,
        paymentDeadline: events.paymentDeadline,
        paymentDeadlineKind: events.paymentDeadlineKind,
        paymentInfo: events.paymentInfo,
      })
      .from(events)
      .where(and(eq(events.entryGroupId, entryGroupId), ne(events.status, 'cancelled')))
      // 支払期限・支払情報の代表値をどの日から採るかを決定的にする（順序を指定しないと
      // 日により値が違うグループで実行ごとに別の口座が選ばれうる）。
      .orderBy(asc(events.eventDate), asc(events.id)),
    db
      .select({ id: eventLineBroadcasts.id })
      .from(eventLineBroadcasts)
      .where(
        and(
          eq(eventLineBroadcasts.entryGroupId, entryGroupId),
          eq(eventLineBroadcasts.status, 'linked'),
        ),
      )
      .limit(1),
  ])
  const hasLineBinding = binding.length > 0
  const dueDays = selectDueDays(dayRows)

  // 単価は**未振込の日**から解決する（金額の母集団と同じ集合にする）。
  const unitPriceByGrade: Partial<Record<Grade, number>> = {}
  for (const day of dueDays) {
    const resolution = resolveEntryFee({
      official: day.official,
      kind: day.kind,
      eligibleGrades: day.eligibleGrades,
      feeJpy: day.feeJpy,
    })
    // 級別の規定額が導ける日（official な個人戦）だけを単価の出所にする。
    if (!resolution.perPersonPriced) continue
    for (const [grade, price] of Object.entries(resolution.unitPriceByGrade)) {
      if (price != null) unitPriceByGrade[grade as Grade] = price
    }
  }

  const availability = resolvePaymentNoticeAvailability({
    settled,
    requireSettled,
    days: dayRows,
    hasLineBinding,
    hasPricedGrade: Object.keys(unitPriceByGrade).length > 0,
  })
  // 共通項目（支払締切・振込先）の代表値。**対象日が無くても返す**（§3.3.5.3）ので、
  // 母集団は「未振込の日があればそこ、無ければ非中止の全日」とする。どちらも
  // 開催日昇順に固定してあるので、同じ状態からは必ず同じ値が選ばれる。
  const commonFields = representativeCommonFields(dueDays.length > 0 ? dueDays : dayRows)

  // `no_priced_grade` 以外の不可はローダーごと弾く（= グループページはセクションを
  // 出さない）。ただし**共通項目は添えて返す** — メール処理画面は送れない状態でも
  // 支払締切・振込先を編集・保存できる必要がある（Codex R1 blocker）。
  if (!availability.ok && availability.reason !== 'no_priced_grade') {
    return {
      ok: false,
      reason: availability.reason,
      message: availability.message,
      commonFields,
    }
  }

  const [tally, savedRows] = await Promise.all([
    // ★グループ全体（`tallyEntryFeesForGroup`）ではなく**未振込の日だけ**を合算する。
    // 支払済みの日を含めると二重請求になる（モジュール冒頭の説明を参照）。
    tallyEntryFees(
      db,
      dueDays.map((d) => d.id),
    ),
    db
      .select({
        gradeCounts: entryGroupPaymentNotices.gradeCounts,
        lastSentAt: entryGroupPaymentNotices.lastSentAt,
        lastAttemptedAt: entryGroupPaymentNotices.lastAttemptedAt,
        lastError: entryGroupPaymentNotices.lastError,
      })
      .from(entryGroupPaymentNotices)
      .where(eq(entryGroupPaymentNotices.entryGroupId, entryGroupId))
      .limit(1),
  ])
  const saved = savedRows[0] ?? null
  const savedCounts = saved?.gradeCounts ?? {}
  const hasSavedCounts = PAYMENT_NOTICE_GRADES.some((g) => (savedCounts[g] ?? 0) > 0)

  // 行は**単価が解決できる対象級すべて**（人数0でも出す）。人数は保存済みがあれば
  // それを、無ければ集計値を初期値にする。
  const tallyByGrade = new Map(tally.headcounts.map((r) => [r.grade, r.count]))
  const rows: GradeHeadcount[] = PAYMENT_NOTICE_GRADES.flatMap((grade) => {
    const unitJpy = unitPriceByGrade[grade]
    if (unitJpy == null) return []
    const count = hasSavedCounts ? (savedCounts[grade] ?? 0) : (tallyByGrade.get(grade) ?? 0)
    return [{ grade, count, unitJpy }]
  })

  return {
    ok: true,
    context: {
      rows,
      hasSavedCounts,
      unitPriceByGrade,
      ...commonFields,
      lastSentAt: saved?.lastSentAt ?? null,
      lastAttemptedAt: saved?.lastAttemptedAt ?? null,
      lastError: saved?.lastError ?? null,
      hasLineBinding,
      availability,
    },
  }
}

/**
 * 振込連絡の**送信状況だけ**を、代表イベント id から引く（§3.3.5.6 の失敗表示）。
 *
 * メール詳細の「処理済み」カードは `mail_messages.linked_event_id` しか持たないので、
 * そこからグループを辿る。露出条件は見ない — 送った**後**に支払済みへ倒したグループでも
 * 「送信に失敗しました」を出し続ける必要があるため（失敗に気づける場所が2つしかない）。
 *
 * 記録が無ければ `null`（＝まだ一度も送っていない・このグループは対象外）。
 */
export async function loadPaymentNoticeStatusByEvent(eventId: number): Promise<{
  entryGroupId: number
  lastSentAt: Date | null
  lastAttemptedAt: Date | null
  lastError: string | null
} | null> {
  const rows = await db
    .select({
      entryGroupId: entryGroupPaymentNotices.entryGroupId,
      lastSentAt: entryGroupPaymentNotices.lastSentAt,
      lastAttemptedAt: entryGroupPaymentNotices.lastAttemptedAt,
      lastError: entryGroupPaymentNotices.lastError,
    })
    .from(entryGroupPaymentNotices)
    .innerJoin(events, eq(events.entryGroupId, entryGroupPaymentNotices.entryGroupId))
    .where(eq(events.id, eventId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * 共通項目（支払締切・振込先）の代表値を、渡された日の集合から決定的に選ぶ。
 * 呼び出し側のクエリが開催日昇順に固定してあるので、同じ状態からは必ず同じ値になる。
 */
function representativeCommonFields(
  days: readonly {
    paymentDeadline: string | null
    paymentDeadlineKind: PaymentDeadlineKind
    paymentInfo: string | null
  }[],
): PaymentNoticeCommonFields {
  const paymentDeadline = earliest(days.map((d) => d.paymentDeadline))
  return {
    paymentDeadline,
    paymentDeadlineKind: representativeDeadlineKind(
      paymentDeadline,
      days.map((d) => d.paymentDeadlineKind),
    ),
    paymentInfo: firstNonEmpty(days.map((d) => d.paymentInfo)),
  }
}

/** 日により違う日付は**最も早い日**を採る（共通項目セクションの表示規則と同じ）。 */
function earliest(dates: readonly (string | null)[]): string | null {
  const present = dates.filter((d): d is string => d != null)
  return present.length === 0 ? null : present.slice().sort()[0]!
}

/**
 * 代表の振込締切「状態」。**日付が正**（`normalizePaymentDeadline` と同じ規律）:
 * 代表日付があるなら必ず `fixed`。無いときは「後日連絡」のように積極的な主張を
 * している日を優先し、どの日も何も言っていなければ `unspecified` に倒す。
 */
function representativeDeadlineKind(
  paymentDeadline: string | null,
  kinds: readonly PaymentDeadlineKind[],
): PaymentDeadlineKind {
  if (paymentDeadline != null) return 'fixed'
  return kinds.find((k) => k === 'later_notice') ?? 'unspecified'
}

/**
 * 日により違う自由記述は最初の非空を採る（グループ共通項目という運用前提）。
 * 対象は**未振込の日だけ**で、並びは開催日昇順に固定してある（呼び出し側のクエリ）ので、
 * 同じ状態からは必ず同じ値が選ばれる。
 */
function firstNonEmpty(values: readonly (string | null)[]): string | null {
  for (const v of values) {
    const trimmed = v?.trim()
    if (trimmed) return trimmed
  }
  return null
}
