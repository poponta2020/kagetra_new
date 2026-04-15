import { pgEnum } from 'drizzle-orm/pg-core'

export const userRoleEnum = pgEnum('user_role', ['admin', 'vice_admin', 'member'])
export const eventStatusEnum = pgEnum('event_status', ['draft', 'published', 'cancelled'])
