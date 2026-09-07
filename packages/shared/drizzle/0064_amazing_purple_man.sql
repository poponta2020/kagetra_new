CREATE TYPE "public"."faculty_kind" AS ENUM('undergraduate', 'graduate');--> statement-breakpoint
CREATE TYPE "public"."travel_destination_source" AS ENUM('ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."travel_selection_status" AS ENUM('confirmed', 'waitlisted', 'not_participating');--> statement-breakpoint
CREATE TYPE "public"."travel_way_kind" AS ENUM('sapporo', 'hometown', 'other');--> statement-breakpoint
CREATE TABLE "entry_group_travel_settings" (
	"entry_group_id" integer PRIMARY KEY NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"route_input_started_at" timestamp with time zone,
	"destination_prefecture" text,
	"destination_city" text,
	"destination_label" text,
	"destination_source" "travel_destination_source",
	"destination_attempted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "entry_group_selection_statuses" (
	"entry_group_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"status" "travel_selection_status" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "entry_group_selection_statuses_entry_group_id_user_id_pk" PRIMARY KEY("entry_group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "travel_routes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "travel_routes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_group_id" integer NOT NULL,
	"unit_start_date" date NOT NULL,
	"user_id" text NOT NULL,
	"departure_kind" "travel_way_kind" NOT NULL,
	"departure_place" text,
	"return_kind" "travel_way_kind" NOT NULL,
	"return_place" text,
	"legs" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"saved_by_user_id" text,
	CONSTRAINT "travel_routes_unit_user_unique" UNIQUE("entry_group_id","unit_start_date","user_id")
);
--> statement-breakpoint
CREATE TABLE "travel_unit_notices" (
	"entry_group_id" integer NOT NULL,
	"unit_start_date" date NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"all_entered_notified_at" timestamp with time zone,
	"last_error" text,
	"notified_member_count" integer,
	CONSTRAINT "travel_unit_notices_entry_group_id_unit_start_date_pk" PRIMARY KEY("entry_group_id","unit_start_date")
);
--> statement-breakpoint
CREATE TABLE "travel_report_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "travel_report_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_group_id" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"notify_error" text
);
--> statement-breakpoint
CREATE TABLE "travel_report_documents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "travel_report_documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"batch_id" integer NOT NULL,
	"event_ids" jsonb NOT NULL,
	"filename" text NOT NULL,
	"docx" "bytea" NOT NULL,
	"header" jsonb NOT NULL,
	"member_count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_circle_member" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "faculty_kind" "faculty_kind";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "faculty" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "school_year" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_travel_report_submitter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_circle_leader" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_group_travel_settings" ADD CONSTRAINT "entry_group_travel_settings_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_travel_settings" ADD CONSTRAINT "entry_group_travel_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_selection_statuses" ADD CONSTRAINT "entry_group_selection_statuses_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_selection_statuses" ADD CONSTRAINT "entry_group_selection_statuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_selection_statuses" ADD CONSTRAINT "entry_group_selection_statuses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_routes" ADD CONSTRAINT "travel_routes_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_routes" ADD CONSTRAINT "travel_routes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_routes" ADD CONSTRAINT "travel_routes_saved_by_user_id_users_id_fk" FOREIGN KEY ("saved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_unit_notices" ADD CONSTRAINT "travel_unit_notices_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_report_batches" ADD CONSTRAINT "travel_report_batches_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_report_batches" ADD CONSTRAINT "travel_report_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_report_documents" ADD CONSTRAINT "travel_report_documents_batch_id_travel_report_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."travel_report_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "travel_report_batches_group_idx" ON "travel_report_batches" USING btree ("entry_group_id");--> statement-breakpoint
CREATE INDEX "travel_report_documents_batch_idx" ON "travel_report_documents" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_circle_leader_unique" ON "users" USING btree ("is_circle_leader") WHERE "users"."is_circle_leader";