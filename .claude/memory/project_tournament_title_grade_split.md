---
name: tournament-title-grade-split
description: 大会名を「場所+級」短縮通称化＋開催日ごとイベント分割（mail-tournament-import 拡張）。PR #111 SHIPPED + 本番反映済
metadata:
  node_type: memory
  type: project
  originSessionId: 3fa3384a-c639-4008-8361-3b3b3be732e5
---

`mail-tournament-import`（ship 済み）の AI 抽出仕様・承認フロー拡張。**PR #111 SHIPPED（merge `e664b3d`, 2026-06-04）、本番反映 success**（auto-deploy: migration 0020 適用 + restart, Oracle 東京）。親 #102 + 子 #103-109 全クローズ。残 DoD=スマホ実機目視のみ。

**目的**: (1) `events.title` を「場所固有名 + 開催級(A→E連結)」の短縮通称に（例: 東大阪ABC / 酒田B）、フルネームは `formal_name` へ。(2) 級ごとに開催日が違う案内を開催日ごと別イベントに自動分割（大阪B 1/11 / 大阪C 1/12）。新規取り込み分のみ（既存リネームせず）、メール取り込み経路のみ（手動 EventForm 対象外）。

**非自明な設計判断（実装済・コードに反映）**:
- **1メール=1ドラフト維持、1ドラフト:Nイベント**。`tournament_drafts.message_id` UNIQUE と既存 UPSERT/再抽出/triage 連動を壊さないため。分割は payload `events[]` 配列で表現
- **`events.tournament_draft_id` + `tournament_draft_unit_key` 新設**（nullable・非破壊、migration 0019）。両カラム NOT NULL 時の partial unique index で単位の二重登録を DB 保証（migration 0020）。単一 FK `tournament_drafts.event_id` は訂正版の既存大会紐付け専用に温存。FK は events↔drafts の TS 型循環回避のため raw ALTER（relations は `relationName` で2関係を区別）
- **title 合成は責務分離**: stem(場所固有名)=AI 抽出、級サフィックス=`composeTitle(stem, grades)` で A→E 順連結（決定論・入力順非依存）。AI 出力スキーマ破壊的変更 `extracted`→`short_name_stem`+`events[]`、PROMPT_VERSION 2.0.0
- **承認の並行安全性（r4+r5 で確立）**: approve/complete/reject/link/reextract の全 mutating action が tx 冒頭で `tournament_drafts` 行を **FOR UPDATE** ロックし、status(APPROVABLE) と materialized events を同一 tx 内で再確認。payload 依存判定（allowedUnitKeys/allMaterialized）も locked row の payload だけで行う。reextractDraft は LLM 後に再ロックして status+materialize 不在を確認してから `persistOutcome(tx,...)`。これで「別タブ同時操作で古い payload の unit_key で events 作成 / 作成済み event のある draft の payload 書換」race を直列化で閉じる
- **再抽出ガード**: materialize 済みイベントがあるドラフトは再抽出禁止（payload 作り直しで整合崩壊を防ぐ）
- **LINE 配信重複排除**: 分割イベントが同一グループに紐付くと同メールが複数回飛ぶため「同一 lineGroupId へ1回のみ」（[[impl_event_line_broadcast_task1]] への追加制約。`loadActiveBinding` を export して dedup）
- **部分承認**: per-unit reject カラムを足さず「作成済みイベント有無」で未処理単位を導出、`completeDraft` で残りを作らず閉じる。旧形式 payload は1単位 'u1' に正規化（後方互換）。承認 UI は `EventForm` の `fieldPrefix` で1 form 内に全単位を `${unit_key}__field` 名前空間で submit

**Codex auto-review**: R1-R6。R1-R5 で UI client 化・schema superRefine・unit_key 形式(`/^u[1-9]\d*$/`)・FOR UPDATE 直列化・payload race を順次解消。最終 R6 は r5-fix 差分のみ high で検証=**pass/0指摘**。コミット: `662fab1`(r1)/`cae5416`(r2)/`4aa6c78`(r3)/`cbcb4e5`(r4)/`9c120b1`(r5 payload race)。
**docs**: `docs/features/tournament-title-grade-split/{requirements,implementation-plan}.md`

関連: [[feedback_vitest_no_file_parallelism]]（本 PR で踏んだ flaky test 罠）, [[project_codex_review_effort]], [[feedback_windows_worktree_path]]
