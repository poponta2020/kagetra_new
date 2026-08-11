CREATE TYPE "public"."registration_invite_kind" AS ENUM('member', 'guest');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'guest';--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "kind" "registration_invite_kind" DEFAULT 'member' NOT NULL;