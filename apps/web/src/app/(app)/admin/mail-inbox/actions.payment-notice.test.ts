import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroupPaymentNotices,
  entryGroups,
  eventLineBroadcasts,
  events,
  lineChannels,
  mailAttachments,
  mailMessages,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import { createAdmin, createEvent, createMailMessage } from '@/test-utils/seed'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * processMail への振込連絡の相乗り（line-bot-message-revamp §3.3.5 / AC-38〜AC-46）。
 *
 * ここが持つのは **配線と保存**:
 *   - 受け付ける条件のサーバー側再判定（fail-closed）
 *   - 共通項目（支払締切・振込先）がグループ内の**全日**へ保存されること
 *   - `after()` の中で **配信 → 振込連絡** の順に呼ばれること
 *   - 取り消し（世代トークン不一致）で送られないこと
 *
 * 送信そのもの（人数保存・push・成否の記録）は `lib/events/payment-notice-send.test.ts`、
 * 露出判定は `payment-notice-actions.test.ts` が持つ。
 */

const { afterMock, broadcastMailToEventMock, sendPaymentNoticeCoreMock, callOrder } = vi.hoisted(
  () => {
    const callOrder: string[] = []
    return {
      callOrder,
      // 既定は no-op（after() は Next.js の request scope 外では例外を投げる）。
      // 配信順を見るテストだけ即時実行へ差し替える。
      afterMock: vi.fn((_cb: () => void | Promise<void>) => {}),
      broadcastMailToEventMock: vi.fn(async () => {
        callOrder.push('broadcast')
        return {
          status: 'skipped' as const,
          reason: 'mocked',
          sentTextCount: 0,
          sentImageCount: 0,
          fallbackLinkCount: 0,
        }
      }),
      sendPaymentNoticeCoreMock: vi.fn(
        async (
          _db: unknown,
          args: { abortBeforePush?: () => Promise<boolean> },
        ): Promise<{ outcome: 'sent'; totalJpy: number } | { outcome: 'aborted' }> => {
          // 実装と同じく push の直前で中止判定を引く（AC-46 の配線検証）。
          if (args.abortBeforePush && (await args.abortBeforePush())) {
            return { outcome: 'aborted' }
          }
          callOrder.push('paymentNotice')
          return { outcome: 'sent', totalJpy: 5000 }
        },
      ),
    }
  },
)

vi.mock('@/auth', () => mockAuthModule())
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => afterMock(cb) }
})
vi.mock('@/lib/line-broadcast', () => ({
  broadcastMailToEvent: broadcastMailToEventMock,
  loadActiveBinding: vi.fn(async () => null),
}))
vi.mock('@/lib/open-chat/broadcast', () => ({
  runOpenChatBroadcast: vi.fn(async () => ({ status: 'sent' as const, sentCount: 0 })),
}))
// ★このモジュールは `resolveTargetGrades`（参加費の級解決が使う純関数）も
// export しているので、丸ごと差し替えず配信関数だけを上書きする。
vi.mock('@/lib/event-grade-broadcast', async () => {
  const actual = await vi.importActual<typeof import('@/lib/event-grade-broadcast')>(
    '@/lib/event-grade-broadcast',
  )
  return {
    ...actual,
    broadcastEventsToGradeGroups: vi.fn(async () => ({
      sentGrades: [],
      skippedGrades: [],
      failedGrades: [],
      notified: false,
    })),
  }
})
vi.mock('@kagetra/mail-worker/classify/classifier', () => ({
  classifyMail: vi.fn(async () => ({ kind: 'noise' as const, result: {} })),
  persistOutcome: vi.fn(async () => ({})),
}))
vi.mock('@kagetra/mail-worker/classify/llm/anthropic', () => ({
  AnthropicExtractor: class {
    readonly modelId = 'mock'
    constructor(_opts: unknown) {}
  },
}))
vi.mock('@kagetra/mail-worker/config', () => ({
  loadLlmConfig: () => ({ anthropicApiKey: 'mock-anthropic-key' }),
  loadCostGuardConfig: () => ({ MAIL_WORKER_PDF_SIZE_LIMIT_KB: 8000 }),
}))
// 送信本体だけスパイに差し替える。`recordPaymentNoticeFailure`（試行記録の書き込み）は
// **実物を使う** — この経路の検証対象そのものなので、mock すると DB への記録を確認できない。
vi.mock('@/lib/events/payment-notice-send', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events/payment-notice-send')>(
    '@/lib/events/payment-notice-send',
  )
  return { ...actual, sendPaymentNoticeCore: sendPaymentNoticeCoreMock }
})

const { processMail, undoTriage } = await import('./actions')

/** `after()` に積まれたコールバックをその場で実行する。 */
function runAfterImmediately() {
  afterMock.mockImplementation((cb: () => void | Promise<void>) => {
    void Promise.resolve(cb())
  })
}

async function linkLineGroup(entryGroupId: number) {
  const [channel] = await testDb
    .insert(lineChannels)
    .values({
      channelId: `ch-${entryGroupId}-${Math.random().toString(36).slice(2, 8)}`,
      channelSecret: 'secret',
      channelAccessToken: 'token',
      botId: '@bot',
      purpose: 'event_broadcast',
      status: 'active',
    })
    .returning({ id: lineChannels.id })
  await testDb.insert(eventLineBroadcasts).values({
    entryGroupId,
    lineChannelId: channel!.id,
    status: 'linked',
    lineGroupId: 'C1234567890',
    linkedAt: new Date(),
  })
}

/**
 * 確定名簿メールを処理する直前の姿: 申込済・事前払い・未振込の個人戦2日
 * （うち1日は中止）＋ LINE 紐付けあり。**振込期限と振込先は空**（杉並AB 型）。
 */
async function seedGroup() {
  const [group] = await testDb.insert(entryGroups).values({}).returning()
  const groupId = group!.id
  const common = {
    entryGroupId: groupId,
    official: true,
    kind: 'individual' as const,
    eligibleGrades: null,
    entryStatus: 'applied' as const,
    paymentType: 'advance' as const,
    paymentStatus: 'unpaid' as const,
    paymentDeadline: null,
    paymentDeadlineKind: 'unspecified' as const,
    paymentInfo: null,
  }
  const day1 = await createEvent({ ...common, eventDate: '2030-06-01', title: '大会 1日目' })
  const day2 = await createEvent({ ...common, eventDate: '2030-06-02', title: '大会 2日目' })
  const cancelled = await createEvent({
    ...common,
    eventDate: '2030-06-03',
    title: '大会 3日目',
    status: 'cancelled',
  })
  await linkLineGroup(groupId)
  return { groupId, day1, day2, cancelled }
}

const NOTICE = {
  send: true,
  counts: { A: 2 },
  paymentDeadline: '2030-05-25',
  paymentDeadlineKind: 'fixed',
  paymentInfo: '〇〇銀行 普通 1234567',
}

async function baseInput(groupId: number, overrides: Record<string, unknown> = {}) {
  return {
    mailKind: 'confirmed_roster' as const,
    entryGroupId: groupId,
    rosterFiles: [],
    broadcast: false,
    includeBody: true,
    ...overrides,
  }
}

async function eventRows(groupId: number) {
  return testDb.select().from(events).where(eq(events.entryGroupId, groupId))
}

describe('processMail: 会計への振込連絡', () => {
  beforeEach(async () => {
    await truncateAll()
    callOrder.length = 0
    afterMock.mockReset()
    afterMock.mockImplementation((_cb: () => void | Promise<void>) => {})
    broadcastMailToEventMock.mockClear()
    sendPaymentNoticeCoreMock.mockClear()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  async function asAdmin() {
    const admin = await createAdmin({ name: `pnm-admin-${Math.random().toString(36).slice(2, 8)}` })
    await setAuthSession({ id: admin.id, role: 'admin' })
    return admin
  }

  it('共通項目が中止の日も含むグループ内の全日へ保存される（AC-40）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })

    const result = await processMail(mail.id, await baseInput(groupId, { paymentNotice: NOTICE }))
    expect(result.ok).toBe(true)

    const rows = await eventRows(groupId)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.paymentInfo).toBe('〇〇銀行 普通 1234567')
      expect(row.paymentDeadline).toBe('2030-05-25')
      // 日付があるなら kind は必ず fixed（events の CHECK を満たす）。
      expect(row.paymentDeadlineKind).toBe('fixed')
    }
    // 中止の日にも入る（`saveGroupCommonFields` と対象を揃える）。
    expect(rows.filter((r) => r.status === 'cancelled')[0]?.paymentInfo).toBe(
      '〇〇銀行 普通 1234567',
    )
  })

  it('チェックを外しても共通項目は保存され、push はしない（AC-42）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    // send: false では after() 自体が登録されない（配信 OFF・送信 OFF）。
    runAfterImmediately()

    const result = await processMail(
      mail.id,
      await baseInput(groupId, { paymentNotice: { ...NOTICE, send: false } }),
    )
    expect(result.ok).toBe(true)
    expect(sendPaymentNoticeCoreMock).not.toHaveBeenCalled()
    const rows = await eventRows(groupId)
    expect(rows.every((r) => r.paymentInfo === '〇〇銀行 普通 1234567')).toBe(true)
  })

  it('セクションが出ていなければ共通項目も保存しない（AC-42b）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })

    // paymentNotice 自体を渡さない = 画面にセクションが出ていない。
    const result = await processMail(mail.id, await baseInput(groupId))
    expect(result.ok).toBe(true)
    const rows = await eventRows(groupId)
    expect(rows.every((r) => r.paymentInfo === null)).toBe(true)
    expect(rows.every((r) => r.paymentDeadline === null)).toBe(true)
  })

  it('チェック ON で振込先が空なら実行を拒否する（AC-38）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })

    const result = await processMail(
      mail.id,
      await baseInput(groupId, { paymentNotice: { ...NOTICE, paymentInfo: '   ' } }),
    )
    expect(result).toEqual({ ok: false, error: '振込先を入力してください（振込連絡を送る場合）' })
    // 実行そのものが止まるので triage も動かない。
    const after = await testDb.query.mailMessages.findFirst({
      where: eq(mailMessages.id, mail.id),
    })
    expect(after?.triageStatus).toBe('unprocessed')
  })

  it('チェック OFF なら振込先が空でも実行できる（§3.3.5.3）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })

    const result = await processMail(
      mail.id,
      await baseInput(groupId, {
        paymentNotice: { ...NOTICE, send: false, paymentInfo: '' },
      }),
    )
    expect(result.ok).toBe(true)
  })

  it('支払締切が空でも送れる（AC-39）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })

    const result = await processMail(
      mail.id,
      await baseInput(groupId, {
        paymentNotice: { ...NOTICE, paymentDeadline: '', paymentDeadlineKind: 'later_notice' },
      }),
    )
    expect(result.ok).toBe(true)
    const rows = await eventRows(groupId)
    // 日付が無いので kind は fixed にならない（CHECK を満たす組み合わせ）。
    expect(rows.every((r) => r.paymentDeadline === null)).toBe(true)
    expect(rows.every((r) => r.paymentDeadlineKind === 'later_notice')).toBe(true)
  })

  it('人数が全級0なら実行を拒否する', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })

    const result = await processMail(
      mail.id,
      await baseInput(groupId, { paymentNotice: { ...NOTICE, counts: { A: 0 } } }),
    )
    expect(result).toEqual({ ok: false, error: '人数が全級0名です。1名以上にしてください' })
  })

  it('種別が確定名簿でなければ受け付けない（fail-closed）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })

    const result = await processMail(
      mail.id,
      await baseInput(groupId, { mailKind: 'applicant_roster', paymentNotice: NOTICE }),
    )
    expect(result).toEqual({
      ok: false,
      error: '振込連絡は確定名簿の処理でのみ指定できます',
    })
  })

  it('送信できない状態で send: true なら受け付けない（fail-closed）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    // 全日を支払済みにする＝振込は不要（§3.3.5.2）。
    await testDb
      .update(events)
      .set({ paymentStatus: 'paid' })
      .where(eq(events.entryGroupId, groupId))
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })

    const result = await processMail(mail.id, await baseInput(groupId, { paymentNotice: NOTICE }))
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('支払済みです')
  })

  it('送信できない状態でも send: false なら共通項目は保存する（§3.3.5.3）', async () => {
    // ★ゲートが掛かるのは push だけ（Codex R1 blocker）。保存まで止めると、
    // LINE 未紐付け・未申込のグループで振込先を入れる場所が無くなる。
    await asAdmin()
    const { groupId } = await seedGroup()
    await testDb
      .update(events)
      .set({ paymentStatus: 'paid' })
      .where(eq(events.entryGroupId, groupId))
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    runAfterImmediately()

    const result = await processMail(
      mail.id,
      await baseInput(groupId, { paymentNotice: { ...NOTICE, send: false } }),
    )
    expect(result.ok).toBe(true)
    expect(sendPaymentNoticeCoreMock).not.toHaveBeenCalled()
    const rows = await eventRows(groupId)
    expect(rows.every((r) => r.paymentInfo === '〇〇銀行 普通 1234567')).toBe(true)
  })

  it('送信時の再検証で対象外になったら試行記録を残す（Codex R1 blocker）', async () => {
    // 先行する LINE 配信が 400 で紐付けを revoke した場合など。黙って return すると
    // processMail は {ok:true} を返し画面もメール一覧へ戻るので、どこにも痕跡が残らない。
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    // after() を溜めておき、コミット後・push 前に紐付けを落とす。
    let queued: (() => void | Promise<void>) | null = null
    afterMock.mockImplementation((cb: () => void | Promise<void>) => {
      queued = cb
    })
    const result = await processMail(mail.id, await baseInput(groupId, { paymentNotice: NOTICE }))
    expect(result.ok).toBe(true)

    await testDb
      .update(eventLineBroadcasts)
      .set({ status: 'revoked' })
      .where(eq(eventLineBroadcasts.entryGroupId, groupId))
    await (queued as unknown as () => Promise<void>)()

    expect(sendPaymentNoticeCoreMock).not.toHaveBeenCalled()
    const row = await testDb.query.entryGroupPaymentNotices.findFirst({
      where: eq(entryGroupPaymentNotices.entryGroupId, groupId),
    })
    expect(row?.lastSentAt).toBeNull()
    expect(row?.lastAttemptedAt).not.toBeNull()
    expect(row?.lastError).toContain('LINE グループが紐付いていません')
  })

  it('LINE 配信も ON のとき、振込連絡は配信の後に呼ばれる（AC-44）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    runAfterImmediately()

    const result = await processMail(
      mail.id,
      await baseInput(groupId, { broadcast: true, paymentNotice: NOTICE }),
    )
    expect(result.ok).toBe(true)
    await vi.waitFor(() => expect(callOrder).toEqual(['broadcast', 'paymentNotice']))
  })

  it('LINE 配信が OFF でも振込連絡は送られる', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    runAfterImmediately()

    await processMail(mail.id, await baseInput(groupId, { paymentNotice: NOTICE }))
    await vi.waitFor(() => expect(callOrder).toEqual(['paymentNotice']))
    expect(broadcastMailToEventMock).not.toHaveBeenCalled()
  })

  it('採用が失敗して全体がロールバックしたときは送られない（AC-43 / AC-49）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    runAfterImmediately()

    const result = await processMail(
      mail.id,
      await baseInput(groupId, {
        // 実在しない添付 id を採用させて tx を失敗させる。
        rosterFiles: [{ attachmentId: 999_999, grades: null }],
        paymentNotice: NOTICE,
      }),
    )
    expect(result.ok).toBe(false)
    expect(sendPaymentNoticeCoreMock).not.toHaveBeenCalled()
    // 共通項目もロールバックされている。
    const rows = await eventRows(groupId)
    expect(rows.every((r) => r.paymentInfo === null)).toBe(true)
  })

  it('取り消された後は世代トークン不一致で送られない（AC-46）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })

    // after() を溜めておき、取り消してから実行する。
    let queued: (() => void | Promise<void>) | null = null
    afterMock.mockImplementation((cb: () => void | Promise<void>) => {
      queued = cb
    })
    const result = await processMail(mail.id, await baseInput(groupId, { paymentNotice: NOTICE }))
    expect(result.ok).toBe(true)

    await undoTriage(mail.id)
    await (queued as unknown as () => Promise<void>)()

    expect(sendPaymentNoticeCoreMock).not.toHaveBeenCalled()
    expect(callOrder).toEqual([])
  })

  it('添付を1件も採用しない確定名簿メールでも送れる（Issue #509 型・AC-33）', async () => {
    await asAdmin()
    const { groupId } = await seedGroup()
    const mail = await createMailMessage({ triageStatus: 'unprocessed' })
    // 添付はあるが採用しない。
    await testDb.insert(mailAttachments).values({
      mailMessageId: mail.id,
      filename: '案内.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      data: Buffer.from('abc'),
    })
    runAfterImmediately()

    const result = await processMail(mail.id, await baseInput(groupId, { paymentNotice: NOTICE }))
    expect(result.ok).toBe(true)
    await vi.waitFor(() => expect(callOrder).toEqual(['paymentNotice']))
  })
})
