CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" "gender";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "affiliation" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dan" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "zen_nichikyo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;