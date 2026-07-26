---
status: completed
---
# event-list-redesign 実装手順書

要件: [`requirements.md`](./requirements.md)（AC は §4）／視覚の正: [`design-spec.md`](./design-spec.md)（locked・**忠実度チェックリストが完了ゲート**）＋ `design-mock/redesign.html`。

## 技術設計の要点（実装前に必ず読む）

- **`design_source: claude-design`** ＝ 適用できる patch は無い。`design-mock/redesign.html` を読み、**同じトークン変数**（`--kg-brand` → Tailwind の `bg-brand` 等）で実コンポーネントへ移植する。値を目で読み取って書き直さない。
- **モックに描かれていない状態が1つある**: 「締切済だが自分が参加回答済み」の行。design-spec §Round 5 の記述（締切済淡色＋砂帯＋meta 行あり）が正。
- **自分の参加判定に新クエリを足さない**: `page.tsx` の `participantRows` は既に表示中イベント分の出欠を1クエリで取得済み。`select` に `userId: eventAttendances.userId` を**足すだけ**で自分の参加有無が判定できる（N+1 を作らない）。
- **`chipSurnames` → `attendeeSurnames` にリネーム**する（チップ表示を廃止するため名前が実態と食い違う）。あわせて `CHIP_LIMIT` と `slice(0, CHIP_LIMIT)` を撤廃。
- **`mobile-shell.tsx` は触らない**（AC-14）。16px 余白は `events/page.tsx` のページコンテナに付ける。
- **既存テストの扱い ★重要**: `EventListClient.test.tsx` には**今回の AC と矛盾する assertion** がある。以下は**書き換えが正しい**（回帰の破壊ではない）:
  - 「参加0名はチップなしで『参加 0名』のみ」→ AC-5 により meta 行ごと非表示へ
  - 「参加数＋苗字チップ最大5＋他N名」→ AC-6 により全員表示・「他N名」なしへ
  - 締切 tone テストの `超過`（`2026-07-05`）を含む fixture、および `BASE` の id=3（締切 `2026-07-05`）→ AC-1 で非表示になるため、`viewerAttending: true` を付けるか未来日へ寄せる
  - **維持しなければならない**のはソート2軸・申込可能フィルタ・空表示文言・行タップ遷移（AC-12/13）

## 実装タスク

### タスク1: 純関数・型の拡張（event-list-utils）
- [x] 完了
- **目的:** 表示判定ロジックを純関数として確定させ、後続2タスクが同じ契約に乗れるようにする
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-8, AC-9
- **主な変更領域:** `apps/web/src/app/(app)/events/event-list-utils.ts` および `event-list-utils.test.ts`
- **依存タスク:** なし
- **実装内容:**
  - `EventListItem` に `viewerAttending: boolean` を追加。`chipSurnames` → `attendeeSurnames` にリネーム。`CHIP_LIMIT` を削除
  - `isPastDeadline(internalDeadline, todayStr)` を追加。**`formatDeadlineCountdown(...).tone === 'past'` を単一の真実として実装**する（しきい値ロジックを二重化しない）
  - `isRowVisible(item, todayStr)` を追加 = `!isPastDeadline(...) || item.viewerAttending`
  - `isOpenForEntry(item, todayStr)` を追加 = `canApply && status !== 'cancelled' && !isPastDeadline(...)`（帯の藍/砂を決める唯一の判定）
- **必要なテスト（テストファースト）:** 締切が昨日/当日/明日/null の可視判定、`viewerAttending=true` での締切済の可視化、`isOpenForEntry` の4分岐（canApply false / 中止 / 締切超過 / すべて満たす）
- **完了条件:** `pnpm --filter=@kagetra/web test event-list-utils --no-file-parallelism` green・型チェック通過
- **対応Issue:** #341

### タスク2: サーバー側データ供給と余白（events/page.tsx）
- [ ] 完了
- **目的:** 自分の参加有無を渡し、苗字を全員分渡し、ページ余白を入れる
- **対応AC:** AC-2, AC-6, AC-7, AC-14
- **主な変更領域:** `apps/web/src/app/(app)/events/page.tsx`（`participantRows` の select と items 組立、ページコンテナの className）
- **依存タスク:** タスク1（型定義に依存）
- **実装内容:**
  - `participantRows` の select に `userId: eventAttendances.userId` を追加（クエリ本数は増やさない）
  - `viewerAttending` = そのイベントの参加者に `session.user.id` が含まれるか
  - `attendeeSurnames` は `slice` せず全員分（並びは現行どおり級昇順・未設定末尾を維持＝AC-7）
  - ページコンテナに 16px 余白（`p-4`）。**`mobile-shell.tsx` は変更しない**
- **必要なテスト:** `page.test.tsx` に「自分が attend=true の締切済大会は表示され、他人だけの締切済大会は表示されない」統合テストを追加（既存の not_applying 除外テストは維持）
- **完了条件:** `pnpm --filter=@kagetra/web test events/page --no-file-parallelism` green
- **対応Issue:** #342

### タスク3: 一覧 UI の移植（EventListClient）
- [ ] 完了
- **目的:** 確定デザインを実コンポーネントへ移植する
- **対応AC:** AC-1, AC-5, AC-6, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13
- **主な変更領域:** `apps/web/src/app/(app)/events/EventListClient.tsx` および `EventListClient.test.tsx`
- **依存タスク:** タスク1（純関数に依存）
- **実装内容:**
  - `isRowVisible` で行を絞る（ソート・フィルタとの適用順序: **可視判定 → 申込可能フィルタ → ソート**）
  - 行に 3px の帯（`isOpenForEntry` で `bg-brand` / `bg-border`）
  - 上段の DOM 順を 大会名 → 日付 → 締切 に入替え（日付は従属サイズ・`text-ink-2`）
  - 締切 tone のスタイル変更: soon は数字のみ拡大・**色は墨**（朱にしない）、today は朱の塗りピル
  - 参加者: `attendCount === 0` なら meta 行ごと描画しない。1名以上は人数（藍・大きめ）＋苗字を「・」区切りで全員表示（「他N名」なし・苗字の途中で折り返さない）
  - 上記「既存テストの扱い」に従いテストを更新（矛盾 assertion の書き換え・維持すべき挙動は残す）
- **必要なテスト:** 帯の色4分岐、締切済の非表示と `viewerAttending` 例外、0名の meta 非表示、8名の全員表示と「他N名」不在、上段 DOM 順、tone ごとのクラス、既存の回帰（ソート・フィルタ・空表示・遷移）
- **完了条件:** `pnpm --filter=@kagetra/web test EventListClient --no-file-parallelism` green
- **対応Issue:** #343

### タスク4: 忠実度の確認と余白の回帰ガード
- [ ] 完了
- **目的:** 確定デザインが劣化していないことと、余白変更が他画面に波及していないことを機械的に固定する
- **対応AC:** AC-14, AC-15, AC-16
- **主な変更領域:** `apps/web/src/components/layout/mobile-shell.test.tsx`（padding 不在の assertion 追加のみ・本体は変更しない）
- **依存タスク:** タスク2, タスク3
- **実装内容:**
  - `mobile-shell.test.tsx` に「`<main>` が padding クラスを持たない」assertion を追加（AC-14 を auto-test 化）
  - design-spec `## 忠実度チェックリスト` を1項目ずつコードと実画面で照合（AC-15・manual）
  - web パッケージ全体のテスト・lint・typecheck
- **完了条件:** `pnpm --filter=@kagetra/web test --no-file-parallelism` / `pnpm lint` / `pnpm check-types` すべて green、忠実度チェックリスト全項目クリア
- **対応Issue:** #344

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1**: タスク1（型と純関数。後続の共有ホットスポットなので単独先行）
- **Wave 2**: タスク2, タスク3（依存はタスク1のみ。`page.tsx` と `EventListClient.tsx` で変更領域が重ならないため並行可）
- **Wave 3**: タスク4（タスク2・3 の完了後に検証）
