ALTER TABLE "event_line_broadcasts" DROP CONSTRAINT "event_line_broadcasts_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" ADD CONSTRAINT "event_line_broadcasts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_channels" ADD CONSTRAINT "line_channels_webhook_destination_id_unique" UNIQUE("webhook_destination_id");