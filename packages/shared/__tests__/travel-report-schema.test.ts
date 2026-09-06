import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  entryGroupSelectionStatuses,
  entryGroupTravelSettings,
  travelReportBatches,
  travelReportDocuments,
  travelRoutes,
  travelUnitNotices,
  users,
} from '../src/schema'
import {
  ALL_SCHOOL_YEARS,
  GRADUATE_SCHOOLS,
  GRADUATE_SCHOOL_YEARS,
  SCHOOL_YEAR_ORDER,
  UNDERGRADUATE_FACULTIES,
  UNDERGRADUATE_SCHOOL_YEARS,
  facultyOptions,
  isSchoolYearForKind,
  isValidSchoolYear,
  schoolYearOptions,
  schoolYearRank,
} from '../src/constants'

const migrationSql = readFileSync(
  fileURLToPath(new URL('../drizzle/0064_amazing_purple_man.sql', import.meta.url)),
  'utf8',
)

describe('users への遠征届の属性・フラグ追加', () => {
  it('サークル所属・副連絡責任者・サークル長は NOT NULL DEFAULT false', () => {
    for (const col of [users.isCircleMember, users.isTravelReportSubmitter, users.isCircleLeader]) {
      expect(col.notNull).toBe(true)
      expect(col.hasDefault).toBe(true)
    }
  })

  it('学部区分・学部等名・学年は nullable（既存 100 名は NULL のまま整合する）', () => {
    expect(users.facultyKind.notNull).toBe(false)
    expect(users.faculty.notNull).toBe(false)
    expect(users.schoolYear.notNull).toBe(false)
  })

  it('電話・生年月日の列を増やさず既存の phone / birth_date を共用する（AC-3）', () => {
    const columns = getTableConfig(users).columns.map((c) => c.name)
    expect(columns).toContain('phone')
    expect(columns).toContain('birth_date')
    expect(columns.filter((n) => n.includes('phone'))).toEqual(['phone'])
    expect(columns.filter((n) => n.includes('birth'))).toEqual(['birth_date'])
  })

  it('マイグレーションは ADD COLUMN だけで既存行を書き換えない', () => {
    for (const name of [
      'is_circle_member',
      'faculty_kind',
      'faculty',
      'school_year',
      'is_travel_report_submitter',
      'is_circle_leader',
    ]) {
      expect(migrationSql).toContain(`ALTER TABLE "users" ADD COLUMN "${name}"`)
    }
    expect(migrationSql).not.toMatch(/ALTER TABLE "users" DROP|UPDATE "users"/)
  })

  it('サークル長は partial unique index で同時に1人に制限される（R2 の DB バックストップ）', () => {
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "users_circle_leader_unique" ON "users" USING btree ("is_circle_leader") WHERE "users"."is_circle_leader"',
    )
  })
})

describe('遠征届のテーブル', () => {
  it('グループ設定は 1 グループ 1 行（entry_group_id が PK）で、行が無ければ既定値', () => {
    const t = getTableConfig(entryGroupTravelSettings)
    expect(t.name).toBe('entry_group_travel_settings')
    expect(entryGroupTravelSettings.entryGroupId.primary).toBe(true)
    // 既定で「必要」（R4）。
    expect(entryGroupTravelSettings.required.hasDefault).toBe(true)
    expect(entryGroupTravelSettings.required.notNull).toBe(true)
  })

  it('開催地は「未試行」と「試したが空欄」を destination_attempted_at で区別する（R7）', () => {
    const columns = getTableConfig(entryGroupTravelSettings).columns.map((c) => c.name)
    expect(columns).toContain('destination_attempted_at')
    expect(columns).toContain('destination_source')
    expect(entryGroupTravelSettings.destinationAttemptedAt.notNull).toBe(false)
  })

  it('確定状況は (グループ, 人) の複合 PK で手入力だけを保存する', () => {
    const t = getTableConfig(entryGroupSelectionStatuses)
    expect(t.name).toBe('entry_group_selection_statuses')
    expect(t.primaryKeys[0]?.columns.map((c) => c.name)).toEqual(['entry_group_id', 'user_id'])
    // 導出値を書き込まないので「導出元」を記録する列は持たない。
    expect(t.columns.map((c) => c.name)).not.toContain('source')
  })

  it('経路は (グループ, 単位初日, 人) で一意', () => {
    const t = getTableConfig(travelRoutes)
    expect(t.name).toBe('travel_routes')
    expect(t.uniqueConstraints[0]?.columns.map((c) => c.name)).toEqual([
      'entry_group_id',
      'unit_start_date',
      'user_id',
    ])
    // 大会出場行は保存しない（出欠から導出する。R6）。
    expect(t.columns.map((c) => c.name)).not.toContain('attendance_dates')
  })

  it('通知記録は claim（試行）と成功を別の列で持ち、単位ごとに 1 行', () => {
    const t = getTableConfig(travelUnitNotices)
    expect(t.primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      'entry_group_id',
      'unit_start_date',
    ])
    const columns = t.columns.map((c) => c.name)
    expect(columns).toContain('last_attempted_at')
    expect(columns).toContain('all_entered_notified_at')
    expect(columns).toContain('last_error')
  })

  it('作成物は batch 1 : documents N で、docx は bytea に保存する', () => {
    expect(getTableConfig(travelReportBatches).name).toBe('travel_report_batches')
    expect(getTableConfig(travelReportDocuments).name).toBe('travel_report_documents')
    expect(migrationSql).toContain('"docx" "bytea" NOT NULL')
    // event_ids は int[] ではなく jsonb（feedback_drizzle_sql_int_array_binding）。
    expect(migrationSql).toContain('"event_ids" jsonb NOT NULL')
  })

  it('グループ FK は cascade、記録者は set null（会員削除で履歴を失わない）', () => {
    expect(migrationSql).toMatch(
      /travel_report_batches_entry_group_id_entry_groups_id_fk[\s\S]{0,200}ON DELETE cascade/,
    )
    expect(migrationSql).toMatch(
      /travel_report_batches_created_by_users_id_fk[\s\S]{0,200}ON DELETE set null/,
    )
    expect(migrationSql).toMatch(
      /travel_routes_saved_by_user_id_users_id_fk[\s\S]{0,200}ON DELETE set null/,
    )
  })

  it('enum 名は既存の抽選系（selection_outcome 等）と衝突しない', () => {
    expect(migrationSql).toContain(`CREATE TYPE "public"."travel_selection_status"`)
    expect(migrationSql).toContain(`CREATE TYPE "public"."travel_way_kind"`)
    expect(migrationSql).toContain(`CREATE TYPE "public"."travel_destination_source"`)
    expect(migrationSql).toContain(`CREATE TYPE "public"."faculty_kind"`)
    expect(migrationSql).not.toContain(`CREATE TYPE "public"."selection_outcome"`)
  })
})

describe('学部・学年の共有定数（R1）', () => {
  it('学部 13 件・大学院 22 件で、どちらも重複が無い', () => {
    expect(UNDERGRADUATE_FACULTIES).toHaveLength(13)
    expect(new Set(UNDERGRADUATE_FACULTIES).size).toBe(13)
    // requirements R1 の列挙は 22 件（AC-4 の括弧書き「21」は数え違い。
    // 列挙のほうを正とする）。
    expect(GRADUATE_SCHOOLS).toHaveLength(22)
    expect(new Set(GRADUATE_SCHOOLS).size).toBe(22)
    // 区分をまたいだ取り違えが起きない（同名の候補が無い）。
    const overlap = UNDERGRADUATE_FACULTIES.filter((f) =>
      (GRADUATE_SCHOOLS as readonly string[]).includes(f),
    )
    expect(overlap).toEqual([])
  })

  it('区分で候補が切り替わる', () => {
    expect(facultyOptions('undergraduate')).toBe(UNDERGRADUATE_FACULTIES)
    expect(facultyOptions('graduate')).toBe(GRADUATE_SCHOOLS)
    expect(schoolYearOptions('undergraduate')).toBe(UNDERGRADUATE_SCHOOL_YEARS)
    expect(schoolYearOptions('graduate')).toBe(GRADUATE_SCHOOL_YEARS)
  })

  it('学年は 学部6 + 大学院9 の 15 件で重複が無い', () => {
    expect(UNDERGRADUATE_SCHOOL_YEARS).toHaveLength(6)
    expect(GRADUATE_SCHOOL_YEARS).toHaveLength(9)
    expect(ALL_SCHOOL_YEARS).toHaveLength(15)
    expect(new Set(ALL_SCHOOL_YEARS).size).toBe(15)
  })

  it('名簿の並び順は学年の高い順（博士4年 → … → 1年）で全学年を尽くす', () => {
    expect(SCHOOL_YEAR_ORDER).toHaveLength(15)
    expect(new Set(SCHOOL_YEAR_ORDER)).toEqual(new Set(ALL_SCHOOL_YEARS))
    expect(SCHOOL_YEAR_ORDER[0]).toBe('博士4年')
    expect(SCHOOL_YEAR_ORDER.at(-1)).toBe('1年')
    // R10 の並び: 博士 → 修士 → 専門職 → 学部。
    expect(schoolYearRank('博士1年')).toBeLessThan(schoolYearRank('修士2年'))
    expect(schoolYearRank('修士1年')).toBeLessThan(schoolYearRank('専門職3年'))
    expect(schoolYearRank('専門職1年')).toBeLessThan(schoolYearRank('6年'))
    expect(schoolYearRank('2年')).toBeLessThan(schoolYearRank('1年'))
  })

  it('学年が未設定・候補外なら末尾へ送る', () => {
    expect(schoolYearRank(null)).toBe(SCHOOL_YEAR_ORDER.length)
    expect(schoolYearRank('')).toBe(SCHOOL_YEAR_ORDER.length)
    expect(schoolYearRank('聴講生')).toBe(SCHOOL_YEAR_ORDER.length)
  })

  it('学年の検証は区分と整合する（学部に「修士1年」を入れさせない）', () => {
    expect(isValidSchoolYear('修士1年')).toBe(true)
    expect(isValidSchoolYear('7年')).toBe(false)
    expect(isSchoolYearForKind('修士1年', 'graduate')).toBe(true)
    expect(isSchoolYearForKind('修士1年', 'undergraduate')).toBe(false)
    expect(isSchoolYearForKind('2年', 'undergraduate')).toBe(true)
    expect(isSchoolYearForKind('2年', 'graduate')).toBe(false)
  })
})
