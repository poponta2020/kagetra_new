ALTER TABLE "event_broadcast_messages" ADD COLUMN "lead_text" text;--> statement-breakpoint
ALTER TABLE "event_broadcast_messages" ADD COLUMN "sent_lead_count" integer DEFAULT 0 NOT NULL;