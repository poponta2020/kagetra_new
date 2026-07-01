---
status: completed
---
# senseki-ranking-refinements 実装手順書

> 要件は `requirements.md`（status: completed）参照。UI 見た目は既存 design-spec のまま
> （`design_required: false`）。DB スキーマ変更・migration なし。
> テストファースト（CLAUDE.md ルール2）で各タスク進める。ローカル test は `--no-file-parallelism`
> ＋ worktree なら `TEST_DATABASE_URL` 隔離（[[feedback_vitest_no_file_parallelism]] /
> [[feedback_shared_test_db_worktree_push_race]]）。

## 実装タスク

### タスクA: ②所属会バグ修正（期間内の直近に）
- [x] 完了
- **概要:** ランキング各行の所属会を、集計後に playerId 群から **期間フィルタ内の直近大会**
  （`event_date` 降順 NULLS LAST・同日 `tournament.id` 降順、級不問）で解決してマージする。
  現状の `recentAffiliation(agg.playerId)`（派生テーブル列への相関が効かず全行同じ値）を廃止。
- **変更対象ファイル:**
  - `apps/web/src/lib/stats/ranking.test.ts` — （先に）**所属の異なる2人以上**で各行が別々の直近所属を
    返すケース＋**期間フィルタで直近が変わる**ケースを追加（現行1人ケースは残す）。
  - `apps/web/src/lib/stats/ranking.ts` — `recentAffiliation` 相関サブクエリを撤去。`getPlayerRanking`
    で行取得後に `playerId[]` → 直近所属を別クエリ（`queries.ts` の相手所属解決と同型・
    `DISTINCT ON (player_id)` or 後段2次クエリ）で解決してマージ。期間条件（yearFrom/yearTo）を
    この解決クエリにも適用（タスクCの `periodConds` があれば再利用、無ければ暫定でローカル実装→C で統合）。
- **依存タスク:** なし（独立・単独 ship 可）
- **対応Issue:** #225

### タスクB: ①③デフォルト期間/級＋明示フラグ
- [x] 完了
- **概要:** 絞り込み未指定時のデフォルトを **級=A・期間=直近5年（当年−5〜当年）** にする。
  「全級/全期間」も明示選択で保持できるよう **明示フラグ**（例 `f=1`）を URL に導入。フラグ無し＝
  デフォルト、有り＝URL 値そのまま。ランキング parse 層に閉じる（共有 `sanitizeStatsFilter` 不変）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/ranking/metrics.test.ts` — （先に）`parseRankingParams` の
    デフォルト注入（フラグ無し→A/直近5年）、明示フラグ有り→URL 値そのまま、`buildRankingHref` の
    フラグ出力、round-trip、指標切替でモード維持を検証。当年依存は固定注入 or `vi` で制御。
  - `apps/web/src/app/(app)/players/ranking/metrics.ts` — `parseRankingParams` にデフォルト注入と
    明示モード判定、`buildRankingHref(metric, filter, explicit)` にフラグ出力。当年は引数 or util で受ける
    （純関数維持のため currentYear を渡す設計を推奨）。
  - `apps/web/src/app/(app)/players/ranking/page.tsx` — `parseRankingParams` から `{metric, filter, explicit}`
    を受け、`currentYear` を算出してデフォルト適用。**解決済み filter（A/直近5年が入った状態）**を
    各コンポーネントへ渡す（フィルタバー表示・集計・loadMore が一致するように）。`explicit` も伝播。
  - `apps/web/src/app/(app)/players/ranking/RankingFilterBar.tsx` — **適用**＝常に明示モードで push、
    **クリア**＝素の URL（フラグ無し）で push＝デフォルト復帰。サマリー表示は解決済み filter を反映。
  - `apps/web/src/app/(app)/players/ranking/RankingMetricChips.tsx` — 指標切替で `explicit` を維持して href 生成。
- **依存タスク:** なし（ただし C・D が本タスクの `metrics.ts` を使うので**先に実装**）
- **対応Issue:** #226

### タスクC: ⑤現級母集団＋「昇段済みを含む」トグル
- [x] 完了
- **概要:** 級フィルタ有り＋トグルOFF のとき、母集団を「**現級 ∈ 選択級**」に制限。現級＝期間内・
  判明級のみの直近1件。非相関 `DISTINCT ON` サブクエリで `players.id IN (...)` を1枚足す。全指標に効く。
- **変更対象ファイル:**
  - `apps/web/src/lib/stats/types.test.ts` — （先に）`sanitizeStatsFilter` が `includeFormerGrade` を
    boolean コアース（未指定/不正→false）することを検証。
  - `apps/web/src/lib/stats/types.ts` — `StatsFilter` に `includeFormerGrade?: boolean` 追加、`sanitizeStatsFilter` で処理。
  - `apps/web/src/lib/stats/ranking.test.ts` — （先に）現級制限（OFF＝現級のみ・ON＝従来）を **6指標のうち
    代表複数**で検証。特に「**級Xを打ったが直近は別級**（降級/昇級）」の選手が OFF で消え ON で復活すること、
    「**直近が級不明→その前の判明級で判定**」を検証。
  - `apps/web/src/lib/stats/ranking.ts` — `filterConds` から **期間だけの `periodConds(filter)`** を分離。
    `participantAgg`/`matchAgg` の WHERE に、`grades?.length>0 && !includeFormerGrade` のときだけ現級 IN 句を
    追加。**現級CTEは生SQL（`t` alias）で period 条件を `t.event_date` 側で組む**（落とし穴②）。
    **CTE の WHERE に選択級（grade IN）を入れない**（落とし穴①）。並びは `event_date DESC NULLS LAST, id DESC`。
    （タスクA の所属解決の period 条件も `periodConds` に寄せて統合）。
  - `apps/web/src/app/(app)/players/ranking/metrics.test.ts` — （先に）`includeFormer=1` の入出力を検証。
  - `apps/web/src/app/(app)/players/ranking/metrics.ts` — `buildRankingHref` で `includeFormerGrade===true`→
    `includeFormer=1`、`parseRankingParams` で読取（`firstParam` 経由）。
  - `apps/web/src/app/(app)/players/ranking/RankingFilterBar.test.tsx` — （先に）級未選択時トグル非表示、
    apply で `includeFormerGrade` が反映されることを検証。
  - `apps/web/src/app/(app)/players/ranking/RankingFilterBar.tsx` — 級セクション下にトグル「昇段済みの選手を
    含む」。`draftIncludeFormer` を `open` 時に同期、**級未選択時は非表示**、`apply` で set（true のみ）。
- **依存タスク:** タスクB（#226・`metrics.ts`・フィルタバーを共有）。※タスクA の `periodConds` 統合もここで確定。
- **対応Issue:** #227

### タスクD: ④選手詳細の「ランキングへ戻る」（ブラウザ戻る相当）
- [ ] 完了
- **概要:** ランキング→詳細で上部導線を「← ランキングへ戻る」にし、押下で `router.back()`（スクロール保持）。
  詳細 URL に `from=ranking`＋絞り込み params を複写（ラベル判定＋フォールバック遷移先）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/ranking/RankingList.test.tsx` — （先に）行リンクが
    `from=ranking`＋現在の絞り込み params を含むことを検証。
  - `apps/web/src/app/(app)/players/ranking/RankingList.tsx` — `Link href` を
    `/players/${id}?from=ranking&…`（metric/明示フラグ/grades/yearFrom/yearTo/includeFormer 複写）に。
  - `apps/web/src/app/(app)/players/ranking/metrics.ts` — 必要なら「詳細への from=ranking URL」を組む小 util を追加
    （`buildRankingHref` の query 部を再利用）。metrics.test.ts に対応テスト。
  - `apps/web/src/app/(app)/players/[id]/BackButton.tsx` — **新規（client）**。`router.back()`＋`href`
    フォールバック（中クリック/JS 無効/history 無し時）。
  - `apps/web/src/app/(app)/players/[id]/page.tsx` — 戻る導線分岐に `from === 'ranking'` を追加し
    `parseRankingParams`→`buildRankingHref` で戻り先 href を再構成、BackButton を描画。数値 `from`・
    それ以外は既存のまま。
- **依存タスク:** タスクB（#226・`parseRankingParams`/`buildRankingHref`・明示フラグを使用）
- **対応Issue:** #228

## 実装順序

1. **タスクA**（②所属バグ・独立）— いつでも可。単独 PR 推奨。
2. **タスクB**（①③デフォルト＋明示フラグ）— C・D の土台。
3. **タスクC**（⑤現級＋トグル）— B の後。`periodConds` をここで統合（A の暫定実装を寄せる）。
4. **タスクD**（④戻る導線）— B の後。C とは独立。

- PR 粒度: **A を独立 PR**、その後 **B → C → D**（1PR ずつを基本。ファイル競合が多いので直列。B と D を
  まとめる等は ship 時に判断）。並行 worktree にする場合は `metrics.ts`/`RankingFilterBar.tsx` の競合に注意し、
  C・D は B マージ後にリベース。

## テスト観点（DoD 補助）
- API/ロジック: `ranking.test.ts`（②複数選手・期間直近／⑤現級OFF・ON・判明級フォールバック）、
  `types.test.ts`（includeFormer sanitize）、`metrics.test.ts`（①③デフォルト・明示フラグ・includeFormer・
  from=ranking round-trip）。
- フロント: `RankingFilterBar.test.tsx`（トグル表示条件・apply 反映）、`RankingList.test.tsx`（from=ranking リンク）。
- 手動/実機: 既定ビュー＝現在A級・直近5年、全級/全期間の到達と復元、クリアで既定復帰、所属会が行ごとに正しい、
  詳細→ランキング戻りでフィルタ＋スクロール保持、トグルON/OFF の増減。
