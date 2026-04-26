CREATE TYPE "public"."tournament_draft_status" AS ENUM('pending_review', 'approved', 'rejected', 'ai_failed', 'superseded');--> statement-breakpoint
CREATE TABLE "tournament_drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" integer NOT NULL,
	"status" "tournament_draft_status" DEFAULT 'pending_review' NOT NULL,
	"confidence" numeric(3, 2),
	"is_correction" boolean DEFAULT false NOT NULL,
	"references_subject" text,
	"superseded_by_draft_id" integer,
	"extracted_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_raw_response" text,
	"prompt_version" text NOT NULL,
	"ai_model" text NOT NULL,
	"ai_tokens_input" integer,
	"ai_tokens_output" integer,
	"ai_cost_usd" numeric(10, 6),
	"event_id" integer,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"rejected_by_user_id" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_drafts_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "tournament_drafts_confidence_range" CHECK ("tournament_drafts"."confidence" BETWEEN 0 AND 1 OR "tournament_drafts"."confidence" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "tournament_drafts" ADD CONSTRAINT "tournament_drafts_message_id_mail_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_drafts" ADD CONSTRAINT "tournament_drafts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_drafts" ADD CONSTRAINT "tournament_drafts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_drafts" ADD CONSTRAINT "tournament_drafts_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_drafts_status_created" ON "tournament_drafts" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "tournament_drafts" ADD CONSTRAINT "tournament_drafts_superseded_by_draft_id_fkey" FOREIGN KEY ("superseded_by_draft_id") REFERENCES "tournament_drafts"("id") ON DELETE SET NULL;