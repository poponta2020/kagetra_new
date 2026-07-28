CREATE TYPE "public"."entry_form_draft_status" AS ENUM('pending', 'appending', 'created', 'imap_failed');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "entry_form_drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_form_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_group_id" integer NOT NULL,
	"created_by" text,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"attachment_filename" text NOT NULL,
	"message_id" text NOT NULL,
	"xlsx" "bytea" NOT NULL,
	"member_count" integer NOT NULL,
	"status" "entry_form_draft_status" DEFAULT 'pending' NOT NULL,
	"imap_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_form_drafts" ADD CONSTRAINT "entry_form_drafts_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_form_drafts" ADD CONSTRAINT "entry_form_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_form_drafts_group_created_idx" ON "entry_form_drafts" USING btree ("entry_group_id","created_at");