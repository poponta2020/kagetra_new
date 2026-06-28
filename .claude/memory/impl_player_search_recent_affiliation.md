---
name: impl_player_search_recent_affiliation
description: 戦績検索結果の所属会を直近大会の participant スナップショットから表示（PR #194）
metadata:
  type: project
---

`/players` 戦績検索結果の所属会が常に「所属不明」だった問題を修正（quickfix・PR #194 merge `2c9360f`、2026-06-29）。

原因: 検索結果（[[project_senseki_detail_redesign]] の検索画面）は `players.affiliation` を表示していたが、[[impl_player_identity_name_only]]（migration 0029・選手同定を姓名のみ化）以降 **`players.affiliation` は常に null**（所属は「人×大会」属性で participant 側の生スナップショットが正）。

修正: `apps/web/src/lib/players/queries.ts` の `searchPlayers` の `affiliation` を相関サブクエリ化し、**直近の大会**（`event_date` 降順・**NULLS LAST**、同日は tournament id 降順）の participant スナップショットの所属を 1 件引く（`tournament_participants → tournament_classes → tournaments` を join）。戦績詳細ヘッダ（`participations[0].affiliation`）・対戦相手の所属（`opponentAffiliation`）と同じ「直近大会の所属」になり、検索結果と詳細で所属が一致する。

非自明: DB スキーマ変更なし。フロント `players/page.tsx` は `p.affiliation` をそのまま使うので変更不要（表示行の都道府県 `p.prefecture` は据え置き＝依頼スコープ外）。テストは複数大会で所属が変わる場合に直近を返す（event_date null の大会を NULLS LAST で直近扱いしない＝id 降順だけの誤実装を弾く）回帰込みで 16/16 green。Codex 1R 即 pass。残 DoD=本番実機で選手検索→所属が直近大会の所属で出ることの目視。
