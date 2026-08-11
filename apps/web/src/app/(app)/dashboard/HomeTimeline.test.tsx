import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Grade } from '@kagetra/shared/types'
import { HomeTimeline } from './HomeTimeline'
import type {
  HomeEntrant,
  HomeTimelineData,
  HomeTimelineEvent,
} from './home-timeline-types'

/**
 * ホーム「会の出場予定」の描画（空状態・もっと見る展開・自分ハイライト・
 * アラート領域の消失）。実装手順書 タスク3。
 *
 * サーバー側の組み立ては page.test.tsx、純関数は home-timeline-utils.test.ts。
 */

const VIEWER_ID = 'viewer-1'

function entrant(
  surname: string,
  grade: Grade | null,
  userId?: string,
  isGuest = false,
): HomeEntrant {
  return { userId: userId ?? `u-${surname}`, surname, grade, isGuest }
}

function event(
  eventId: number,
  overrides: Partial<HomeTimelineEvent> = {},
): HomeTimelineEvent {
  return {
    eventId,
    displayName: `大会${eventId}`,
    eventDate: `2026-08-${String(eventId).padStart(2, '0')}`,
    venue: null,
    confidence: 'confirmed',
    entrants: [entrant('佐々木', 'A')],
    ...overrides,
  }
}

function data(overrides: Partial<HomeTimelineData> = {}): HomeTimelineData {
  return {
    todayStr: '2026-07-28',
    viewerUserId: VIEWER_ID,
    today: [],
    upcoming: [],
    alerts: [],
    ...overrides,
  }
}

/** 出場者チップ（姓で引く）。 */
function chipOf(surname: string): HTMLElement {
  const chip = Array.from(document.querySelectorAll('span')).find(
    (el) =>
      el.className.includes('inline-flex') &&
      (el.textContent ?? '').startsWith(surname),
  )
  if (!chip) throw new Error(`chip not found: ${surname}`)
  return chip
}

describe('HomeTimeline', () => {
  describe('空状態', () => {
    it('出場予定ゼロなら「出場予定の大会はありません」', () => {
      render(<HomeTimeline data={data()} />)
      expect(screen.getByText('出場予定の大会はありません')).toBeTruthy()
      expect(screen.queryByText('この先の出場予定はありません')).toBeNull()
    })

    it('今日カードだけあって upcoming が空なら「この先の出場予定はありません」', () => {
      render(<HomeTimeline data={data({ today: [event(1)] })} />)
      expect(screen.getByText('この先の出場予定はありません')).toBeTruthy()
      expect(screen.queryByText('出場予定の大会はありません')).toBeNull()
    })
  })

  describe('未回答アラート', () => {
    it('0 件なら朱の行を描かない（空枠を残さない）', () => {
      render(<HomeTimeline data={data({ upcoming: [event(1)] })} />)
      expect(screen.queryByText('未回答')).toBeNull()
    })

    it('件数ぶんの行を描き、カウントダウン文言を出す', () => {
      render(
        <HomeTimeline
          data={data({
            upcoming: [event(1)],
            alerts: [
              {
                eventId: 9,
                displayName: '石狩CD',
                baseDeadline: '2026-07-31',
                daysLeft: 3,
              },
              {
                eventId: 10,
                displayName: '大通杯A',
                baseDeadline: '2026-07-28',
                daysLeft: 0,
              },
            ],
          })}
        />,
      )
      expect(screen.getAllByText('未回答')).toHaveLength(2)
      expect(screen.getByText('あと3日')).toBeTruthy()
      expect(screen.getByText('本日締切')).toBeTruthy()
    })
  })

  describe('もっと見る', () => {
    it('4 件以下なら「もっと見る」を出さない', () => {
      render(
        <HomeTimeline data={data({ upcoming: [1, 2, 3, 4].map((i) => event(i)) })} />,
      )
      expect(screen.queryByRole('button')).toBeNull()
      expect(screen.getByText('大会4')).toBeTruthy()
    })

    it('5 件なら初期 4 件 +「もっと見る（残り1件）」、押すと 5 件出てボタンが消える', () => {
      render(
        <HomeTimeline
          data={data({ upcoming: [1, 2, 3, 4, 5].map((i) => event(i)) })}
        />,
      )
      expect(screen.queryByText('大会5')).toBeNull()

      const button = screen.getByRole('button', { name: 'もっと見る（残り1件）' })
      fireEvent.click(button)

      expect(screen.getByText('大会5')).toBeTruthy()
      expect(screen.queryByRole('button')).toBeNull()
    })
  })

  describe('自分ハイライト', () => {
    it('viewerUserId と一致するチップにだけ自分用の塗りが付く', () => {
      render(
        <HomeTimeline
          data={data({
            upcoming: [
              event(1, {
                entrants: [
                  entrant('宮下', 'C', VIEWER_ID),
                  entrant('井上', 'C'),
                ],
              }),
            ],
          })}
        />,
      )

      const mine = chipOf('宮下')
      const other = chipOf('井上')
      expect(mine.className).toContain('bg-brand')
      expect(mine.className).toContain('text-ink-on-brand')
      expect(other.className).not.toContain('bg-brand')
      expect(other.className).toContain('bg-surface-alt')
    })

    it('viewerUserId が null なら誰も自分扱いにしない', () => {
      render(
        <HomeTimeline
          data={data({
            viewerUserId: null,
            upcoming: [
              event(1, { entrants: [entrant('宮下', 'C', VIEWER_ID)] }),
            ],
          })}
        />,
      )
      expect(chipOf('宮下').className).not.toContain('bg-brand')
    })

    it('userId が null の名簿行チップは自分扱いにならない', () => {
      render(
        <HomeTimeline
          data={data({
            viewerUserId: null,
            upcoming: [
              event(1, {
                entrants: [
                  { userId: null, surname: '他会', grade: 'B', isGuest: false },
                ],
              }),
            ],
          })}
        />,
      )
      expect(chipOf('他会').className).not.toContain('bg-brand')
    })
  })

  describe('チップ・行の中身', () => {
    // guest-role R5/AC-21/AC-22: 出場者チップにゲスト印を付ける（events/[id]
    // の参加者欄と同じ最小表現）。
    it('isGuest なチップにはゲスト印が付き、会員のチップには付かない', () => {
      render(
        <HomeTimeline
          data={data({
            upcoming: [
              event(1, {
                entrants: [
                  entrant('宮下', 'C'),
                  entrant('外来', 'C', undefined, true),
                ],
              }),
            ],
          })}
        />,
      )
      expect(chipOf('宮下').textContent).toBe('宮下C')
      expect(chipOf('外来').textContent).toBe('外来Cゲスト')
    })

    it('級が null の会員は級の添え字を出さない（チップ自体は出す）', () => {
      render(
        <HomeTimeline
          data={data({ upcoming: [event(1, { entrants: [entrant('神谷', null)] })] })}
        />,
      )
      expect(chipOf('神谷').textContent).toBe('神谷')
    })

    it('確度ピルは 確定 / 希望 を出し分ける', () => {
      render(
        <HomeTimeline
          data={data({
            upcoming: [
              event(1, { confidence: 'confirmed' }),
              event(2, { confidence: 'hoped' }),
            ],
          })}
        />,
      )
      expect(screen.getByText('確定')).toBeTruthy()
      expect(screen.getByText('希望')).toBeTruthy()
    })

    it('今日カードは会場があるときだけ会場行を出す', () => {
      const { unmount } = render(
        <HomeTimeline
          data={data({ today: [event(1, { venue: '市民体育センター' })] })}
        />,
      )
      expect(screen.getByText('本日')).toBeTruthy()
      expect(screen.getByText('市民体育センター')).toBeTruthy()
      unmount()

      render(<HomeTimeline data={data({ today: [event(1, { venue: null })] })} />)
      expect(screen.queryByText('市民体育センター')).toBeNull()
    })

    it('タイムライン行には会場を出さない（顔ぶれの面積を食うため）', () => {
      render(
        <HomeTimeline
          data={data({ upcoming: [event(1, { venue: '市民体育センター' })] })}
        />,
      )
      expect(screen.queryByText('市民体育センター')).toBeNull()
    })

    it('行タップの遷移先は /events/{id}', () => {
      render(<HomeTimeline data={data({ upcoming: [event(7)] })} />)
      const anchor = screen.getByText('大会7').closest('a')
      expect(anchor?.getAttribute('href')).toBe('/events/7')
    })

    it('日付レールに eventDate の M/D と曜日が出る', () => {
      // event(7).eventDate === '2026-08-07'（金）。eventDate がレールまで
      // 配線されていることを固定する（splitTimelineDate 自体の検証は
      // home-timeline-utils.test.ts）。
      render(<HomeTimeline data={data({ upcoming: [event(7)] })} />)
      expect(screen.getByText('8/7')).toBeTruthy()
      expect(screen.getByText('金')).toBeTruthy()
    })
  })
})
