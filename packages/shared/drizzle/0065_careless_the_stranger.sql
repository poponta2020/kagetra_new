CREATE TABLE "mail_body_share_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mail_body_share_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mail_message_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_body_share_tokens_mail_message_id_unique" UNIQUE("mail_message_id"),
	CONSTRAINT "mail_body_share_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "mail_body_share_tokens" ADD CONSTRAINT "mail_body_share_tokens_mail_message_id_mail_messages_id_fk" FOREIGN KEY ("mail_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_body_share_tokens_mail_idx" ON "mail_body_share_tokens" USING btree ("mail_message_id");--> statement-breakpoint
CREATE INDEX "mail_body_share_tokens_expires_at_idx" ON "mail_body_share_tokens" USING btree ("expires_at");