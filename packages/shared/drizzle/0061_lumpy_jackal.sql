ALTER TABLE "result_drafts" ADD COLUMN "ai_routing" jsonb;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD COLUMN "ai_prompt_version" text;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD COLUMN "ai_tokens_input" integer;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD COLUMN "ai_tokens_output" integer;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD COLUMN "ai_cost_usd" numeric(10, 6);--> statement-breakpoint
ALTER TABLE "result_drafts" ADD COLUMN "ai_error" text;--> statement-breakpoint
ALTER TABLE "result_drafts" ADD COLUMN "extraction_source" text;