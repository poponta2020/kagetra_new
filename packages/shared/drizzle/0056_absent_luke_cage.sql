CREATE TYPE "public"."open_chat_broadcast_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."open_chat_source" AS ENUM('body', 'attachment_text', 'qr', 'manual');--> statement-breakpoint
CREATE TABLE "entry_group_open_chats" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_group_open_chats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_group_id" integer NOT NULL,
	"url" text NOT NULL,
	"grades" "grade"[],
	"event_date" date,
	"label" text,
	"password" text,
	"source" "open_chat_source" NOT NULL,
	"source_mail_message_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_group_open_chats_group_url_unique" UNIQUE("entry_group_id","url")
);
--> statement-breakpoint
CREATE TABLE "entry_group_open_chat_broadcasts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_group_open_chat_broadcasts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_group_id" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"status" "open_chat_broadcast_status" NOT NULL,
	"error_message" text,
	"sent_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "entry_group_open_chats" ADD CONSTRAINT "entry_group_open_chats_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_open_chats" ADD CONSTRAINT "entry_group_open_chats_source_mail_message_id_mail_messages_id_fk" FOREIGN KEY ("source_mail_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_open_chat_broadcasts" ADD CONSTRAINT "entry_group_open_chat_broadcasts_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_open_chat_broadcasts" ADD CONSTRAINT "entry_group_open_chat_broadcasts_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_group_open_chats_group_idx" ON "entry_group_open_chats" USING btree ("entry_group_id");