CREATE TYPE "public"."roster_entry_status" AS ENUM('applied', 'confirmed', 'carried_up', 'carry_up_declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."roster_type" AS ENUM('applicant', 'confirmed');--> statement-breakpoint
CREATE TABLE "tournament_entry_rosters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_entry_rosters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"roster_type" "roster_type" NOT NULL,
	"published_at" date,
	"source_attachment_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_entry_rosters_event_id_roster_type_key" UNIQUE("event_id","roster_type")
);
--> statement-breakpoint
CREATE TABLE "tournament_entry_roster_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_entry_roster_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"roster_id" integer NOT NULL,
	"player_id" integer,
	"user_id" text,
	"grade" "grade",
	"raw_name" text NOT NULL,
	"raw_kana" text,
	"raw_affiliation" text,
	"raw_dan" text,
	"status" "roster_entry_status" NOT NULL,
	"seq_no" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD CONSTRAINT "tournament_entry_rosters_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD CONSTRAINT "tournament_entry_rosters_source_attachment_id_mail_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."mail_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_roster_entries" ADD CONSTRAINT "tournament_entry_roster_entries_roster_id_tournament_entry_rosters_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."tournament_entry_rosters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_roster_entries" ADD CONSTRAINT "tournament_entry_roster_entries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_roster_entries" ADD CONSTRAINT "tournament_entry_roster_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_entries_roster_id_idx" ON "tournament_entry_roster_entries" USING btree ("roster_id");--> statement-breakpoint
CREATE INDEX "roster_entries_player_id_idx" ON "tournament_entry_roster_entries" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "roster_entries_user_id_idx" ON "tournament_entry_roster_entries" USING btree ("user_id");