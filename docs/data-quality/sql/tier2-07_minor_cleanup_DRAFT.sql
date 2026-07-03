-- =============================================================================
-- Tier2⑦ 軽微一括クリーンアップ — 草案（DRAFT・未適用）
-- 根拠: docs/data-quality/REPORT_本番結果データ点検_2026-07-03.md 所見F
-- 運用: HANDOVER §4-§5。行レベル修正なので本番直接でよいが、
--       バックアップ→単一トランザクション→read-back＋1件ずつ承認は同じ。
-- =============================================================================

-- =============================================================================
-- A. score_diff = 0 の null 化（36件想定）
--    競技かるたに0枚差勝ちは存在しない（兵庫2019 D級の敗者側16件＝欠損が0で入った、ほか）
-- =============================================================================

-- preflight + backup
SELECT m.id, m.class_id, m.round, m.result, m.status, m.score_diff
FROM matches m WHERE m.score_diff = 0 ORDER BY m.class_id, m.round;
-- 期待: 36行
-- \copy (SELECT * FROM matches WHERE score_diff = 0) TO 'bk_scorediff0.csv' CSV HEADER

-- BEGIN;
-- UPDATE matches SET score_diff = NULL WHERE score_diff = 0;  -- 36行想定
-- COMMIT;

-- read-back
SELECT count(*) FROM matches WHERE score_diff = 0;  -- 期待: 0

-- =============================================================================
-- B. 不戦勝/棄権が opponent_name に残り status='normal' の正規化
--    ★適用前に必ず下の抽出で全件を目視し、ケースごとにマッピングを承認すること。
--    「不戦勝」= その選手が対戦なしで勝ち → status='walkover'
--      （walkover は1行のみ・相手不在が正規形: opponent_name/opponent_participant_id は null、
--        score_diff も null、result='win' を維持）
--    「棄権」「棄」= 相手が棄権か本人が棄権かで意味が逆。result 値と原本で個別判定
--      （相手の棄権による勝ち → walkover 相当 / 本人棄権の負け → forfeit）
-- =============================================================================

-- preflight（全件抽出・目視用）
SELECT m.id, c.tournament_id, t.name AS tournament, c.class_name, m.round,
       p.name AS player, m.opponent_name, m.result, m.status, m.score_diff,
       m.opponent_participant_id
FROM matches m
JOIN tournament_classes c ON c.id = m.class_id
JOIN tournaments t        ON t.id = c.tournament_id
JOIN tournament_participants p ON p.id = m.participant_id
WHERE m.status = 'normal'
  AND m.opponent_name ~ '不戦|棄権|^棄$'
ORDER BY t.id, c.id, m.round;
-- 既知の該当: t866會津「不戦勝」「棄権」/ t1227福岡「棄」/ t1317長崎(相手名空でwin)
-- \copy (上のSELECT) TO 'bk_walkover_candidates.csv' CSV HEADER

-- 適用テンプレート（承認されたidリストに対してのみ実行）
-- BEGIN;
-- -- 不戦勝 → walkover（相手情報を落として正規形へ）
-- UPDATE matches SET status='walkover', opponent_name=NULL,
--                    opponent_participant_id=NULL, score_diff=NULL
-- WHERE id IN (/* 承認済みidリスト */) AND result='win';
-- -- 本人棄権 → forfeit（ケース確認後）
-- UPDATE matches SET status='forfeit'
-- WHERE id IN (/* 承認済みidリスト */);
-- COMMIT;

-- read-back
SELECT count(*) FROM matches
WHERE status = 'normal' AND opponent_name ~ '不戦|棄権|^棄$';  -- 期待: 0

-- =============================================================================
-- C. editions マスターの year 誤り2件の修正
--    （1〜5月開催を前年に付けるシーズン年規約の160件は仕様なので触らない）
-- =============================================================================

-- preflight
SELECT e.id, s.name, e.edition_number, e.year
FROM tournament_series_editions e JOIN tournament_series s ON s.id = e.series_id
WHERE (s.name LIKE '%宇佐神宮%' AND e.edition_number = 42)
   OR (s.name LIKE '%桑名%'     AND e.edition_number = 76);
-- 期待: 2行（宇佐神宮42回 year=2014 / 桑名76回 year=2018）
-- ※ UNIQUE(series_id, edition_number) なので year 変更で衝突はしないが、
--    変更後の (series, year) に既存の別回次が居ないかも確認する:
SELECT s.name, e.edition_number, e.year
FROM tournament_series_editions e JOIN tournament_series s ON s.id = e.series_id
WHERE (s.name LIKE '%宇佐神宮%' AND e.year = 2013)
   OR (s.name LIKE '%桑名%'     AND e.year = 2017);

-- BEGIN;
-- UPDATE tournament_series_editions e SET year = 2013
-- FROM tournament_series s
-- WHERE e.series_id = s.id AND s.name LIKE '%宇佐神宮%'
--   AND e.edition_number = 42 AND e.year = 2014;   -- 1行想定（event 2013-03-09）
-- UPDATE tournament_series_editions e SET year = 2017
-- FROM tournament_series s
-- WHERE e.series_id = s.id AND s.name LIKE '%桑名%'
--   AND e.edition_number = 76 AND e.year = 2018;   -- 1行想定（event 2017-03-20）
-- COMMIT;

-- read-back: preflight を再実行し year が 2013 / 2017 になっていること
