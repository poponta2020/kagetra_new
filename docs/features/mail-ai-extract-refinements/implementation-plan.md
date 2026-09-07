---
status: completed
---

# mail-ai-extract-refinements 実装手順書（2026-09-07 改修: 通称と系列の相互連動）

親Issue: #599

要件定義書: [requirements.md](./requirements.md)（今回の対象は §3.2.9〜3.2.11 / AC-45〜AC-63）

> 前回（2026-07-29 初版 / 2026-08-29 サイズ上限改訂）のタスクは出荷済み。本書は今回の改修タスクで上書きしている（完了済みタスクの記録は git 履歴が保持する）。

## 技術設計の要点（調査で確定したこと）

| 論点 | 結論 |
|---|---|
| 「DB の通称リスト」の実体 | `tournament_series.short_name`（migration 0038 で180系列投入済み・個人戦182件中180件が非 null）。**新しい列も新しいテーブルも作らない** |
| 通称候補の生成方法 | AI 呼び出しを増やさず、既存の名寄せ（`parseSeriesName` → `rankSeriesCandidates`）の結果に載っている系列の `short_name` を使う。本番31ドラフトの実測でトップ一致16/31 |
| 初期選択の条件 | `buildEditionSuggestion` を「完全一致1件」→「**候補が1件**（完全一致・部分一致を問わない）」へ緩和。実測では完全一致はごく少数で、旧条件では自動化がほぼ効かない |
| 検索の照合対象 | `scoreSeriesForSearch`（管理者検索・一方向）にだけ `short_name` を足す。**`scoreSeries`（自動解決・双方向包含）は触らない** — PR #292 で意図的に分離した契約 |
| 通称と系列の同期方向 | 空欄を埋める方向にだけ自動を効かせる。人が入れた値は上書きしない。系列は ID・通称は表示文字列として別々に保持（会の表記と `short_name` は実データでずれる） |
| `short_name` の書き込み経路 | `createConfirmedSeries`（新規作成）のみ。既存系列の更新経路は作らない（大会一覧・選手戦績の表示が承認操作の副作用で変わるのを防ぐ） |
| 通称のサーバー送信 | 現在の通称 input には `name` 属性が無く送信されていない。**新規作成時だけ値が入る hidden field `editionSeriesShortName`** を足す（既存選択時は空） |
| 回次の漢数字 | `parseEditionNumber` の数字部を漢数字にも広げる。NFKC 済みなので全角数字の既存挙動は不変 |
| マイグレーション | **不要** |
| 追加のラウンドトリップ | **なし**。`loadAllSeries` が全系列をクライアントへ渡す既存契約に `shortName` が1列増えるだけで、候補チップの絞り込みはクライアント内で完結 |

## 実装タスク

### タスク1: 系列マスタの通称を検索・名寄せ・作成に通す（lib/edition 層）
- [x] 完了
- **目的:** `short_name` を型・検索・初期候補・新規作成に通し、回次パースを漢数字へ広げる。UI から使える土台を作る
- **対応AC:** AC-45〜AC-47（サーバー側の候補供給）, AC-54, AC-55/AC-56（保存関数側）, AC-58, AC-60（回帰）
- **主な変更領域:** `apps/web/src/lib/edition/match.ts` / `apps/web/src/lib/edition/resolve.ts`（＋ `match.test.ts` / `resolve.test.ts`）
  - `SeriesRow` に `shortName: string | null` を追加し、`loadAllSeries` / `getSeriesForEditionLink` / `createConfirmedSeries` の select・returning に `tournamentSeries.shortName` を足す
  - `scoreSeriesForSearch` の照合対象へ `shortName` を追加（`scoreSeries` は**変更しない**）。候補リストの根拠表示（`matchedAliasForQuery`）のロジックも変更しない
  - `EditionSuggestion` に `seriesShortName: string | null` を追加。`buildEditionSuggestion` は `rankSeriesCandidates` の結果が**1件のとき**その系列を採用する（0件・複数件は現行どおり未選択。`matched` は従来どおり「完全一致だったか」を表す）
  - `createConfirmedSeries` が `shortName?: string | null` を受け取り保存する（trim して空なら `null`）
  - `parseEditionNumber` が漢数字を読む（「第三回」→3、「第二十五回」→25）。算用数字・全角数字・空白入りの既存挙動は不変
  - **実装時に判明**: `parseSeriesName` も同じ「第N回」を数字限定の正規表現で剥がしているため、片方だけ広げると回次は読めても系列名候補に「第三回」が残って完全一致しない。「第N回」のマッチャを1か所（`EDITION_NUMBER_SOURCE`）に切り出して両者で共有した
  - **実装時に判明**: 採用条件は「候補が1件」への**置き換え**ではなく**追加**（`完全一致が単独 || 候補が1件`）。置き換えると、完全一致が単独で他に部分一致がある案内で現行の自動選択が失われる。requirements.md の AC-47・§3.2.9(a)・変更履歴を訂正済み
- **依存タスク:** なし
- **必要なテスト:**
  - `match.test.ts`: `short_name` の完全一致が候補の先頭に来る（「大阪」→「大阪大会」が「初段認定大阪なにはえ会大会」より前）／`short_name` の部分一致でも拾える／`scoreSeries` の戻り値が変わらない
  - `resolve.test.ts`: 漢数字の回次（第三回・第二十五回・既存の算用数字/全角/空白入り）／候補1件で `seriesId` と `seriesShortName` が返る・0件と複数件では `seriesId` が `null`／`createConfirmedSeries` が `short_name` を保存する・空文字なら `null`／`autoResolveEdition` の既存ケースが不変
- **既存テストとの関係（調査済み）:**
  - `resolve.test.ts` の `suggestEditionFromName` 3ケースは新条件でも通る（「完全一致が複数」ケースは候補2件のままなので未選択のまま。`matched` の意味は変えない）
  - もし部分一致1件で `seriesId === null` を期待するテストが見つかったら、**要件 §3.2.9(a)（tournament-entry-rosters AC-1/AC-2 の上書き）を根拠に期待値を張り替える**（テストの削除ではない。理由をコミットメッセージに残す）
  - `actions.test.ts:4538` の `autoResolveEdition` fixture は結果取込 flow② の経路で `buildEditionSuggestion` を通らないため影響しない
- **触らない既知の競合:** `createConfirmedSeries` はロックなしの `loadAllSeries` で重複チェックしてから INSERT する既存の TOCTOU を持つ（最終的には `onConflictDoNothing` + UNIQUE で守られる）。今回のスコープ外であり、テストで「解決済み」と見せない
- **完了条件:** 上記テストが green、`pnpm typecheck` 通過
- **対応Issue:** #600

### タスク2: 承認フォームの通称⇄系列連動（UI）
- [x] 完了
- **目的:** 通称欄と系列選択を双方向に連動させ、同じ語を二度打つ状態を解消する
- **対応AC:** AC-45〜AC-53
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/components/ApprovalForm.tsx` / `TournamentSeriesSelectSheet.tsx` / `apps/web/src/app/(app)/admin/mail-inbox/[id]/page.tsx`（＋ `ApprovalForm.test.tsx`）
  - 初期値: `editionSuggestion.seriesShortName` を通称の初期値に使う（2.x ドラフトの `shortNameStem` が有ればそちらを優先）。kind 適合チェック（`compatibleSeriesOptions`）を通った系列のときだけ。自動投入したときは通称欄の近くに由来（系列名）を表示する
  - 通称 → 候補チップ: `searchSeriesCandidates(通称, seriesOptions, editionKind)` の上位3件を通称欄の直下に出す。`hasMixedKinds` のときは出さない。チップのラベルは `short_name`（無ければ正準名）＋正準名
  - チップのタップ: `seriesSelection` を `{ query: 系列名, seriesId, createNew: false }` に更新し `seriesSelectionKind` へ `editionKind` を入れる。**`nickname` は書き換えない**
  - 既存の「kind 不一致で選択を解除する」`useEffect` と競合させない（通称の編集は選択解除のトリガーにしない）
  - 系列 → 通称: シートの `onConfirm` で既存系列が確定したとき、`nickname` が空なら `shortName` を入れる（`createNew` のときは入れない）
  - 新規作成時に通称を送るための hidden field `editionSeriesShortName`（`createNew` のときだけ `nickname` の trim 値、それ以外は空）
  - シートの候補リストに `short_name` を表示する（どの通称の系列かが見えるようにする）
  - **型の広げ方:** `ApprovalFormProps` の `editionSuggestion.seriesShortName` は **optional**（`seriesShortName?: string | null`）で足す。`ApprovalForm.test.tsx` に既存の `editionSuggestion` リテラルが20箇所以上あり、required にすると回帰と無関係な一括修正が発生するため。生成側（`buildEditionSuggestion`）では常に値を入れる
- **依存タスク:** タスク1（`SeriesRow.shortName` / `EditionSuggestion.seriesShortName`）
- **必要なテスト:** `ApprovalForm.test.tsx`
  - 候補1件で通称欄が埋まり系列が選択済みになる／由来表示が出る
  - 候補1件でも `short_name` が `null` なら通称欄は空・系列は選択済み
  - 候補0件・複数件では通称欄が空・系列未選択
  - 通称を打つと候補チップが出る／タップで系列が確定し通称欄の文字は変化しない
  - 通称を打ち直しても系列選択が外れず、チップだけ入れ替わる
  - 個人戦・団体戦の混在案内ではチップが出ない
  - シートで系列を選ぶと、通称欄が空なら埋まり、入力済みなら変化しない
  - `createNew` のとき hidden field に通称が入り、既存選択時は空
- **完了条件:** 上記テストが green、`pnpm typecheck` / `pnpm lint` 通過
- **対応Issue:** #601

### タスク3: 新規系列作成時に通称を `short_name` として保存する（Server Action）
- [x] 完了
- **目的:** 承認フォームから作った系列に通称が入り、次回から候補が出るようにする（マスタの穴を塞ぐ）
- **対応AC:** AC-55, AC-56, AC-57, AC-61
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/actions.ts`（`approveDraftUnits` の系列解決部）＋ `actions.test.ts`
  - `editionSeriesShortName` を FormData から読み、trim して空なら `null` として `createConfirmedSeries` に渡す
  - 既存系列を選んだ経路（`getSeriesForEditionLink`）では `short_name` を**書き換えない**
  - 既存の検証（`editionSeriesId` と `editionCreateNewSeries` の排他・種別再検証・新規作成の明示確認）は変更しない
- **依存タスク:** タスク1（`createConfirmedSeries` の引数）
- **必要なテスト:** `actions.test.ts`
  - 新規作成経路で `tournament_series.short_name` に通称が入る
  - 通称が空なら `short_name` が `null`
  - 既存系列を選んだ承認では、その系列の `short_name` が変化しない
  - 既存の拒否ケース（ID と新規作成の同時指定／種別不一致／明示確認なし）が従来どおりのエラーを返す
  - ※ AC-56（通称が空のまま新規作成 → `short_name` が `null`）は**フォーム経由では到達しない可能性がある**（通称が空だと大会名が空になり登録できない）。サーバー契約の AC として、**FormData を直接組んで** `approveDraftUnits` を呼ぶ形で検証する
- **完了条件:** 上記テストが green、`pnpm typecheck` 通過
- **対応Issue:** #602

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1:** タスク1（`lib/edition` の型・検索・初期候補・作成関数・回次パース）
- **Wave 2:** タスク2 / タスク3（タスク1 に依存。互いは `components/**` と `actions.ts` で変更領域が重ならないため並行可）

## 出荷後の運用作業（コード変更ではない）

- **AC-63**: 本番の `short_name` が `null` の既存2系列に通称を投入する（`id=182` 九段 → 「九段」、`id=181` 北海道競技かるた初心者大会 → 「初心者」）。SSH 経由の psql で `UPDATE tournament_series SET short_name = $1, updated_at = now() WHERE id = $2 AND short_name IS NULL;` を2行。実測で直近31件中3件がこの2系列だったため、埋めると候補が出るようになる
