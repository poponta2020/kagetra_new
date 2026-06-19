CREATE TYPE "public"."match_result" AS ENUM('win', 'lose');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('normal', 'walkover', 'forfeit');--> statement-breakpoint
CREATE TYPE "public"."result_draft_status" AS ENUM('pending_review', 'approved', 'rejected', 'parse_failed', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."mail_worker_job_kind" ADD VALUE 'result_parse';--> statement-breakpoint
CREATE TABLE "players" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "players_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"name_kana" text,
	"affiliation" text,
	"prefecture" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_normalized_name_affiliation_uq" UNIQUE NULLS NOT DISTINCT("normalized_name","affiliation")
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournaments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"event_date" date,
	"venue" text,
	"source_result_draft_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_classes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_classes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tournament_id" integer NOT NULL,
	"class_name" text NOT NULL,
	"grade" "grade",
	"num_players" integer,
	"sheet_name" text
);
--> statement-breakpoint
CREATE TABLE "tournament_participants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_participants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"class_id" integer NOT NULL,
	"player_id" integer,
	"seq_no" integer,
	"name" text NOT NULL,
	"name_kana" text,
	"affiliation" text,
	"prefecture" text,
	"dan" text,
	"member_no" text,
	"final_rank" text,
	CONSTRAINT "tournament_participants_id_class_id_uq" UNIQUE("id","class_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "matches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"class_id" integer NOT NULL,
	"round" integer NOT NULL,
	"round_label" text,
	"participant_id" integer NOT NULL,
	"opponent_participant_id" integer,
	"opponent_name" text,
	"result" "match_result" NOT NULL,
	"score_diff" integer,
	"status" "match_status" DEFAULT 'normal' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "result_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"status" "result_draft_status" DEFAULT 'pending_review' NOT NULL,
	"extracted_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parser_version" text NOT NULL,
	"parse_error" text,
	"superseded_by_draft_id" integer,
	"tournament_id" integer,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"rejected_by_user_id" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_drafts_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_classes" ADD CONSTRAINT "tournament_classes_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_class_id_tournament_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."tournament_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_class_id_tournament_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."tournament_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_opponent_participant_id_tournament_participants_id_fk" FOREIGN KEY ("opponent_participant_id") REFERENCES "public"."tournament_participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_participant_id_class_id_fk" FOREIGN KEY ("participant_id","class_id") REFERENCES "public"."tournament_participants"("id","class_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD CONSTRAINT "result_drafts_message_id_mail_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD CONSTRAINT "result_drafts_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD CONSTRAINT "result_drafts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD CONSTRAINT "result_drafts_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_players_normalized_name" ON "players" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "idx_players_user_id" ON "players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_participants_player_id" ON "tournament_participants" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "idx_participants_class_id" ON "tournament_participants" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "idx_matches_class_id" ON "matches" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "idx_matches_participant_id" ON "matches" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "idx_result_drafts_status_created" ON "result_drafts" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
-- tournament-results: circular/self FK constraints added manually (declared as plain
-- integer columns in the drizzle schema to avoid a TypeScript circular type reference,
-- mirroring tournament_drafts.superseded_by_draft_id). Both target tables now exist.
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_source_result_draft_id_result_drafts_id_fk" FOREIGN KEY ("source_result_draft_id") REFERENCES "public"."result_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD CONSTRAINT "result_drafts_superseded_by_draft_id_result_drafts_id_fk" FOREIGN KEY ("superseded_by_draft_id") REFERENCES "public"."result_drafts"("id") ON DELETE set null ON UPDATE no action;