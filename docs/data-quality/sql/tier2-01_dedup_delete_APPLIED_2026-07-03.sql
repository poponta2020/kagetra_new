-- Tier2-01 dedup delete APPLY on production kagetra (2026-07-03)
-- backups taken: c:/tmp/dq/tier2/bk_dedup_*_2026-07-03.csv
-- targets: t302,t825,t939,t940,t1361,t950,t1064,t1065,t21,t1327 (10 tournaments / 8 editions)
-- plus: t1328 class '-' -> 'A' (grade=A), dummy-player orphan cleanup, scoped display_name recompute

\echo === preflight asserts ===
DO $$
DECLARE v bigint;
BEGIN
  SELECT count(*) INTO v FROM tournaments WHERE id IN (302,825,939,940,1361,950,1064,1065,21,1327);
  IF v <> 10 THEN RAISE EXCEPTION 'preflight: expected 10 delete-side tournaments, got %', v; END IF;

  SELECT count(*) INTO v FROM matches m JOIN tournament_classes c ON m.class_id=c.id
  WHERE c.tournament_id NOT IN (302,825,939,940,1361,950,1064,1065,21,1327)
    AND m.opponent_participant_id IN (
      SELECT p.id FROM tournament_participants p JOIN tournament_classes c2 ON p.class_id=c2.id
      WHERE c2.tournament_id IN (302,825,939,940,1361,950,1064,1065,21,1327));
  IF v <> 0 THEN RAISE EXCEPTION 'preflight: % outside matches reference delete-side participants', v; END IF;

  SELECT count(*) INTO v FROM players p
  WHERE NOT EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp.player_id=p.id);
  IF v <> 0 THEN RAISE EXCEPTION 'preflight: orphan players baseline not 0 (got %)', v; END IF;

  SELECT count(*) INTO v FROM result_drafts WHERE tournament_id IN (302,825,939,940,1361,950,1064,1065,21,1327);
  IF v <> 0 THEN RAISE EXCEPTION 'preflight: result_drafts reference delete-side (%)', v; END IF;

  SELECT count(*) INTO v FROM tournament_classes WHERE tournament_id=1328 AND class_name='-';
  IF v <> 1 THEN RAISE EXCEPTION 'preflight: t1328 class "-" not found exactly once (got %)', v; END IF;
END $$;

\echo === capture pre-metrics and affected players ===
CREATE TEMP TABLE pre_metrics AS
SELECT 'opp_null_outside'::text AS k,
       (SELECT count(*) FROM matches m JOIN tournament_classes c ON m.class_id=c.id
        WHERE m.opponent_participant_id IS NULL AND m.status='normal'
          AND c.tournament_id NOT IN (302,825,939,940,1361,950,1064,1065,21,1327))::bigint AS v;
INSERT INTO pre_metrics SELECT 'matches_total', count(*) FROM matches;
INSERT INTO pre_metrics SELECT 'participants_total', count(*) FROM tournament_participants;
INSERT INTO pre_metrics SELECT 'tournaments_total', count(*) FROM tournaments;
SELECT * FROM pre_metrics ORDER BY k;

CREATE TEMP TABLE affected_players AS
SELECT DISTINCT p.player_id FROM tournament_participants p
JOIN tournament_classes c ON p.class_id=c.id
WHERE c.tournament_id IN (302,825,939,940,1361,950,1064,1065,21,1327);
SELECT count(*) AS affected_players FROM affected_players;

\echo === DELETE pair 1/8 shinshun2016: t302 ===
BEGIN;
DELETE FROM tournaments WHERE id = 302;
COMMIT;

\echo === DELETE pair 2/8 dazaifu2019: t825 ===
BEGIN;
DELETE FROM tournaments WHERE id = 825;
COMMIT;

\echo === DELETE pair 3/8 dazaifu2024: t939,t940 ===
BEGIN;
DELETE FROM tournaments WHERE id IN (939,940);
COMMIT;

\echo === DELETE pair 4/8 kuwana2023: t1361 ===
BEGIN;
DELETE FROM tournaments WHERE id = 1361;
COMMIT;

\echo === DELETE pair 5/8 kuwana2024: t950 ===
BEGIN;
DELETE FROM tournaments WHERE id = 950;
COMMIT;

\echo === DELETE pair 6/8 kuwana2025: t1064,t1065 ===
BEGIN;
DELETE FROM tournaments WHERE id IN (1064,1065);
COMMIT;

\echo === DELETE pair 7/8 aichi2011: t21 ===
BEGIN;
DELETE FROM tournaments WHERE id = 21;
COMMIT;

\echo === DELETE pair 8/8 aichi2022: t1327 ===
BEGIN;
DELETE FROM tournaments WHERE id = 1327;
COMMIT;

\echo === UPDATE aichi2022 t1328: class '-' -> 'A' (grade=A) ===
BEGIN;
UPDATE tournament_classes SET class_name='A', grade='A'
WHERE tournament_id = 1328 AND class_name = '-';
COMMIT;

\echo === post asserts ===
DO $$
DECLARE v bigint; want bigint;
BEGIN
  SELECT count(*) INTO v FROM tournaments WHERE id IN (302,825,939,940,1361,950,1064,1065,21,1327);
  IF v <> 0 THEN RAISE EXCEPTION 'postcheck: % delete-side tournaments still present', v; END IF;

  SELECT count(*) INTO v FROM matches WHERE opponent_participant_id IS NULL AND status='normal';
  SELECT p.v INTO want FROM pre_metrics p WHERE p.k='opp_null_outside';
  IF v <> want THEN RAISE EXCEPTION 'postcheck: opp_null_normal total % <> expected % (collateral SET NULL happened)', v, want; END IF;

  SELECT count(*) INTO v FROM players p
  WHERE NOT EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp.player_id=p.id);
  IF v <> 5 THEN RAISE EXCEPTION 'postcheck: expected exactly 5 orphan players (dummies), got %', v; END IF;
END $$;

\echo === orphan dummy players (verify then delete) ===
SELECT p.id, p.normalized_name, p.display_name FROM players p
WHERE NOT EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp.player_id=p.id)
ORDER BY p.id;

BEGIN;
DELETE FROM players p
WHERE NOT EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp.player_id=p.id)
  AND p.normalized_name IN ('あああ','いいいい','うううう','ええええ','おおおお');
COMMIT;

DO $$
DECLARE v bigint;
BEGIN
  SELECT count(*) INTO v FROM players p
  WHERE NOT EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp.player_id=p.id);
  IF v <> 0 THEN RAISE EXCEPTION 'postcheck: orphan players remain after dummy cleanup (%)', v; END IF;
END $$;

\echo === scoped display_name recompute (same algorithm as recompute-display-name.ts) ===
BEGIN;
WITH cand AS (
  SELECT tp.player_id, tp.name,
         COUNT(*) AS cnt,
         bool_or(tp.name <> pl.normalized_name) AS is_variant,
         MAX(t.event_date) AS latest
  FROM tournament_participants tp
  JOIN players pl ON pl.id = tp.player_id
  JOIN tournament_classes tc ON tc.id = tp.class_id
  JOIN tournaments t ON t.id = tc.tournament_id
  WHERE tp.player_id IN (SELECT player_id FROM affected_players)
  GROUP BY tp.player_id, tp.name
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY player_id
    ORDER BY cnt DESC, is_variant DESC, latest DESC NULLS LAST, name ASC
  ) AS rn
  FROM cand
)
UPDATE players p
SET display_name = r.name, updated_at = now()
FROM ranked r
WHERE r.player_id = p.id AND r.rn = 1
  AND p.display_name IS DISTINCT FROM r.name;
COMMIT;

\echo === final read-back ===
SELECT (SELECT count(*) FROM tournaments) AS tournaments,
       (SELECT count(*) FROM tournament_classes) AS classes,
       (SELECT count(*) FROM tournament_participants) AS participants,
       (SELECT count(*) FROM matches) AS matches;

SELECT t.id, c.class_name, c.grade, c.num_players,
       (SELECT count(*) FROM matches m WHERE m.class_id=c.id) AS match_cnt
FROM tournaments t JOIN tournament_classes c ON c.tournament_id=t.id
WHERE t.id IN (301,826,945,1370,972,1084,643,1328)
ORDER BY t.id, c.id;
