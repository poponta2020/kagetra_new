-- tournament-entry-rosters (Codex R3 should_fix): edition をハブに events/tournaments を引く
-- 参照列に btree index を追加（PG は FK 列に自動 index を作らない）。
-- IF NOT EXISTS で冪等（本番では列は既存・index 無し→作成、再実行や fresh DB でも安全）。
CREATE INDEX IF NOT EXISTS "events_edition_id_idx" ON "events" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tournaments_edition_id_idx" ON "tournaments" USING btree ("edition_id");
