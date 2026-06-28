-- tournament-entry-rosters (PR-1b): remove the event_group layer (the "group several
-- events" role is folded into edition). event_groups is empty in production (0 rows,
-- 0 events linked — verified against the prod mirror), so this is a structural drop
-- with no data loss.
--
-- Order matters: drop the FK + column on events FIRST, then the table. drizzle's
-- default ordering (DROP TABLE event_groups CASCADE before the explicit DROP
-- CONSTRAINT) CASCADE-drops the FK, making the later DROP CONSTRAINT fail on a
-- non-existent object. IF EXISTS guards keep a partial/re-run state safe.
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_event_group_id_event_groups_id_fk";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN IF EXISTS "event_group_id";--> statement-breakpoint
DROP TABLE IF EXISTS "event_groups" CASCADE;
