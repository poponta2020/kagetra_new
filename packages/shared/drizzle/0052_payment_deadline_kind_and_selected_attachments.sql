CREATE TYPE "public"."event_payment_deadline_kind" AS ENUM('fixed', 'later_notice', 'unspecified');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_deadline_kind" "event_payment_deadline_kind" DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_drafts" ADD COLUMN "selected_attachment_ids" integer[];--> statement-breakpoint
-- 手で追記（drizzle-kit generate は backfill を出さない）。
-- 既存行は全て DEFAULT 'unspecified' で埋まっているため、payment_deadline を
-- 持つ行はこのままだと直後の CHECK に違反する。**CHECK を張る前に**倒しておく。
-- 「後日連絡」だった行は判別材料が無いので unspecified のまま（人が編集画面で
-- 後日連絡へ直す）。この規則で全既存行が CHECK を満たす。
UPDATE "events" SET "payment_deadline_kind" = 'fixed' WHERE "payment_deadline" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_payment_deadline_kind_consistent" CHECK (("events"."payment_deadline" IS NOT NULL) = ("events"."payment_deadline_kind" = 'fixed'));
