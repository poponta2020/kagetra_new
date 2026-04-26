ALTER TABLE "events" ADD COLUMN "fee_jpy" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_deadline" date;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_info" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "entry_method" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "organizer" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "capacity_a" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "capacity_b" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "capacity_c" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "capacity_d" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "capacity_e" integer;