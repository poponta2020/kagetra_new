---
status: completed
---
# 大会申込詳細（/events/[id]）リデザイン 実装手順書

> 要件: [`requirements.md`](requirements.md)（§4 に AC 34件）／
> 視覚の正: [`design-spec.md`](design-spec.md) と `design-mock/redesign.html`（`design_source: claude-design`）
>
> **★着手ブロッカー: `nav-settings-hub`（親Issue #346）の出荷が先。**
> 親Issue: #352
> 同機能が `/events/[id]` のルート要素に `p-4` を入れ、上部バー 44px を廃止して
> ボトムナビを再構成する（一般会員4タブ・管理者6タブ）。先に出荷させ、本改修はその
> 土台の上に作る（requirements §6）。**#346 がマージされるまでタスク1を開始しない。**

## 移植の共通ルール（claude-design パス）

- `design-mock/redesign.html` を読み、実スタックのコンポーネントへ**移植**する。
  **モックと同じトークン変数名（`--kg-*`）を使う**。値を読み取って書き直さない
- モックの仮データ（名簿12名・Bot 名・配信履歴・出欠5名）は design-spec §6 に従って実配線する
- モックが描く上部バー・ボトムナビは**確定当時のシェル**であり忠実度チェックの対象外。
  実装時点（#346 出荷後）の現実に合わせる
- `SCOPE-OUT:` コメントが付いた**オープンチャット欄は実装しない**

## 実装タスク

### タスク1: 日付整形ユーティリティの共通化
- [ ] 完了
- **目的:** `/events` 一覧専用だった `formatEventDate` を共有可能な場所へ移し、詳細画面が使う
  文脈別の書式（フロー用・年つき日時・年なし日時）を揃える
- **対応AC:** AC-22（の基盤）
- **主な変更領域:**
  - 新規 `apps/web/src/lib/event-date.ts` … `formatEventDate`（移設）＋
    `formatFlowDate`（`M/D` 曜日なし・NULL は `未定`）＋`formatDateTimeFull`（`YYYY/MM/DD HH:mm`）＋
    `formatDateTimeShort`（`M/D HH:mm`）
  - 変更 `apps/web/src/app/(app)/events/event-list-utils.ts`（`formatEventDate` を削除）
  - 変更 `apps/web/src/app/(app)/events/EventListClient.tsx`・
    `apps/web/src/lib/event-grade-broadcast.ts`（import 先を差し替え。後者は現在
    lib → app への逆向き import になっており、これも解消される）
  - テスト移設 `event-list-utils.test.ts` → `lib/event-date.test.ts`
- **依存タスク:** **nav-settings-hub（親Issue #346）の出荷**
- **必要なテスト:** 移設した `formatEventDate` の既存4ケースを維持。新規3関数の
  正常系・NULL・不正入力（防御的に入力をそのまま返す既存方針を踏襲）
- **完了条件:** 移設後も `/events` 一覧と級別配信の文面が同一の出力になる（テスト green）・
  `formatEventDate` の import 元が `@/lib/event-date` に統一されている・型チェック通過
- **対応Issue:** #353

### タスク2: 申込フロー判定の純関数
- [ ] 完了
- **目的:** 5ステップの done / now / warn / neutral / goal を決めるロジックを、UI から独立した
  純関数として実装する（requirements §3.2.1 が仕様の正）
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9
- **主な変更領域:** 新規 `apps/web/src/lib/events/entry-flow.ts` と同名 `.test.ts` のみ
  （**UI を含まない**。表示は タスク6 の `EntryFlow` が担う）
  - 入力: `internalDeadline` / `entryDeadline` / `lotteryDate` / `paymentDeadline` / `eventDate` /
    `entryStatus` / `paymentType` / `paymentStatus` / `todayStr`（JST。テスト容易性のため注入）
  - 出力: 5要素の配列（`key` / `label` / `dateText` の素材 / `status`）
- **依存タスク:** なし
- **必要なテスト:** テストファースト。**中立の伝播**（`onsite`/`null` の支払・`not_applying` 時の
  大会申込〜支払）、**`not_applying` で now を出さない**、**warn は期限超過かつ未完了のみ**、
  日付 NULL で warn にならない、now は高々1つ、候補ゼロで now なし、JST 境界（当日は未超過）
- **完了条件:** AC-1〜9 に対応するテストが green・型チェック通過
- **対応Issue:** #354

### タスク3: 詳細画面用の表示プリミティブ新設
- [ ] 完了
- **目的:** 脱カードの土台（罫線セクション・フラット表・開閉トグル行）を作る。
  タスク4/5/6 が共通で使う**共有ホットスポット**なので先行させる
- **対応AC:** AC-24（の基盤）
- **主な変更領域:** 新規 `apps/web/src/components/events/detail/` 配下のみ
  - `SectionRule.tsx`（Serif 見出し＋1px 下線＋右端の補助スロット）
  - `FlatTable.tsx`（行間ヘアラインのみ・`tabular-nums`・ラベル列固定幅）
  - `DisclosureRow.tsx`（`<details>`。ラベル＋現在値＋右端の補助テキスト。**既定=閉**）
  - `LinkAction.tsx`（テキストリンク型アクション。**見た目を変えずタップ領域を 44px 相当へ広げる**
    — design-spec §10 の受容済みリスクへの対処）
  - 既存 `components/ui/` のプリミティブは**変更しない**（他画面で現役のため）
- **依存タスク:** なし
- **必要なテスト:** 各プリミティブのレンダリング（`DisclosureRow` の既定閉・
  `LinkAction` の当たり判定拡張が視覚サイズを変えないこと）
- **完了条件:** テスト green・`components/ui/` に差分が無い・型チェック通過
- **対応Issue:** #355

### タスク4: 名簿パネルの作り替えと Excel 取込の廃止
- [ ] 完了
- **目的:** 名簿を級タブ＋級の若い順に作り替え、この画面からの Excel 取込を廃止する
  （名簿はメール取り込み経由のみ）。関連メールもトグル化する
- **対応AC:** AC-14, AC-15, AC-16, AC-19, AC-20, AC-21, AC-30
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/` 配下のみ
  - 変更 `actions.ts` … `uploadRoster` を削除し、それ専用だった import を整理
    （`desc` / `isNull` / `tournamentEntryRosters` / `tournamentEditionGradeLotteryFacts` /
    `tournamentConfirmedRosterPublications` / `readExcel` / `parseRosterGrid` / `materializeRoster`）。
    **`asc` は `generateInviteCodeForEvent` が使うので残す**
  - 変更 `components/RosterSection.tsx` … 級タブ（初期「全体」固定）・級の若い順ソート・
    会員は所属の後ろに「・会員」・確定名簿の空文言。取込ブロックを除去。client component 化
  - 変更 `components/EventRelatedMails.tsx` … 開閉トグル内へ（管理者のみは維持）
  - 削除 `components/RosterUploadForm.tsx`、`actions.roster.test.ts`
  - 整理 `components/RosterSection.test.tsx` の `uploadRoster` 死にモック
  - **`materializeRoster` / `parseRosterGrid` / `readExcel` は共有ライブラリなので削除しない**
    （メール取込フローが使用）
- **依存タスク:** タスク3
- **必要なテスト:** 級ソート・級タブの絞り込みと初期選択・確定名簿の空文言・
  個人戦のみ表示（回帰）・取込フォームが admin にも出ないこと・
  `uploadRoster` がどこからも import されていないこと
- **完了条件:** AC-14/15/16/19/20/21/30 のテストが green・
  `git grep uploadRoster` が 0件・メール取込のテストが従来どおり green
- **対応Issue:** #356

### タスク5: 進行管理・LINE 配信・級別配信の再構成
- [ ] 完了
- **目的:** 運営操作を開閉トグルへ畳み、支払情報・申込方法を管理者トグル内へ集約する。
  級別グループ配信を LINE 配信トグルの中の1項目へ移す
- **対応AC:** AC-11, AC-12, AC-13b, AC-13c, AC-27, AC-28, AC-29
- **主な変更領域:** `apps/web/src/components/events/` 配下（`detail/` を除く）
  - `EventLifecycleSection.tsx` … 申込状態／支払状態の2トグル化。支払トグル内に
    参加費・支払締切・支払方法・振込先を表示。**「申し込まない」は `not_applied` のときだけ**
  - `LineBroadcastSection.tsx` … トグル化。**一般会員向けの1行案内を廃止**（非管理者には
    何も描画しない）。status のみスタブで渡す既存の情報遮断は**維持**
  - `GradeBroadcastSection.tsx` … 独立セクションをやめ LINE 配信トグル内の1項目へ。
    `role === 'admin'` 限定は維持
  - `BroadcastHistoryTable.tsx` … 罫線リストへ
  - 各 `.test.tsx` を更新
  - **`LifecycleStatusBadge.tsx` は削除しない**（他画面で使用の可能性。この画面が使うのをやめるだけ）
- **依存タスク:** タスク1, タスク3
- **必要なテスト:** 「申し込まない」の表示条件・支払トグル内の項目・非管理者に LINE 情報が
  渡らないこと（RSC payload の遮断は回帰）・級別配信が admin 限定（vice_admin に渡らない）・
  状態遷移と once-ever 通知が現行どおり（回帰）
- **完了条件:** AC-11/12/13b/13c/27/28/29 のテストが green・型チェック通過
- **対応Issue:** #357

### タスク6: 詳細ページ本体の組み替え
- [ ] 完了
- **目的:** タスク1〜5 の成果を `page.tsx` で組み上げ、脱カードのレイアウトを完成させる。
  sticky ヘッダー＋申込フローを新設し、削除項目を落とす
- **対応AC:** AC-10, AC-13, AC-17, AC-18, AC-22, AC-23, AC-24, AC-25, AC-26, AC-31, AC-32
- **主な変更領域:**
  - 変更 `apps/web/src/app/(app)/events/[id]/page.tsx`（全面書き換え）
  - 新規 `apps/web/src/components/events/detail/EventDetailHeader.tsx`
    （日付+大会名+会場+申込フローを**1つのラッパー**で sticky。分割しない）
  - 新規 `apps/web/src/components/events/detail/EntryFlow.tsx`（タスク2の純関数を描画）
  - 新規 `apps/web/src/app/(app)/events/[id]/page.test.tsx`
  - ルート要素の余白は **#346 が入れた `p-4` を引き継ぐ**（二重に入れない）。
    sticky ヘッダーは左右のみ `-mx-4` 相当で打ち消す（design-spec のモックは
    `padding:0 16px` 前提のため、上下 padding が入る差分を吸収する）
  - 対象級を級別定員セクションへ統合（定員が無ければ級のみ／両方無ければセクションごと非表示）
  - `nonAttendingCount` の算出を削除。**`eligibleUsers` クエリは残す**（参加者リストの
    stale 行除外に必要）
- **依存タスク:** タスク1, タスク2, タスク3, タスク4, タスク5
- **必要なテスト:** 一般会員に参加費・支払方法・申込方法が渡らないこと（AC-10）・
  削除項目が DOM に無いこと（AC-13）・級別定員の3分岐（AC-17/18）・生 ISO が出ないこと（AC-22）・
  ルート `p-4` と `<main>` 無 padding（AC-23）・出欠回答の可否判定（AC-25 回帰）・
  参加者リストの stale 行除外（AC-26 回帰）・ロールプレビュー追随（AC-31 回帰）
- **完了条件:** AC-10/13/17/18/22/23/25/26/31 のテストが green・
  **design-spec §8 の忠実度チェックリスト全12項目をクリア**・
  既存テスト・lint・typecheck が CI で green（AC-32）
- **対応Issue:** #358

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 0（前提）:** `nav-settings-hub`（親Issue #346）の出荷を待つ
- **Wave 1:** タスク1, タスク2, タスク3
  （変更領域が重ならない — タスク1=`lib/event-date` と `/events` 一覧側、
  タスク2=`lib/events/entry-flow`〔新規のみ〕、タスク3=`components/events/detail/`〔新規のみ〕）
- **Wave 2:** タスク4, タスク5
  （タスク4=`app/(app)/events/[id]/` 配下、タスク5=`components/events/` 直下。重ならない）
- **Wave 3:** タスク6（全タスクに依存）
