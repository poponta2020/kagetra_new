-- entry-groups タスク8（1/2）: 名簿の帰属を event → entry_group へ移す。
--
-- **手修正版。再生成で上書きしないこと。** nullable ADD → backfill → fail-loudly ガード →
-- SET NOT NULL → FK → UNIQUE の順。旧列の DROP は 0049（generate の rename プロンプト回避のため
-- 2パスに分けている。0046/0047 と同じ理由）。本番は db:migrate で連続適用するので中間状態は
-- 外から観測されない。
--
-- ON DELETE は **RESTRICT**（events からの旧 FK は cascade だった）。空グループの削除が
-- 名簿を道連れにしないため — `deleteGroupIfEmpty` が rosters 0件を確認してから消す設計で、
-- RESTRICT はその DB 側バックストップ。
--
-- 本番の名簿は 0 行（2026-07-26 調査）だが、手修正パターンは踏襲する。
ALTER TABLE "tournament_entry_rosters" ADD COLUMN "entry_group_id" integer;--> statement-breakpoint
UPDATE "tournament_entry_rosters" r
   SET "entry_group_id" = e."entry_group_id"
  FROM "events" e
 WHERE e."id" = r."event_id";--> statement-breakpoint
DO $$
DECLARE
  orphans integer;
  dup_versions integer;
BEGIN
  -- 1) 取りこぼし: 旧 FK があるので起こらないはずだが、SET NOT NULL の前に明示的に落とす。
  SELECT count(*) INTO orphans FROM tournament_entry_rosters WHERE entry_group_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'entry-groups 0048: entry_group_id が未割当の tournament_entry_rosters が % 件あります', orphans;
  END IF;

  -- 2) ★fail-loudly: 版管理の一意性を (グループ, roster_type, version) へ読み替えると、
  --    「同一グループの別々の日に同じ種別・同じ version の名簿がある」場合に衝突する。
  --    UNIQUE 違反の生エラーではなく意味のあるメッセージで止める（本番は名簿0行なので
  --    起こらないが、開発 DB や将来の再適用で踏む可能性がある）。
  SELECT count(*) INTO dup_versions FROM (
    SELECT entry_group_id, roster_type, version
      FROM tournament_entry_rosters
     GROUP BY entry_group_id, roster_type, version
    HAVING count(*) > 1
  ) d;
  IF dup_versions > 0 THEN
    RAISE EXCEPTION 'entry-groups 0048: (entry_group_id, roster_type, version) が重複する組が % 件あります（同一グループの複数日に同じ版の名簿が付いています。統合してから再実行してください）', dup_versions;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ALTER COLUMN "entry_group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD CONSTRAINT "tournament_entry_rosters_entry_group_id_entry_groups_id_fk" FOREIGN KEY ("entry_group_id") REFERENCES "public"."entry_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entry_rosters" ADD CONSTRAINT "tournament_entry_rosters_entry_group_roster_type_version_key" UNIQUE("entry_group_id","roster_type","version");
