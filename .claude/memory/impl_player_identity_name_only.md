---
name: impl_player_identity_name_only
description: "players 同定キーを (normalized_name, affiliation) → 姓名のみに変更 SHIPPED。affiliation は player では null・所属は participant 生値で per-大会表示。PR#172 merge 9fbea13"
metadata: 
  node_type: memory
  type: project
  originSessionId: 143f1e49-070b-492e-ab5c-a67b5d33546f
---

過去結果 bulk 投入の前提として、players の選手同定キーを **(normalized_name, affiliation) → normalized_name のみ**に変更（確定判断 [[project_homonym_risk_accepted]] にスキーマを一致）。**PR #172 merge `9fbea13`（2026-06-25）**。

なぜ: 所属表記ゆれ（「日本女子大かるた会」vs「日本女子大**学**かるた会」）で同一人物が最大16 player に分裂（リハ320大会で参加記録の約71%が分裂姓名）。所属は「人×大会」属性で生涯変わるため同定に使わない。発端報告書 = `c:/tmp/REPORT_players_identity.md`。

実装の要点:
- schema: `UNIQUE(normalized_name, affiliation) NULLS NOT DISTINCT` → `UNIQUE(normalized_name)`。normalized_name は NOT NULL。冗長 `idx_players_normalized_name` 削除（UNIQUE が張る一意 index が完全一致 lookup を兼ねる）。migration **0029**（本番 players 0件＝ユーザー確定のため bare な制約張替え・データ移行不要、SQL 先頭コメントで自己文書化）。
- materialize: get-or-create を姓名のみ照合に（`and/isNull` import 不要化）。**player.affiliation は常に null**（人ではなく人×大会の属性）。生の所属は participant スナップショットが正。bulk/メール取込承認の共通パス。
- 戦績: `getPlayerRecord` の participation view に affiliation を追加し、players/[id] の各大会カードに per-大会所属を表示（player 単位の代表所属は持たない）。searchPlayers/queries はキー変更で 1人=1エントリに自動収束、変更最小。
- PR #170 の recomputePlayerDisplayNames（display_name=最頻表記）とは独立・両立（recompute は player.id で join・affiliation 非依存）。
- 同姓同名（別人）は統合される＝受容済みリスク。participant 生データで後から再分割可能。

並行作業の整合: dan-rank PR #171（migration 0027/0028・materialize に danRank 追加）が作業中に main マージ→最新 main へリベース。materialize は danRank 加算と**非衝突で自動マージ**、migration は 0028 baseline から**再生成**（snapshot に dan_rank 含む・将来 generate の差分汚染を回避）、0029 で番号衝突なし。journal は 26→27→28→29 連続。

検証: Codex auto-review 1R（high）= blocker（既存重複で UNIQUE 追加失敗）は本番0件で該当せず・should_fix（snapshot欠落）はレビュー diff から snapshot を除外したことによる誤検知（実際はコミット済）＝実欠陥なし。typecheck 4/4・web 592 passed・shared 12・mail-worker 352・lint green。

残 DoD: 本番反映後（auto-deploy で migration 0029 適用）に戦績ページの per-大会所属表示を実機目視。これで [[project_bulk_load_handover]] の bulk 投入は**前提クリア**（投入自体は別途ユーザー GO 制のまま）。
