import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  eventBroadcastMessages,
  eventLineBroadcasts,
  lineChannels,
  mailAttachments,
  mailMessages,
  tournamentEntryRosterEntries,
  tournamentEntryRosterFiles,
  tournamentEntryRosters,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createEntryGroup,
  createEvent,
  createEventAttendance,
  createGuest,
  createMailMessage,
  createUser,
} from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'
import { RosterSection } from './components/RosterSection'
import { EventLifecycleSection } from '@/components/events/EventLifecycleSection'

/**
 * event-detail-redesign タスク6: `/events/[id]` 本体の組み替えに対する検証。
 * 対応 AC は AC-10 / AC-13 / AC-17 / AC-18 / AC-22 / AC-23 / AC-25 / AC-26 / AC-31。
 * AC-1〜9（申込フローの判定）は `lib/events/entry-flow.test.ts`、描画は
 * `components/events/detail/EntryFlow.test.tsx` が担当する。
 */

vi.mock('@/auth', () => mockAuthModule())

// 関連メールは async Server Component で、jsdom の render では実行できない
// （非同期コンポーネントはクライアント側でレンダリングできない）。この画面の
// 検証対象ではないのでスタブへ差し替える。中身は EventRelatedMails.test.tsx が持つ。
vi.mock('./components/EventRelatedMails', () => ({
  EventRelatedMails: () => null,
}))

const { default: EventDetailPage } = await import('./page')

function renderPage(eventId: number) {
  return EventDetailPage({ params: Promise.resolve({ id: String(eventId) }) })
}

/**
 * 返り値の React 要素ツリーを辿って、props に載っている文字列/数値をすべて集める。
 * DOM に出ていないだけでなく **RSC payload にも載っていない** ことを検証するため
 * （client component へ渡した props はツリー上に現れる）。
 *
 * ★React 要素の `props` だけでなく、**プレーンオブジェクトの値も再帰する**こと。
 * `binding` / `history` / `gradeBroadcast` / `steps` のようにネストした素の
 * オブジェクトで渡る props があり、そこを覗かないと「Bot 名や配信エラーが
 * 一般会員向け props に混入しても検査を通る」偽陰性になる（AC-28 の回帰ガードが
 * 効かなくなる）。循環参照は `seen` で防ぐ。
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
  // React 要素なら props を、素のオブジェクトなら全ての値を辿る。
  const props = (node as { props?: unknown }).props
  const values =
    props != null && typeof props === 'object'
      ? Object.values(props as Record<string, unknown>)
      : Object.values(node as Record<string, unknown>)
  for (const value of values) collectPropValues(value, out, depth + 1, seen)
}

/**
 * roster-file-adoption タスク4: 要素ツリーから `type`（コンポーネント参照）が
 * 一致する React 要素を集める。DTO の**キー**そのものを検査したいテスト
 * （AC-7）向け——`collectPropValues` は値しか見ないので、キーが漏れていても
 * 値がたまたま他の許可済みプロパティと衝突しなければ拾えない。
 */
function findElementsByType(
  node: unknown,
  type: unknown,
  out: Array<{ props: Record<string, unknown> }> = [],
  seen: WeakSet<object> = new WeakSet(),
): Array<{ props: Record<string, unknown> }> {
  if (node == null || typeof node !== 'object') return out
  if (seen.has(node)) return out
  seen.add(node)

  if (Array.isArray(node)) {
    for (const child of node) findElementsByType(child, type, out, seen)
    return out
  }
  const elType = (node as { type?: unknown }).type
  const props = (node as { props?: unknown }).props
  if (elType === type && props != null && typeof props === 'object') {
    out.push(node as { props: Record<string, unknown> })
  }
  if (props != null && typeof props === 'object') {
    for (const value of Object.values(props as Record<string, unknown>)) {
      findElementsByType(value, type, out, seen)
    }
  }
  return out
}

/** JST today as YYYY-MM-DD（page 側の todayInJst と同じ計算）。 */
function todayJst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** LINE 連携済み（linked）＋失敗履歴つきの大会を作る。AC-28 の遮断検証用。 */
const BOT_NOTE = 'かげとら07（若草）テスト'
const LINE_GROUP_ID = 'C123456789ABCDEF'
const BROADCAST_ERROR = '画像1件の送信がタイムアウトしましたテスト'

async function seedLinkedBroadcast(entryGroupId: number): Promise<void> {
  const channelRows = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${entryGroupId}-${Math.random().toString(36).slice(2, 8)}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      botId: '@bot-test-secret',
      note: BOT_NOTE,
      purpose: 'event_broadcast',
      status: 'active',
    })
    .returning({ id: lineChannels.id })
  const broadcastRows = await testDb
    .insert(eventLineBroadcasts)
    .values({
      entryGroupId,
      lineChannelId: channelRows[0]!.id,
      status: 'linked',
      lineGroupId: LINE_GROUP_ID,
      linkedAt: new Date(),
    })
    .returning({ id: eventLineBroadcasts.id })
  const mailRows = await testDb
    .insert(mailMessages)
    .values({
      messageId: `m-${entryGroupId}-${Math.random().toString(36).slice(2, 8)}`,
      fromAddress: 'organiser@example.com',
      toAddresses: ['admin@kagetra'],
      subject: '要綱のご案内テスト',
      receivedAt: new Date(),
      bodyText: '本文',
      status: 'ai_done',
    })
    .returning({ id: mailMessages.id })
  await testDb.insert(eventBroadcastMessages).values({
    eventLineBroadcastId: broadcastRows[0]!.id,
    mailMessageId: mailRows[0]!.id,
    status: 'failed',
    errorMessage: BROADCAST_ERROR,
  })
}

beforeEach(async () => {
  await truncateAll()
})
afterAll(async () => {
  await closeTestDb()
})

describe('/events/[id] — 一般会員から隠す情報 (AC-10)', () => {
  it('参加費・支払締切・支払方法・支払情報・申込方法が DOM も RSC payload にも出ない', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({
      title: '広島CDE',
      eventDate: addDays(todayJst(), 30),
      feeJpy: 24680,
      paymentDeadline: addDays(todayJst(), 10),
      paymentMethod: '事前振込テスト方法',
      paymentInfo: 'ゆうちょ銀行テスト支店',
      entryMethod: '会でとりまとめテスト',
    })

    const ui = await renderPage(ev.id)
    const propValues: string[] = []
    collectPropValues(ui, propValues)
    const payload = propValues.join(' ')
    render(ui)

    // grade-entry-fee (AC-21): 会員向け「あなたの参加費」を全ロールへ出すようになったため、
    // 「参加費」という文字列単体は一般会員にも出る。隠すべきなのは**進行管理の中身**
    // （格納値 fee_jpy・支払方法・振込先・申込方法・管理者だけの振込総額）であり、
    // 会員自身が払う額はむしろ見せる仕様に変わった（requirements §3.1）。
    const secrets = [
      '24,680',
      '事前振込テスト方法',
      'ゆうちょ銀行テスト支店',
      '会でとりまとめテスト',
      '振込総額',
      '支払方法',
      '振込先',
      '申込方法',
    ]
    for (const secret of secrets) {
      expect(screen.queryByText(new RegExp(secret))).toBeNull()
      expect(payload).not.toContain(secret)
    }
    // 会員に出るのは自分の級の導出額だけ（C級=2,000円）。格納値 24,680 は出ない。
    expect(screen.getByText(/あなたの参加費/)).toBeTruthy()
    expect(screen.getByText(/2,000円/)).toBeTruthy()
  })

  it('管理者の支払状態トグル内には参加費・支払方法・振込先が渡る (AC-11 の呼び出し側)', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      feeJpy: 24680,
      paymentMethod: '事前振込テスト方法',
      paymentInfo: 'ゆうちょ銀行テスト支店',
      entryMethod: '会でとりまとめテスト',
    })

    const ui = await renderPage(ev.id)
    const propValues: string[] = []
    collectPropValues(ui, propValues)
    const payload = propValues.join(' ')

    expect(payload).toContain('事前振込テスト方法')
    expect(payload).toContain('ゆうちょ銀行テスト支店')
    expect(payload).toContain('会でとりまとめテスト')
  })

  // mail-ai-extract-refinements タスク12 (§3.2.7 / AC-44): 振込締切の状態を
  // EventLifecycleSection へ渡す配線。日本語表示そのものの検証は
  // EventLifecycleSection.test.tsx が持つ（この画面は「渡っているか」だけを見る）。
  it('AC-44: event.paymentDeadlineKind が EventLifecycleSection の paymentDeadlineKind へ渡る', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      paymentDeadlineKind: 'later_notice',
    })

    const ui = await renderPage(ev.id)
    const sections = findElementsByType(ui, EventLifecycleSection)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.props.paymentDeadlineKind).toBe('later_notice')
    expect(sections[0]!.props.paymentDeadline).toBeNull()
  })

  it('AC-44: paymentDeadlineKind=unspecified（既定）もそのまま渡る（回帰）', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    const ui = await renderPage(ev.id)
    const sections = findElementsByType(ui, EventLifecycleSection)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.props.paymentDeadlineKind).toBe('unspecified')
  })
})

describe('/events/[id] — LINE 情報の遮断 (AC-28)', () => {
  it('連携済みでも一般会員には Bot 名・グループID・配信エラーが渡らない', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })
    await seedLinkedBroadcast(ev.entryGroupId)

    const ui = await renderPage(ev.id)
    const propValues: string[] = []
    collectPropValues(ui, propValues)
    const payload = propValues.join(' ')

    // ネストした binding / history の中身まで走査した上で 0 件であること。
    expect(payload).not.toContain(BOT_NOTE)
    expect(payload).not.toContain('@bot-test-secret')
    expect(payload).not.toContain(LINE_GROUP_ID)
    expect(payload).not.toContain(LINE_GROUP_ID.slice(-8))
    expect(payload).not.toContain(BROADCAST_ERROR)
    expect(payload).not.toContain('要綱のご案内テスト')
  })

  it('管理者には Bot 名・配信エラーが渡る（遮断が admin まで効いていないことの対照）', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })
    await seedLinkedBroadcast(ev.entryGroupId)

    const ui = await renderPage(ev.id)
    const propValues: string[] = []
    collectPropValues(ui, propValues)
    const payload = propValues.join(' ')

    expect(payload).toContain(BOT_NOTE)
    expect(payload).toContain(LINE_GROUP_ID.slice(-8))
    expect(payload).toContain(BROADCAST_ERROR)
  })
})

describe('/events/[id] — 名簿の内部列を RSC payload へ載せない', () => {
  // RosterSection は client component なので `event.rosters` はブラウザへ直列化される。
  // 型（RosterView）は実行時に余剰プロパティを落とさないため、クエリ側で列を絞らないと
  // note（管理メモ）/ rawKana / rawDan / selectionOutcome（抽選結果）/ approvedByUserId /
  // source_*（取込元メール・添付）等が一般会員へ渡ってしまう。
  it('note・rawKana・rawDan・selectionOutcome 等の内部列が payload に無い', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })
    const rosterRows = await testDb
      .insert(tournamentEntryRosters)
      .values({
        entryGroupId: ev.entryGroupId,
        rosterType: 'applicant',
        version: 1,
        publishedAt: '2026-07-22',
        note: '管理メモ・会員に見せない',
        approvedByUserId: member.id,
      })
      .returning({ id: tournamentEntryRosters.id })
    await testDb.insert(tournamentEntryRosterEntries).values({
      rosterId: rosterRows[0]!.id,
      rawName: '川村 美咲',
      rawKana: 'カワムラミサキ',
      rawAffiliation: '広島かるた会',
      rawDan: '四段',
      grade: 'C',
      status: 'applied',
      selectionOutcome: 'waitlisted',
    })

    const ui = await renderPage(ev.id)
    const propValues: string[] = []
    collectPropValues(ui, propValues)
    const payload = propValues.join(' ')

    // 表示に使う列は渡る。
    expect(payload).toContain('川村 美咲')
    expect(payload).toContain('広島かるた会')
    // 内部列・非表示の個人情報は渡らない。
    expect(payload).not.toContain('管理メモ・会員に見せない')
    expect(payload).not.toContain('カワムラミサキ')
    expect(payload).not.toContain('四段')
    expect(payload).not.toContain('waitlisted')
  })
})

describe('/events/[id] — 原本ファイル採用の表示 (roster-file-adoption AC-5/AC-6/AC-7)', () => {
  /** mail_attachments を1件作って返す最小ヘルパー（seed.ts に対応する create* が無いため直接 insert）。 */
  async function seedAttachment(mailMessageId: number, filename: string) {
    const [attachment] = await testDb
      .insert(mailAttachments)
      .values({
        mailMessageId,
        filename,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 1234,
        data: Buffer.from('test'),
      })
      .returning()
    if (!attachment) throw new Error('Failed to seed test mail attachment')
    return attachment
  }

  it('グループ内の別日の大会詳細からも、同じ entry_group に採用されたファイルが見える', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const { id: entryGroupId } = await createEntryGroup()
    const day1 = await createEvent({
      title: '多摩A',
      eventDate: addDays(todayJst(), 20),
      entryGroupId,
    })
    const day2 = await createEvent({
      title: '多摩B',
      eventDate: addDays(todayJst(), 25),
      entryGroupId,
    })

    const mail = await createMailMessage()
    const attachment = await seedAttachment(mail.id, '確定名簿テスト.xlsx')
    await testDb.insert(tournamentEntryRosterFiles).values({
      entryGroupId,
      rosterType: 'confirmed',
      sourceAttachmentId: attachment.id,
      publishedAt: '2026-07-20',
    })

    const { container: c1 } = render(await renderPage(day1.id))
    expect(c1.textContent).toContain('確定名簿テスト.xlsx')

    const { container: c2 } = render(await renderPage(day2.id))
    expect(c2.textContent).toContain('確定名簿テスト.xlsx')
  })

  it('同一 entry_group×種別に複数ファイルが採用されていれば全件表示する', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })
    const mail = await createMailMessage()

    const filenames = ['参加者一覧テスト.xlsx', '参加費一覧テスト.xlsx']
    for (const filename of filenames) {
      const attachment = await seedAttachment(mail.id, filename)
      await testDb.insert(tournamentEntryRosterFiles).values({
        entryGroupId: ev.entryGroupId,
        rosterType: 'confirmed',
        sourceAttachmentId: attachment.id,
      })
    }

    const { container } = render(await renderPage(ev.id))
    for (const filename of filenames) {
      expect(container.textContent).toContain(filename)
    }
  })

  it('取込元メール・採用者・管理メモが DOM にも RSC payload にも出ない (AC-7)', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const admin = await createUser({ role: 'admin', name: '採用担当テスト太郎' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    const mail = await createMailMessage({ subject: '確定名簿ですテスト件名' })
    const attachment = await seedAttachment(mail.id, '確定名簿テスト.xlsx')
    await testDb.insert(tournamentEntryRosterFiles).values({
      entryGroupId: ev.entryGroupId,
      rosterType: 'confirmed',
      sourceAttachmentId: attachment.id,
      sourceMailMessageId: mail.id,
      publishedAt: '2026-07-20',
      note: '管理メモ・原本ファイル用テスト',
      adoptedByUserId: admin.id,
    })

    const ui = await renderPage(ev.id)
    const propValues: string[] = []
    collectPropValues(ui, propValues)
    const payload = propValues.join(' ')
    const { container } = render(ui)

    // 表示に使ってよい情報（ファイル名・種別・発表日・ビューア導線）は渡る。
    expect(payload).toContain('確定名簿テスト.xlsx')
    expect(container.textContent).toContain('確定名簿テスト.xlsx')

    // 内部情報（取込元メール・採用者・管理メモ）は渡らない。
    expect(payload).not.toContain('管理メモ・原本ファイル用テスト')
    expect(payload).not.toContain('採用担当テスト太郎')
    expect(payload).not.toContain('確定名簿ですテスト件名')

    // 値ベースの検査に加えて、RosterSection へ渡る DTO の**キー**そのものに
    // 内部列が存在しないことも固定する（値がたまたま他の列と衝突する
    // 偽陰性を防ぐ）。
    const rosterSections = findElementsByType(ui, RosterSection)
    expect(rosterSections).toHaveLength(1)
    const files = rosterSections[0]!.props.rosterFiles as Array<Record<string, unknown>>
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const keys = Object.keys(file)
      expect(keys).not.toContain('sourceMailMessageId')
      expect(keys).not.toContain('adoptedByUserId')
      expect(keys).not.toContain('note')
      expect(keys).not.toContain('sourceAttachmentId')
      expect(keys).not.toContain('entryGroupId')
      expect(keys).not.toContain('adoptedAt')
    }
  })

  // roster-file-adoption 2026-08-01 改修 (AC-18): 級別採用のファイルには
  // 大会詳細に級ラベルが出る。
  it('grades を指定して採用したファイルは級ラベル付きで表示される', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    const mail = await createMailMessage()
    const attachment = await seedAttachment(mail.id, 'D級名簿テスト.xlsx')
    await testDb.insert(tournamentEntryRosterFiles).values({
      entryGroupId: ev.entryGroupId,
      rosterType: 'confirmed',
      sourceAttachmentId: attachment.id,
      grades: ['D'],
    })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).toContain('D級名簿テスト.xlsx')
    expect(container.textContent).toContain('D級')
  })
})

describe('/events/[id] — 削除した表示 (AC-13)', () => {
  it('戻りリンク・公認ピル・ステータスピル・主催・正式名称・不参加・コメント・出欠状況が無い', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const ev = await createEvent({
      title: '広島CDE',
      eventDate: addDays(todayJst(), 30),
      status: 'cancelled',
      official: true,
      organizer: '広島県かるた協会テスト',
      formalName: '第99回テスト大会正式名称',
    })

    const { container } = render(await renderPage(ev.id))

    expect(screen.queryByText(/イベント一覧/)).toBeNull()
    expect(screen.queryByText('公認')).toBeNull()
    expect(screen.queryByText('中止')).toBeNull()
    expect(screen.queryByText('広島県かるた協会テスト')).toBeNull()
    expect(screen.queryByText('第99回テスト大会正式名称')).toBeNull()
    expect(screen.queryByText(/不参加/)).toBeNull()
    expect(screen.queryByText(/出欠状況/)).toBeNull()
    // 出欠コメントの入力 UI は廃止（データ・Server Action の経路は残す）。
    expect(container.querySelector('textarea[name="comment"]')).toBeNull()
    expect(screen.queryByText(/^コメント/)).toBeNull()
  })

  it('一般会員に進行状況バッジと LINE 配信の案内が出ない (AC-13b)', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      entryStatus: 'applied',
    })

    render(await renderPage(ev.id))

    expect(screen.queryByText('進行管理')).toBeNull()
    expect(screen.queryByText('申込済')).toBeNull()
    expect(screen.queryByText('LINE 配信')).toBeNull()
    expect(screen.queryByText(/自動配信されています/)).toBeNull()
  })
})

describe('/events/[id] — 級別定員セクションの3分岐 (AC-17 / AC-18)', () => {
  it('定員が設定された級は「級＋定員数」と合計を出す', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      eligibleGrades: ['C', 'D'],
      capacityC: 64,
      capacityD: 48,
    })

    render(await renderPage(ev.id))

    expect(screen.getByText('級別定員')).toBeTruthy()
    expect(screen.getByText('64')).toBeTruthy()
    expect(screen.getByText('48')).toBeTruthy()
    expect(screen.getByText('計 112名')).toBeTruthy()
  })

  it('定員が1つも無ければ eligibleGrades の級だけを数字なしで出す', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      eligibleGrades: ['C', 'D'],
    })

    render(await renderPage(ev.id))

    expect(screen.getByText('級別定員')).toBeTruthy()
    expect(screen.getByText('C')).toBeTruthy()
    expect(screen.getByText('D')).toBeTruthy()
    // 合計は定員があるときだけ。
    expect(screen.queryByText(/^計 /)).toBeNull()
  })

  it('eligibleGrades も定員も無ければセクションごと描画しない', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    render(await renderPage(ev.id))

    expect(screen.queryByText('級別定員')).toBeNull()
  })
})

describe('/events/[id] — 日付表記 (AC-22)', () => {
  it('生 ISO 表記（YYYY-MM-DD）が1箇所も出ない', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const ev = await createEvent({
      title: '広島CDE',
      eventDate: '2030-09-06',
      internalDeadline: '2030-07-31',
      entryDeadline: '2030-08-05',
      lotteryDate: '2030-08-07',
      paymentDeadline: '2030-08-20',
      eligibleGrades: ['C'],
      capacityC: 64,
    })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    // 大会名脇は曜日つき、申込フローは曜日なし。
    expect(screen.getByText('9/6(金)')).toBeTruthy()
    expect(screen.getByText('7/31')).toBeTruthy()
  })
})

describe('/events/[id] — ページ余白 (AC-23)', () => {
  it('ルート要素が padding utility を持つ（<main> 側は mobile-shell.test.tsx が担保）', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    const { container } = render(await renderPage(ev.id))

    expect(container.firstElementChild?.className).toMatch(/\bp-4\b/)
  })
})

describe('/events/[id] — グループ日リンク (entry-groups タスク4 AC-16)', () => {
  it('同グループの他の日があれば一般会員にもリンクが表示される（現在地はリンクにしない）', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const { id: entryGroupId } = await createEntryGroup()
    const day1 = await createEvent({
      title: '多摩A',
      eventDate: addDays(todayJst(), 20),
      entryGroupId,
    })
    await createEvent({
      title: '多摩B',
      eventDate: addDays(todayJst(), 25),
      entryGroupId,
    })

    const { container } = render(await renderPage(day1.id))

    // 多摩A（現在の日）は h1 見出しにも出るので重複マッチを避け textContent で見る。
    expect(container.textContent).toContain('多摩A')
    expect(container.textContent).toContain('多摩B')
    // 現在見ている日（多摩A）はリンクにならない。
    expect(screen.queryByRole('link', { name: /多摩A/ })).toBeNull()
    // 別の日（多摩B）はリンク。
    const otherLink = screen.getByRole('link', { name: /多摩B/ })
    expect(otherLink.getAttribute('href')).toMatch(/^\/events\/\d+$/)
  })

  it('シングルトングループ（1件のみ）ではグループ日リンクを表示しない', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ title: '単独大会', eventDate: addDays(todayJst(), 30) })

    render(await renderPage(ev.id))

    expect(
      screen.queryByRole('navigation', { name: '同じ申込グループの日程' }),
    ).toBeNull()
  })
})

describe('/events/[id] — 出欠回答の可否判定 (AC-25 回帰)', () => {
  it('招待されていない会員は理由が出て回答ボタンが出ない', async () => {
    const member = await createUser({ role: 'member', isInvited: false })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    render(await renderPage(ev.id))

    expect(screen.getByText('出欠回答の対象外です')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '参加する' })).toBeNull()
  })

  it('会内締切を過ぎた会員は回答できない', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      internalDeadline: addDays(todayJst(), -1),
    })

    render(await renderPage(ev.id))

    expect(screen.getByText('会内締切を過ぎています')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '参加する' })).toBeNull()
  })

  it('対象外の級の会員は回答できない', async () => {
    const member = await createUser({ role: 'member', grade: 'E' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      eligibleGrades: ['A'],
    })

    render(await renderPage(ev.id))

    expect(screen.getByText('対象外の級です')).toBeTruthy()
  })

  it('管理者は締切・級・招待をバイパスして回答できる', async () => {
    const admin = await createUser({ role: 'admin', grade: 'E', isInvited: false })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      internalDeadline: addDays(todayJst(), -1),
      eligibleGrades: ['A'],
    })

    render(await renderPage(ev.id))

    expect(screen.getByRole('button', { name: '参加する' })).toBeTruthy()
  })

  it('回答済みならボタンがキャンセル側になる', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })
    await createEventAttendance({ eventId: ev.id, userId: member.id, attend: true })

    render(await renderPage(ev.id))

    expect(screen.getByRole('button', { name: '参加をキャンセル' })).toBeTruthy()
  })
})

describe('/events/[id] — 参加者リストの stale 行除外 (AC-26 回帰)', () => {
  it('対象級から外れた attend=true の行は参加者に出ない', async () => {
    const viewer = await createUser({ role: 'admin' })
    await setAuthSession({ id: viewer.id, role: 'admin' })
    const inGrade = await createUser({ role: 'member', grade: 'C', name: '山田 太郎' })
    const outOfGrade = await createUser({ role: 'member', grade: 'E', name: '鈴木 花子' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      eligibleGrades: ['C'],
    })
    await createEventAttendance({ eventId: ev.id, userId: inGrade.id, attend: true })
    await createEventAttendance({ eventId: ev.id, userId: outOfGrade.id, attend: true })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).toContain('山田')
    expect(container.textContent).not.toContain('鈴木')
    // 見出しの人数も対象級だけを数える（不参加人数は算出しない）。
    expect(screen.getByText('参加者').textContent).toContain('1')
  })
})

describe('/events/[id] — 会員向け「あなたの参加費」(grade-entry-fee タスク7 AC-21/AC-22/AC-23)', () => {
  it('対象級の会員には出欠未回答でも「あなたの参加費 2,500円」が出る', async () => {
    const member = await createUser({ role: 'member', grade: 'A' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).toContain('あなたの参加費')
    expect(container.textContent).toContain('2,500円')
  })

  it('出欠 attend=false（不参加）でも出る', async () => {
    const member = await createUser({ role: 'member', grade: 'A' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })
    await createEventAttendance({ eventId: ev.id, userId: member.id, attend: false })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).toContain('あなたの参加費')
    expect(container.textContent).toContain('2,500円')
  })

  it('級未設定の会員には出ない', async () => {
    const member = await createUser({ role: 'member', grade: null })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).not.toContain('あなたの参加費')
  })

  it('対象級外の会員には出ない（eligible_grades={A,B} の会員が C 級）', async () => {
    const member = await createUser({ role: 'member', grade: 'C' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      eligibleGrades: ['A', 'B'],
    })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).not.toContain('あなたの参加費')
  })

  it("kind='team' では出ない", async () => {
    const member = await createUser({ role: 'member', grade: 'A' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30), kind: 'team' })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).not.toContain('あなたの参加費')
  })

  it('非公認（official=false）は events.fee_jpy がそのまま出る／null なら行が出ない', async () => {
    const member = await createUser({ role: 'member', grade: 'A' })
    await setAuthSession({ id: member.id, role: 'member' })
    const priced = await createEvent({
      eventDate: addDays(todayJst(), 30),
      official: false,
      feeJpy: 3000,
    })

    const { container: c1 } = render(await renderPage(priced.id))
    expect(c1.textContent).toContain('あなたの参加費')
    expect(c1.textContent).toContain('3,000円')

    const unpriced = await createEvent({
      eventDate: addDays(todayJst(), 30),
      official: false,
      feeJpy: null,
    })
    const { container: c2 } = render(await renderPage(unpriced.id))
    expect(c2.textContent).not.toContain('あなたの参加費')
  })

  it('official な個人戦は events.fee_jpy に別の値が入っていても無視され、級別規定額が出る', async () => {
    const member = await createUser({ role: 'member', grade: 'A' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      official: true,
      feeJpy: 9999,
    })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).toContain('あなたの参加費')
    expect(container.textContent).toContain('2,500円')
    expect(container.textContent).not.toContain('9,999')
  })

  it('「規定額」という文字列がページに出ない', async () => {
    const member = await createUser({ role: 'member', grade: 'A' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).not.toContain('規定額')
  })
})

describe('/events/[id] — 表示ロールのプレビュー追随 (AC-31 回帰)', () => {
  it('DB 上は admin でもセッションの実効ロールが member なら会員ビューになる', async () => {
    const admin = await createUser({ role: 'admin' })
    // role-preview-switch: session.user.role が実効ロール。
    await setAuthSession({ id: admin.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    render(await renderPage(ev.id))

    expect(screen.queryByText('進行管理')).toBeNull()
    expect(screen.queryByText('編集')).toBeNull()
  })

  it('実効ロールが admin なら管理者ビューになる', async () => {
    const admin = await createUser({ role: 'admin' })
    await setAuthSession({ id: admin.id, role: 'admin' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    render(await renderPage(ev.id))

    expect(screen.getByText('進行管理')).toBeTruthy()
    expect(screen.getByText('編集')).toBeTruthy()
  })
})

describe('/events/[id] — ゲストの出欠回答条件 (guest-role タスク5 AC-12/AC-13/AC-14)', () => {
  it('ゲストは会内締切を過ぎていても対象級の大会に回答できる', async () => {
    const guest = await createGuest({ grade: 'A' })
    await setAuthSession({ id: guest.id, role: 'guest' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      internalDeadline: addDays(todayJst(), -1),
    })

    render(await renderPage(ev.id))

    expect(screen.getByRole('button', { name: '参加する' })).toBeTruthy()
    expect(screen.queryByText('会内締切を過ぎています')).toBeNull()
  })

  it('ゲストは対象級外の大会には回答できない（理由表示は「対象外の級です」）', async () => {
    const guest = await createGuest({ grade: 'E' })
    await setAuthSession({ id: guest.id, role: 'guest' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      eligibleGrades: ['A', 'B'],
    })

    render(await renderPage(ev.id))

    expect(screen.queryByRole('button', { name: '参加する' })).toBeNull()
    expect(screen.getByText('対象外の級です')).toBeTruthy()
  })

  // AC-14 回帰: 一般会員は従来どおり会内締切超過で回答できない。
  it('一般会員は従来どおり会内締切超過で回答できない（回帰）', async () => {
    const member = await createUser({ role: 'member' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({
      eventDate: addDays(todayJst(), 30),
      internalDeadline: addDays(todayJst(), -1),
    })

    render(await renderPage(ev.id))

    expect(screen.getByText('会内締切を過ぎています')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '参加する' })).toBeNull()
  })
})

describe('/events/[id] — 参加者欄のゲスト印 (guest-role タスク5 AC-15)', () => {
  it('参加者欄にゲストがゲスト印つきで表示され、人数にも含まれる', async () => {
    const viewer = await createUser({ role: 'admin' })
    await setAuthSession({ id: viewer.id, role: 'admin' })
    const member = await createUser({ role: 'member', grade: 'C', name: '山田 太郎' })
    const guest = await createGuest({ grade: 'C', name: '佐藤 次郎' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })
    await createEventAttendance({ eventId: ev.id, userId: member.id, attend: true })
    await createEventAttendance({ eventId: ev.id, userId: guest.id, attend: true })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).toContain('山田')
    expect(container.textContent).toContain('佐藤')
    expect(container.textContent).toContain('ゲスト')
    // 見出しの人数にゲストを含めて 2 名。
    expect(screen.getByText('参加者').textContent).toContain('2')
  })
})

describe('/events/[id] — ゲストには「あなたの参加費」を出さない (guest-role タスク5 AC-16)', () => {
  it('ゲストには「あなたの参加費」の行が DOM にも RSC payload にも出ない', async () => {
    const guest = await createGuest({ grade: 'A' })
    await setAuthSession({ id: guest.id, role: 'guest' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    const ui = await renderPage(ev.id)
    const propValues: string[] = []
    collectPropValues(ui, propValues)
    const payload = propValues.join(' ')
    const { container } = render(ui)

    expect(container.textContent).not.toContain('あなたの参加費')
    expect(payload).not.toContain('あなたの参加費')
    // A 級の公認個人戦規定額 2,500円が RSC payload にも一切載らないこと
    // （JSX の条件分岐だけで隠すのではなく、計算前にサーバー側で分岐する）。
    expect(payload).not.toContain('2,500')
  })

  // 同じ大会・同じ級で会員には出ることの対照（分岐がゲスト固有であることの確認）。
  it('同条件の会員には従来どおり出る（対照）', async () => {
    const member = await createUser({ role: 'member', grade: 'A' })
    await setAuthSession({ id: member.id, role: 'member' })
    const ev = await createEvent({ eventDate: addDays(todayJst(), 30) })

    const { container } = render(await renderPage(ev.id))

    expect(container.textContent).toContain('あなたの参加費')
    expect(container.textContent).toContain('2,500円')
  })
})
