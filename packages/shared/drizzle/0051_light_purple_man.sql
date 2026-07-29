CREATE TABLE "tournament_entry_roster_files" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_entry_roster_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_group_id" integer NOT NULL,
	"roster_type" "roster_type" NOT NULL,
	"source_attachment_id" integer NOT NULL,
	"source_mail_message_id" integer,
	"published_at" date,
	"note" text,
	"adopted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"adopted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_entry_roster_files_source_attachment_key" UNIQUE("source_attachment_id")
);
--> statement-breakpoint
ALTER TABLE "tournament_entry_roster_files" ADD CONSTRAINT "tournament_entry_roster_files_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_roster_files" ADD CONSTRAINT "tournament_entry_roster_files_source_attachment_id_mail_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."mail_attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_roster_files" ADD CONSTRAINT "tournament_entry_roster_files_source_mail_message_id_mail_messages_id_fk" FOREIGN KEY ("source_mail_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_roster_files" ADD CONSTRAINT "tournament_entry_roster_files_adopted_by_user_id_users_id_fk" FOREIGN KEY ("adopted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tournament_entry_roster_files_group_type_idx" ON "tournament_entry_roster_files" USING btree ("entry_group_id","roster_type");