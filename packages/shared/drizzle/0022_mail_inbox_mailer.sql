CREATE TYPE "public"."mail_worker_job_kind" AS ENUM('fetch', 'manual_extract');--> statement-breakpoint
ALTER TYPE "public"."tournament_draft_status" ADD VALUE 'ai_processing';--> statement-breakpoint
ALTER TABLE "mail_messages" ALTER COLUMN "triage_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "mail_messages" ALTER COLUMN "triage_status" SET DEFAULT 'unprocessed'::text;--> statement-breakpoint
DROP TYPE "public"."mail_triage_status";--> statement-breakpoint
CREATE TYPE "public"."mail_triage_status" AS ENUM('unprocessed', 'processed');--> statement-breakpoint
-- mail-inbox-mailer: 既存 deferred 行を unprocessed に倒してから新 enum へ ALTER。
-- enum 値削除は drizzle-kit が「text に ALTER → DROP TYPE → CREATE TYPE → enum に再 ALTER」
-- パターンで自動生成するが、UPDATE が抜けると次の USING キャストで
-- 「invalid input value for enum mail_triage_status: "deferred"」が出るので手動追記。
UPDATE "mail_messages" SET "triage_status" = 'unprocessed' WHERE "triage_status" = 'deferred';--> statement-breakpoint
ALTER TABLE "mail_messages" ALTER COLUMN "triage_status" SET DEFAULT 'unprocessed'::"public"."mail_triage_status";--> statement-breakpoint
ALTER TABLE "mail_messages" ALTER COLUMN "triage_status" SET DATA TYPE "public"."mail_triage_status" USING "triage_status"::"public"."mail_triage_status";--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "linked_event_id" integer;--> statement-breakpoint
ALTER TABLE "mail_worker_jobs" ADD COLUMN "kind" "mail_worker_job_kind" DEFAULT 'fetch' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_worker_jobs" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_linked_event_id_events_id_fk" FOREIGN KEY ("linked_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_messages_linked_event_id_idx" ON "mail_messages" USING btree ("linked_event_id") WHERE "mail_messages"."linked_event_id" IS NOT NULL;