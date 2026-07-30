ALTER TABLE "events" ALTER COLUMN "payment_type" SET DEFAULT 'advance';--> statement-breakpoint
-- grade-entry-fee: 既存の NULL 行を 'advance' へ backfill する（要件 §3.2.6）。
-- DEFAULT 変更だけでは既存行が NULL のまま残り、支払締切リマインドの発火条件
-- （payment_type='advance'）を満たさず通知が黙り続ける。'onsite' / 'advance' の
-- 既存行は書き換えない。
UPDATE "events" SET "payment_type" = 'advance' WHERE "payment_type" IS NULL;
