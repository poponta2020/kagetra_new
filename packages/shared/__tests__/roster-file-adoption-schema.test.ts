import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { tournamentEntryRosterFiles } from '../src/schema'

const table = getTableConfig(tournamentEntryRosterFiles)

const migrationSql = readFileSync(
  fileURLToPath(new URL('../drizzle/0051_light_purple_man.sql', import.meta.url)),
  'utf8',
)
// 2026-08-01 改修（級別採用）で足した grades 列のマイグレーション。
const gradesMigrationSql = readFileSync(
  fileURLToPath(new URL('../drizzle/0054_green_agent_zero.sql', import.meta.url)),
  'utf8',
)

describe('roster-file-adoption schema', () => {
  it('is an independent table so the parsed-roster pipeline is untouched', () => {
    // 既存の tournament_entry_rosters に entries 0 件の行を混ぜると /dashboard の
    // 出場者フォールバックが壊れる。別テーブルであることが構造的な保証。
    expect(table.name).toBe('tournament_entry_roster_files')
  })

  it('declares the adoption columns with the required nullability', () => {
    expect(tournamentEntryRosterFiles.entryGroupId.notNull).toBe(true)
    expect(tournamentEntryRosterFiles.rosterType.notNull).toBe(true)
    expect(tournamentEntryRosterFiles.rosterType.enumValues).toEqual(['applicant', 'confirmed'])
    expect(tournamentEntryRosterFiles.sourceAttachmentId.notNull).toBe(true)
    // プロビナンス・任意項目は null 可（発表日はメール受信日を UI が既定で入れる）。
    expect(tournamentEntryRosterFiles.sourceMailMessageId.notNull).toBe(false)
    expect(tournamentEntryRosterFiles.publishedAt.notNull).toBe(false)
    expect(tournamentEntryRosterFiles.note.notNull).toBe(false)
    expect(tournamentEntryRosterFiles.adoptedByUserId.notNull).toBe(false)
    expect(tournamentEntryRosterFiles.adoptedAt.notNull).toBe(true)
    // 版管理は持たない（ファイル採用は構造化データではないので版も統計寄与もない）。
    expect(Object.keys(tournamentEntryRosterFiles)).not.toContain('version')
    expect(Object.keys(tournamentEntryRosterFiles)).not.toContain('supersededAt')
  })

  it('carries the adoption unit in a nullable grade array (NULL = group-wide)', () => {
    // 級別採用（2026-08-01）。既存行は NULL のまま「グループ統一」と解釈されるので
    // backfill が要らない — nullable を落とすと過去データの意味が変わる。
    expect(tournamentEntryRosterFiles.grades.notNull).toBe(false)
    // 複数級を 1 行でカバーする（UNIQUE(source_attachment_id) を維持するための配列列）。
    // 前例は events.eligible_grades と同型。
    expect(tournamentEntryRosterFiles.grades.getSQLType()).toBe('grade[]')
    expect(tournamentEntryRosterFiles.grades.baseColumn.enumValues).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ])
  })

  it('forbids adopting the same attachment twice (AC-11)', () => {
    const uniqueColumns = table.uniqueConstraints.map((c) => c.columns.map((col) => col.name))
    expect(uniqueColumns).toEqual([['source_attachment_id']])
  })

  it('indexes the board / event-detail lookup key', () => {
    const indexColumns = table.indexes.map((i) =>
      (i.config.columns as { name: string }[]).map((c) => c.name),
    )
    expect(indexColumns).toEqual([['entry_group_id', 'roster_type']])
  })

  it('pins the FK onDelete behaviour decided in the tech plan', () => {
    const byColumn = new Map(
      table.foreignKeys.map((fk) => {
        const ref = fk.reference()
        return [ref.columns[0]!.name, { onDelete: fk.onDelete, to: ref.foreignTable }] as const
      }),
    )
    // 空グループ削除が採用レコードを道連れにしない（tournament_entry_rosters と同じ）。
    expect(byColumn.get('entry_group_id')?.onDelete).toBe('restrict')
    // 添付が消えた採用レコードは意味を持たない。attachment_share_tokens と同じ前例。
    expect(byColumn.get('source_attachment_id')?.onDelete).toBe('cascade')
    expect(byColumn.get('source_mail_message_id')?.onDelete).toBe('set null')
    expect(byColumn.get('adopted_by_user_id')?.onDelete).toBe('set null')
  })

  it('ships a purely additive migration (no existing table is altered)', () => {
    expect(migrationSql).toContain('CREATE TABLE "tournament_entry_roster_files"')
    // 既存テーブルへの ALTER は新テーブルの FK 追加だけであること。
    const alteredTables = [...migrationSql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1])
    expect([...new Set(alteredTables)]).toEqual(['tournament_entry_roster_files'])
    expect(migrationSql).not.toContain('DROP')
  })

  it('adds grades as a purely additive nullable column (AC-22: 既存行は無変換)', () => {
    // NOT NULL / DEFAULT / backfill UPDATE のいずれかが混ざると既存の採用済みデータの
    // 意味が変わる（NULL = グループ統一の解釈が壊れる）。生成 SQL で固定する。
    expect(gradesMigrationSql).toContain(
      'ALTER TABLE "tournament_entry_roster_files" ADD COLUMN "grades" "grade"[]',
    )
    expect(gradesMigrationSql).not.toContain('NOT NULL')
    expect(gradesMigrationSql).not.toContain('DEFAULT')
    expect(gradesMigrationSql).not.toContain('UPDATE')
    expect(gradesMigrationSql).not.toContain('DROP')
  })
})
