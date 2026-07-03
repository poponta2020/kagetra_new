-- =============================================================================
-- Tier2⑦ 軽微一括クリーンアップ — 草案 v2（DRAFT・未適用）
-- 根拠: REPORT_本番結果データ点検_2026-07-03.md 所見F
--       ＋ 2026-07-03 preflight 全件抽出（c:/tmp/dq/tier2/t7_*.csv、Fable検証済み）
-- 運用: HANDOVER §4-§5。行レベル修正なので本番直接でよいが、
--       バックアップ→単一トランザクション→read-back＋承認は必須。
--
-- v2 変更点: B の実態は草案 v1 の想定(regex 860件)より広く、プレースホルダ表記が
--   大会由来で6通り存在（計 2,409件）。3カテゴリに分割し、C(39件)は⑤へ送る。
-- =============================================================================

-- =============================================================================
-- A. score_diff = 0 の null 化（36件・preflight一致確認済み 2026-07-03）
--    競技かるたに0枚差勝ちは存在しない（兵庫2019 D級の敗者側16件＝欠損が0で入った、ほか）
--    ※うち2件(id=569809 會津, id=732891 福岡)はBカテゴリAと重複。同一txなら順序不問
--      （Bのwalkover化でも score_diff=NULL になるため終状態は同じ）。
-- =============================================================================

-- preflight + backup
SELECT m.id, m.class_id, m.round, m.result, m.status, m.score_diff
FROM matches m WHERE m.score_diff = 0 ORDER BY m.class_id, m.round;
-- 期待: 36行（全件リスト = c:/tmp/dq/tier2/t7_A_scorediff0.csv）
-- \copy (SELECT * FROM matches WHERE score_diff = 0) TO 'bk_scorediff0.csv' CSV HEADER

-- BEGIN;
-- UPDATE matches SET score_diff = NULL WHERE score_diff = 0;  -- 36行想定
-- COMMIT;

-- read-back
SELECT count(*) FROM matches WHERE score_diff = 0;  -- 期待: 0

-- =============================================================================
-- B. 不戦勝/棄権プレースホルダが opponent_name に残り status='normal' の正規化
--    全件 2,409件 = 目視用 c:/tmp/dq/tier2/t7_B_walkover_eyeball.csv
--    グループ集計とマッピング根拠 = c:/tmp/dq/tier2/t7_B_group_mapping.md
--
--    カテゴリA: 不戦勝プレースホルダ 2,353件
--      表記6種（大会ごとに1種で混在なし）: 不戦(660)/不戦勝(183)/不(740)/― 不(649)/- 不(118)/#N/A 不(3)
--      署名: 100% result=win・opponent_participant_id 全NULL・負け側ミラー行なし
--      → status='walkover'＋相手情報とscore_diffをNULL化（既存walkover約94千行の正規形と同形）
--    カテゴリB: 本人棄権 17件（棄=11・棄権=6）
--      署名: 100% result=lose（「相手の棄権」ケースは実測0件 → v1の曖昧さは解消）
--      既存DBに同一慣行あり（例 id=829882: opponent_name='棄権', result=lose, status=forfeit）
--      → status='forfeit'（opponent_name は既存慣行に合わせ保持）
--    カテゴリC: 実在の相手名＋理由字サフィックス 39件（「姓(名) 棄」25・「姓(名) 不」14）
--      実対戦のミラー行が存在。サフィックスで名前解決が壊れているだけ
--      → 本バッチでは触らない。⑤相手未解決の再解決へ送る（id=604423/604432 の非対称1件含む）
-- =============================================================================

-- preflight（適用直前に件数を再確認）
SELECT opponent_name, result, count(*)
FROM matches
WHERE status = 'normal'
  AND opponent_name IN ('不戦','不戦勝','不','― 不','- 不','#N/A 不','棄','棄権')
GROUP BY 1, 2 ORDER BY 3 DESC;
-- 期待: win系6種=2,353 / lose系2種=17（2026-07-03 実測。Fableが独立再実行で一致確認済み）
-- \copy (SELECT * FROM matches WHERE status='normal' AND opponent_name IN ('不戦','不戦勝','不','― 不','- 不','#N/A 不','棄','棄権')) TO 'bk_walkover_normalize.csv' CSV HEADER

-- 適用（承認後）
-- BEGIN;
-- -- カテゴリA: 不戦勝 → walkover 正規形
-- UPDATE matches
-- SET status='walkover', opponent_name=NULL, opponent_participant_id=NULL, score_diff=NULL
-- WHERE status='normal' AND result='win'
--   AND opponent_name IN ('不戦','不戦勝','不','― 不','- 不','#N/A 不');   -- 2,353行想定
-- -- カテゴリB: 本人棄権 → forfeit
-- UPDATE matches
-- SET status='forfeit'
-- WHERE status='normal' AND result='lose'
--   AND opponent_name IN ('棄','棄権');                                      -- 17行想定
-- COMMIT;

-- read-back（v1のregexでは 不/― 不/- 不/#N/A 不 を検出できないため IN リストで）
SELECT count(*) FROM matches
WHERE status = 'normal'
  AND opponent_name IN ('不戦','不戦勝','不','― 不','- 不','#N/A 不','棄','棄権');
-- 期待: 0（カテゴリCの39件は意図的に status='normal' のまま残る）
SELECT status, count(*) FROM matches
WHERE opponent_name IN ('棄','棄権') GROUP BY 1;
-- 期待: forfeit のみ（正規化後）

-- =============================================================================
-- C. editions マスターの year 誤り2件の修正（証跡 = c:/tmp/dq/tier2/t7_C_editions.txt）
--    （1〜5月開催を前年に付けるシーズン年規約の160件は仕様なので触らない）
--    宇佐神宮42回 edition id=497: 実開催 2013-03-09（41回=2013-03-10 の前日）→ year 2013
--    桑名76回     edition id=852: 実開催 2017-03-20（75回C/D/E=t780 と同日）→ year 2017
--    UNIQUE は (series_id, edition_number) のみで year 変更に衝突なし（確認済み）
-- =============================================================================

-- preflight
SELECT e.id, s.name, e.edition_number, e.year
FROM tournament_series_editions e JOIN tournament_series s ON s.id = e.series_id
WHERE (s.name LIKE '%宇佐神宮%' AND e.edition_number = 42)
   OR (s.name LIKE '%桑名%'     AND e.edition_number = 76);
-- 期待: 2行（id=497 year=2014 / id=852 year=2018）

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
