/**
 * 申込フロー（会内締切→大会申込→抽選→支払→開催）の done/now/warn/neutral/goal を
 * 決める純関数。UI から独立させて描画側（EntryFlow コンポーネント）から呼ぶ。
 * 仕様の正: docs/spec/events-attendance.md「申込フロー」（初出は
 * docs/features/event-detail-redesign/requirements.md §3.2.1 / §4。抽選の
 * 確定名簿連動は 2026-08-02 の quickfix で追加）。
 *
 * 排他的な単一 status ではなく合成可能なフラグにしているのは、warn が now と
 * 併存しうる（期限超過の未完了ステップが現在地でもある）ことと、開催ステップが
 * done でも goal の見た目を保つことを表現するため。
 */

export type EntryFlowStepKey = 'internal' | 'entry' | 'lottery' | 'payment' | 'event'

/**
 * 日付欄の中身。
 * - `kind: 'date'` … `YYYY-MM-DD`。描画側が `M/D` に整形し Serif + tabular-nums で出す
 * - `kind: 'text'` … `未定` / `申込なし` / `現地払い`。数値でないので描画側は sans で出す
 */
export type EntryFlowDateCell = { kind: 'date'; value: string } | { kind: 'text'; value: string }

export interface EntryFlowStep {
  key: EntryFlowStepKey
  /** '会内締切' | '大会申込' | '抽選' | '支払' | '開催' */
  label: string
  date: EntryFlowDateCell
  /** 完了。中立ステップは常に false */
  done: boolean
  /** 現在地。5ステップ全体で高々1つ */
  isNow: boolean
  /** 期限超過かつ未完了。isNow と併存しうる（done とは定義上併存しない） */
  isWarn: boolean
  /** 開催ステップのみ true。done でも goal スタイルを保つためのフラグ */
  isGoal: boolean
  /** 判定対象外。done / isWarn / isNow のいずれにもならない */
  neutral: boolean
}

export interface EntryFlowInput {
  internalDeadline: string | null
  entryDeadline: string | null
  lotteryDate: string | null
  paymentDeadline: string | null
  /** events.event_date は NOT NULL */
  eventDate: string
  entryStatus: 'not_applied' | 'applied' | 'not_applying'
  paymentType: 'advance' | 'onsite' | null
  paymentStatus: 'unpaid' | 'paid'
  /**
   * 確定名簿（`confirmed`）が取り込まれているか。定義は申込管理ボードと同じ
   * 「パース済み（supersede されていない版）∪ 採用済み原本ファイル」で、
   * `applicant`（申込者名簿）は含めない。確定名簿は抽選結果そのものなので、
   * 抽選日が未設定・未来日でも true なら抽選ステップを完了扱いにする。
   */
  hasConfirmedRoster: boolean
  /** JST の今日（`YYYY-MM-DD`）。テスト容易性のため呼び出し側から注入する */
  todayStr: string
}

const STEP_LABELS: Record<EntryFlowStepKey, string> = {
  internal: '会内締切',
  entry: '大会申込',
  lottery: '抽選',
  payment: '支払',
  event: '開催',
}

/** `YYYY-MM-DD` は辞書順＝時系列順なので文字列比較でよい。当日は「超過していない」。 */
function isPast(date: string | null, todayStr: string): boolean {
  return date != null && date < todayStr
}

function dateCell(date: string | null, placeholder: string): EntryFlowDateCell {
  return date == null ? { kind: 'text', value: placeholder } : { kind: 'date', value: date }
}

/** neutral 未確定の生の判定値。neutral 決定後に done/isWarn を上書きする。 */
interface RawStep {
  key: EntryFlowStepKey
  date: EntryFlowDateCell
  done: boolean
  isWarn: boolean
  neutral: boolean
}

export function buildEntryFlow(input: EntryFlowInput): EntryFlowStep[] {
  const {
    internalDeadline,
    entryDeadline,
    lotteryDate,
    paymentDeadline,
    eventDate,
    entryStatus,
    paymentType,
    paymentStatus,
    hasConfirmedRoster,
    todayStr,
  } = input

  const entryLotteryPaymentNeutral = entryStatus === 'not_applying'

  const raw: RawStep[] = [
    {
      key: 'internal',
      date: dateCell(internalDeadline, '未定'),
      done: isPast(internalDeadline, todayStr),
      isWarn: false,
      neutral: false,
    },
    {
      key: 'entry',
      date: entryStatus === 'not_applying' ? { kind: 'text', value: '申込なし' } : dateCell(entryDeadline, '未定'),
      done: entryStatus === 'applied',
      isWarn: isPast(entryDeadline, todayStr) && entryStatus !== 'applied',
      neutral: entryLotteryPaymentNeutral,
    },
    {
      key: 'lottery',
      date: dateCell(lotteryDate, '未定'),
      // 確定名簿=抽選結果そのもの。抽選日の経過を待たず（未設定でも）完了にする。
      // 日付欄は変えない（null なら「未定」のまま。完了は done スタイルで伝わる）。
      done: isPast(lotteryDate, todayStr) || hasConfirmedRoster,
      isWarn: false,
      neutral: entryLotteryPaymentNeutral,
    },
    {
      key: 'payment',
      date:
        paymentType === 'onsite'
          ? { kind: 'text', value: '現地払い' }
          : paymentType === null
            ? { kind: 'text', value: '未定' }
            : dateCell(paymentDeadline, '未定'),
      done: paymentType === 'advance' && paymentStatus === 'paid',
      isWarn: isPast(paymentDeadline, todayStr) && paymentType === 'advance' && paymentStatus !== 'paid',
      neutral: entryLotteryPaymentNeutral || paymentType !== 'advance',
    },
    {
      key: 'event',
      date: { kind: 'date', value: eventDate },
      done: isPast(eventDate, todayStr),
      isWarn: false,
      neutral: false,
    },
  ]

  const steps: EntryFlowStep[] = raw.map((r) => ({
    key: r.key,
    label: STEP_LABELS[r.key],
    date: r.date,
    // neutral なステップは done/isWarn/isNow を全て false にする。
    done: r.neutral ? false : r.done,
    isWarn: r.neutral ? false : r.isWarn,
    isNow: false,
    isGoal: r.key === 'event',
    neutral: r.neutral,
  }))

  // 現在地は「完了でも中立でもない」最先頭の高々1つ。会として申し込まない
  // (not_applying) 場合は「進行中の段階」が存在しないため現在地を出さない。
  if (entryStatus !== 'not_applying') {
    const nowStep = steps.find((s) => !s.done && !s.neutral)
    if (nowStep) nowStep.isNow = true
  }

  return steps
}
