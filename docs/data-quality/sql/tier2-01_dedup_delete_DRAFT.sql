-- =============================================================================
-- Tier2① 二重取込9ペアの削除 — 草案（DRAFT・未適用）
-- 根拠: docs/data-quality/REPORT_本番結果データ点検_2026-07-03.md 所見A
-- 運用: HANDOVER §4-§5。本番適用は 1ペアずつ diff提示→ユーザー承認→適用。
--       大会単位の削除なので、原則リハDB(kagetra_rehearsal)で検証してから本番へ。
-- 前提: 実行前にペアごとの preflight が全て想定通りであること。
--       matches/tournament_participants は tournament_classes 経由の ON DELETE CASCADE、
--       tournament_classes は tournaments 経由の CASCADE → 親 tournaments の DELETE 1文で消える。
--       players はグローバル共有なので絶対に消さない（削除後の孤児化チェックのみ）。
-- =============================================================================

-- 削除対象（消す側）: 報告書の候補に基づく。★=原本確認が済むまで適用禁止
--   新春2016(第61回)  : t302 を削除（t301 と完全同一。どちらでも可 → 若番 t301 を残す）
--   太宰府2019(第49回): t825 (A,B) を削除（t826 大会報告=全級1,315 が上位互換）
--   太宰府2024(第53回): t939 (A), t940 (B) を削除（t945 A,B,C,D が上位互換）
--   桑名2023(第80回)  : t1361 (C,E) を削除（t1370 A-E が上位互換）
--   桑名2024(第81回)  : t950 (C,E) を削除（t972 A-E が上位互換）
--   桑名2025(第82回)  : t1064 (D,E), t1065 (C) を削除（t1084 A-E が上位互換）
--   愛知2011(第14回)  : t21 (D) を削除（t643 全級519 が上位互換）
--   ★愛知2022(第22回): t1327 ↔ t1328 は未決。t1328 に級名「-」ゴミあり・重複級はCのみ。
--                       原本（12/10版と12/11版）を突合してから決定する。本草案に含めない。

-- =============================================================================
-- 0. preflight（read-only。全ペア共通で削除前に必ず流す）
-- =============================================================================

-- 0-1. 削除側の級構成が「重複級のみ」であること（想定外の級が混ざっていたら中断）
SELECT t.id AS tournament_id, t.name, c.id AS class_id, c.class_name, c.grade,
       c.num_players,
       (SELECT count(*) FROM matches m WHERE m.class_id = c.id) AS match_cnt
FROM tournaments t JOIN tournament_classes c ON c.tournament_id = t.id
WHERE t.id IN (302, 825, 939, 940, 1361, 950, 1064, 1065, 21)
ORDER BY t.id, c.id;
-- 期待: t302=Dのみ / t825=A,B / t939=A / t940=B / t1361=C,E / t950=C,E
--       / t1064=D,E / t1065=C / t21=D

-- 0-2. result_drafts が削除対象大会を参照していないこと（バルク投入分は参照なしの想定）
SELECT id, tournament_id, status FROM result_drafts
WHERE tournament_id IN (302, 825, 939, 940, 1361, 950, 1064, 1065, 21);
-- 期待: 0行。1行でもあれば中断して要検討

-- 0-3. 残す側にも同級が存在すること（消したら級ごと消える事故の防止）
SELECT t.id, t.name, c.class_name, c.grade FROM tournaments t
JOIN tournament_classes c ON c.tournament_id = t.id
WHERE t.id IN (301, 826, 945, 1370, 972, 1084, 643)
ORDER BY t.id, c.grade;

-- 0-4. 対象行バックアップ（適用直前に採取。ファイル名は日付を付ける）
-- \copy (SELECT * FROM tournaments            WHERE id IN (302,825,939,940,1361,950,1064,1065,21)) TO 'bk_dedup_tournaments.csv' CSV HEADER
-- \copy (SELECT c.* FROM tournament_classes c WHERE c.tournament_id IN (302,825,939,940,1361,950,1064,1065,21)) TO 'bk_dedup_classes.csv' CSV HEADER
-- \copy (SELECT p.* FROM tournament_participants p JOIN tournament_classes c ON p.class_id=c.id WHERE c.tournament_id IN (302,825,939,940,1361,950,1064,1065,21)) TO 'bk_dedup_participants.csv' CSV HEADER
-- \copy (SELECT m.* FROM matches m JOIN tournament_classes c ON m.class_id=c.id WHERE c.tournament_id IN (302,825,939,940,1361,950,1064,1065,21)) TO 'bk_dedup_matches.csv' CSV HEADER

-- =============================================================================
-- 1. 適用（1ペア=1トランザクション。承認が下りたペアだけ実行する）
--    ※ 他大会の matches.opponent_participant_id が削除参加者を指す行は
--      FK ON DELETE SET NULL で自動的に null 化される（相手未解決化）。
--      二重取込ペアは同一開催なので相互参照は原則ペア内で閉じるが、
--      read-back 1-2 で削除前後の null 増分を必ず確認する。
-- =============================================================================

-- 例: 新春2016（承認後にコメントを外す）
-- BEGIN;
-- DELETE FROM tournaments WHERE id = 302;   -- classes/participants/matches はCASCADE
-- COMMIT;

-- 以降同様: 825 / 939,940 / 1361 / 950 / 1064,1065 / 21

-- =============================================================================
-- 2. read-back（各ペア適用後）
-- =============================================================================

-- 2-1. 消えたこと・残る側が無傷なこと（0-1/0-3 を再実行して比較）
-- 2-2. opponent_participant_id の null 増分（削除の巻き添え確認。全体で増えていないこと）
SELECT count(*) FROM matches WHERE opponent_participant_id IS NULL AND status = 'normal';
-- 2-3. 孤児 players（参加行が1つも無くなった選手）が発生していないこと
SELECT count(*) FROM players p
WHERE NOT EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp.player_id = p.id);

-- =============================================================================
-- 3. 全ペア完了後の派生再計算（HANDOVER §4-5）
--    - display_name 再計算: apps/web/_recompute_all.mts（recomputePlayerDisplayNames）
--    - derived_bracket / num_players は削除大会ごと消えるため残側は影響なし（確認のみ）
--    - 台帳 result-fix-ledger.md に1ペア=1行で記録
-- =============================================================================
