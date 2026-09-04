ALTER TABLE "entry_group_payment_notices" ADD COLUMN "last_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entry_group_payment_notices" ADD COLUMN "last_error" text;