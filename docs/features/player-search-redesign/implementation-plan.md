---
status: draft
---
# 選手検索 結果一覧 リデザイン 実装手順書

> 要件成果物＝[design-spec.md](./design-spec.md)（locked）。本手順書は薄い実装計画。PR構成＝**1PR**（コミットは 共有(タブ固定)→ 画面(検索/行) の順）。テストファースト。

## 実装タスク

### タスク1: SectionTabs 固定（統計4画面共通・共有変更）
- [x] 完了
- **概要:** `SectionTabs`（または統計レイアウトの配置元）を下スクロールでも上部固定に。MobileShell 上部バーの直下に `position: sticky; top:*`。選手検索/大会結果/ランキング/大会統計の4画面すべてに効く共有変更。washi surface 背景＋下境界を維持し、内容がタブ裏に潜るよう z-index を確保。
- **変更対象ファイル:**
  - `apps/web/src/components/stats/section-tabs.tsx` — sticky クラス付与（top はシェル上部バー高さ）
  - （必要なら）統計セクションのレイアウト/ラッパ — スクロールコンテナとの整合
- **依存タスク:** なし（先行）
- **検証:** 4画面すべてでスクロール時にタブが残る／既存レイアウト非回帰（目視＋実機）。

### タスク2: searchPlayers 拡張（フィールド追加＋並び替え）
- [x] 完了
- **概要ः** 戻り値に `currentGrade` / `lastEventDate` / `lastTournamentName` / `lastResult` を追加し、**並び順を lastEventDate 降順（NULLS LAST）主キー**へ変更（タイブレーク＝participationCount 降順→displayName）。`lastResult` は ①`derivePlacement` 導出（当該直近大会・級のみ）→ ②`final_rank` フォールバック → ③null（=記録なし）。各選手の直近参加1件だけを対象に対戦をまとめて取得し N+1 を回避。
- **変更対象ファイル:**
  - `apps/web/src/lib/players/queries.ts` — `PlayerSearchResult` 型拡張＋クエリ＋導出
  - `apps/web/src/lib/players/queries.test.ts`（無ければ新規）— **先に**：新フィールドの値・並び順・fallback3段（導出/生final_rank/記録なし）・開催日不明(null)・同名複数のケース
- **依存タスク:** なし（タスク1と並行可）
- **検証:** APIテスト green・詳細画面の rank と同名大会で表示一致。

### タスク3: 結果行コンポーネント＋page 差し替え
- [ ] 完了
- **概要:** 枠付きカード→密なリスト行に置換。行＝1行目「氏名(Serif)＋現級`(A)`一体＋所属会」／2行目「最終出場：YYYY/MM（大会名 結果）」／右「出場大会数」／末尾`›`。入賞＝藍・記録なし＝砂ミュート・古い最終出場年＝`.old`ミュート・開催日不明表示・省略記号。件数ヘッダ文言を「最終出場が新しい順」に。空/該当なし文言は踏襲。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/components/PlayerResultRow.tsx`（新規）
  - `apps/web/src/app/(app)/players/page.tsx` — リスト描画差し替え・件数ヘッダ
  - 上記の render テスト（先に）：級表記・最終出場行・記録なし・old ミュート class・開催日不明・長名省略
- **依存タスク:** タスク2
- **検証:** フロントテスト green。

### タスク4: 検索バー固定（選手検索のみ）
- [ ] 完了
- **概要:** 検索ボックス＋ボタンの区画に surface 背景＋下境界＋淡い影を与え、タブ直下に `position: sticky`。ボタン単体でなく区画ごと固定。結果はバー裏に潜る。top はタブ高さ分オフセット、z-index はタブ>検索バー>本文。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/players/page.tsx` ／ `components/PlayerSearchForm.tsx`（固定バーのラッパ・背景・境界）
- **依存タスク:** タスク1（タブ固定と top/z の整合）
- **検証:** iPhone 実機でスクロール時にタブ＋検索バーが残り、ボタンが浮かない。横スクロール無し。

## 実装順序
1. タスク1（SectionTabs 固定・共有）→ 単体で回帰確認
2. タスク2（searchPlayers 拡張・API先行）
3. タスク3（行コンポーネント＋page）
4. タスク4（検索バー固定）
5. （まとめて1PR。コミットは 1→2→3→4 の粒度で分ける）
