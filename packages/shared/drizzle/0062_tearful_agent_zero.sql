CREATE TYPE "public"."payment_report_amount_source" AS ENUM('payment_notice', 'tally', 'none');--> statement-breakpoint
CREATE TYPE "public"."payment_report_status" AS ENUM('sent', 'failed', 'skipped_unlinked', 'skipped_no_change');--> statement-breakpoint
CREATE TABLE "entry_group_payment_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_group_payment_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_group_id" integer NOT NULL,
	"event_ids" jsonb NOT NULL,
	"amount_jpy" integer,
	"amount_source" "payment_report_amount_source" NOT NULL,
	"unknown_grade_count" integer DEFAULT 0 NOT NULL,
	"message_text" text NOT NULL,
	"receipt_count" integer DEFAULT 0 NOT NULL,
	"status" "payment_report_status" NOT NULL,
	"error_message" text,
	"last_sent_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_group_payment_receipts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_group_payment_receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"report_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"preview_data" "bytea" NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_group_payment_receipts_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "entry_group_payment_reports" ADD CONSTRAINT "entry_group_payment_reports_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_payment_reports" ADD CONSTRAINT "entry_group_payment_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_payment_receipts" ADD CONSTRAINT "entry_group_payment_receipts_report_id_entry_group_payment_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."entry_group_payment_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_group_payment_reports_group_idx" ON "entry_group_payment_reports" USING btree ("entry_group_id");--> statement-breakpoint
CREATE INDEX "entry_group_payment_receipts_report_idx" ON "entry_group_payment_receipts" USING btree ("report_id");