-- tournament-entry-rosters (PR-1a baseline): bring the raw-loaded series/editions layer
-- under Drizzle management and add events/tournaments.edition_id.
--
-- IDEMPOTENT BY DESIGN. Production already has tournament_series / tournament_series_editions
-- (raw-loaded — see C:/tmp/prod_schema_series.sql — series 180 / editions 1236),
-- tournaments.edition_id (+ tournaments_edition_id_fkey), and both enums. There this migration
-- MUST be a pure no-op (no drops, no recreations, no duplicate FKs, existing rows untouched).
-- On a fresh DB everything is created. Tests build the schema via `drizzle-kit push` (from the
-- TS schema), so this SQL is exercised only by prod `db:migrate`. Constraint names match the
-- production originals exactly, so the name-scoped guards below are reliable on both sides.
DO $$ BEGIN
 CREATE TYPE "public"."tournament_kind" AS ENUM('individual', 'team');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tournament_status" AS ENUM('held', 'cancelled', 'unconfirmed');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tournament_series" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_series_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" "tournament_kind" DEFAULT 'individual' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_series_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tournament_series_editions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tournament_series_editions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"series_id" integer NOT NULL,
	"edition_number" integer NOT NULL,
	"year" integer,
	"status" "tournament_status" NOT NULL,
	"source_filetype" text,
	"raw_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_series_editions_series_id_edition_number_key" UNIQUE("series_id","edition_number")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "edition_id" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "edition_id" integer;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname = 'tournament_series_editions_series_id_fkey'
    AND conrelid = 'public.tournament_series_editions'::regclass
 ) THEN
  ALTER TABLE "tournament_series_editions" ADD CONSTRAINT "tournament_series_editions_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "public"."tournament_series"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname = 'events_edition_id_fkey'
    AND conrelid = 'public.events'::regclass
 ) THEN
  ALTER TABLE "events" ADD CONSTRAINT "events_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."tournament_series_editions"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname = 'tournaments_edition_id_fkey'
    AND conrelid = 'public.tournaments'::regclass
 ) THEN
  ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "public"."tournament_series_editions"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;
