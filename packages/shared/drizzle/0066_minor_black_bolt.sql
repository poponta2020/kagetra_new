CREATE TYPE "public"."line_chat_task_kind" AS ENUM('announcement', 'reminder');--> statement-breakpoint
CREATE TYPE "public"."line_chat_task_status" AS ENUM('PENDING', 'RESERVING', 'RESERVED', 'FAILED', 'MANUAL_REVIEW_REQUIRED', 'DRY_RUN_SUCCEEDED', 'CANCEL_PENDING', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."membership_renewal_status" AS ENUM('open', 'completed');--> statement-breakpoint
CREATE TYPE "public"."reader_certification" AS ENUM('B', 'A');--> statement-breakpoint
CREATE TYPE "public"."renewal_answer" AS ENUM('register', 'not_register');--> statement-breakpoint
CREATE TYPE "public"."renewal_school_year_kind" AS ENUM('advance', 'custom', 'leave');--> statement-breakpoint
ALTER TYPE "public"."line_channel_purpose" ADD VALUE 'club_chat';--> statement-breakpoint
CREATE TABLE "club_line_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "club_line_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"line_channel_id" integer NOT NULL,
	"oam_account_path" text NOT NULL,
	"oam_chat_room_id" text NOT NULL,
	"chat_room_name" text NOT NULL,
	"line_group_id" text,
	"line_group_captured_at" timestamp with time zone,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_line_groups_line_channel_id_unique" UNIQUE("line_channel_id")
);
--> statement-breakpoint
CREATE TABLE "membership_renewals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "membership_renewals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fiscal_year" integer NOT NULL,
	"deadline" date NOT NULL,
	"note" text,
	"status" "membership_renewal_status" DEFAULT 'open' NOT NULL,
	"started_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_renewals_fiscal_year_unique" UNIQUE("fiscal_year")
);
--> statement-breakpoint
CREATE TABLE "membership_renewal_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "membership_renewal_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"renewal_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"is_zennichikyo_target" boolean DEFAULT false NOT NULL,
	"is_circle_target" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb NOT NULL,
	"answer" "renewal_answer",
	"answered_at" timestamp with time zone,
	"answered_by_user_id" text,
	"answered_by_admin" boolean DEFAULT false NOT NULL,
	"school_year_kind" "renewal_school_year_kind",
	"next_faculty_kind" "faculty_kind",
	"next_faculty" text,
	"next_school_year" text,
	"school_year_answered_at" timestamp with time zone,
	"school_year_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_renewal_members_renewal_user_unique" UNIQUE("renewal_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "line_chat_tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "line_chat_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"renewal_id" integer NOT NULL,
	"kind" "line_chat_task_kind" NOT NULL,
	"target_date" date NOT NULL,
	"split_index" integer DEFAULT 0 NOT NULL,
	"scheduled_send_at" timestamp with time zone NOT NULL,
	"message_text" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "line_chat_task_status" DEFAULT 'PENDING' NOT NULL,
	"error_code" text,
	"error_message" text,
	"mention_result" jsonb,
	"reserving_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reader_certification" "reader_certification";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_associate_referee" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "club_line_groups" ADD CONSTRAINT "club_line_groups_line_channel_id_line_channels_id_fk" FOREIGN KEY ("line_channel_id") REFERENCES "public"."line_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_line_groups" ADD CONSTRAINT "club_line_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_renewals" ADD CONSTRAINT "membership_renewals_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_renewals" ADD CONSTRAINT "membership_renewals_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_renewal_members" ADD CONSTRAINT "membership_renewal_members_renewal_id_membership_renewals_id_fk" FOREIGN KEY ("renewal_id") REFERENCES "public"."membership_renewals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_renewal_members" ADD CONSTRAINT "membership_renewal_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_renewal_members" ADD CONSTRAINT "membership_renewal_members_answered_by_user_id_users_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_chat_tasks" ADD CONSTRAINT "line_chat_tasks_renewal_id_membership_renewals_id_fk" FOREIGN KEY ("renewal_id") REFERENCES "public"."membership_renewals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "line_chat_tasks_slot_uq" ON "line_chat_tasks" USING btree ("renewal_id","kind","target_date","split_index") WHERE "line_chat_tasks"."status" <> 'CANCELLED';