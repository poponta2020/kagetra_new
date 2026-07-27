import { describe, expect, it } from 'vitest'
import {
  INITIAL_VISIBLE_COUNT,
  alertCountdown,
  confidenceLabel,
  splitTimelineDate,
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

describe('confidenceLabel', () => {
  it('confirmed は確定 / hoped は希望', () => {
    expect(confidenceLabel('confirmed')).toBe('確定')
    expect(confidenceLabel('hoped')).toBe('希望')
  })
})

describe('INITIAL_VISIBLE_COUNT', () => {
  it('タイムラインの初期表示は4件', () => {
    expect(INITIAL_VISIBLE_COUNT).toBe(4)
  })
})
