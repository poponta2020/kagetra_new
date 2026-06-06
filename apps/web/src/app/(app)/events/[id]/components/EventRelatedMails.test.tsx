import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { eq } from 'drizzle-orm'
import {
  events,
  mailMessages,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import { closeTestDb, testDb, truncateAll } from '@/test-utils/db'
import {
  createEvent,
  createMailMessage,
  createTournamentDraft,
} from '@/test-utils/seed'
import { EventRelatedMails } from './EventRelatedMails'

/**
 * mail-inbox-mailer タスク5: 関連メールセクションのテスト。
 *
 * 3 経路（A: linked_event_id / B: tournament_drafts.event_id / C: events.tournament_draft_id）
 * のそれぞれを UNION で拾えること、重複しないこと、受信日降順になることを検証する。
 */
describe('EventRelatedMails (mail-inbox-mailer task5)', () => {
  beforeEach(async () => {
    await truncateAll()
  })
  afterAll(async () => {
    await closeTestDb()
  })

  it('関連メールが 1 件も無ければ何も描画しない', async () => {
    const ev = await createEvent({ title: 'no related' })
    const ui = await EventRelatedMails({ eventId: ev.id })
    expect(ui).toBeNull()
  })

  it('(A) linked_event_id 経由のメールを表示する', async () => {
    const ev = await createEvent({ title: 'linked-event' })
    const mail = await createMailMessage({ subject: '組合せ表 v1' })
    await testDb
      .update(mailMessages)
      .set({ linkedEventId: ev.id })
      .where(eq(mailMessages.id, mail.id))

    const ui = await EventRelatedMails({ eventId: ev.id })
    const { container } = render(ui!)

    expect(screen.getByText('関連メール (1)')).toBeTruthy()
    expect(screen.getByText('組合せ表 v1')).toBeTruthy()
    const link = container.querySelector('a[href]')
    expect(link?.getAttribute('href')).toBe(`/admin/mail-inbox/mail/${mail.id}`)
  })

  it('(B) tournament_drafts.event_id 経由のメールを表示する', async () => {
    const ev = await createEvent({ title: 'linked-draft' })
    const mail = await createMailMessage({ subject: '訂正版 mail' })
    await createTournamentDraft({
      messageId: mail.id,
      status: 'approved',
      eventId: ev.id,
    })

    const ui = await EventRelatedMails({ eventId: ev.id })
    const { container } = render(ui!)

    expect(screen.getByText('関連メール (1)')).toBeTruthy()
    expect(screen.getByText('訂正版 mail')).toBeTruthy()
    expect(container.querySelector('a[href]')?.getAttribute('href')).toBe(
      `/admin/mail-inbox/mail/${mail.id}`,
    )
  })

  it('(C) events.tournament_draft_id 経由のメールを表示する', async () => {
    const mail = await createMailMessage({ subject: 'AI 抽出元 mail' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'approved',
    })
    const ev = await createEvent({ title: 'AI 由来 event' })
    // tournament_draft_id を後付けで紐付け（createEvent helper は draft 連携を
    // サポートしていないので直接 UPDATE）。
    await testDb
      .update(events)
      .set({ tournamentDraftId: draft.id })
      .where(eq(events.id, ev.id))

    const ui = await EventRelatedMails({ eventId: ev.id })
    const { container } = render(ui!)

    expect(screen.getByText('関連メール (1)')).toBeTruthy()
    expect(screen.getByText('AI 抽出元 mail')).toBeTruthy()
    expect(container.querySelector('a[href]')?.getAttribute('href')).toBe(
      `/admin/mail-inbox/mail/${mail.id}`,
    )
  })

  it('3 経路の重複は mail_id で dedup される', async () => {
    const mail = await createMailMessage({ subject: '重複 mail' })
    const draft = await createTournamentDraft({
      messageId: mail.id,
      status: 'approved',
    })
    const ev = await createEvent({ title: 'multi-route' })
    // (A): linked_event_id
    await testDb
      .update(mailMessages)
      .set({ linkedEventId: ev.id })
      .where(eq(mailMessages.id, mail.id))
    // (B): tournament_drafts.event_id
    await testDb
      .update(tournamentDrafts)
      .set({ eventId: ev.id })
      .where(eq(tournamentDrafts.id, draft.id))
    // (C): events.tournament_draft_id
    await testDb
      .update(events)
      .set({ tournamentDraftId: draft.id })
      .where(eq(events.id, ev.id))

    const ui = await EventRelatedMails({ eventId: ev.id })
    render(ui!)

    // 同じ mail が 3 経路で拾えても 1 件としてカウント。
    expect(screen.getByText('関連メール (1)')).toBeTruthy()
  })

  it('受信日降順で並ぶ', async () => {
    const ev = await createEvent({ title: 'order check' })
    const old = await createMailMessage({
      subject: 'older mail',
      receivedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const newer = await createMailMessage({
      subject: 'newer mail',
      receivedAt: new Date('2026-06-01T00:00:00Z'),
    })
    await testDb
      .update(mailMessages)
      .set({ linkedEventId: ev.id })
      .where(eq(mailMessages.id, old.id))
    await testDb
      .update(mailMessages)
      .set({ linkedEventId: ev.id })
      .where(eq(mailMessages.id, newer.id))

    const ui = await EventRelatedMails({ eventId: ev.id })
    const { container } = render(ui!)

    const subjects = Array.from(container.querySelectorAll('span.font-medium')).map(
      (el) => el.textContent,
    )
    expect(subjects).toEqual(['newer mail', 'older mail'])
  })
})
