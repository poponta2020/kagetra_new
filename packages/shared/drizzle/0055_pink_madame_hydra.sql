CREATE TYPE "public"."mail_kind" AS ENUM('tournament_notice', 'applicant_roster', 'confirmed_roster');--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "mail_kind" "mail_kind";--> statement-breakpoint
ALTER TABLE "event_broadcast_messages" ADD COLUMN "include_body" boolean DEFAULT true NOT NULL;