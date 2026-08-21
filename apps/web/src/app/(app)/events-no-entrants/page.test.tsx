import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createEvent, createEventAttendance, createUser } from '@/test-utils/seed'

// events-no-entrants: 会内締切を過ぎたのに申込者が 1 人もいなかったために
// `/events` から消えた（かつ開催日前なので `/events-archive` にも出ない）
// 大会を拾うページ。requirements §3.2 の掲載条件 4 つと §3.3 のカード表示を
// 実 DB + RSC 直呼びで固定する。
//
// このページは `auth()` を読まない（掲載対象が閲覧者で変わらない仕様）ので
// auth モックは張らない。ゲートは middleware 側（`isGuestAllowedPath` に
// 追加しないこと自体が仕様）で、AC-14 は lib/guest-access.test.ts が持つ。

const { default: EventsNoEntrantsPage } = await import('./page')

/** JST today as YYYY-MM-DD, matching the page's own todayStr computation. */
function todayJst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

/** Add `days` calendar days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('/events-no-entrants — 掲載対象 (AC-4〜AC-8, AC-22)', () => {
  it('締切超過・申込者0名・開催日前・not_applying でない大会だけが並ぶ', async () => {
    const today = todayJst()
    const future = addDays(today, 10)
    const yesterday = addDays(today, -1)
    const member = await createUser({ role: 'member' })

    // 掲載される: 締切超過 × 出欠行なし
    await createEvent({
      title: '誰も申し込まなかった大会',
      eventDate: future,
      internalDeadline: yesterday,
    })

    // AC-22: 全員が「不参加」と回答した大会も参加者 0 名として掲載する。
    // ⚠️ createEventAttendance の attend 既定は true なので明示する。
    const allDeclined = await createEvent({
      title: '全員不参加の大会',
      eventDate: future,
      internalDeadline: yesterday,
    })
    await createEventAttendance({
      eventId: allDeclined.id,
      userId: member.id,
      attend: false,
    })

    // AC-5: 会内締切が未設定（NULL）
    await createEvent({
      title: '締切未設定の大会',
      eventDate: future,
      internalDeadline: null,
    })

    // 締切当日（daysLeft=0 は past ではない）
    await createEvent({
      title: '締切本日の大会',
      eventDate: future,
      internalDeadline: today,
    })

    // 締切が未来
    await createEvent({
      title: '締切前の大会',
      eventDate: future,
      internalDeadline: addDays(today, 3),
    })

    // AC-6: 参加者が 1 名以上いる締切超過の大会
    const attended = await createEvent({
      title: '申込者がいた大会',
      eventDate: future,
      internalDeadline: yesterday,
    })
    const attendee = await createUser({ role: 'member' })
    await createEventAttendance({
      eventId: attended.id,
      userId: attendee.id,
      attend: true,
    })

    // AC-7: entry_status='not_applying'（管理者が明示的に見送った大会）
    await createEvent({
      title: '見送り大会',
      eventDate: future,
      internalDeadline: yesterday,
      entryStatus: 'not_applying',
    })

    // AC-8: 開催日が過去（/events-archive の担当）
    await createEvent({
      title: '開催済みの大会',
      eventDate: addDays(today, -3),
      internalDeadline: addDays(today, -10),
    })

    render(await EventsNoEntrantsPage())

    expect(screen.getByText('誰も申し込まなかった大会')).toBeDefined()
    expect(screen.getByText('全員不参加の大会')).toBeDefined()

    expect(screen.queryByText('締切未設定の大会')).toBeNull()
    expect(screen.queryByText('締切本日の大会')).toBeNull()
    expect(screen.queryByText('締切前の大会')).toBeNull()
    expect(screen.queryByText('申込者がいた大会')).toBeNull()
    expect(screen.queryByText('見送り大会')).toBeNull()
    expect(screen.queryByText('開催済みの大会')).toBeNull()
  })

  it('「一部だけ不参加」でも attend=true が 1 件あれば掲載しない (AC-6)', async () => {
    const today = todayJst()
    const event = await createEvent({
      title: '1名だけ参加の大会',
      eventDate: addDays(today, 10),
      internalDeadline: addDays(today, -1),
    })
    const yes = await createUser({ role: 'member' })
    const no = await createUser({ role: 'member' })
    await createEventAttendance({ eventId: event.id, userId: yes.id, attend: true })
    await createEventAttendance({ eventId: event.id, userId: no.id, attend: false })

    render(await EventsNoEntrantsPage())

    expect(screen.queryByText('1名だけ参加の大会')).toBeNull()
    expect(screen.getByText('申込者なしで締切済の大会はありません')).toBeDefined()
  })
})

describe('/events-no-entrants — 並び順 (AC-9)', () => {
  it('開催日の昇順で並ぶ', async () => {
    const today = todayJst()
    const deadline = addDays(today, -1)

    await createEvent({
      title: '3番目の大会',
      eventDate: addDays(today, 30),
      internalDeadline: deadline,
    })
    await createEvent({
      title: '1番目の大会',
      eventDate: addDays(today, 5),
      internalDeadline: deadline,
    })
    await createEvent({
      title: '2番目の大会',
      eventDate: addDays(today, 12),
      internalDeadline: deadline,
    })

    const { container } = render(await EventsNoEntrantsPage())

    const titles = Array.from(container.querySelectorAll('a[href^="/events/"]')).map(
      (a) => a.querySelector('span')?.textContent,
    )
    expect(titles).toEqual(['1番目の大会', '2番目の大会', '3番目の大会'])
  })
})

describe('/events-no-entrants — 0 件表示 (AC-10)', () => {
  it('対象が無いとき「申込者なしで締切済の大会はありません」が出る', async () => {
    render(await EventsNoEntrantsPage())

    expect(screen.getByText('申込者なしで締切済の大会はありません')).toBeDefined()
    // 見出しと戻り導線は 0 件でも残す
    expect(screen.getByText('申込者なしで締切済の大会')).toBeDefined()
    expect(screen.getByText('現在の大会 →').getAttribute('href')).toBe('/events')
  })
})

describe('/events-no-entrants — カードの表示項目 (AC-11)', () => {
  it('大会名・公認 Pill・開催日・場所・StatusPill・会内締切 M/D を持ち /events/[id] へリンクする', async () => {
    const today = todayJst()
    const eventDate = addDays(today, 10)
    const internalDeadline = addDays(today, -1)

    const event = await createEvent({
      title: '中止になった大会',
      eventDate,
      internalDeadline,
      location: '札幌市中央体育館',
      official: true,
      status: 'cancelled',
    })

    render(await EventsNoEntrantsPage())

    expect(screen.getByText('中止になった大会')).toBeDefined()
    expect(screen.getByText('公認')).toBeDefined()
    expect(screen.getByText(eventDate)).toBeDefined()
    expect(screen.getByText('札幌市中央体育館')).toBeDefined()
    // StatusPill は published では何も描画しない実装なので、中止で確認する
    expect(screen.getByText('中止')).toBeDefined()

    // 「参加 0名」ではなく掲載理由である会内締切を M/D で出す
    const [, month, day] = internalDeadline.split('-') as [string, string, string]
    expect(
      screen.getByText(`会内締切 ${Number(month)}/${Number(day)}`),
    ).toBeDefined()
    expect(screen.queryByText(/参加\s*0\s*名/)).toBeNull()

    const card = screen.getByText('中止になった大会').closest('a')
    expect(card?.getAttribute('href')).toBe(`/events/${event.id}`)
  })

  it('公認でない大会には「公認」Pill が出ない', async () => {
    const today = todayJst()
    await createEvent({
      title: '非公認大会',
      eventDate: addDays(today, 10),
      internalDeadline: addDays(today, -1),
      official: false,
    })

    render(await EventsNoEntrantsPage())

    expect(screen.getByText('非公認大会')).toBeDefined()
    expect(screen.queryByText('公認')).toBeNull()
  })
})
