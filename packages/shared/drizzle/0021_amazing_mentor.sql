ALTER TYPE "public"."event_lifecycle_notification_type" ADD VALUE 'entry_applied_treasurer';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lottery_date" date;