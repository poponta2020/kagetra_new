---
name: impl-series-nickname-link-task1-3
description: 通称⇄系列連動 タスク1・3
type: project
---

## 概要

mail-ai-extract-refinements の 2026-09-07 改修（承認画面の通称⇄系列連動。親 #599）。worktree = `C:/tmp/impl-mail-ai-extract-refinements`、ブランチ `feature/mail-ai-extract-refinements`（origin の同名ブランチは出荷済みだったので ensure-worktree.sh が origin/main から張り直した）。

## タスク1（#600・main 直実装）: lib/edition 層

- `SeriesRow.shortName` を **optional**（`shortName?: string | null`）で追加。required にすると match.test / resolve.test / ApprovalForm.test の SeriesRow リテラルが全部落ち、タスク1 の typecheck がタスク2 のファイルを触らないと通らなくなる（Wave の排他違反）
- `scoreSeriesForSearch` の照合対象に `shortName` を追加。`scoreSeries` / `rankSeriesCandidates` は不変（PR #292 の検索/自動解決の分離）
- `createConfirmedSeries` が `shortName` を受けて保存（trim して空なら null）。返り値・`loadAllSeries`・`getSeriesForEditionLink` の select にも `shortName` を追加

## ★実装で判明した2点（要件・計画の抜け）

1. **`parseSeriesName` も漢数字対応が要る**。計画は `parseEditionNumber` だけ書いていたが、`parseSeriesName` は同じ「第N回」を `\d{1,4}` で剥がしている。片方だけ直すと「第三回全国競技かるた杉並大会」は回次3が読めても系列名候補に「第三回」が残り、**完全一致にならない**（= matched false・候補が2件あれば未選択・flow② の autoResolveEdition は score>=100 を要求するので依然 link されない）。「第N回」のマッチャを `EDITION_NUMBER_SOURCE` として1か所に切り出し、両者で共有する形にした
2. **初期選択の緩和は「置き換え」ではなく「追加」**。AC-47 の原文「候補が0件または複数のときは未選択（現行どおり）」を文字どおり実装すると、現行の `buildEditionSuggestion`（完全一致が単独なら他に部分一致があっても採用）より**狭く**なる。緩和のはずが自動化を落とすので、`完全一致が単独 || 候補が1件` の2分岐にし、requirements.md の AC-47・§3.2.9(a)・変更履歴と tournament-entry-rosters の相互参照を訂正した（生きた仕様の明確化として、ユーザー確認は取らず実装＋文書訂正で処理）

## ★副作用として明示的にテスト固定したこと

初期選択が当たる頻度が上がる（実測16/31）＝ **`editionLink` チェックが既定 ON になる承認が大幅に増える**。`tournament_series_editions` の行作成と `events.edition_id` 設定が既定で走る挙動変化なので、ApprovalForm.test に「候補1件 → editionLink が checked」を入れて固定し、PR 本文にも書く。

## タスク3（#602・main 直実装）: Server Action

`approveDraftUnits` が hidden `editionSeriesShortName` を読み、trim して空なら null で `createConfirmedSeries` に渡す。既存系列経路（`getSeriesForEditionLink`）では一切使わない。AC-57 のテストは「早期 throw で触られていないから不変」を掴まないよう、events 行の `editionId` が非 null であることを先に assert している。

## 検証

- `apps/web` typecheck: pass（タスク1 時点）
- `src/lib/edition/` vitest: 72 passed
- `admin/mail-inbox/actions.test.ts` vitest: 187 passed

## タスク2（#601・task-implementer(sonnet) へ委譲）: 承認フォーム UI

Wave 2 = タスク2（worker）／タスク3（main）を同時進行。変更領域は `components/**` と `actions.ts` で実際に重ならず、**排他宣言ミスなし**。hidden field `editionSeriesShortName` だけが2タスクを跨ぐ契約なので、名前と値（`createNew ? nickname.trim() : ''`）を両方のプロンプト・実装に逐語で書いて揃えた。

受け入れ確認（main）: diff を全読み → ApprovalForm.test 42 passed / edition 72 passed / actions 187 passed、`tsc --noEmit` pass、eslint pass。ワーカーの判断はいずれも妥当だった。

- 通称の初期値は `shortNameStem` → kind 適合初期候補の `seriesShortName` → 空の優先順位。**kind 適合チェック（`compatibleSeriesOptions`）を通ったときだけ**通称も入れる
- ワーカーが `unitKinds` / `hasMixedKinds` / `editionKind` / `compatibleSeriesOptions` / `initialSeriesId` の宣言を通称 `useState` より前へ移動（初期値が `initialSeriesId` に依存するため）。ロジックは不変だが diff が大きく見える
- 候補チップは `searchSeriesCandidates(通称, seriesOptions, editionKind)` の上位3件。**通称が空のときのガードが必須**（空クエリだと同種別の全系列が返る仕様）
- main が後付けした唯一の変更: 選択済み系列のチップに `aria-pressed` と選択スタイル（押しても状態が変わらないチップが「押せそうで無反応」に見えるため）

## ★ワーカーへの指示で効いたこと

既存テスト「初期候補の系列種別が登録対象と異なる場合は選択しない」に「通称欄も空」を足させたのが、kind ゲートの実装スリップ検知になった。ワーカーは指示（アサーション追加）を超えて `shortNameStem` を null・`seriesShortName` を非空へ変える必要があることに自分で気づいて報告してきた（`shortNameStem` が非空だと通称は必ず埋まり、アサーションが無意味になる）。
