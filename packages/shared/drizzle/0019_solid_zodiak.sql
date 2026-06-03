ALTER TABLE "events" ADD COLUMN "tournament_draft_id" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "tournament_draft_unit_key" text;--> statement-breakpoint
-- tournament-title-grade-split: events ↔ tournament_drafts は相互参照のため drizzle スキーマ上で
-- .references() を張ると TypeScript 型が循環する。よって FK は drizzle-kit 管理外の raw ALTER で
-- 張る (tournament_drafts.superseded_by_draft_id と同方針)。snapshot には載らないが、drizzle は
-- スキーマ外の FK を drop しないので以降の generate でも保持される。
-- ON DELETE SET NULL: 元ドラフトを消しても materialize 済みイベントは残す。
ALTER TABLE "events" ADD CONSTRAINT "events_tournament_draft_id_fkey" FOREIGN KEY ("tournament_draft_id") REFERENCES "tournament_drafts"("id") ON DELETE SET NULL;