import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  clubLineGroups,
  lineChannels,
  lineChatTasks,
  membershipRenewalMembers,
  membershipRenewals,
  users,
} from '../src/schema'
import {
  EMPTY_RENEWAL_SNAPSHOT,
  GRADUATE_FINAL_YEARS,
  RENEWAL_MENTION_LIMIT_PER_MESSAGE,
  RENEWAL_SNAPSHOT_VERSION,
  ROSTER_FIELDS,
  ROSTER_FIELD_LABELS,
  SIX_YEAR_FACULTIES,
} from '../src/constants'

const migrationSql = readFileSync(
  fileURLToPath(new URL('../drizzle/0066_minor_black_bolt.sql', import.meta.url)),
  'utf8',
)

describe('users への公認資格 2 列の追加（AC-27 の土台）', () => {
  it('読手は nullable（NULL＝なし）、準公認審判員は NOT NULL DEFAULT false', () => {
    expect(users.readerCertification.notNull).toBe(false)
    expect(users.isAssociateReferee.notNull).toBe(true)
    expect(users.isAssociateReferee.hasDefault).toBe(true)
  })

  it('マイグレーションは ADD COLUMN だけで既存行を書き換えない', () => {
    expect(migrationSql).toContain('ALTER TABLE "users" ADD COLUMN "reader_certification"')
    expect(migrationSql).toContain('ALTER TABLE "users" ADD COLUMN "is_associate_referee"')
    expect(migrationSql).not.toMatch(/ALTER TABLE "users" DROP|UPDATE "users"/)
  })
})

describe('line_channel_purpose への club_chat 追加', () => {
  it('purpose の値に club_chat が入る（Bot 転換の受け皿）', () => {
    expect(lineChannels.purpose.enumValues).toContain('club_chat')
  })

  it('status は available から動かす前提なので値は変えない', () => {
    expect(lineChannels.status.enumValues).toEqual([
      'available',
      'assigned',
      'active',
      'system',
      'disabled',
    ])
  })

  it('ADD VALUE と同じファイルで club_chat を値として使わない（PG は同一 tx で使えない）', () => {
    const occurrences = migrationSql.match(/club_chat/g) ?? []
    expect(occurrences).toHaveLength(1)
    expect(migrationSql).toContain(
      `ALTER TYPE "public"."line_channel_purpose" ADD VALUE 'club_chat'`,
    )
  })
})

describe('membership_renewals（年度確認 1 回分）', () => {
  it('年度が UNIQUE ＝同一年度を 2 回開始できない（AC-3）', () => {
    const t = getTableConfig(membershipRenewals)
    expect(t.name).toBe('membership_renewals')
    expect(t.uniqueConstraints.map((u) => u.name)).toContain(
      'membership_renewals_fiscal_year_unique',
    )
  })

  it('状態は open / completed の 2 値で既定は open', () => {
    expect(membershipRenewals.status.enumValues).toEqual(['open', 'completed'])
    expect(membershipRenewals.status.hasDefault).toBe(true)
  })

  it('開始者・完了者は SET NULL（会員を消しても年度確認は残る）', () => {
    const fks = getTableConfig(membershipRenewals).foreignKeys.map((fk) => fk.onDelete)
    expect(fks).toEqual(['set null', 'set null'])
  })
})

describe('membership_renewal_members（対象者と回答）', () => {
  it('(renewal_id, user_id) が UNIQUE', () => {
    const t = getTableConfig(membershipRenewalMembers)
    expect(t.uniqueConstraints.map((u) => u.name)).toContain(
      'membership_renewal_members_renewal_user_unique',
    )
  })

  it('user_id は CASCADE ＝誤登録リカバリの会員物理削除を塞がない', () => {
    const userFk = getTableConfig(membershipRenewalMembers).foreignKeys.find((fk) =>
      fk.reference().foreignColumns.some((c) => c.name === 'id' && c.table === users),
    )
    expect(userFk).toBeDefined()
    const onDeletes = getTableConfig(membershipRenewalMembers)
      .foreignKeys.map((fk) => ({
        columns: fk.reference().columns.map((c) => c.name),
        onDelete: fk.onDelete,
      }))
    expect(onDeletes).toContainEqual({ columns: ['renewal_id'], onDelete: 'cascade' })
    expect(onDeletes).toContainEqual({ columns: ['user_id'], onDelete: 'cascade' })
    expect(onDeletes).toContainEqual({ columns: ['answered_by_user_id'], onDelete: 'set null' })
  })

  it('未回答は NULL で表す（answer に「未回答」の enum 値を持たない）', () => {
    expect(membershipRenewalMembers.answer.enumValues).toEqual(['register', 'not_register'])
    expect(membershipRenewalMembers.answer.notNull).toBe(false)
  })

  it('学年の回答は絶対値の 3 列で保持し、反映済みは applied_at の NULL 判定', () => {
    expect(membershipRenewalMembers.schoolYearKind.enumValues).toEqual([
      'advance',
      'custom',
      'leave',
    ])
    expect(membershipRenewalMembers.nextSchoolYear.notNull).toBe(false)
    expect(membershipRenewalMembers.nextFaculty.notNull).toBe(false)
    expect(membershipRenewalMembers.schoolYearAppliedAt.notNull).toBe(false)
  })

  it('スナップショットは NOT NULL の jsonb（キー欠落を作らない）', () => {
    expect(membershipRenewalMembers.snapshot.notNull).toBe(true)
    expect(membershipRenewalMembers.snapshot.getSQLType()).toBe('jsonb')
  })
})

describe('line_chat_tasks（OAM チャット予約送信）', () => {
  it('状態の値が match-tracker ワーカーの契約と同じ大文字（AC-22）', () => {
    expect(lineChatTasks.status.enumValues).toEqual([
      'PENDING',
      'RESERVING',
      'RESERVED',
      'FAILED',
      'MANUAL_REVIEW_REQUIRED',
      'DRY_RUN_SUCCEEDED',
      'CANCEL_PENDING',
      'CANCELLED',
    ])
  })

  it('冪等キーは (renewal, kind, target_date, split_index) の部分 UNIQUE で CANCELLED を除外する', () => {
    const idx = getTableConfig(lineChatTasks).indexes.find(
      (i) => i.config.name === 'line_chat_tasks_slot_uq',
    )
    expect(idx?.config.unique).toBe(true)
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual([
      'renewal_id',
      'kind',
      'target_date',
      'split_index',
    ])
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "line_chat_tasks_slot_uq" ON "line_chat_tasks" USING btree ("renewal_id","kind","target_date","split_index") WHERE "line_chat_tasks"."status" <> \'CANCELLED\'',
    )
  })

  it('本文・メンション・対象者は NOT NULL（既定は空配列）で、氏名以外の PII 列を持たない', () => {
    expect(lineChatTasks.messageText.notNull).toBe(true)
    expect(lineChatTasks.mentions.notNull).toBe(true)
    expect(lineChatTasks.mentions.hasDefault).toBe(true)
    expect(lineChatTasks.targetUserIds.notNull).toBe(true)
    const columns = getTableConfig(lineChatTasks).columns.map((c) => c.name)
    for (const banned of ['phone', 'address1', 'address2', 'birth_date', 'postal_code']) {
      expect(columns).not.toContain(banned)
    }
  })

  it('年度確認が消えたらタスクも消える（CASCADE）', () => {
    expect(getTableConfig(lineChatTasks).foreignKeys.map((fk) => fk.onDelete)).toEqual(['cascade'])
  })
})

describe('club_line_groups（会 LINE グループ設定）', () => {
  it('Bot は 1 行につき 1 体（UNIQUE）で、設定が生きている間は削除できない（RESTRICT）', () => {
    const t = getTableConfig(clubLineGroups)
    expect(clubLineGroups.lineChannelId.isUnique).toBe(true)
    expect(migrationSql).toContain(
      'CONSTRAINT "club_line_groups_line_channel_id_unique" UNIQUE("line_channel_id")',
    )
    const channelFk = t.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === 'line_channel_id'),
    )
    expect(channelFk?.onDelete).toBe('restrict')
  })

  it('webhook 側グループ ID は join で捕捉するまで NULL（OAM のルーム ID とは別列）', () => {
    expect(clubLineGroups.lineGroupId.notNull).toBe(false)
    expect(clubLineGroups.oamChatRoomId.notNull).toBe(true)
    expect(clubLineGroups.oamAccountPath.notNull).toBe(true)
    expect(clubLineGroups.chatRoomName.notNull).toBe(true)
  })
})

describe('共有定数', () => {
  it('名簿の列は全日協「会員名簿（確認用）」の順で、ラベルが全項目に付く', () => {
    expect(ROSTER_FIELDS).toEqual([
      'familyName',
      'givenName',
      'familyKana',
      'givenKana',
      'birthDate',
      'gender',
      'dan',
      'grade',
      'postalCode',
      'address1',
      'address2',
      'phone',
    ])
    for (const f of ROSTER_FIELDS) {
      expect(ROSTER_FIELD_LABELS[f]).toBeTruthy()
    }
  })

  it('空スナップショットが全キーを null で持つ（キー欠落を作らない土台）', () => {
    expect(EMPTY_RENEWAL_SNAPSHOT.v).toBe(RENEWAL_SNAPSHOT_VERSION)
    for (const f of ROSTER_FIELDS) {
      expect(EMPTY_RENEWAL_SNAPSHOT[f]).toBeNull()
    }
    for (const f of ['facultyKind', 'faculty', 'schoolYear'] as const) {
      expect(EMPTY_RENEWAL_SNAPSHOT[f]).toBeNull()
    }
  })

  it('6 年制学部は医・歯・薬・獣医の 4 つ、大学院の最終学年は 3 課程', () => {
    expect(SIX_YEAR_FACULTIES).toEqual(['医学部', '歯学部', '薬学部', '獣医学部'])
    expect(GRADUATE_FINAL_YEARS).toEqual(['修士2年', '博士3年', '専門職3年'])
  })

  it('メンション上限は設定値（PoC で実測して更新する）', () => {
    expect(RENEWAL_MENTION_LIMIT_PER_MESSAGE).toBeGreaterThan(0)
  })
})
