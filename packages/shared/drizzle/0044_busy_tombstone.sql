CREATE TYPE "public"."line_grade_group_status" AS ENUM('invite_pending', 'joined_waiting_code', 'linked', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."line_channel_purpose" ADD VALUE 'grade_broadcast';--> statement-breakpoint
CREATE TABLE "line_grade_group_bindings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "line_grade_group_bindings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"grade" "grade" NOT NULL,
	"line_channel_id" integer NOT NULL,
	"invite_code" text,
	"invite_code_expires_at" timestamp with time zone,
	"line_group_id" text,
	"status" "line_grade_group_status" DEFAULT 'invite_pending' NOT NULL,
	"linked_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_grade_group_bindings_grade_unique" UNIQUE("grade"),
	CONSTRAINT "line_grade_group_bindings_line_channel_id_unique" UNIQUE("line_channel_id")
);
--> statement-breakpoint
CREATE TABLE "event_grade_broadcasts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_grade_broadcasts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"grade" "grade" NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retry_key" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "grade_broadcast_attachment_id" integer;--> statement-breakpoint
ALTER TABLE "line_grade_group_bindings" ADD CONSTRAINT "line_grade_group_bindings_line_channel_id_line_channels_id_fk" FOREIGN KEY ("line_channel_id") REFERENCES "public"."line_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_grade_broadcasts" ADD CONSTRAINT "event_grade_broadcasts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "line_grade_group_bindings_invite_code_active_uq" ON "line_grade_group_bindings" USING btree ("invite_code") WHERE "line_grade_group_bindings"."invite_code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "event_grade_broadcasts_event_grade_uq" ON "event_grade_broadcasts" USING btree ("event_id","grade");--> statement-breakpoint
CREATE INDEX "events_grade_broadcast_attachment_id_idx" ON "events" USING btree ("grade_broadcast_attachment_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_grade_broadcast_attachment_id_fkey" FOREIGN KEY ("grade_broadcast_attachment_id") REFERENCES "mail_attachments"("id") ON DELETE SET NULL;