-- entry-groups タスク1: 申込グループ基盤。
--
-- drizzle-kit generate は `ADD COLUMN ... NOT NULL`（default 無し）を出すが、それでは
-- 既存行があるテーブルで失敗する。手修正パターン（nullable ADD → backfill → ガード →
-- SET NOT NULL → 制約/index）へ書き換えてある。**再生成時に上書きしないこと。**
--
-- backfill のクラスタ規則（requirements §3.2.10 / AC-2）:
--   - tournament_draft_id が同じ AND entry_deadline が IS NOT DISTINCT FROM で一致 → 同一グループ
--     （同じ案内メール × 同じ申込締切。例: 多摩 5 件 → AB / CDE の 2 グループ）
--   - tournament_draft_id が NULL（手動作成・移行データ）→ 1 行 1 グループのシングルトン
-- GROUP BY は NULL 同士を1グループにまとめるため、`IS NOT DISTINCT FROM` と同じ NULL 同値に
-- なる（締切未設定の複数日が同一 draft から来た場合も1グループに入る）。
CREATE TABLE "entry_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "entry_group_id" integer;--> statement-breakpoint
DO $$
DECLARE
  rec RECORD;
  gid integer;
  orphans integer;
BEGIN
  -- 1) draft 由来: (tournament_draft_id, entry_deadline) の distinct 組ごとに 1 グループ。
  FOR rec IN
    SELECT tournament_draft_id AS draft_id, entry_deadline AS deadline
      FROM events
     WHERE tournament_draft_id IS NOT NULL
     GROUP BY tournament_draft_id, entry_deadline
  LOOP
    INSERT INTO entry_groups DEFAULT VALUES RETURNING id INTO gid;
    UPDATE events
       SET entry_group_id = gid
     WHERE tournament_draft_id = rec.draft_id
       AND entry_deadline IS NOT DISTINCT FROM rec.deadline;
  END LOOP;

  -- 2) draft 無し: 1 行 1 グループのシングルトン。
  FOR rec IN SELECT id FROM events WHERE tournament_draft_id IS NULL LOOP
    INSERT INTO entry_groups DEFAULT VALUES RETURNING id INTO gid;
    UPDATE events SET entry_group_id = gid WHERE id = rec.id;
  END LOOP;

  -- 3) fail-loudly ガード: 取りこぼしがあれば SET NOT NULL の前に落とす。
  SELECT count(*) INTO orphans FROM events WHERE entry_group_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'entry-groups backfill: entry_group_id が未割当の events が % 件あります', orphans;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "entry_group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_entry_group_id_idx" ON "events" USING btree ("entry_group_id");
