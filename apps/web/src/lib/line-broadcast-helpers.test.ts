import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  entryGroups,
  eventBroadcastMessages,
  eventLineBroadcasts,
  events,
  lineChannels,
} from '@kagetra/shared/schema'
import { truncateAll } from '@/test-utils/db'
import { createEntryGroup } from '@/test-utils/seed'
import { db } from './db'
import {
  applyPushFailureRecovery,
  assertBindingUnchangedByEntryGroup,
  isBindingChanged,
  loadActiveBindingByEntryGroup,
} from './line-broadcast'

/**
 * openchat-broadcast タスク6 で `broadcastMailToEvent` から切り出した再利用
 * ヘルパーの直接テスト。既存の `line-broadcast.test.ts`（無改変で green）は
 * 「切り出す前の経路が壊れていないこと」の網で、こちらは「切り出した関数を
 * オープンチャット配信から呼んだときに正しく動くこと」を見る。
 *
 * ★特に検証したいのは、これらのヘルパーが **event_broadcast_messages に
 * 一切書かない**こと（requirements §6 の契約）。ここに書き込みが混ざると、
 * 同テーブルの UNIQUE(event_line_broadcast_id, mail_message_id) により
 * 「同じメールから2回目のオープンチャット配信」が制約違反で落ちる。
 */

/**
 * ★共通の `truncateAll()` を使う（このファイル固有の手書き削除は使わない）。
 *
 * 以前は `eventBroadcastMessages → eventLineBroadcasts → lineChannels → events →
 * entryGroups` を順に `delete` していたが、`tournament_entry_rosters` /
 * `tournament_entry_roster_files` → `entry_groups` の FK は **RESTRICT** なので、
 * このファイルより前に走ったテストファイルが名簿行を残していると
 * `delete from entry_groups` が FK 違反で落ちる（実測: confirmed-roster-signal で
 * `src/lib/events/confirmed-roster.test.ts` を足したところ、実行順が隣接して 17 件が
 * 一斉に落ちた）。リポジトリの規約どおり `truncateAll()`（CASCADE）へ寄せる。
 */
async function resetDb() {
  await truncateAll()
}

let originalBaseUrl: string | undefined

beforeAll(() => {
  originalBaseUrl = process.env.PUBLIC_BASE_URL
  process.env.PUBLIC_BASE_URL = 'https://test.example.com'
})

afterAll(() => {
  if (originalBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = originalBaseUrl
})

beforeEach(async () => {
  await resetDb()
})

/** linked な binding（channel 込み）を1組つくる。 */
async function seedLinkedBinding() {
  const channel = (
    await db
      .insert(lineChannels)
      .values({
        channelId: `ch-helper-${Math.random().toString(36).slice(2, 10)}`,
        channelSecret: 'secret',
        channelAccessToken: 'token',
        botId: '@kagetra-event-bot-test',
        purpose: 'event_broadcast',
        status: 'active',
      })
      .returning()
  )[0]!

  const entryGroupId = (await createEntryGroup()).id

  await db
    .update(lineChannels)
    .set({ assignedEntryGroupId: entryGroupId })
    .where(eq(lineChannels.id, channel.id))

  const broadcast = (
    await db
      .insert(eventLineBroadcasts)
      .values({
        entryGroupId,
        lineChannelId: channel.id,
        status: 'linked',
        lineGroupId: 'C123456789',
        linkedAt: new Date(),
      })
      .returning()
  )[0]!

  return { channel, entryGroupId, broadcast }
}

describe('isBindingChanged', () => {
  const base = {
    id: 1,
    eventId: -1,
    entryGroupId: 10,
    lineChannelId: 5,
    status: 'linked',
    lineGroupId: 'C1',
    channel: { id: 5, channelAccessToken: 'tok' },
  }

  it('同一の binding なら変更なし', () => {
    expect(isBindingChanged(base, { ...base })).toBe(false)
  })

  it('binding が消えていれば変更ありとみなす', () => {
    expect(isBindingChanged(base, null)).toBe(true)
  })

  it('lineGroupId が変わっていれば変更あり', () => {
    expect(isBindingChanged(base, { ...base, lineGroupId: 'C2' })).toBe(true)
  })

  it('channelAccessToken が変わっていれば変更あり（失効トークンへの送信を防ぐ）', () => {
    expect(
      isBindingChanged(base, { ...base, channel: { id: 5, channelAccessToken: 'tok2' } }),
    ).toBe(true)
  })

  it('binding 行そのものが別 id に差し替わっていれば変更あり', () => {
    expect(isBindingChanged(base, { ...base, id: 2 })).toBe(true)
  })
})

describe('loadActiveBindingByEntryGroup', () => {
  it('linked な binding を申込グループ基準で引ける（events を経由しない）', async () => {
    const { entryGroupId, channel } = await seedLinkedBinding()
    const binding = await loadActiveBindingByEntryGroup(db, entryGroupId)
    expect(binding).not.toBeNull()
    expect(binding!.entryGroupId).toBe(entryGroupId)
    expect(binding!.lineGroupId).toBe('C123456789')
    expect(binding!.channel.channelAccessToken).toBe(channel.channelAccessToken)
  })

  it('紐付けが無いグループでは null（保存のみ・配信しないケース）', async () => {
    const entryGroupId = (await createEntryGroup()).id
    await expect(loadActiveBindingByEntryGroup(db, entryGroupId)).resolves.toBeNull()
  })

  it('revoked な binding は返さない', async () => {
    const { entryGroupId, broadcast } = await seedLinkedBinding()
    await db
      .update(eventLineBroadcasts)
      .set({ status: 'revoked' })
      .where(eq(eventLineBroadcasts.id, broadcast.id))
    await expect(loadActiveBindingByEntryGroup(db, entryGroupId)).resolves.toBeNull()
  })
})

describe('assertBindingUnchangedByEntryGroup', () => {
  it('紐付けが変わっていなければ changed=false', async () => {
    const { entryGroupId } = await seedLinkedBinding()
    const binding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!
    const verdict = await assertBindingUnchangedByEntryGroup(db, entryGroupId, binding)
    expect(verdict.changed).toBe(false)
    expect(verdict.current).not.toBeNull()
  })

  it('配信直前に紐付けが解除されていれば changed=true（AC-39）', async () => {
    const { entryGroupId, broadcast } = await seedLinkedBinding()
    const binding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!
    await db
      .update(eventLineBroadcasts)
      .set({ status: 'revoked' })
      .where(eq(eventLineBroadcasts.id, broadcast.id))

    const verdict = await assertBindingUnchangedByEntryGroup(db, entryGroupId, binding)
    expect(verdict.changed).toBe(true)
    expect(verdict.current).toBeNull()
  })

  it('判定は event_broadcast_messages に一切書かない（§6 の契約）', async () => {
    const { entryGroupId } = await seedLinkedBinding()
    const binding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!
    await assertBindingUnchangedByEntryGroup(db, entryGroupId, binding)
    await expect(db.select().from(eventBroadcastMessages)).resolves.toHaveLength(0)
  })
})

describe('applyPushFailureRecovery', () => {
  it('401 で channel を disabled にし binding を revoke する', async () => {
    const { entryGroupId, channel } = await seedLinkedBinding()
    const binding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!

    await applyPushFailureRecovery({ db, binding, httpStatus: 401 })

    const [broadcastRow] = await db
      .select()
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.id, binding.id))
    expect(broadcastRow!.status).toBe('revoked')
    expect(broadcastRow!.revokeReason).toBe('channel_disabled')

    const [channelRow] = await db
      .select()
      .from(lineChannels)
      .where(eq(lineChannels.id, channel.id))
    expect(channelRow!.status).toBe('disabled')
    expect(channelRow!.assignedEntryGroupId).toBeNull()
  })

  it('403 / 404（Bot 追放・宛先消失）では binding を revoke し channel をプールへ戻す', async () => {
    const { entryGroupId, channel } = await seedLinkedBinding()
    const binding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!

    await applyPushFailureRecovery({ db, binding, httpStatus: 404 })

    const [broadcastRow] = await db
      .select()
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.id, binding.id))
    expect(broadcastRow!.status).toBe('revoked')
    expect(broadcastRow!.revokeReason).toBe('line_api_4xx')

    const [channelRow] = await db
      .select()
      .from(lineChannels)
      .where(eq(lineChannels.id, channel.id))
    // disabled ではなく available（再紐付けに使える）。
    expect(channelRow!.status).toBe('available')
    expect(channelRow!.assignedEntryGroupId).toBeNull()
  })

  it('400（メッセージ内容の不備）では紐付けを解除しない（requirements §6）', async () => {
    // ★textV2 の導入でペイロード起因の 400 が起こりうる。宛先と無関係な不備で
    // 正常な紐付けを壊すと、その大会の通知が以後すべて止まる。
    const { entryGroupId, channel } = await seedLinkedBinding()
    const binding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!

    await applyPushFailureRecovery({ db, binding, httpStatus: 400 })

    const [broadcastRow] = await db
      .select()
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.id, binding.id))
    expect(broadcastRow!.status).toBe('linked')
    expect(broadcastRow!.revokeReason).toBeNull()

    const [channelRow] = await db
      .select()
      .from(lineChannels)
      .where(eq(lineChannels.id, channel.id))
    expect(channelRow!.status).toBe('active')
    expect(channelRow!.assignedEntryGroupId).toBe(entryGroupId)
  })

  it('429（rate limit）ではリトライ可能なので何も変えない', async () => {
    const { entryGroupId } = await seedLinkedBinding()
    const binding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!

    await applyPushFailureRecovery({ db, binding, httpStatus: 429 })

    const [broadcastRow] = await db
      .select()
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.id, binding.id))
    expect(broadcastRow!.status).toBe('linked')
  })

  it('5xx / transport error（httpStatus=null）では何も変えない', async () => {
    const { entryGroupId } = await seedLinkedBinding()
    const binding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!

    await applyPushFailureRecovery({ db, binding, httpStatus: 500 })
    await applyPushFailureRecovery({ db, binding, httpStatus: null })

    const [broadcastRow] = await db
      .select()
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.id, binding.id))
    expect(broadcastRow!.status).toBe('linked')
  })

  it('送信中に別の binding へ差し替わっていたら新 binding を壊さない（stale cleanup skip）', async () => {
    const { entryGroupId, channel, broadcast } = await seedLinkedBinding()
    const staleBinding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!

    // 管理者が送信中に連携解除 → 別の LINE グループへ再紐付けした状況を作る。
    await db
      .update(eventLineBroadcasts)
      .set({ lineGroupId: 'C999999999' })
      .where(eq(eventLineBroadcasts.id, broadcast.id))

    await applyPushFailureRecovery({ db, binding: staleBinding, httpStatus: 401 })

    const [broadcastRow] = await db
      .select()
      .from(eventLineBroadcasts)
      .where(eq(eventLineBroadcasts.id, broadcast.id))
    // 新しい紐付けは linked のまま残る。
    expect(broadcastRow!.status).toBe('linked')

    const [channelRow] = await db
      .select()
      .from(lineChannels)
      .where(eq(lineChannels.id, channel.id))
    // binding の UPDATE が 0 件だったので channel 解放も連動して skip される。
    expect(channelRow!.status).toBe('active')
    expect(channelRow!.assignedEntryGroupId).toBe(entryGroupId)
  })

  it('復旧処理は event_broadcast_messages に一切書かない（§6 の契約）', async () => {
    const { entryGroupId } = await seedLinkedBinding()
    const binding = (await loadActiveBindingByEntryGroup(db, entryGroupId))!

    await applyPushFailureRecovery({ db, binding, httpStatus: 401 })

    await expect(db.select().from(eventBroadcastMessages)).resolves.toHaveLength(0)
  })
})
