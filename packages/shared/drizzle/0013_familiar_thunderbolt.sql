CREATE TYPE "public"."event_broadcast_message_status" AS ENUM('pending', 'sending', 'sent', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."event_line_broadcast_status" AS ENUM('invite_pending', 'joined_waiting_code', 'linked', 'revoked', 'released');--> statement-breakpoint
CREATE TYPE "public"."line_channel_purpose" AS ENUM('system_notify', 'event_broadcast');--> statement-breakpoint
CREATE TABLE "event_line_broadcasts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_line_broadcasts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"line_channel_id" integer NOT NULL,
	"invite_code" text,
	"invite_code_expires_at" timestamp with time zone,
	"line_group_id" text,
	"status" "event_line_broadcast_status" DEFAULT 'invite_pending' NOT NULL,
	"linked_at" timestamp with time zone,
	"extended_until" date,
	"released_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_line_broadcasts_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "event_broadcast_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_broadcast_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_line_broadcast_id" integer NOT NULL,
	"mail_message_id" integer NOT NULL,
	"status" "event_broadcast_message_status" DEFAULT 'pending' NOT NULL,
	"is_correction" boolean DEFAULT false NOT NULL,
	"sent_text_count" integer DEFAULT 0 NOT NULL,
	"sent_image_count" integer DEFAULT 0 NOT NULL,
	"fallback_link_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_broadcast_messages_broadcast_mail_uq" UNIQUE("event_line_broadcast_id","mail_message_id")
);
--> statement-breakpoint
CREATE TABLE "attachment_share_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "attachment_share_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mail_attachment_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_share_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "line_channels" ADD COLUMN "purpose" "line_channel_purpose" DEFAULT 'system_notify' NOT NULL;--> statement-breakpoint
ALTER TABLE "line_channels" ADD COLUMN "assigned_event_id" integer;--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" ADD CONSTRAINT "event_line_broadcasts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" ADD CONSTRAINT "event_line_broadcasts_line_channel_id_line_channels_id_fk" FOREIGN KEY ("line_channel_id") REFERENCES "public"."line_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_broadcast_messages" ADD CONSTRAINT "event_broadcast_messages_event_line_broadcast_id_event_line_broadcasts_id_fk" FOREIGN KEY ("event_line_broadcast_id") REFERENCES "public"."event_line_broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_broadcast_messages" ADD CONSTRAINT "event_broadcast_messages_mail_message_id_mail_messages_id_fk" FOREIGN KEY ("mail_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_share_tokens" ADD CONSTRAINT "attachment_share_tokens_mail_attachment_id_mail_attachments_id_fk" FOREIGN KEY ("mail_attachment_id") REFERENCES "public"."mail_attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_line_broadcasts_invite_code_active_uq" ON "event_line_broadcasts" USING btree ("invite_code") WHERE "event_line_broadcasts"."invite_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "attachment_share_tokens_attachment_idx" ON "attachment_share_tokens" USING btree ("mail_attachment_id");--> statement-breakpoint
CREATE INDEX "attachment_share_tokens_expires_at_idx" ON "attachment_share_tokens" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "line_channels" ADD CONSTRAINT "line_channels_assigned_event_id_events_id_fk" FOREIGN KEY ("assigned_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_channels" ADD CONSTRAINT "line_channels_assigned_event_id_unique" UNIQUE("assigned_event_id");