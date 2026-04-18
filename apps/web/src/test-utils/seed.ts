import type { InferInsertModel } from 'drizzle-orm'
import { users, events, eventAttendances, eventGroups } from '@kagetra/shared/schema'
import { testDb } from './db'

type NewUser = InferInsertModel<typeof users>
type NewEvent = InferInsertModel<typeof events>
type NewEventAttendance = InferInsertModel<typeof eventAttendances>
type NewEventGroup = InferInsertModel<typeof eventGroups>

/**
 * Create a user. Defaults to a member role with a unique email.
 * All schema fields are nullable/have defaults except id (auto-generated via crypto.randomUUID()).
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
 * Create an event. Required columns in schema: title, eventDate.
 * kind defaults to 'individual', status defaults to 'draft', official defaults to true.
 */
export async function createEvent(overrides: Partial<NewEvent> = {}) {
  const [event] = await testDb
    .insert(events)
    .values({
      title: 'Test Event',
      eventDate: '2030-01-01',
      kind: 'individual',
      ...overrides,
    })
    .returning()
  if (!event) throw new Error('Failed to insert test event')
  return event
}

export async function createEventGroup(overrides: Partial<NewEventGroup> = {}) {
  const [group] = await testDb
    .insert(eventGroups)
    .values({
      name: `Test Group ${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning()
  if (!group) throw new Error('Failed to insert test event group')
  return group
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
