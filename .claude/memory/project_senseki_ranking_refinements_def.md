---
name: project_senseki_ranking_refinements_def
description: "統計ランキング改修5件（デフォルト/所属会/戻る/現級母集団）SHIPPED PR#230。親#224+子#225-228全クローズ"
metadata: 
  node_type: memory
  type: project
  originSessionId: 138441d8-2090-4c79-adec-8248d018ae1d
---

**SHIPPED: PR#230 merge `fbb5dcf`（2026-07-02・implement→auto-review-loop→ship 自律完走）。親#224＋子#225-228 全クローズ。migration 無。Codex 1R pass(high・0 blocker/should_fix/nit・109,910 tokens)・CI green。残=本番実機目視（web再ビルドで反映・auto-deploy対象外）。**

**実装の非自明点（4コミット A→B→C→D）:**
- ②所属会=`getPlayerRanking` 行取得後に `db.execute` の `DISTINCT ON` 別クエリで一括解決してマージ（`recentAffiliation` 相関サブクエリ撤去）。期間条件は既存 `stats/filters.ts` の `periodConds`（`t` alias・"AND t.event_date …"）を再利用（②⑤で共有）
- ①③=`parseRankingParams(sp, currentYear)` が `{metric, filter, explicit}` を返す純関数化。明示フラグ param は **`f=1`**。無し→デフォルト級A・直近5年注入／有り→URL値そのまま。`buildRankingHref(metric, filter, explicit)` は非明示=指標のみ・明示=f=1＋フィルタ。当年は page で `new Date().getFullYear()` 算出し渡す
- ⑤=`currentGradeMembership(filter)` が発火時のみ `players.id IN (DISTINCT ON …)` を返し participantAgg/matchAgg の WHERE に追加。enum比較は `cur.grade::text in (…)`。既存「grades で絞る」テストは母集団意味変化に伴い `includeFormerGrade:true` で分子/母集団を分離する形へ更新（承認済み挙動変更）
- ④=`buildPlayerHrefFromRanking(id,metric,filter,explicit)` で行→`/players/[id]?…&from=ranking`。詳細 `page.tsx` は `from==='ranking'` で新規 `BackButton.tsx`(client・router.back＋href フォールバック・history.length>1 判定)。数値 `from`(相手名タップ)と排他

統計タブ ③選手ランキング（`/players/ranking`・[[impl_senseki_stats_pr3_ranking]]）への delta 改修5件を define-feature で要件化。DBスキーマ変更・migration なし・design_required:false（見た目は既存 design-spec のまま）。

**5件（順序 A→B→C・D）:**
- ① デフォルト期間=直近5年（当年−5〜当年、`yearFrom=当年-5`）
- ② 所属会バグ修正: `recentAffiliation(agg.playerId)` は派生列相関が効かず**全行同じ値**（既存テストは1人seedで未検出）。集計後に playerId群→**期間内の直近**大会の所属を別クエリ解決（queries.ts 相手所属解決と同型）
- ③ デフォルト級=A級（ランキングタブのみ・parse層に閉じ共有 sanitizeStatsFilter 不変）
- ④ 詳細の戻る=ランキングへ（**ブラウザ戻る相当 router.back でスクロール保持**・新規 BackButton.tsx client・`from=ranking`＋params複写でラベル/フォールバック）
- ⑤ 級フィルタ母集団を「現級∈選択級」に制限＋トグル「昇段済みの選手を含む」。**非相関 DISTINCT ON**で `players.id IN(...)`。落とし穴①CTEに選択級grade INを入れない(判明級の最新→後で級判定)②CTEは生SQL`t`aliasなので `filterConds` から期間だけ `periodConds` 切出し `t.event_date` で組む。級フィルタ有り＋OFF時だけ発火

**点検で確定した非自明判断:**
- ①③⑤合成で**初期表示=現在A級・直近5年の人だけ**（意図した強い既定）
- ②所属は「通算直近→**期間内の直近**」に変更しユーザー決定で⑤現級と期間スコープ統一（歴史ビューで選手検索/詳細ヘッダ=通算直近と食い違い得るが許容）
- ⑤トグル文言「昇段済み」はA級で降級側=方向逆と指摘したが**ユーザー判断で維持**
- ①③「全級/全期間」は**残す**＝明示フラグ(例`f=1`)をURLに持たせデフォルト省略方式との衝突回避。クリア=デフォルト復帰

要件/手順書=`docs/features/senseki-ranking-refinements/`。次=`/implement senseki-ranking-refinements`（A独立PR→B→C・D）。
