---
status: completed
---
# tournament-results 実装手順書

要件定義書：`docs/features/tournament-results/requirements.md`
親Issue：#157（子 #158〜#162）

方針：テストファースト（API/ロジック→実装→フロント→E2E）。1PR=1タスク。AI は使わない（決定的パース）。
既存 `mail-tournament-import` 基盤（IMAP・添付 bytea・ジョブキュー・Web Push・レビュー UI）を再利用。

## 実装タスク

### タスク1: shared スキーマ＋migration
- [x] 完了
- **概要:** 選手マスタ含む 6 テーブルと enum、relations、migration を追加。
- **詳細:**
  - enum 追加：`result_draft_status`(pending_review/approved/rejected/parse_failed/superseded) / `match_result`(win/lose) / `match_status`(normal/walkover/forfeit)。`mail_worker_job_kind` に `result_parse` 追加。grade(A–E) 既存流用。
  - テーブル：`players`（normalized_name・UNIQUE(normalized_name,affiliation)・user_id=会員同定後続）/ `tournaments` / `tournament_classes` / `tournament_participants`（player_id・生スナップショット・wins/losses は持たない）/ `matches`（result/score_diff(null可)/status）/ `result_drafts`（tournament_drafts 踏襲）。
  - index：players(normalized_name) / players(user_id) / participants(player_id) / participants(class_id) / matches(class_id) / matches(participant_id) / result_drafts(status,created_at)。
- **変更対象ファイル:**
  - `packages/shared/src/schema/enums.ts` — enum 追加・job kind 拡張
  - `packages/shared/src/schema/players.ts` / `tournaments.ts` / `tournament-classes.ts` / `tournament-participants.ts` / `matches.ts` / `result-drafts.ts` — 新規
  - `packages/shared/src/schema/index.ts` / `relations.ts` — export・relations 追加
  - `packages/shared/drizzle/00xx_*.sql` — migration 生成（`db:generate`）
  - `packages/shared/__tests__/` — スキーマ/挿入・cascade テスト
- **依存タスク:** なし
- **完了条件:** 型チェック通過・migration 適用・FK/cascade を含む基本挿入テスト green。
- **対応Issue:** #158

### タスク2: パーサ中核＋fixtureテスト（最重要・最難）
- [ ] 完了
- **概要:** Excel リーダー＋ヘッダ署名駆動パーサ＋正規化を純関数で実装し、42 サンプルで検証。
- **詳細:**
  - リーダー：`.xlsx`=`exceljs`、`.xls`=libreoffice で `.xlsx` 変換後に読む（脆弱な `xlsx` lib 不使用。fods 経由も可・PR 内で最終選定）。出力＝シート→セルグリッド。
  - パーサ：「選手名＋相手/枚数/勝敗」署名でシート判定（無し=スキップ）→ 列を名前で特定 → (相手,枚数,勝敗) 抽出 → 級は級/クラス列 or シート名。
  - 正規化：枚数(不戦勝/棄権)→status、勝敗(○/〇/×)、`normalized_name`（空白除去・NFKC・字体揺れ）。Zod payload 型。
- **変更対象ファイル:**
  - `apps/mail-worker/src/result-import/reader.ts` / `parser.ts` / `normalize.ts` / `schema.ts` — 新規
  - `apps/mail-worker/package.json` — `exceljs` 追加
  - `apps/mail-worker/src/result-import/__tests__/` ＋ fixtures（サンプル xls/xlsx。**個人情報のため fixtures は gitignore か匿名化**）
- **依存タスク:** なし（payload 型は単独で作成可）
- **完了条件:** 各系統の代表サンプルで参加者数・試合数・特定選手の成績が期待一致。不戦勝/棄権/○〇/非AE級/兵庫(1シート全級)/山形(列順可変)/署名なしスキップを網羅。
- **対応Issue:** #159

### タスク3: result_parse ジョブ＋取込トリガ＋ボタン
- [ ] 完了
- **概要:** mail-worker に取込ジョブ、web に「結果として取り込む」導線を追加。
- **詳細:**
  - mail-worker：job kind `result_parse`（payload=`{mail_message_id, attachment_id}`）、`runResultParse`（reader+parser→`result_drafts` 格納 pending_review/parse_failed→Web Push）。既存 extract-only timer に相乗り。
  - web：Server Action `triggerResultParse`、mail-inbox 詳細に「結果として取り込む」ボタン（.xls/.xlsx 添付時表示、複数なら選択）。
- **変更対象ファイル:**
  - `apps/mail-worker/src/jobs.ts`（dispatch）/ `src/result-import/run.ts`（新規）/ `src/index.ts`（mode）
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（triggerResultParse）/ `[id]/` 配下（ボタン・添付選択 UI）
  - 各テスト（action が draft+job 作成 / runResultParse が draft 格納）
- **依存タスク:** タスク1, タスク2
- **完了条件:** ボタン→ジョブ→draft(pending_review/parse_failed)生成、Web Push 到達。
- **対応Issue:** #160

### タスク4: レビューUI＋承認/却下＋確定保存
- [ ] 完了
- **概要:** 結果ドラフトのレビュー画面と、承認時の確定保存（名寄せ・相手解決込み）。
- **詳細:**
  - レビュー UI：大会名編集（件名/ファイル名プリフィル）・開催日/会場任意・級/選手/試合プレビュー・承認/却下。
  - `approveResultDraft`：1 トランザクションで tournaments/classes/participants/matches 作成＋`players` get-or-create(正規化キー)で player_id 付与＋同一級内 opponent 解決。draft=approved・mail=processed。訂正版 supersede。
  - `rejectResultDraft`：draft=rejected。`parse_failed` は却下のみ。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（approve/reject）
  - `apps/web/src/app/(app)/admin/mail-inbox/[id]/` 配下（レビューコンポーネント）
  - `apps/web/src/lib/result-import/materialize.ts`（新規・確定保存）
  - テスト（materialize：players 名寄せ・opponent 解決・walkover/forfeit・supersede）
- **依存タスク:** タスク1, タスク3
- **完了条件:** 承認で 6 テーブルへ正しく確定（名寄せ/相手解決/不戦勝・棄権の status）。却下・supersede 動作。
- **対応Issue:** #161

### タスク5: 選手戦績ページ（会員向け）
- [ ] 完了
- **概要:** 会員向け。選手名検索→players引当→全出場（大会/級/順位/各試合）表示。勝敗は status=normal 集計。
- **詳細:**
  - 検索（`players.normalized_name`）→ `participant.player_id` で全出場 → 大会/級/順位/各試合（相手/枚数/勝敗）。
  - 勝敗集計は `matches` から `status=normal` のみ（不戦勝・棄権除外）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/` 配下（検索＋一覧＋詳細）・ナビ追加
  - `apps/web/src/lib/players/queries.ts`（新規）
  - テスト（検索・集計が status=normal のみ）
- **依存タスク:** タスク1（表示データはタスク4投入後）
- **完了条件:** 名前検索→戦績表示、勝敗集計が status=normal のみ。
- **対応Issue:** #162

## 実装順序
1. タスク1（依存なし）— #158
2. タスク2（依存なし・1 と並行可）— #159
3. タスク3（1,2 依存）— #160
4. タスク4（1,3 依存）— #161
5. タスク5（1 依存・実データは 4 後）— #162

## 補足
- **個人情報**：パーサ fixtures は実選手名を含むため、リポジトリには gitignore か匿名化して置く（`docs/調査用/` の生ファイルはコミットしない方針を踏襲）。
- 真の定型外（署名不一致）は `parse_failed`→管理者却下＝手動対応は後続フェーズ。
