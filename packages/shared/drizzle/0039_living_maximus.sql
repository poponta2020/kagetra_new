CREATE TABLE "event_broadcast_guideline_attachments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_broadcast_guideline_attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_line_broadcast_id" integer NOT NULL,
	"mail_attachment_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_broadcast_guideline_attachments_uq" UNIQUE("event_line_broadcast_id","mail_attachment_id")
);
--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" ADD COLUMN "guidelines_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_broadcast_guideline_attachments" ADD CONSTRAINT "event_broadcast_guideline_attachments_event_line_broadcast_id_event_line_broadcasts_id_fk" FOREIGN KEY ("event_line_broadcast_id") REFERENCES "public"."event_line_broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_broadcast_guideline_attachments" ADD CONSTRAINT "event_broadcast_guideline_attachments_mail_attachment_id_mail_attachments_id_fk" FOREIGN KEY ("mail_attachment_id") REFERENCES "public"."mail_attachments"("id") ON DELETE cascade ON UPDATE no action;