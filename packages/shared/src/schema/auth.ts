import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { AdapterAccountType } from '@auth/core/adapters'
import { userRoleEnum, gradeEnum, genderEnum } from './enums'

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text('name').unique(),
    email: text('email').unique(),
    emailVerified: timestamp('email_verified', { mode: 'date' }),
    image: text('image'),
    // kagetra extensions
    lineUserId: text('line_user_id').unique(),
    role: userRoleEnum('role').notNull().default('member'),
    grade: gradeEnum('grade'),
    isInvited: boolean('is_invited').notNull().default(false),
    invitedAt: timestamp('invited_at', { mode: 'date' }),
    passwordHash: text('password_hash'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    // Phase 1-5 PR-B: extended profile fields
    gender: genderEnum('gender'),
    affiliation: text('affiliation'),
    dan: integer('dan'),
    zenNichikyo: boolean('zen_nichikyo').notNull().default(false),
    deactivatedAt: timestamp('deactivated_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // dan is 段位 (kyu/dan rank). Valid range is 0–9; enforce at the DB layer
    // so batch/SQL updates cannot bypass the application-level validation.
    check('users_dan_range', sql`${table.dan} BETWEEN 0 AND 9 OR ${table.dan} IS NULL`),
  ],
)

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => [
    primaryKey({ columns: [vt.identifier, vt.token] }),
  ]
)
