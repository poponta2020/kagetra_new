CREATE TYPE "public"."event_entry_status" AS ENUM('not_applied', 'applied');--> statement-breakpoint
CREATE TYPE "public"."event_lifecycle_notification_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."event_lifecycle_notification_type" AS ENUM('entry_applied', 'entry_deadline_advance', 'entry_deadline_day', 'payment_paid', 'payment_deadline_advance', 'payment_deadline_day', 'onsite_payment_advance', 'onsite_payment_day');--> statement-breakpoint
CREATE TYPE "public"."event_payment_status" AS ENUM('unpaid', 'paid');--> statement-breakpoint
CREATE TYPE "public"."event_payment_type" AS ENUM('advance', 'onsite');--> statement-breakpoint
CREATE TABLE "event_lifecycle_notifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_lifecycle_notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"type" "event_lifecycle_notification_type" NOT NULL,
	"status" "event_lifecycle_notification_status" DEFAULT 'sent' NOT NULL,
	"line_group_id" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "entry_status" "event_entry_status" DEFAULT 'not_applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "entry_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_type" "event_payment_type";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_status" "event_payment_status" DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_lifecycle_notifications" ADD CONSTRAINT "event_lifecycle_notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_lifecycle_notifications_event_type_uq" ON "event_lifecycle_notifications" USING btree ("event_id","type");