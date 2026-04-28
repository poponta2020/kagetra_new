CREATE TYPE "public"."line_channel_status" AS ENUM('available', 'assigned', 'active', 'system', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."mail_worker_job_status" AS ENUM('pending', 'claimed', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mail_worker_run_kind" AS ENUM('cron', 'manual');--> statement-breakpoint
CREATE TYPE "public"."mail_worker_run_status" AS ENUM('running', 'success', 'imap_failed', 'ai_failed', 'partial');--> statement-breakpoint
CREATE TABLE "line_channels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "line_channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel_id" text NOT NULL,
	"channel_secret" text NOT NULL,
	"channel_access_token" text NOT NULL,
	"bot_id" text NOT NULL,
	"status" "line_channel_status" DEFAULT 'available' NOT NULL,
	"assigned_user_id" text,
	"notification_line_user_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_channels_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
CREATE TABLE "mail_worker_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_worker_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"since" timestamp with time zone,
	"status" "mail_worker_job_status" DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"run_id" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "mail_worker_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_worker_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"kind" "mail_worker_run_kind" NOT NULL,
	"status" "mail_worker_run_status" DEFAULT 'running' NOT NULL,
	"summary" jsonb,
	"error" text,
	"triggered_by_user_id" text,
	"since" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "line_channel_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notification_line_user_id" text;--> statement-breakpoint
ALTER TABLE "line_channels" ADD CONSTRAINT "line_channels_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_worker_jobs" ADD CONSTRAINT "mail_worker_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_worker_jobs" ADD CONSTRAINT "mail_worker_jobs_run_id_mail_worker_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."mail_worker_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_worker_runs" ADD CONSTRAINT "mail_worker_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mail_worker_jobs_status_requested_at" ON "mail_worker_jobs" USING btree ("status","requested_at");