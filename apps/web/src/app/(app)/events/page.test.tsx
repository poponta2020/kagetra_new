import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { closeTestDb, truncateAll } from '@/test-utils/db'
import {
  createEvent,
  createEventAttendance,
  createGuest,
  createUser,
} from '@/test-utils/seed'
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

describe('/events 一覧 — 締切超過行の可視性 (AC-2)', () => {
  it('自分が attend=true の締切済大会は表示され、他人だけの締切済大会は表示されない', async () => {
    const viewer = await createUser({ role: 'member', name: '閲覧者太郎' })
    const other = await createUser({ role: 'member', name: '他人花子' })
    await setAuthSession({ id: viewer.id, role: 'member' })

    const future = addDays(todayJst(), 10)
    const yesterday = addDays(todayJst(), -1)

    const myEvent = await createEvent({
      title: '自分参加済み大会',
      eventDate: future,
      internalDeadline: yesterday,
    })
    const othersEvent = await createEvent({
      title: '他人だけ参加大会',
      eventDate: future,
      internalDeadline: yesterday,
    })

    await createEventAttendance({ eventId: myEvent.id, userId: viewer.id, attend: true })
    await createEventAttendance({ eventId: othersEvent.id, userId: other.id, attend: true })

    const ui = await EventsPage()
    render(ui)

    expect(screen.getByText('自分参加済み大会')).toBeDefined()
    expect(screen.queryByText('他人だけ参加大会')).toBeNull()
  })

  // AC-18（回帰・/events 側の半分）: 参加者が誰も attend=true していない
  // （出欠行が無い、または全員 attend=false）締切超過の大会は、閲覧者が
  // 誰であっても /events から消える（isRowVisible は viewerAttending=false
  // の一択になるため）。もう半分（/events-no-entrants にだけ出る）は
  // events-no-entrants page 側のテストが担当する。
  it('参加者0名で締切超過の大会は、閲覧者を問わず /events に出ない', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    const future = addDays(todayJst(), 10)
    const yesterday = addDays(todayJst(), -1)

    await createEvent({
      title: '誰も申し込まなかった大会',
      eventDate: future,
      internalDeadline: yesterday,
    })

    const ui = await EventsPage()
    render(ui)

    expect(screen.queryByText('誰も申し込まなかった大会')).toBeNull()
  })
})

describe('/events 一覧 — 参加者の苗字は全員分表示される (AC-6)', () => {
  it('参加者6名以上でも「他N名」が出ず全員分の苗字が描画される', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const future = addDays(todayJst(), 10)

    const event = await createEvent({
      title: '大人数参加大会',
      eventDate: future,
    })

    const surnames = ['佐藤一', '鈴木二', '高橋三', '田中四', '伊藤五', '渡辺六', '山本七']
    for (const name of surnames) {
      const participant = await createUser({ name })
      await createEventAttendance({ eventId: event.id, userId: participant.id, attend: true })
    }

    const ui = await EventsPage()
    // 苗字が個別 span で描画されるか結合文字列になるかは EventListClient
    // （並行作業で書き換え中）の描画方式次第なので、markup 構造ではなく
    // 描画結果に含まれるテキスト全体（container.textContent）で判定する。
    const { container } = render(ui)

    for (const name of surnames) {
      expect(container.textContent).toContain(name)
    }
    // リデザインで「参加 N名」の語は廃止され、人数＋「名」だけになった（AC-5）。
    expect(container.textContent).toContain('7名')
    expect(container.textContent).not.toMatch(/他\d+名/)
  })
})

// event-list-month-grouping §2-5/§2-7: ページ見出し行を削除し、「過去の大会」
// と「新規作成」はリスト末尾のフッター行へ移す。フッターはソートにも 0 件表示にも
// 左右されず必ず出す（見出し行が無くなった以上、ここが唯一のアーカイブ導線）。
describe('/events 一覧 — 見出し行の削除とフッター行', () => {
  it('管理者: h1 が無く、リストの後ろに「過去の大会 →」と「新規作成」が並ぶ', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    await createEvent({ title: 'フッター確認大会', eventDate: addDays(todayJst(), 10) })

    const { container } = render(await EventsPage())

    expect(container.querySelector('h1')).toBeNull()
    expect(screen.queryByText('大会申込')).toBeNull()

    const archive = screen.getByText('過去の大会 →')
    const create = screen.getByText('新規作成')
    expect(archive.getAttribute('href')).toBe('/events-archive')
    expect(create.getAttribute('href')).toBe('/events/new')

    // リスト末尾＝行より後ろ（DOCUMENT_POSITION_FOLLOWING = 4）
    const row = screen.getByText('フッター確認大会')
    expect(row.compareDocumentPosition(archive) & 4).toBeTruthy()
  })

  it('一般会員: 「新規作成」は出ないが「過去の大会 →」は残る', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    await createEvent({ title: '会員から見る大会', eventDate: addDays(todayJst(), 10) })

    render(await EventsPage())

    expect(screen.getByText('過去の大会 →')).toBeDefined()
    expect(screen.queryByText('新規作成')).toBeNull()
  })

  it('イベント 0 件でもフッター行は残る（アーカイブ導線を落とさない）', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })

    render(await EventsPage())

    expect(screen.getByText('現在の大会はありません')).toBeDefined()
    expect(screen.getByText('過去の大会 →')).toBeDefined()
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

// events-no-entrants AC-12 / AC-13: 締切超過で一覧から消えた「申込者 0 名」の
// 大会を辿る唯一の導線をフッター 2 段目に置く。行き先 `/events-no-entrants` は
// ゲストに開いていない（`isGuestAllowedPath` に載せない＝middleware が /403 へ
// 飛ばす）ので、ゲストにはリンク自体を描画しない。
describe('/events 一覧 — 「申込者なしで締切済 →」導線 (AC-12 / AC-13)', () => {
  it('管理者: リンクがあり href が /events-no-entrants である', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })

    render(await EventsPage())

    const link = screen.getByText('申込者なしで締切済 →')
    expect(link.getAttribute('href')).toBe('/events-no-entrants')
  })

  it('一般会員: リンクがあり href が /events-no-entrants である', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })

    render(await EventsPage())

    const link = screen.getByText('申込者なしで締切済 →')
    expect(link.getAttribute('href')).toBe('/events-no-entrants')
  })

  it('ゲスト: リンクは描画されないが「過去の大会 →」は残る', async () => {
    const guest = await createGuest()
    await setAuthSession({ id: guest.id, role: 'guest' })

    render(await EventsPage())

    expect(screen.queryByText('申込者なしで締切済 →')).toBeNull()
    expect(screen.getByText('過去の大会 →')).toBeDefined()
  })
})

// AC-15: 見出し・戻りリンクの文言を「大会」へ統一する。
describe('/events-archive — 見出し・戻りリンクの文言 (AC-15)', () => {
  it('h1 が「過去の大会」、戻りリンクが「現在の大会 →」で href が /events である', async () => {
    const past = addDays(todayJst(), -10)
    await createEvent({ title: '過去の確認大会', eventDate: past })

    const { container } = render(await EventsArchivePage())

    expect(container.querySelector('h1')?.textContent).toBe('過去の大会')
    const back = screen.getByText('現在の大会 →')
    expect(back.getAttribute('href')).toBe('/events')
  })

  it('0 件のとき「過去の大会はまだありません」が表示される', async () => {
    render(await EventsArchivePage())

    expect(screen.getByText('過去の大会はまだありません')).toBeDefined()
  })
})

// guest-role AC-23: 一覧の参加人数はゲストを含む（大会詳細の人数と食い違わせ
// ないため。requirements R5）。一覧側の集計は元から attend=true の素通しなので
// **実装変更は無い** —— この describe は「将来ここに role フィルタを足すと
// 詳細と数字がずれる」ことを固定するための回帰テストである。
// 姓の羅列にゲスト印は付けない（情報密度を優先。誰がゲストかは詳細で分かる）。
describe('guest-role AC-23: 一覧の参加人数にゲストを含む', () => {
  it('/events 一覧の人数がゲストを含み、姓の羅列にはゲスト印を付けない', async () => {
    const viewer = await createUser({ name: '閲覧 太郎', grade: 'C' })
    await setAuthSession({ id: viewer.id, role: 'member' })

    const event = await createEvent({
      title: 'ゲスト混在大会',
      eventDate: addDays(todayJst(), 10),
      eligibleGrades: ['C'],
    })
    const member = await createUser({ name: '会員 花子', grade: 'C' })
    const guest = await createGuest({ name: '客人 太郎', grade: 'C' })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })
    await createEventAttendance({ eventId: event.id, userId: guest.id, attend: true })

    render(await EventsPage())

    // 会員1名 + ゲスト1名 = 2名。
    // `getByText('2')` にすると、開催日が「◯月2日」になる日（＝毎月2日の10日前）
    // にカードの日付表示「2」と衝突して落ちる（日付依存の flaky）。人数バッジは
    // `<span>2<small>名</small></span>` なので textContent が「2名」の要素で一意に取る。
    expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '2名'),
    ).toBeDefined()
    expect(screen.getByText('会員')).toBeDefined()
    expect(screen.getByText('客人')).toBeDefined()
    // 姓の羅列にゲスト印は出さない
    expect(screen.queryByText('ゲスト')).toBeNull()
  })

  it('/events-archive の人数もゲストを含む', async () => {
    const viewer = await createUser({ name: '閲覧 太郎', grade: 'C' })
    await setAuthSession({ id: viewer.id, role: 'member' })

    const event = await createEvent({
      title: '過去のゲスト混在大会',
      eventDate: addDays(todayJst(), -10),
      eligibleGrades: ['C'],
    })
    const member = await createUser({ name: '会員 花子', grade: 'C' })
    const guest = await createGuest({ name: '客人 太郎', grade: 'C' })
    await createEventAttendance({ eventId: event.id, userId: member.id, attend: true })
    await createEventAttendance({ eventId: event.id, userId: guest.id, attend: true })

    render(await EventsArchivePage())

    expect(screen.getByText('参加 2名')).toBeDefined()
  })
})
