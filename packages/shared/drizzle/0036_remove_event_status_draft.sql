ALTER TABLE "events" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
UPDATE "events" SET "status" = 'published' WHERE "status" = 'draft';--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."event_status";--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('published', 'cancelled', 'done');--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "status" SET DATA TYPE "public"."event_status" USING "status"::"public"."event_status";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "status" SET DEFAULT 'published';