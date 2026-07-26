import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventLifecycleNotifications, eventLineBroadcasts, lineChannels } from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createEntryGroup, createEvent, createEventAttendance, createUser } from '@/test-utils/seed'
import {
  buildOverdueAlertMessage,
  collectOverdueEntries,
  loadSystemChannel,
  sendEntryOverdueAlert,
  type OverdueEntryRow,
} from './entry-overdue-alert'

// ---------------------------------------------------------------------------
// buildOverdueAlertMessage (pure, no DB)
// ---------------------------------------------------------------------------

function row(overrides: Partial<OverdueEntryRow> = {}): OverdueEntryRow {
  const eventId = overrides.eventId ?? 1
  return {
    eventId,
    // entry-groups タスク5: 既定では eventId をそのままグループ id に使う
    // （＝各行が単独グループ）。複数行を同じグループにまとめたいテストだけが
    // `entryGroupId` を明示する。固定値のままだと AC-9 の並び替えテスト等で
    // 7 行すべてが 1 グループへ潰れてしまい、既存の「1行1大会」の意味が壊れる。
    entryGroupId: overrides.entryGroupId ?? eventId,
    title: 'テスト大会',
    eventDate: '2030-01-01',
    baseDeadlineIso: '2026-06-01',
    baseDeadlineSource: 'internal',
    entryDeadlineIso: '2026-06-10',
    overdueDays: 5,
    attendCount: 3,
    ...overrides,
  }
}

describe('buildOverdueAlertMessage', () => {
  const today = '2026-06-06'
  const baseUrl = 'https://kagetra.example.com'

  it('AC-8: 大会名・会内締切と超過日数・申込締切と残日数・参加人数・絶対 URL を含む', () => {
    const text = buildOverdueAlertMessage(
      [row({ eventId: 42, title: '春季大会', overdueDays: 5, attendCount: 3 })],
      { today, baseUrl },
    )
    expect(text).toContain('春季大会')
    // 会内締切「日付＋超過日数」／大会申込締切「日付＋残日数」を複合表記で検証する
    // （'5日超過' 単体や '大会申込締切' 単体だけでは日付・残日数の欠落を検知できない）。
    expect(text).toContain('会内締切 6/1（5日超過）')
    expect(text).toContain('大会申込締切 6/10（あと4日）')
    expect(text).toContain('参加 3名')
    expect(text).toContain('https://kagetra.example.com/events/42')
  })

  it('baseUrl の末尾スラッシュを取り除いてから /events/{id} を連結する', () => {
    const text = buildOverdueAlertMessage([row({ eventId: 7 })], {
      today,
      baseUrl: 'https://kagetra.example.com/',
    })
    expect(text).toContain('https://kagetra.example.com/events/7')
    expect(text).not.toContain('.com//events')
  })

  it('基準締切が entry_deadline 代替のときはその旨が分かる表記になる', () => {
    const text = buildOverdueAlertMessage([row({ baseDeadlineSource: 'entry' })], {
      today,
      baseUrl,
    })
    expect(text).toContain('大会申込締切で代替')
  })

  it('entryDeadlineIso が null のときは「未設定」と表示する（クラッシュしない）', () => {
    const text = buildOverdueAlertMessage([row({ entryDeadlineIso: null })], { today, baseUrl })
    expect(text).toContain('大会申込締切 未設定')
  })

  it('大会名が長い場合は行単位で切り詰める', () => {
    const longTitle = 'あ'.repeat(50)
    const text = buildOverdueAlertMessage([row({ title: longTitle })], { today, baseUrl })
    const line = text.split('\n').find((l) => l.startsWith('・'))!
    // 先頭の「・」を除いた本体が truncate 上限 + 省略記号を超えない
    expect(Array.from(line.slice(1)).length).toBeLessThanOrEqual(31)
    expect(line).toContain('…')
  })

  it('AC-9: 6 件以上で超過日数降順に上位 5 件が明細、残りが「他 N 件」に畳まれる', () => {
    const rows = [10, 50, 20, 5, 40, 30, 1].map((overdueDays, i) =>
      row({ eventId: i + 1, title: `大会${i + 1}`, overdueDays }),
    )
    const text = buildOverdueAlertMessage(rows, { today, baseUrl })
    expect(text).toContain('他 2件')

    // 明細に出てくる大会名の出現順が超過日数降順になっている
    const order = [50, 40, 30, 20, 10].map(
      (d) => `大会${rows.find((r) => r.overdueDays === d)!.eventId}`,
    )
    let lastIndex = -1
    for (const title of order) {
      const idx = text.indexOf(title)
      expect(idx).toBeGreaterThan(lastIndex)
      lastIndex = idx
    }
    // 下位 2 件（1, 5）は明細に出ない
    const excluded = rows.filter((r) => r.overdueDays === 1 || r.overdueDays === 5)
    for (const r of excluded) {
      expect(text).not.toContain(`大会${r.eventId}`)
    }
  })

  it('tie-break: 超過日数が同じ場合は eventDate 昇順→id 昇順で安定ソートする', () => {
    const rows = [
      row({ eventId: 3, title: 'C', overdueDays: 10, eventDate: '2030-02-01' }),
      row({ eventId: 1, title: 'A', overdueDays: 10, eventDate: '2030-01-01' }),
      row({ eventId: 2, title: 'B', overdueDays: 10, eventDate: '2030-01-01' }),
    ]
    const text = buildOverdueAlertMessage(rows, { today, baseUrl })
    const idxA = text.indexOf('・A')
    const idxB = text.indexOf('・B')
    const idxC = text.indexOf('・C')
    expect(idxA).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxC)
  })

  // entry-groups タスク5 (AC-13): entry-overdue-alert はグループ単位で1行に集約される。
  describe('AC-13: グループ単位の集約', () => {
    it('同一グループの複数日は1行にまとまり、導出表示名・両日の締切明細・代表イベントの URL を含む', () => {
      const rows = [
        row({
          eventId: 11,
          entryGroupId: 100,
          title: '多摩A',
          eventDate: '2030-08-15',
          overdueDays: 5,
          attendCount: 3,
        }),
        row({
          eventId: 12,
          entryGroupId: 100,
          title: '多摩B',
          eventDate: '2030-08-11',
          overdueDays: 9,
          attendCount: 7,
        }),
      ]
      const text = buildOverdueAlertMessage(rows, { today, baseUrl })

      // 1 グループ = 1 明細（「・」で始まる行は 1 本だけ）
      const bulletLines = text.split('\n').filter((l) => l.startsWith('・'))
      expect(bulletLines).toHaveLength(1)
      // 導出表示名（多摩A + 多摩B → 多摩AB）
      expect(bulletLines[0]).toBe('・多摩AB')
      // 両日の締切明細が列挙される（どちらの日も隠れない）
      expect(text).toContain('8/11(日)多摩B')
      expect(text).toContain('8/15(木)多摩A')
      // 参加人数は最大値（延べ人数の合算ではない）
      expect(text).toContain('参加 7名')
      // 代表イベント（今日以降で最も近い開催日）の URL
      expect(text).toContain(`${baseUrl}/events/12`)
      expect(text).not.toContain(`${baseUrl}/events/11`)
      // 件数はグループ数（1件）
      expect(text).toContain('未申込大会が1件あります')
    })

    it('グループが異なれば別々の行のまま（従来の1行1大会の書式を保つ）', () => {
      const rows = [
        row({ eventId: 21, entryGroupId: 21, title: '単独大会', overdueDays: 5 }),
        row({ eventId: 22, entryGroupId: 22, title: '別の単独大会', overdueDays: 3 }),
      ]
      const text = buildOverdueAlertMessage(rows, { today, baseUrl })
      expect(text).toContain('未申込大会が2件あります')
      // 単独グループでは日別ラベル行を挟まない（既存の1行1大会と同じ書式）
      expect(text).not.toContain('(')
    })

    it('超過日数の並び替えはグループ内最大値で行う', () => {
      const rows = [
        // グループ 200: 最大超過日数 20（並びで先頭に来るはず）。同一タイトルなので
        // 導出表示名はそのタイトルになり、代表選定の細かい挙動に依存しない。
        row({ eventId: 31, entryGroupId: 200, title: 'グループ大会', overdueDays: 1 }),
        row({ eventId: 32, entryGroupId: 200, title: 'グループ大会', overdueDays: 20 }),
        // グループ 300: 単独 10日超過
        row({ eventId: 33, entryGroupId: 300, title: 'Z', overdueDays: 10 }),
      ]
      const text = buildOverdueAlertMessage(rows, { today, baseUrl })
      const idxGroup200 = text.indexOf('・グループ大会')
      const idxZ = text.indexOf('・Z')
      expect(idxGroup200).toBeGreaterThanOrEqual(0)
      expect(idxGroup200).toBeLessThan(idxZ)
    })
  })
})

// ---------------------------------------------------------------------------
// DB integration tests
// ---------------------------------------------------------------------------

function okFetch() {
  return vi.fn<typeof fetch>(
    async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '',
      }) as unknown as Response,
  )
}

async function seedSystemChannel(overrides: { notificationLineUserId?: string | null } = {}) {
  // `?? 'Uadmin123'` は明示的な null 指定（userId 未設定ケースの再現）を踏み潰して
  // しまう（null も nullish なので既定値にフォールバックする）ため、"key が渡された
  // かどうか" で分岐する。
  const notificationLineUserId =
    'notificationLineUserId' in overrides ? overrides.notificationLineUserId : 'Uadmin123'
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${crypto.randomUUID()}`,
      channelSecret: 'secret',
      channelAccessToken: 'sys-token',
      botId: '@sys-bot',
      purpose: 'system_notify',
      status: 'system',
      notificationLineUserId,
    })
    .returning()
  if (!channel) throw new Error('failed to seed system channel')
  return channel
}

// DB を使うテストは 1 ファイルにつき 1 プールなので、describe をまたいで
// beforeEach(truncateAll) を共有しつつ closeTestDb() は最後に一度だけ呼ぶ
// （event-lifecycle-notify.test.ts と同じ制約。afterAll を複数箇所で呼ぶと
// 後続の describe がプール終了後の testDb にアクセスしてエラーになる）。
describe('entry-overdue-alert — DB', () => {
  const today = '2026-06-10'

  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  /**
   * 大会を 1 件作り、参加希望者を 1 名登録して返す。
   *
   * entry-management（§3.2.9）で抽出条件に `attendCount >= 1` が加わったため、
   * 出欠 0 名のフィクスチャは「その条件だけ」で対象外になる。対象になるべき
   * ケースだけでなく**対象外を確認するケースにも参加者を足す** — でないと
   * cancelled / 過去開催 / applied などのテストが、自分が切り分けたい条件では
   * なく「出欠 0 名」を理由に通ってしまい、条件を分離しなくなる（AC-29）。
   */
  async function createEventWithAttendee(
    overrides: Parameters<typeof createEvent>[0] = {},
  ) {
    const event = await createEvent(overrides)
    const user = await createUser()
    await createEventAttendance({ eventId: event.id, userId: user.id, attend: true })
    return event
  }

  describe('collectOverdueEntries', () => {
    it('AC-1: 会内締切超過・開催日未来・not_applied・非中止は対象になる', async () => {
      const event = await createEventWithAttendee({
        title: '対象大会',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
        status: 'published',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).toContain(event.id)
      const hit = rows.find((r) => r.eventId === event.id)!
      expect(hit.baseDeadlineSource).toBe('internal')
      expect(hit.overdueDays).toBe(9)
    })

    it('AC-3: 基準締切が今日と同日は対象外', async () => {
      const event = await createEventWithAttendee({
        title: '締切当日',
        eventDate: '2030-01-01',
        internalDeadline: today,
        entryStatus: 'not_applied',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).not.toContain(event.id)
    })

    it('AC-3: 基準締切の翌日からは対象になる', async () => {
      const event = await createEventWithAttendee({
        title: '翌日から対象',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-09',
        entryStatus: 'not_applied',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).toContain(event.id)
    })

    it('AC-2: internal_deadline が NULL なら entry_deadline を基準締切として判定する', async () => {
      const event = await createEventWithAttendee({
        title: 'entry_deadline 代替',
        eventDate: '2030-01-01',
        internalDeadline: null,
        entryDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      const hit = rows.find((r) => r.eventId === event.id)
      expect(hit).toBeDefined()
      expect(hit!.baseDeadlineSource).toBe('entry')
      expect(hit!.baseDeadlineIso).toBe('2026-06-01')
    })

    it('AC-2: internal_deadline / entry_deadline が両方 NULL なら対象外', async () => {
      const event = await createEventWithAttendee({
        title: '両方未設定',
        eventDate: '2030-01-01',
        internalDeadline: null,
        entryDeadline: null,
        entryStatus: 'not_applied',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).not.toContain(event.id)
    })

    it('AC-4: entry_status=applied は対象外', async () => {
      const event = await createEventWithAttendee({
        title: '申込済',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'applied',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).not.toContain(event.id)
    })

    it('AC-4: entry_status=not_applying は対象外', async () => {
      const event = await createEventWithAttendee({
        title: '申込なし',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applying',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).not.toContain(event.id)
    })

    it('AC-4: status=cancelled は対象外', async () => {
      const event = await createEventWithAttendee({
        title: '中止大会',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
        status: 'cancelled',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).not.toContain(event.id)
    })

    it('AC-4: event_date が過去は対象外', async () => {
      const event = await createEventWithAttendee({
        title: '過去開催',
        eventDate: '2020-01-01',
        internalDeadline: '2019-12-01',
        entryStatus: 'not_applied',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).not.toContain(event.id)
    })

    it('AC-5: LINE グループ未紐付けの大会も対象に含まれる（event_line_broadcasts に一切依存しない）', async () => {
      const unlinked = await createEventWithAttendee({
        title: '未紐付け',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      // revoked（非 linked）の broadcast 行を持つ大会も対象に含まれることを確認する。
      // ここで LEFT JOIN していれば、この行の有無で結果セットが変わってしまうはず。
      const revokedTarget = await createEventWithAttendee({
        title: '解除済みグループあり',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      const [channel] = await testDb
        .insert(lineChannels)
        .values({
          channelId: `ch-${crypto.randomUUID()}`,
          channelSecret: 'secret',
          channelAccessToken: 'tok',
          botId: '@test-bot',
          purpose: 'event_broadcast',
          status: 'available',
        })
        .returning()
      await testDb.insert(eventLineBroadcasts).values({
        entryGroupId: revokedTarget.entryGroupId,
        lineChannelId: channel!.id,
        status: 'revoked',
        lineGroupId: 'Gold',
      })

      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).toContain(unlinked.id)
      expect(rows.map((r) => r.eventId)).toContain(revokedTarget.id)
    })

    it('参加人数は event_attendances.attend=true の件数（相関サブクエリ）', async () => {
      const event = await createEvent({
        title: '参加人数集計',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      const u1 = await createUser()
      const u2 = await createUser()
      const u3 = await createUser()
      await createEventAttendance({ eventId: event.id, userId: u1.id, attend: true })
      await createEventAttendance({ eventId: event.id, userId: u2.id, attend: true })
      await createEventAttendance({ eventId: event.id, userId: u3.id, attend: false })

      const rows = await collectOverdueEntries(testDb, { today })
      const hit = rows.find((r) => r.eventId === event.id)!
      expect(hit.attendCount).toBe(2)
    })

    // entry-management §3.2.9 / AC-28: 画面（/admin/entries）が「会内締切超過で
    // 参加希望者 0 名」を非表示にするので、LINE も同じ定義で黙る。定義が 2 つに
    // 割れると、片方が鳴らしている大会をもう片方が消していることになり、管理者は
    // どちらも信用しなくなる。
    it('AC-28: 参加希望者 0 名の未申込・締切超過大会は対象外', async () => {
      const event = await createEvent({
        title: '出欠0名',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).not.toContain(event.id)
    })

    it('AC-28: attend=false しかいない大会も対象外（行の有無ではなく attend=true の件数で判定する）', async () => {
      const event = await createEvent({
        title: '全員不参加',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      const user = await createUser()
      await createEventAttendance({ eventId: event.id, userId: user.id, attend: false })

      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).not.toContain(event.id)
    })

    it('AC-28: 参加希望者が 1 名なら対象に含まれる（境界）', async () => {
      const event = await createEventWithAttendee({
        title: '出欠1名',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.map((r) => r.eventId)).toContain(event.id)
    })

    it('AC-13: entry_group_id を各行に含む（グループ集約のキー）', async () => {
      const group = await createEntryGroup()
      const a = await createEventWithAttendee({
        title: 'グループA',
        eventDate: '2030-08-15',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
        entryGroupId: group.id,
      })
      const b = await createEventWithAttendee({
        title: 'グループB',
        eventDate: '2030-08-11',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
        entryGroupId: group.id,
      })
      const rows = await collectOverdueEntries(testDb, { today })
      expect(rows.find((r) => r.eventId === a.id)?.entryGroupId).toBe(group.id)
      expect(rows.find((r) => r.eventId === b.id)?.entryGroupId).toBe(group.id)
    })
  })

  describe('loadSystemChannel', () => {
    it('status=system 行が無ければ null を返す（throw しない）', async () => {
      expect(await loadSystemChannel(testDb)).toBeNull()
    })

    it('status=system 行を返す', async () => {
      await seedSystemChannel({ notificationLineUserId: 'Uabc' })
      const channel = await loadSystemChannel(testDb)
      expect(channel).toMatchObject({ notificationLineUserId: 'Uabc' })
    })
  })

  describe('sendEntryOverdueAlert', () => {
    const ORIGINAL_DRY_RUN = process.env.LINE_NOTIFY_DRY_RUN
    const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL

    beforeEach(() => {
      // AC-6/AC-7/AC-10 は push 呼び出し回数を fetch スタブで観測するため、
      // 環境変数由来の DRY_RUN / PUBLIC_BASE_URL を毎テスト明示的に消して決定的にする。
      delete process.env.LINE_NOTIFY_DRY_RUN
      delete process.env.PUBLIC_BASE_URL
    })
    afterEach(() => {
      if (ORIGINAL_DRY_RUN === undefined) delete process.env.LINE_NOTIFY_DRY_RUN
      else process.env.LINE_NOTIFY_DRY_RUN = ORIGINAL_DRY_RUN
      if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL
      else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL
    })

    it('AC-7: 対象 0 件なら push されない', async () => {
      await seedSystemChannel()
      const fetchImpl = okFetch()
      const result = await sendEntryOverdueAlert(testDb, {
        today,
        baseUrl: 'https://kagetra.example.com',
        fetchImpl,
      })
      expect(result).toEqual({ skipped: 'no-candidates' })
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    // AC-28 を送信経路まで通して確認する。抽出で落ちるので「対象 0 件」に
    // 合流し、push は起きない。
    it('AC-28: 出欠 0 名の締切超過大会しか無ければ push されない', async () => {
      await createEvent({
        title: '出欠0名',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      await seedSystemChannel()
      const fetchImpl = okFetch()
      const result = await sendEntryOverdueAlert(testDb, {
        today,
        baseUrl: 'https://kagetra.example.com',
        fetchImpl,
      })
      expect(result).toEqual({ skipped: 'no-candidates' })
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('AC-6: 対象 1 件以上なら push は 1 回だけ', async () => {
      await createEventWithAttendee({
        title: '対象',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      await seedSystemChannel()
      const fetchImpl = okFetch()
      const result = await sendEntryOverdueAlert(testDb, {
        today,
        baseUrl: 'https://kagetra.example.com',
        fetchImpl,
      })
      expect(result).toMatchObject({ sent: true, candidateCount: 1, pushOutcome: 'sent' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('AC-13: 同一グループの複数大会は push 1 回・本文がグループ1行に集約される', async () => {
      const group = await createEntryGroup()
      await createEventWithAttendee({
        title: '多摩A',
        eventDate: '2030-08-15',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
        entryGroupId: group.id,
      })
      await createEventWithAttendee({
        title: '多摩B',
        eventDate: '2030-08-11',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
        entryGroupId: group.id,
      })
      await seedSystemChannel()
      const fetchImpl = vi.fn<typeof fetch>(
        async () =>
          ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => '',
          }) as unknown as Response,
      )
      const result = await sendEntryOverdueAlert(testDb, {
        today,
        baseUrl: 'https://kagetra.example.com',
        fetchImpl,
      })
      // candidateCount は抽出行数（2 大会）のまま、push 回数はグループ 1 行分の 1 回。
      expect(result).toMatchObject({ sent: true, candidateCount: 2, pushOutcome: 'sent' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)

      const [, requestInit] = fetchImpl.mock.calls[0]!
      const body = JSON.parse(String(requestInit!.body)) as { messages: Array<{ text: string }> }
      const text = body.messages[0]!.text
      expect(text).toContain('多摩AB')
      expect(text).toContain('8/11(日)多摩B')
      expect(text).toContain('8/15(木)多摩A')
    })

    it('AC-11: system_notify チャネル未設定は throw せずスキップ＋警告', async () => {
      await createEventWithAttendee({
        title: '対象',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      const fetchImpl = okFetch()
      const warn = vi.fn()
      const result = await sendEntryOverdueAlert(testDb, {
        today,
        baseUrl: 'https://kagetra.example.com',
        fetchImpl,
        logger: { info: vi.fn(), warn },
      })
      expect(result).toEqual({ skipped: 'no-channel' })
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalled()
    })

    it('AC-11: notification_line_user_id 未設定は throw せずスキップ＋警告', async () => {
      await createEventWithAttendee({
        title: '対象',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      await seedSystemChannel({ notificationLineUserId: null })
      const fetchImpl = okFetch()
      const warn = vi.fn()
      const result = await sendEntryOverdueAlert(testDb, {
        today,
        baseUrl: 'https://kagetra.example.com',
        fetchImpl,
        logger: { info: vi.fn(), warn },
      })
      expect(result).toEqual({ skipped: 'no-user-id' })
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalled()
    })

    it('PUBLIC_BASE_URL 未設定は例外', async () => {
      await createEventWithAttendee({
        title: '対象',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      await seedSystemChannel()
      await expect(
        sendEntryOverdueAlert(testDb, { today, fetchImpl: okFetch() }),
      ).rejects.toThrow(/PUBLIC_BASE_URL/)
    })

    it.each(['new.hokudaicarta.com', 'http://kagetra.example.com', 'ftp://x'])(
      'PUBLIC_BASE_URL が https:// でない (%s) と例外',
      async (badUrl) => {
        await createEventWithAttendee({
          title: '対象',
          eventDate: '2030-01-01',
          internalDeadline: '2026-06-01',
          entryStatus: 'not_applied',
        })
        await seedSystemChannel()
        const fetchImpl = okFetch()
        // 裸のホストを通すと LINE 上でタップできない文字列が届くだけになる。
        await expect(
          sendEntryOverdueAlert(testDb, { today, baseUrl: badUrl, fetchImpl }),
        ).rejects.toThrow(/https:\/\//)
        expect(fetchImpl).not.toHaveBeenCalled()
      },
    )

    it('チャネル未設定のケースでは PUBLIC_BASE_URL 未設定に到達しない（throw しない）', async () => {
      await createEventWithAttendee({
        title: '対象',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      // system_notify チャネルは未設定・PUBLIC_BASE_URL も未設定のまま。
      const result = await sendEntryOverdueAlert(testDb, { today, fetchImpl: okFetch() })
      expect(result).toEqual({ skipped: 'no-channel' })
    })

    it('AC-10: 同じ引数で 2 回実行すると push は 2 回とも走り、event_lifecycle_notifications に行は増えない', async () => {
      await createEventWithAttendee({
        title: '対象',
        eventDate: '2030-01-01',
        internalDeadline: '2026-06-01',
        entryStatus: 'not_applied',
      })
      await seedSystemChannel()
      const fetchImpl = okFetch()
      const opts = { today, baseUrl: 'https://kagetra.example.com', fetchImpl }

      const first = await sendEntryOverdueAlert(testDb, opts)
      const second = await sendEntryOverdueAlert(testDb, opts)

      expect(first).toMatchObject({ sent: true })
      expect(second).toMatchObject({ sent: true })
      expect(fetchImpl).toHaveBeenCalledTimes(2)

      const rows = await testDb.select().from(eventLifecycleNotifications)
      expect(rows).toHaveLength(0)
    })
  })
})
