import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { AdapterAccountType } from '@auth/core/adapters'
import {
  userRoleEnum,
  gradeEnum,
  genderEnum,
  lineLinkMethodEnum,
  facultyKindEnum,
} from './enums'

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
    // line-bot-message-revamp: 「@会計 で誰をメンションするか」の識別だけに使う列。
    // **認可判断には一切使わない**（会計の権限は副管理者と同一なので、会計担当には
    // role='vice_admin' を付与して運用する。requirements §3.1.1 / §6）。
    // ロール enum を増やさないのは、`role !== 'admin' && role !== 'vice_admin'` の
    // 判定が43ファイル・58箇所にインライン展開されているため（§7-1）。
    isTreasurer: boolean('is_treasurer').notNull().default(false),
    grade: gradeEnum('grade'),
    isInvited: boolean('is_invited').notNull().default(false),
    invitedAt: timestamp('invited_at', { mode: 'date' }),
    // Phase 1-5 PR-B: extended profile fields
    gender: genderEnum('gender'),
    affiliation: text('affiliation'),
    dan: integer('dan'),
    zenNichikyo: boolean('zen_nichikyo').notNull().default(false),
    // invite-register-redesign: structured name + 全日協 (全日本かるた協会) PII
    // collected at self-registration. All nullable — `name` (合成表示名) stays
    // the canonical display/UNIQUE key; existing ~100 members keep these NULL
    // (we do not auto-split their `name`). PII is gated by zenNichikyo + grade.
    familyName: text('family_name'),
    givenName: text('given_name'),
    familyKana: text('family_kana'),
    givenKana: text('given_kana'),
    birthDate: date('birth_date'),
    phone: text('phone'),
    postalCode: text('postal_code'),
    address1: text('address1'),
    address2: text('address2'),
    deactivatedAt: timestamp('deactivated_at', { mode: 'date', withTimezone: true }),
    lineLinkedAt: timestamp('line_linked_at', { mode: 'date', withTimezone: true }),
    lineLinkedMethod: lineLinkMethodEnum('line_link_method'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    // PR5 (mail-tournament-import): per-user notification preference. The
    // channel↔user pairing is canonically stored on `line_channels.assigned_user_id`
    // (FK + future UNIQUE), so we deliberately do NOT carry a reverse pointer
    // on users — review r1 flagged that as a dual source of truth with no
    // integrity constraint. Channel lookup goes user → line_channels.assigned_user_id.
    notificationLineUserId: text('notification_line_user_id'),
    // ── travel-report（遠征届）──────────────────────────────────────────
    // 北大かるた会サークルへの所属。会員・ゲスト共通の属性で、既定 OFF。
    // ON のとき faculty_kind / faculty / school_year / phone / birth_date が
    // 必須になる（不変条件は Server Action 側で強制。requirements R1）。
    // 遠征届の対象者判定の第1条件でもある（R5）。
    isCircleMember: boolean('is_circle_member').notNull().default(false),
    // 学部／大学院の区分。faculty の候補と school_year の選択肢を切り替える。
    facultyKind: facultyKindEnum('faculty_kind'),
    // 学部等名（例「法学部」「情報科学院」）。候補つきの自由入力で、候補外の
    // 文字列も保存できる（R1）。遠征届の名簿表と団体代表者欄にそのまま出力する。
    faculty: text('faculty'),
    // 学年（例「2年」「修士1年」「博士3年」）。★enum にしない — 届にはこの文字列を
    // そのまま出力し、名簿の並び順は共有定数 SCHOOL_YEAR_ORDER で決める
    // （constants/travel-report.ts）。年度繰り上げは運用（Non-goal）。
    schoolYear: text('school_year'),
    // 副連絡責任者（遠征届の提出係）。
    // ★`is_treasurer` と違い**認可に使う**（requirements §6・§7）。「@副連絡責任者」
    // メンションの解決先であると同時に、遠征届の操作（必要/不要・経路入力の開始・
    // 代理入力・作成・ダウンロード・開催地修正・遠征届設定）の権限そのもの。
    // 提出係は一般会員のことが多く、vice_admin を渡すと他の管理操作まで開くため
    // フラグで認可する。判定の正典は `lib/travel-report/authz.ts` の1ヘルパー。
    // ゲスト（role='guest'）にフラグが付いても権限にはならない。
    isTravelReportSubmitter: boolean('is_travel_report_submitter').notNull().default(false),
    // サークル長。**同時に1人だけ**（下の partial unique index が DB バックストップ）。
    // 遠征届の「団体代表者」と「留守連絡先の既定」に使う（R2・R9）。
    isCircleLeader: boolean('is_circle_leader').notNull().default(false),
  },
  (table) => [
    // dan is 段位 (kyu/dan rank). Valid range is 0–9; enforce at the DB layer
    // so batch/SQL updates cannot bypass the application-level validation.
    check('users_dan_range', sql`${table.dan} BETWEEN 0 AND 9 OR ${table.dan} IS NULL`),
    // travel-report: サークル長は同時に1人だけ（R2）。付与 Action 側でも既存の
    // 保持者を検出して日本語エラーで拒否するが、一括更新・SQL 直操作が
    // すり抜けないよう DB にもバックストップを置く（partial unique index）。
    uniqueIndex('users_circle_leader_unique')
      .on(table.isCircleLeader)
      .where(sql`${table.isCircleLeader}`),
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
