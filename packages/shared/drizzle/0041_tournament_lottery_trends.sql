CREATE TYPE "public"."competition_category" AS ENUM('official', 'new_year', 'hosted', 'supported', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."lottery_selection_status" AS ENUM('lottery', 'under_capacity', 'no_capacity', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."roster_import_draft_status" AS ENUM('pending_review', 'approved', 'rejected', 'parse_failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."roster_import_source_kind" AS ENUM('attachment', 'body');--> statement-breakpoint
CREATE TYPE "public"."selection_outcome" AS ENUM('accepted', 'waitlisted', 'rejected', 'unknown');--> statement-breakpoint
ALTER TYPE "public"."mail_worker_job_kind" ADD VALUE 'roster_parse';--> statement-breakpoint
CREATE TABLE "tournament_confirmed_roster_publications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_confirmed_roster_publications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"edition_id" integer NOT NULL,
	"grade" "grade" NOT NULL,
	"roster_id" integer,
	"published_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tcrp_edition_grade_roster_uq" UNIQUE("edition_id","grade","roster_id")
);
--> statement-breakpoint
CREATE TABLE "tournament_edition_grade_lottery_facts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_edition_grade_lottery_facts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"edition_id" integer NOT NULL,
	"grade" "grade" NOT NULL,
	"selection_status" "lottery_selection_status" DEFAULT 'unknown' NOT NULL,
	"capacity" integer,
	"application_start_date" date,
	"applicant_roster_id" integer,
	"selection_result_roster_id" integer,
	"actual_result_class_id" integer,
	"selection_rule_version" text,
	"source_mail_message_id" integer,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" text,
	"supersedes_fact_id" integer,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_edition_grade_lottery_facts_capacity_positive" CHECK ("tournament_edition_grade_lottery_facts"."capacity" IS NULL OR "tournament_edition_grade_lottery_facts"."capacity" > 0),
	CONSTRAINT "tournament_edition_grade_lottery_facts_status_capacity" CHECK (("tournament_edition_grade_lottery_facts"."selection_status" = 'lottery' AND "tournament_edition_grade_lottery_facts"."capacity" IS NOT NULL)
        OR ("tournament_edition_grade_lottery_facts"."selection_status" = 'under_capacity' AND "tournament_edition_grade_lottery_facts"."capacity" IS NOT NULL)
        OR ("tournament_edition_grade_lottery_facts"."selection_status" = 'no_capacity' AND "tournament_edition_grade_lottery_facts"."capacity" IS NULL)
        OR "tournament_edition_grade_lottery_facts"."selection_status" = 'unknown')
);
--> statement-breakpoint
CREATE TABLE "tournament_roster_import_drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_roster_import_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_kind" "roster_import_source_kind" NOT NULL,
	"source_mail_message_id" integer,
	"source_attachment_id" integer,
	"parser_version" text NOT NULL,
	"status" "roster_import_draft_status" DEFAULT 'pending_review' NOT NULL,
	"extracted_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_reason" text,
	"inferred_edition_id" integer,
	"inferred_roster_type" "roster_type",
	"inferred_grade" "grade",
	"approved_at" timestamp with time zone,
	"approved_by_user_id" text,
	"rejected_at" timestamp with time zone,
	"rejected_by_user_id" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" DROP CONSTRAINT "tournament_entry_rosters_event_id_roster_type_key";--> statement-breakpoint
ALTER TABLE "tournament_series_editions" ADD COLUMN "competition_category" "competition_category" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_series_editions" ADD COLUMN "competition_category_source_mail_id" integer;--> statement-breakpoint
ALTER TABLE "tournament_series_editions" ADD COLUMN "competition_category_note" text;--> statement-breakpoint
ALTER TABLE "tournament_series_editions" ADD COLUMN "competition_category_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_series_editions" ADD COLUMN "competition_category_verified_by_user_id" text;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD COLUMN "source_mail_message_id" integer;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD COLUMN "supersedes_roster_id" integer;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD COLUMN "approved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "tournament_entry_roster_entries" ADD COLUMN "selection_outcome" "selection_outcome" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_entry_roster_entries" ADD COLUMN "selection_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_confirmed_roster_publications" ADD CONSTRAINT "tcrp_edition_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."tournament_series_editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_confirmed_roster_publications" ADD CONSTRAINT "tcrp_roster_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."tournament_entry_rosters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_edition_grade_lottery_facts" ADD CONSTRAINT "teglf_edition_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."tournament_series_editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_edition_grade_lottery_facts" ADD CONSTRAINT "teglf_applicant_roster_fk" FOREIGN KEY ("applicant_roster_id") REFERENCES "public"."tournament_entry_rosters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_edition_grade_lottery_facts" ADD CONSTRAINT "teglf_selection_roster_fk" FOREIGN KEY ("selection_result_roster_id") REFERENCES "public"."tournament_entry_rosters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_edition_grade_lottery_facts" ADD CONSTRAINT "teglf_actual_class_fk" FOREIGN KEY ("actual_result_class_id") REFERENCES "public"."tournament_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_edition_grade_lottery_facts" ADD CONSTRAINT "teglf_source_mail_fk" FOREIGN KEY ("source_mail_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_edition_grade_lottery_facts" ADD CONSTRAINT "teglf_verified_by_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_roster_import_drafts" ADD CONSTRAINT "trid_source_mail_fk" FOREIGN KEY ("source_mail_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_roster_import_drafts" ADD CONSTRAINT "trid_source_attachment_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."mail_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_roster_import_drafts" ADD CONSTRAINT "trid_inferred_edition_fk" FOREIGN KEY ("inferred_edition_id") REFERENCES "public"."tournament_series_editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_roster_import_drafts" ADD CONSTRAINT "trid_approved_by_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_roster_import_drafts" ADD CONSTRAINT "trid_rejected_by_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tcrp_edition_grade_published_idx" ON "tournament_confirmed_roster_publications" USING btree ("edition_id","grade","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_edition_grade_lottery_facts_active_key" ON "tournament_edition_grade_lottery_facts" USING btree ("edition_id","grade") WHERE "tournament_edition_grade_lottery_facts"."valid_to" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_roster_import_drafts_attachment_key" ON "tournament_roster_import_drafts" USING btree ("source_attachment_id") WHERE "tournament_roster_import_drafts"."source_kind" = 'attachment' AND "tournament_roster_import_drafts"."source_attachment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_roster_import_drafts_body_message_key" ON "tournament_roster_import_drafts" USING btree ("source_mail_message_id") WHERE "tournament_roster_import_drafts"."source_kind" = 'body' AND "tournament_roster_import_drafts"."source_mail_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tournament_roster_import_drafts_status_created_idx" ON "tournament_roster_import_drafts" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "tournament_series_editions" ADD CONSTRAINT "tse_category_verified_by_fk" FOREIGN KEY ("competition_category_verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD CONSTRAINT "ter_source_mail_fk" FOREIGN KEY ("source_mail_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD CONSTRAINT "ter_approved_by_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_series_editions" ADD CONSTRAINT "tse_comp_category_source_mail_fk" FOREIGN KEY ("competition_category_source_mail_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD CONSTRAINT "ter_supersedes_roster_fk" FOREIGN KEY ("supersedes_roster_id") REFERENCES "public"."tournament_entry_rosters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_edition_grade_lottery_facts" ADD CONSTRAINT "teglf_supersedes_fact_fk" FOREIGN KEY ("supersedes_fact_id") REFERENCES "public"."tournament_edition_grade_lottery_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tournament_series_editions_competition_category_idx" ON "tournament_series_editions" USING btree ("competition_category");--> statement-breakpoint
CREATE INDEX "roster_entries_roster_grade_player_idx" ON "tournament_entry_roster_entries" USING btree ("roster_id","grade","player_id");--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD CONSTRAINT "tournament_entry_rosters_event_id_roster_type_version_key" UNIQUE("event_id","roster_type","version");
