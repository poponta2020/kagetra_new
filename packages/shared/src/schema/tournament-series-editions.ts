import { foreignKey, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { tournamentStatusEnum } from './enums'
import { tournamentSeries } from './tournament-series'

/**
 * tournament_series_editions: 系列の「開催（第N回）」。tournament_series 1 : editions N。
 *
 * 「第N回○○大会」の正準 ID になりうる単位で、events / tournaments を束ねるハブ
 * （events:edition は N:1、tournaments:edition も N:1）。raw SQL で本番投入済み
 * （editions 1236）。tournament-entry-rosters PR-1a で Drizzle 化（現物一致）。
 *
 * `status` は **NOT NULL かつデフォルトなし**（series.kind と異なり、開催ごとに
 * held/cancelled/unconfirmed を必ず確定させる）。`source_filetype` / `raw_name` は
 * 取込元のプロビナンス。UNIQUE(series_id, edition_number) で同一系列の回次重複を防ぐ。
 */
export const tournamentSeriesEditions = pgTable(
  'tournament_series_editions',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    seriesId: integer('series_id').notNull(),
    editionNumber: integer('edition_number').notNull(),
    year: integer('year'),
    status: tournamentStatusEnum('status').notNull(),
    sourceFiletype: text('source_filetype'),
    rawName: text('raw_name'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tournament_series_editions_series_id_edition_number_key').on(
      table.seriesId,
      table.editionNumber,
    ),
    foreignKey({
      columns: [table.seriesId],
      foreignColumns: [tournamentSeries.id],
      name: 'tournament_series_editions_series_id_fkey',
    }).onDelete('cascade'),
  ],
)
