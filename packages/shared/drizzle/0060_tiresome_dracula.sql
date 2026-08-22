CREATE TABLE "entry_group_payment_notices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_group_payment_notices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_group_id" integer NOT NULL,
	"grade_counts" jsonb NOT NULL,
	"total_jpy" integer NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_sent_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_group_payment_notices_group_unique" UNIQUE("entry_group_id")
);
--> statement-breakpoint
ALTER TABLE "entry_group_payment_notices" ADD CONSTRAINT "entry_group_payment_notices_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_group_payment_notices" ADD CONSTRAINT "entry_group_payment_notices_last_sent_by_users_id_fk" FOREIGN KEY ("last_sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;