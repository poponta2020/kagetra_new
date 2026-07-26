-- entry-groups タスク3（1/2）: LINE 紐付けの帰属を event → entry_group へ移す。
--
-- **手修正版。再生成で上書きしないこと。** drizzle-kit generate は
-- `ADD COLUMN ... NOT NULL`（default 無し）を出すが既存行があると失敗する。また
-- 「1列追加 + 1列削除」を同一 migration にすると generate がリネーム候補として
-- 対話プロンプトを要求し非TTY環境で落ちるため、**旧列の DROP は次の migration に分けた**
-- （0047）。本番は db:migrate で両方を一度に適用するので中間状態は見えない。
--
-- 手順: nullable ADD → backfill → fail-loudly ガード → SET NOT NULL → FK → UNIQUE。
ALTER TABLE "line_channels" ADD COLUMN "assigned_entry_group_id" integer;--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" ADD COLUMN "entry_group_id" integer;--> statement-breakpoint
-- backfill: いま event に紐付いている帰属を、その event の申込グループへ移す。
UPDATE "event_line_broadcasts" b
   SET "entry_group_id" = e."entry_group_id"
  FROM "events" e
 WHERE e."id" = b."event_id";--> statement-breakpoint
UPDATE "line_channels" c
   SET "assigned_entry_group_id" = e."entry_group_id"
  FROM "events" e
 WHERE e."id" = c."assigned_event_id";--> statement-breakpoint
DO $$
DECLARE
  orphans integer;
  dup_groups integer;
  dup_channels integer;
BEGIN
  -- 1) 取りこぼし: FK があるので起こらないはずだが、SET NOT NULL の前に明示的に落とす。
  SELECT count(*) INTO orphans FROM event_line_broadcasts WHERE entry_group_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'entry-groups 0046: entry_group_id が未割当の event_line_broadcasts が % 件あります', orphans;
  END IF;

  -- 2) ★fail-loudly: 同一グループに複数の紐付け行が集まると UNIQUE が張れない。
  --    「1グループ=1LINEグループ」の前提が崩れているということなので、Postgres の
  --    UNIQUE 違反ではなく**意味のあるエラー**で止める（本番は 2026-07-26 の調査で
  --    クラスタ単位に高々1行であることを確認済み。行再利用セマンティクスにより
  --    revoked/released も同一行の UPDATE なので通常は増えない）。
  SELECT count(*) INTO dup_groups FROM (
    SELECT entry_group_id FROM event_line_broadcasts
     GROUP BY entry_group_id HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'entry-groups 0046: 同一 entry_group に複数の event_line_broadcasts 行があるグループが % 件あります（1グループ=1紐付けの前提が崩れています。手動で統合してから再実行してください）', dup_groups;
  END IF;

  -- 3) 同様に Bot の予約先も1グループ1つでなければならない。
  SELECT count(*) INTO dup_channels FROM (
    SELECT assigned_entry_group_id FROM line_channels
     WHERE assigned_entry_group_id IS NOT NULL
     GROUP BY assigned_entry_group_id HAVING count(*) > 1
  ) d;
  IF dup_channels > 0 THEN
    RAISE EXCEPTION 'entry-groups 0046: 同一 entry_group に複数の line_channels が予約されているグループが % 件あります', dup_channels;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" ALTER COLUMN "entry_group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "line_channels" ADD CONSTRAINT "line_channels_assigned_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("assigned_entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" ADD CONSTRAINT "event_line_broadcasts_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_channels" ADD CONSTRAINT "line_channels_assigned_entry_group_id_unique" UNIQUE("assigned_entry_group_id");--> statement-breakpoint
ALTER TABLE "event_line_broadcasts" ADD CONSTRAINT "event_line_broadcasts_entry_group_id_unique" UNIQUE("entry_group_id");
