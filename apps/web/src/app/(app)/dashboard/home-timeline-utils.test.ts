import { describe, expect, it } from 'vitest'
import {
  HOME_EVENT_STATUS_PILL,
  INITIAL_VISIBLE_COUNT,
  alertCountdown,
  deriveHomeEventStatus,
  splitTimelineDate,
  type HomeEventStatusInput,
} from './home-timeline-utils'

// ホーム「会の出場予定」の表示用純関数。実装手順書 タスク1。
// 描画側の分岐は HomeTimeline.test.tsx、サーバー側の組み立ては page.test.tsx が持つ。

describe('splitTimelineDate', () => {
  it('YYYY-MM-DD を M/D と曜日1文字へ割る', () => {
    expect(splitTimelineDate('2026-08-02')).toEqual({ md: '8/2', weekday: '日' })
  })

  it('月日はゼロ埋めしない', () => {
    expect(splitTimelineDate('2026-01-05')).toEqual({ md: '1/5', weekday: '月' })
  })

  it('曜日は7種すべて正しく出る', () => {
    // 2026-07-26(日) から 1 週間。曜日の並びがずれていないことを見る。
    const week = [
      '2026-07-26',
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]
    expect(week.map((d) => splitTimelineDate(d).weekday)).toEqual([
      '日',
      '月',
      '火',
      '水',
      '木',
      '金',
      '土',
    ])
  })

  it('不正入力は入力そのまま + 曜日なしを返す（防御的）', () => {
    expect(splitTimelineDate('2026/08/02')).toEqual({ md: '2026/08/02', weekday: '' })
    expect(splitTimelineDate('')).toEqual({ md: '', weekday: '' })
  })
})

describe('alertCountdown', () => {
  it('0 は本日締切', () => {
    expect(alertCountdown(0)).toBe('本日締切')
  })

  it('正値はあとN日', () => {
    expect(alertCountdown(3)).toBe('あと3日')
    expect(alertCountdown(7)).toBe('あと7日')
  })

  it('負値は防御的に N日超過（アラートの対象外だが握り潰さない）', () => {
    expect(alertCountdown(-2)).toBe('2日超過')
  })
})

describe('deriveHomeEventStatus', () => {
  const TODAY = '2026-09-21'
  const YESTERDAY = '2026-09-20'
  const TOMORROW = '2026-09-22'

  function input(overrides: Partial<HomeEventStatusInput> = {}): HomeEventStatusInput {
    return {
      rosterSettled: false,
      entryStatus: 'not_applied',
      internalDeadline: TOMORROW,
      entryDeadline: null,
      ...overrides,
    }
  }

  it('確定名簿ありなら entry_status・締切にかかわらず名簿確定（AC-1）', () => {
    const entryStatuses = ['not_applied', 'applied', 'not_applying'] as const
    const deadlines = [YESTERDAY, TODAY, TOMORROW, null]
    for (const entryStatus of entryStatuses) {
      for (const internalDeadline of deadlines) {
        for (const entryDeadline of deadlines) {
          expect(
            deriveHomeEventStatus(
              input({ rosterSettled: true, entryStatus, internalDeadline, entryDeadline }),
              TODAY,
            ),
          ).toBe('roster_confirmed')
        }
      }
    }
  })

  it('確定名簿なし ∧ applied は基準締切が未来でも申込済（AC-2）', () => {
    expect(
      deriveHomeEventStatus(input({ entryStatus: 'applied', internalDeadline: TOMORROW }), TODAY),
    ).toBe('applied')
    // 締切後に申し込んだ（通常の流れ）場合も申込済
    expect(
      deriveHomeEventStatus(input({ entryStatus: 'applied', internalDeadline: YESTERDAY }), TODAY),
    ).toBe('applied')
  })

  it('未申込 ∧ 基準締切 = 昨日は締切済（AC-3）', () => {
    expect(deriveHomeEventStatus(input({ internalDeadline: YESTERDAY }), TODAY)).toBe('closed')
  })

  it('未申込 ∧ 基準締切 = 今日・明日は参加受付中（締切当日は受付中。AC-4）', () => {
    expect(deriveHomeEventStatus(input({ internalDeadline: TODAY }), TODAY)).toBe('open')
    expect(deriveHomeEventStatus(input({ internalDeadline: TOMORROW }), TODAY)).toBe('open')
  })

  it('会内締切が null なら申込締切で判定し、両方 null なら参加受付中（AC-5）', () => {
    expect(
      deriveHomeEventStatus(input({ internalDeadline: null, entryDeadline: YESTERDAY }), TODAY),
    ).toBe('closed')
    expect(
      deriveHomeEventStatus(input({ internalDeadline: null, entryDeadline: TOMORROW }), TODAY),
    ).toBe('open')
    expect(
      deriveHomeEventStatus(input({ internalDeadline: null, entryDeadline: null }), TODAY),
    ).toBe('open')
  })

  it('会内締切と申込締切が両方あれば会内締切で判定する（AC-6）', () => {
    expect(
      deriveHomeEventStatus(
        input({ internalDeadline: YESTERDAY, entryDeadline: TOMORROW }),
        TODAY,
      ),
    ).toBe('closed')
    expect(
      deriveHomeEventStatus(
        input({ internalDeadline: TOMORROW, entryDeadline: YESTERDAY }),
        TODAY,
      ),
    ).toBe('open')
  })

  it('not_applying は日付どおり（締切前=参加受付中／締切後=締切済。AC-7）', () => {
    expect(
      deriveHomeEventStatus(
        input({ entryStatus: 'not_applying', internalDeadline: TOMORROW }),
        TODAY,
      ),
    ).toBe('open')
    expect(
      deriveHomeEventStatus(
        input({ entryStatus: 'not_applying', internalDeadline: YESTERDAY }),
        TODAY,
      ),
    ).toBe('closed')
  })
})

describe('HOME_EVENT_STATUS_PILL', () => {
  it('4ステータスの文言とトーンが requirements §3.2.4 どおり（AC-10）', () => {
    expect(HOME_EVENT_STATUS_PILL).toEqual({
      roster_confirmed: { label: '名簿確定', tone: 'brand' },
      applied: { label: '申込済', tone: 'info' },
      open: { label: '参加受付中', tone: 'warn' },
      closed: { label: '締切済', tone: 'neutral' },
    })
  })
})

describe('INITIAL_VISIBLE_COUNT', () => {
  it('タイムラインの初期表示は4件', () => {
    expect(INITIAL_VISIBLE_COUNT).toBe(4)
  })
})
