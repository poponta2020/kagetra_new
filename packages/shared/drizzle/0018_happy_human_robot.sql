CREATE TYPE "public"."mail_triage_status" AS ENUM('unprocessed', 'processed', 'deferred');--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "push_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "triage_status" "mail_triage_status" DEFAULT 'unprocessed' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "triaged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "triaged_by_user_id" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_triaged_by_user_id_users_id_fk" FOREIGN KEY ("triaged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_messages_triage_status_idx" ON "mail_messages" USING btree ("triage_status");--> statement-breakpoint
-- mail-triage-badge: 機能リリース前に届いていた既存メールは「処理済み」でベースライン化する。
-- これを入れないと初期バッジが過去メール全件 (noise 含む数百件) になり実用性を損なう。
-- リリース後に届くメールは triage_status DEFAULT 'unprocessed' で入り、未処理として正しく数えられる。
UPDATE "mail_messages" SET "triage_status" = 'processed';