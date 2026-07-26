-- entry-groups タスク8（2/2）: 旧 event 帰属の列と旧 UNIQUE を落とす。
-- 0048 と分けてあるのは drizzle-kit generate の rename プロンプト回避（0046/0047 と同じ理由）。
-- **自動生成のまま（手修正なし）。**
ALTER TABLE "tournament_entry_rosters" DROP CONSTRAINT "tournament_entry_rosters_event_id_roster_type_version_key";--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" DROP CONSTRAINT "tournament_entry_rosters_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" DROP COLUMN "event_id";