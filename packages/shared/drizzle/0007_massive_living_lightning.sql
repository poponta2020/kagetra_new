CREATE TYPE "public"."attachment_extraction_status" AS ENUM('pending', 'extracted', 'failed', 'unsupported');--> statement-breakpoint
CREATE TABLE "mail_attachments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mail_message_id" integer NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"extracted_text" text,
	"extraction_status" "attachment_extraction_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_mail_message_id_mail_messages_id_fk" FOREIGN KEY ("mail_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_attachments_mail_message_id_idx" ON "mail_attachments" USING btree ("mail_message_id");