CREATE TYPE "public"."line_link_method" AS ENUM('self_identify', 'admin_link', 'account_switch');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "line_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "line_link_method" "line_link_method";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "must_change_password";