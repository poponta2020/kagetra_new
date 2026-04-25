CREATE TYPE "public"."mail_classification" AS ENUM('tournament', 'noise', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."mail_message_status" AS ENUM('pending', 'fetched', 'parse_failed', 'fetch_failed', 'ai_processing', 'ai_done', 'ai_failed', 'archived');--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_addresses" text[] NOT NULL,
	"subject" text,
	"received_at" timestamp with time zone NOT NULL,
	"body_text" text,
	"body_html" text,
	"status" "mail_message_status" DEFAULT 'pending' NOT NULL,
	"classification" "mail_classification",
	"imap_uid" integer,
	"imap_box" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_messages_message_id_unique" UNIQUE("message_id")
);
