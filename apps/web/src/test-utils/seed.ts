import type { InferInsertModel } from 'drizzle-orm'
import {
  users,
  entryGroups,
  events,
  eventAttendances,
  mailMessages,
  tournamentDrafts,
} from '@kagetra/shared/schema'
import { testDb } from './db'

type NewUser = InferInsertModel<typeof users>
type NewEvent = InferInsertModel<typeof events>
type NewEventAttendance = InferInsertModel<typeof eventAttendances>
type NewMailMessage = InferInsertModel<typeof mailMessages>
type NewTournamentDraft = InferInsertModel<typeof tournamentDrafts>

/**
 * Create a user. Defaults to a member role with a unique email.
 * All schema fields are nullable/have defaults except id (auto-generated via crypto.randomUUID()).
 *
 * `lineUserId` defaults to `null` (unlinked). Tests that need a LINE-linked
 * user should override explicitly (e.g. `lineUserId: 'Utest-xxx', lineLinkedAt: new Date()`).
 */
export async function createUser(overrides: Partial<NewUser> = {}) {
  const uniqueId = crypto.randomUUID()
  const [user] = await testDb
    .insert(users)
    .values({
      name: `test-user-${uniqueId}`,
      email: `test-${uniqueId}@example.com`,
      role: 'member',
      isInvited: true,
      grade: 'A',
      lineUserId: null,
      ...overrides,
    })
    .returning()
  if (!user) throw new Error('Failed to insert test user')
  return user
}

export async function createAdmin(overrides: Partial<NewUser> = {}) {
  return createUser({ role: 'admin', ...overrides })
}

export async function createViceAdmin(overrides: Partial<NewUser> = {}) {
  return createUser({ role: 'vice_admin', ...overrides })
}

/**
 * entry-groups: 申込グループを1件作って id を返す。複数イベントを**同じグループ**に
 * 入れたいテストは、これで作った id を `createEvent({ entryGroupId })` へ渡す。
 */
export async function createEntryGroup() {
  const [group] = await testDb.insert(entryGroups).values({}).returning()
  if (!group) throw new Error('Failed to insert test entry group')
  return group
}

/**
 * Create an event. Required columns in schema: title, eventDate.
 * kind defaults to 'individual', status defaults to 'published', official defaults to true.
 *
 * entry-groups: `events.entry_group_id` は NOT NULL。**既定ではシングルトングループを
 * 自動生成する**ので、グループを意識しないテストは今までどおり `createEvent()` だけで動く。
 * 同一グループの複数日を作るテストだけが `entryGroupId` を明示する。
 */
export async function createEvent(overrides: Partial<NewEvent> = {}) {
  const entryGroupId = overrides.entryGroupId ?? (await createEntryGroup()).id
  const [event] = await testDb
    .insert(events)
    .values({
      title: 'Test Event',
      eventDate: '2030-01-01',
      kind: 'individual',
      ...overrides,
      entryGroupId,
    })
    .returning()
  if (!event) throw new Error('Failed to insert test event')
  return event
}

/**
 * Create an event attendance. Requires eventId, userId, attend.
 */
export async function createEventAttendance(
  overrides: Partial<NewEventAttendance> & Pick<NewEventAttendance, 'eventId' | 'userId'>,
) {
  const [attendance] = await testDb
    .insert(eventAttendances)
    .values({
      attend: true,
      ...overrides,
    })
    .returning()
  if (!attendance) throw new Error('Failed to insert test event attendance')
  return attendance
}

/**
 * Create a mail_messages row. Defaults are minimal so PR4 inbox tests can
 * spin one up in a single line.
 *
 * `messageId` (RFC 5322 Message-ID header) defaults to a random UUID — the
 * column has a UNIQUE constraint, so two seeds in the same test must not
 * collide. `receivedAt` defaults to "now" because the inbox UI orders by it
 * and tests don't generally care about the absolute value.
 */
export async function createMailMessage(overrides: Partial<NewMailMessage> = {}) {
  const [mail] = await testDb
    .insert(mailMessages)
    .values({
      messageId: `<test-${crypto.randomUUID()}@kagetra.test>`,
      fromAddress: 'organizer@example.com',
      fromName: 'Test Organizer',
      toAddresses: ['kagetra@example.com'],
      subject: 'Test mail subject',
      receivedAt: new Date(),
      bodyText: 'Test body',
      status: 'ai_done',
      classification: 'tournament',
      ...overrides,
    })
    .returning()
  if (!mail) throw new Error('Failed to insert test mail message')
  return mail
}

/**
 * Create a tournament_drafts row. `messageId` (the integer FK to
 * mail_messages.id) is required — pass the seeded mail's id. `extractedPayload`
 * defaults to an empty object so the jsonb column stays valid; tests that
 * exercise pre-fill should pass a richer ExtractionPayload-shaped value.
 */
export async function createTournamentDraft(
  overrides: Partial<NewTournamentDraft> & Pick<NewTournamentDraft, 'messageId'>,
) {
  const [draft] = await testDb
    .insert(tournamentDrafts)
    .values({
      status: 'pending_review',
      isCorrection: false,
      extractedPayload: {},
      promptVersion: 'test-1.0',
      aiModel: 'test-model',
      ...overrides,
    })
    .returning()
  if (!draft) throw new Error('Failed to insert test tournament draft')
  return draft
}
