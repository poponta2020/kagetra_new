import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import { createEvent, createUser } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

// entry-overdue-alert タスク4: /events 一覧は entry_status='not_applying' を
// クエリ条件で除外する（取得後フィルタにすると件数表示・フィルタ・並び替えの
// 母集団がずれるため）。/events-archive は変更しないが、開催日経過後は
// not_applying の大会も従来どおり並ぶことを回帰として確認する。

vi.mock('@/auth', () => mockAuthModule())

const { default: EventsPage } = await import('./page')
const { default: EventsArchivePage } = await import('../events-archive/page')

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

// closeTestDb はファイル単位で 1 回だけ。describe ごとに afterAll で閉じると、
// 先に走った describe がプールを落として後続の describe が接続できなくなる。
beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('/events 一覧 — entry_status=not_applying の除外 (AC-14)', () => {
  it('not_applying は一覧に出ず、not_applied/applied は従来どおり出る', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const future = addDays(todayJst(), 10)

    await createEvent({
      title: '未申込大会',
      eventDate: future,
      entryStatus: 'not_applied',
    })
    await createEvent({
      title: '申込済大会',
      eventDate: future,
      entryStatus: 'applied',
    })
    await createEvent({
      title: '見送り大会',
      eventDate: future,
      entryStatus: 'not_applying',
    })

    const ui = await EventsPage()
    render(ui)

    expect(screen.getByText('未申込大会')).toBeDefined()
    expect(screen.getByText('申込済大会')).toBeDefined()
    expect(screen.queryByText('見送り大会')).toBeNull()
  })
})

describe('/events-archive — not_applying も従来どおり表示される（回帰）', () => {
  it('開催日経過後は not_applying の大会も並ぶ', async () => {
    const past = addDays(todayJst(), -10)

    await createEvent({
      title: '過去の見送り大会',
      eventDate: past,
      entryStatus: 'not_applying',
    })

    const ui = await EventsArchivePage()
    render(ui)

    expect(screen.getByText('過去の見送り大会')).toBeDefined()
  })
})
