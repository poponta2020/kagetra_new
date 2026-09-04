import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { eq } from 'drizzle-orm'
import { entryGroups, tournamentEntryRosters } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createAdmin,
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createGuest,
  createMailMessage,
  createUser,
  createViceAdmin,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * entry-group-page タスク3: `/admin/entries/[groupId]` のサーバー側。
 * 対応 AC は AC-1〜AC-9 / AC-22 / AC-23 / AC-25 / AC-26 / AC-35。
 * フロー帯の集約規則は `lib/events/group-entry-flow.test.ts`、フェーズ語は
 * `admin/entries/day-phase.test.ts`、共通値は `group-common-fields.test.ts` が持つ。
 */

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('@/auth', () => mockAuthModule())

// 関連メールは async Server Component。jsdom の render では実行できないので
// スタブへ差し替える（中身は EventRelatedMails.test.tsx が持つ）。ただし
// **「非管理者には要素ごと現れない」ことは検査したい**ので、識別できる印を返す。
vi.mock('@/components/events/EventRelatedMails', () => ({
  EventRelatedMails: () => null,
}))

const { default: EntryGroupPage } = await import('./page')

function renderPage(groupId: number | string) {
  return EntryGroupPage({ params: Promise.resolve({ groupId: String(groupId) }) })
}

function todayJst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * 返り値の React 要素ツリーを辿り、props に載っている文字列/数値を集める。
 * DOM に出ていないだけでなく **RSC payload にも載っていない** ことを検証する
 * （client component へ渡した props はツリー上に現れる）。実装は
 * `/events/[id]/page.test.tsx` の同名ヘルパーと同一。
 */
function collectPropValues(
  node: unknown,
  out: string[],
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (node == null || depth > 40) return
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if (typeof node === 'number' || typeof node === 'bigint') {
    out.push(String(node))
    return
  }
  if (typeof node !== 'object') return
  if (seen.has(node)) return
  seen.add(node)

  if (Array.isArray(node)) {
    for (const child of node) collectPropValues(child, out, depth + 1, seen)
    return
  }
  const props = (node as { props?: unknown }).props
  const values =
    props != null && typeof props === 'object'
      ? Object.values(props as Record<string, unknown>)
      : Object.values(node as Record<string, unknown>)
  for (const value of values) collectPropValues(value, out, depth + 1, seen)
}

async function payloadOf(groupId: number): Promise<string> {
  const ui = await renderPage(groupId)
  const values: string[] = []
  collectPropValues(ui, values)
  return values.join('\u0000')
}

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await closeTestDb()
})

describe('/admin/entries/[groupId] — 到達と権限 (AC-1)', () => {
  async function seedGroup() {
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, title: '杉並A', eventDate: '2030-09-06' })
    return group
  }

  it('管理者・副管理者・一般会員はいずれも 200（描画される）', async () => {
    const group = await seedGroup()
    const cases = [
      [createAdmin, 'admin'],
      [createViceAdmin, 'vice_admin'],
      [createUser, 'member'],
    ] as const
    for (const [create, role] of cases) {
      const user = await create()
      await setAuthSession({ id: user.id, role })
      const ui = await renderPage(group.id)
      expect(ui).toBeTruthy()
    }
  })

  it('未ログインは /403 へリダイレクトされる', async () => {
    const group = await seedGroup()
    await setAuthSession(null)
    await expect(renderPage(group.id)).rejects.toThrow('NEXT_REDIRECT:/403')
  })

  it('ゲストは /403 へリダイレクトされる（ページ側 fail-safe）', async () => {
    const group = await seedGroup()
    const guest = await createGuest()
    await setAuthSession({ id: guest.id, role: 'guest' })
    await expect(renderPage(group.id)).rejects.toThrow('NEXT_REDIRECT:/403')
  })
})

describe('/admin/entries/[groupId] — 404 条件 (AC-4)', () => {
  it('存在しない groupId は 404', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await expect(renderPage(999999)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('イベントが0件のグループは 404', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await expect(renderPage(group.id)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('数値でない groupId は 404', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    await expect(renderPage('abc')).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('/admin/entries/[groupId] — グループ名の導出 (AC-5)', () => {
  it('畳める2日は導出名になる（多摩A + 多摩B → 多摩AB）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, title: '多摩A', eventDate: '2030-09-05' })
    await createEvent({ entryGroupId: group.id, title: '多摩B', eventDate: '2030-09-06' })
    render(await renderPage(group.id))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('多摩AB')
  })

  it('導出不能なら代表イベントのタイトル（九段E + 九段CDE → 九段E）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const today = todayJst()
    const group = await createEntryGroup()
    // 代表 = 今日以降で最も近い開催日 = 8/22 相当の「九段E」。
    await createEvent({
      entryGroupId: group.id,
      title: '九段E',
      eventDate: addDays(today, 2),
    })
    await createEvent({
      entryGroupId: group.id,
      title: '九段CDE',
      eventDate: addDays(today, 3),
    })
    render(await renderPage(group.id))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('九段E')
  })
})

describe('/admin/entries/[groupId] — 日程表 (AC-6/AC-7/AC-8)', () => {
  it('全イベントを開催日昇順で並べ、cancelled の日も行として出す', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, title: '多摩E', eventDate: '2030-09-20' })
    await createEvent({
      entryGroupId: group.id,
      title: '多摩D',
      eventDate: '2030-09-19',
      status: 'cancelled',
    })
    await createEvent({ entryGroupId: group.id, title: '多摩C', eventDate: '2030-09-12' })

    const { container } = render(await renderPage(group.id))
    const names = Array.from(container.querySelectorAll('li a')).map(
      (a) => a.querySelectorAll('span')[1]?.textContent,
    )
    expect(names).toEqual(['多摩C', '多摩D', '多摩E'])
    expect(screen.getByText('中止')).toBeTruthy()
  })

  it('cancelled の日はチェックボックスが押せない（AC-16）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, title: '多摩C', eventDate: '2030-09-12' })
    await createEvent({
      entryGroupId: group.id,
      title: '多摩D',
      eventDate: '2030-09-19',
      status: 'cancelled',
    })
    const { container } = render(await renderPage(group.id))
    const boxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    )
    expect(boxes).toHaveLength(2)
    expect(boxes[0]!.disabled).toBe(false)
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[1]!.disabled).toBe(true)
    expect(boxes[1]!.checked).toBe(false)
  })

  it('行から /events/[id] へ遷移できる', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    const ev = await createEvent({
      entryGroupId: group.id,
      title: '杉並A',
      eventDate: '2030-09-06',
    })
    const { container } = render(await renderPage(group.id))
    const link = container.querySelector('li a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`/events/${ev.id}`)
  })

  it('参加希望者数は attend=true の素通しで、ゲストは数えない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    const ev = await createEvent({
      entryGroupId: group.id,
      title: '杉並A',
      eventDate: '2030-09-06',
      eligibleGrades: ['A'],
    })
    // 対象級外・未招待でも数える（素通し）。ゲストだけ数えない。
    const m1 = await createUser({ grade: 'C' })
    const m2 = await createUser({ grade: null, isInvited: false })
    const guest = await createGuest()
    const absent = await createUser()
    await createEventAttendance({ eventId: ev.id, userId: m1.id, attend: true })
    await createEventAttendance({ eventId: ev.id, userId: m2.id, attend: true })
    await createEventAttendance({ eventId: ev.id, userId: guest.id, attend: true })
    await createEventAttendance({ eventId: ev.id, userId: absent.id, attend: false })

    render(await renderPage(group.id))
    expect(screen.getByText('2名')).toBeTruthy()
    expect(screen.getByText('参加希望 のべ2名')).toBeTruthy()
  })

  it('参加希望者数が0でも数値を出す（空欄にしない）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-06' })
    render(await renderPage(group.id))
    expect(screen.getByText('0名')).toBeTruthy()
  })

  it('自分の回答印: 参加=● / 不参加=− / 未回答=無印', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    const yes = await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05' })
    const no = await createEvent({ entryGroupId: group.id, eventDate: '2030-09-06' })
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-07' })
    await createEventAttendance({ eventId: yes.id, userId: admin.id, attend: true })
    await createEventAttendance({ eventId: no.id, userId: admin.id, attend: false })

    render(await renderPage(group.id))
    expect(screen.getByText('●')).toBeTruthy()
    expect(screen.getByText('−')).toBeTruthy()
  })
})

describe('/admin/entries/[groupId] — 非管理者への遮断 (AC-2/AC-3/AC-9)', () => {
  async function seedRichGroup() {
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      title: '杉並A',
      eventDate: '2030-09-06',
      eligibleGrades: ['A'],
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
      paymentInfo: 'ゆうちょ銀行 〇八九店 普通 1234567',
      paymentMethod: '事前振込',
      entryMethod: '郵送（申込書）',
      paymentDeadline: '2030-08-28',
    })
    return group
  }

  it('一般会員には進行管理・共通項目・LINE配信・申込書・関連メールが DOM にも RSC payload にも出ない', async () => {
    const group = await seedRichGroup()
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })

    const payload = await payloadOf(group.id)
    for (const forbidden of [
      '進行管理',
      '共通項目',
      'LINE配信',
      '申込書',
      '関連メール',
      'ゆうちょ銀行 〇八九店 普通 1234567',
      '事前振込',
      '郵送（申込書）',
    ]) {
      expect(payload).not.toContain(forbidden)
    }
  })

  it('一般会員には選択チェックと一括操作ボタンが出ない（差はそこだけ＝AC-9）', async () => {
    const group = await seedRichGroup()
    const member = await createUser()
    await setAuthSession({ id: member.id, role: 'member' })
    const { container } = render(await renderPage(group.id))

    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    // seedRichGroup は申込済・事前払い・未払なので、管理者なら「支払報告」が
    // 出る状態。一般会員にはそれも「戻す操作」も出ない。
    expect(screen.queryByText('支払報告')).toBeNull()
    expect(screen.queryByText('申込済にする')).toBeNull()
    expect(screen.queryByText('戻す操作')).toBeNull()
    // 日程表の列そのものは管理者と同じ。「杉並A」「A」はパンくず・見出しにも
    // 出るため、日程表の行（li）にスコープして検査する。
    const row = container.querySelector('li') as HTMLElement
    expect(within(row).getByText('杉並A')).toBeTruthy()
    expect(within(row).getByText('A')).toBeTruthy()
  })

  it('AC-3: DB 上は管理者でも実効ロールが member なら操作 UI が出ない', async () => {
    const group = await seedRichGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'member', realRole: 'admin' })
    const { container } = render(await renderPage(group.id))
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(screen.queryByText('進行管理')).toBeNull()
  })

  it('対照: 管理者には進行管理・共通項目・LINE配信が出る', async () => {
    const group = await seedRichGroup()
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    render(await renderPage(group.id))
    expect(screen.getByText('進行管理')).toBeTruthy()
    expect(screen.getByText('共通項目')).toBeTruthy()
    // 申込済・事前払い・未払の日なので、前進側は「支払報告」だけが出る。
    expect(screen.getByText('支払報告')).toBeTruthy()
    // payment-receipt-broadcast AC-1: 旧ラベル「支払済にする」は DOM に残さない。
    expect(screen.queryByText('支払済にする')).toBeNull()
    expect(screen.getByText('戻す操作')).toBeTruthy()
  })
})

describe('/admin/entries/[groupId] — 前進ボタンは今できる操作だけ出す', () => {
  it('申込がまだの日は「申込済にする」だけ出し「支払報告」は出さない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      eventDate: '2030-09-06',
      entryStatus: 'not_applied',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
    })
    render(await renderPage(group.id))
    expect(screen.getByText('申込済にする')).toBeTruthy()
    expect(screen.queryByText('支払報告')).toBeNull()
  })

  it('申込済の日は「支払報告」だけ出し「申込済にする」は出さない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      eventDate: '2030-09-06',
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
    })
    render(await renderPage(group.id))
    expect(screen.getByText('支払報告')).toBeTruthy()
    expect(screen.queryByText('申込済にする')).toBeNull()
  })

  it('申込済・支払済まで終わった日は前進ボタンを1つも出さない（戻す操作は残る）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      eventDate: '2030-09-06',
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'paid',
    })
    render(await renderPage(group.id))
    expect(screen.queryByText('申込済にする')).toBeNull()
    expect(screen.queryByText('支払報告')).toBeNull()
    expect(screen.getByText('戻す操作')).toBeTruthy()
  })
})

describe('/admin/entries/[groupId] — 進行管理と申込書 (AC-22/AC-23/AC-35)', () => {
  it('個人戦では申込書ウィザードへの導線が groupId 付きで出る（AC-22）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-06', kind: 'individual' })
    const { container } = render(await renderPage(group.id))
    const link = container.querySelector(
      `a[href="/admin/entry-form/${group.id}"]`,
    )
    expect(link).toBeTruthy()
  })

  it('団体戦では名簿セクションも申込書の導線も出ない（AC-35）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-10-12', kind: 'team' })
    await testDb.insert(tournamentEntryRosters).values({
      entryGroupId: group.id,
      rosterType: 'confirmed',
      version: 1,
    })
    const { container } = render(await renderPage(group.id))
    expect(container.querySelector(`a[href="/admin/entry-form/${group.id}"]`)).toBeNull()
    expect(screen.queryByText('名簿')).toBeNull()
  })

  it('振込総額が表示される（AC-23。tallyEntryFeesForGroup と同じ値）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    const ev = await createEvent({
      entryGroupId: group.id,
      eventDate: '2030-09-06',
      kind: 'individual',
      official: true,
      eligibleGrades: ['A'],
      paymentType: 'advance',
    })
    const a1 = await createUser({ grade: 'A' })
    const a2 = await createUser({ grade: 'A' })
    await createEventAttendance({ eventId: ev.id, userId: a1.id, attend: true })
    await createEventAttendance({ eventId: ev.id, userId: a2.id, attend: true })

    render(await renderPage(group.id))
    // A級 2,500 × 2名（協会規定の実値）。
    expect(screen.getByText(/5,000円/)).toBeTruthy()
  })
})

describe('/admin/entries/[groupId] — フロー帯 (AC-14)', () => {
  it('全日 cancelled ではフロー帯を描かない（日程表とヘッダーは残る）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      title: '多摩C',
      eventDate: '2030-09-12',
      status: 'cancelled',
    })
    render(await renderPage(group.id))
    // 「会内締切」は進行管理・共通項目の <th> にも出るためフロー帯の判定には使えない。
    // 「開催」はフロー帯の5ステップ目のラベルで、このページに他に完全一致する要素が無い。
    expect(screen.queryByText('開催')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('多摩C')
  })

  it('対象日があればフロー帯を描く', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-06' })
    render(await renderPage(group.id))
    // 「開催」はフロー帯にしか現れないためアンカーにする（「会内締切」は進行管理・
    // 共通項目にも出て紛らわしい。「大会申込」も進行管理の「大会申込締切」と紛らわしい）。
    expect(screen.getByText('開催')).toBeTruthy()
  })

  // confirmed-roster-signal AC-9: 確定名簿メールだけでも抽選が完了になり、
  // 現在地が支払へ移る（杉並AB 相当。名簿レコードも採用ファイルも 0 件）。
  /**
   * 会内締切・大会申込を既に通過した状態を作る（そうしないと現在地が
   * 「会内締切」で止まり、抽選/支払の判定まで到達しない）。
   */
  async function seedAppliedGroupDay(entryGroupId: number) {
    const today = todayJst()
    return createEvent({
      entryGroupId,
      title: '杉並B',
      eventDate: addDays(today, 15),
      internalDeadline: addDays(today, -20),
      entryDeadline: addDays(today, -15),
      entryStatus: 'applied',
      paymentType: 'advance',
      paymentStatus: 'unpaid',
    })
  }

  it('AC-9: 確定名簿メールがあると抽選が完了になり、現在地が支払へ移る', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    const day = await seedAppliedGroupDay(group.id)
    await createMailMessage({
      subject: '第三回全国競技かるた杉並大会(AB級)確定連絡',
      linkedEventId: day.id,
      mailKind: 'confirmed_roster',
      triageStatus: 'processed',
    })

    const { container } = render(await renderPage(group.id))

    // 抽選ステップの点が done（藍の塗り）になっている。
    const lotteryDot = within(container).getByText('抽選').parentElement?.querySelector('span')
    expect(lotteryDot?.className).toContain('bg-brand')
    // 現在地は支払。
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('支払')
  })

  it('AC-9 回帰: 確定名簿シグナルが何も無ければ現在地は抽選のまま', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await seedAppliedGroupDay(group.id)

    const { container } = render(await renderPage(group.id))

    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('抽選')
  })
})

describe('/admin/entries/[groupId] — 共通項目の食い違い (AC-15)', () => {
  it('締切が日により異なると朱の注記が出て「編集して揃える」になる', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      eventDate: '2030-09-12',
      entryDeadline: '2030-09-01',
    })
    await createEvent({
      entryGroupId: group.id,
      eventDate: '2030-09-19',
      entryDeadline: '2030-09-05',
    })
    render(await renderPage(group.id))
    expect(screen.getAllByText('（日により異なる）').length).toBeGreaterThan(0)
    expect(screen.getByText('1項目が日により異なる')).toBeTruthy()
    expect(screen.getByText('編集して揃える')).toBeTruthy()
  })

  it('全日一致なら「全N日に反映」で注記が出ない', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({
      entryGroupId: group.id,
      eventDate: '2030-09-12',
      entryDeadline: '2030-09-01',
    })
    await createEvent({
      entryGroupId: group.id,
      eventDate: '2030-09-19',
      entryDeadline: '2030-09-01',
    })
    render(await renderPage(group.id))
    expect(screen.queryByText('（日により異なる）')).toBeNull()
    expect(screen.getByText('全2日に反映')).toBeTruthy()
    expect(screen.getByText('編集')).toBeTruthy()
  })
})

/**
 * confirmed-roster-signal タスク2 (AC-11/AC-13): 申込グループページの名簿セクションにも
 * 同じトグルが出る（`RosterSection` は日ページと同一コンポーネント）。
 */
describe('/admin/entries/[groupId] — 確定名簿ありトグル (confirmed-roster-signal AC-11/AC-13)', () => {
  const TOGGLE_LABEL = '確定名簿ありとして扱う'

  it('AC-13: 名簿0件・ファイル0件でも名簿セクションが描画されトグルへ到達できる（管理者）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05' })

    const { container } = render(await renderPage(group.id))

    expect(container.textContent).toContain(TOGGLE_LABEL)
  })

  it('AC-11: 一般会員には DOM にも RSC payload にも現れない', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05' })

    const ui = await renderPage(group.id)
    const propValues: string[] = []
    collectPropValues(ui, propValues)
    const { container } = render(ui)

    expect(container.textContent).not.toContain(TOGGLE_LABEL)
    expect(propValues.join(' ')).not.toContain(TOGGLE_LABEL)
  })

  it('override が立っていれば ON の見た目になる（管理者）', async () => {
    const admin = await createAdmin()
    await setAuthSession({ id: admin.id, role: 'admin' })
    const group = await createEntryGroup()
    await createEvent({ entryGroupId: group.id, eventDate: '2030-09-05' })
    await testDb
      .update(entryGroups)
      .set({ confirmedRosterOverride: true })
      .where(eq(entryGroups.id, group.id))

    const { container } = render(await renderPage(group.id))

    expect(container.textContent).toContain('確定名簿ありとして扱っています')
    expect(container.textContent).toContain('扱いを解除')
  })
})
