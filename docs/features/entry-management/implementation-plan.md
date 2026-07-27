---
status: completed
---
# entry-management 実装手順書（2026-07-27 改修: 確定名簿を「完了」の必須要件から外す）

要件: [requirements.md](requirements.md) ／ 見た目の正典: [design-spec.md](design-spec.md) + [design-prototype.patch](design-prototype.patch)

> 新規構築時（#323〜#326）と entry-groups 対応（#360〜#367）のタスクは完了済みで、手順は git 履歴が保持している。
> 本ファイルは**今回の改修のタスクだけ**を持つ（`/implement` は未完了タスクのみを見るため整合する）。

**スキーマ変更・migration・UI の見た目の変更はいずれも発生しない。** 純関数 1 つの評価順の変更とテストのみ。

---

## 実装タスク

### タスク1: `classify` から「完了」の確定名簿要件を外す（#379）

- [ ] 完了
- **目的:** 支払いの決着（振込済／現地払い／支払い管理なし）が付いた大会を、確定名簿が未取込でも「完了」区画へ抜けさせる。確定名簿の判定は「事前払い・未振込」の大会を「抽選待ち」と「振込待ち」に分けるためだけに残す。
- **対応AC:** AC-10, AC-12, AC-12b, AC-12c, AC-13, AC-13b, AC-14, AC-31b, AC-31c, AC-33
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/entries/entry-board-utils.ts` — `classify` の `applied` 分岐（現行 200-206 行）と `AreaId.applied_waiting` の JSDoc（現行 41 行）
  - `apps/web/src/app/(app)/admin/entries/entry-board-utils.test.ts` — classify / dayStatusLabel / 相互排他の網羅テストの期待値
  - `apps/web/src/app/(app)/admin/entries/page.test.tsx`・`EntryBoardClient.test.tsx` — `applied` かつ `paymentType` 既定（NULL）のフィクスチャで「抽選待ち」を期待している箇所の追随
- **依存タスク:** なし（単独タスク・単一 Wave）
- **必要なテスト（テストファースト）:**
  - **修正が要る既存テスト（想定内。回帰ではない）:** `makeItem` の既定は `paymentType: null` / `paymentStatus: 'unpaid'` なので、`applied` かつ確定名簿なしのケースは本改修後 `done` になる。「抽選待ち」を期待している既存 3 箇所（`classify` の AC-10 ケース・`dayStatusLabel` の `waiting`・網羅テストの `id: 6`）に `paymentType: 'advance'` を明示して意図を固定する
  - **追加（AC-12b。本改修の主目的）:** `applied` + `advance` + `paid` + `hasConfirmedRoster: false` → `done`
  - **追加（AC-12c）:** `applied` + `onsite` + `hasConfirmedRoster: false` → `done` ／ `applied` + `paymentType: null` + `hasConfirmedRoster: false` → `done`
  - **追加（AC-13b）:** `hasConfirmedRoster` の true/false で区画が変わるのは `advance` かつ `unpaid` のときだけ、を対のケースで確認する
  - **追加（AC-14 網羅の拡張）:** 名簿なしの `advance`+`paid` / `onsite` / `payment_type NULL` を網羅テストの入力集合へ足し、各大会がちょうど 1 区画に入る（または非表示になる）ことを維持する
  - **追加（グループ単位の境界）:** `hasConfirmedRoster` はグループ単位・`paymentStatus` はイベント単位なので、同一グループ内に「振込済の日（`done`）」と「事前払い未振込・名簿なしの日（`applied_waiting`）」が混在するケースを 1 本足す。カードは `GROUP_AREA_PRIORITY` により `applied_waiting` へ載り、日別行は `dayStatusLabel` でそれぞれのラベルを出す（既存設計どおりだが、今回の入力で初めて生じる組み合わせなので固定する）
  - **回帰（AC-31b）:** `apps/web/src/lib/events/entry-flow.test.ts` は**一切変更しない**（無変更のまま green であることが「申込フロー帯を触っていない」証拠になる）
- **完了条件:**
  - `classify` の `applied` 分岐が次の形になっている（判定を反転させず**評価順**で表現する。`hasConfirmedRoster` の条件式が残るので、戻すときは順序を戻すだけで済む）:
    ```ts
    // entryStatus === 'applied'
    // 支払いの決着が付いた大会は確定名簿を待たない（2026-07-27）。
    if (paymentType !== 'advance' || paymentStatus === 'paid') return 'done'
    // ここから先は事前払いかつ未振込のみ。名簿の有無で待ちの種類が分かれる。
    if (!item.hasConfirmedRoster) return 'applied_waiting'
    return 'payment_due'
    ```
  - 上記に「なぜ緩めたか（確定名簿は主催者の発表＋取込作業が揃って初めて true になる外部依存の値で、名簿が来ないだけの済んだ大会が滞留する）」と「戻す条件（確定名簿なしで完了へ入った大会に実は会としてやることが残っていたケースが実運用で出たとき。戻し方は `git revert`）」をコメントで残す
  - `AreaId.applied_waiting` の JSDoc が新しい母集団（事前払い・未振込・名簿待ち）を説明している
  - `pnpm --filter=@kagetra/web test --no-file-parallelism` が green、`pnpm check-types` / `pnpm lint` 通過
- **対応Issue:** #379

---

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1 (#379)**（単独）

---

## 触らないもの（§3.3 と AC-29〜AC-31c の回帰対象）

- `apps/web/src/lib/events/entry-flow.ts`（大会詳細の申込フロー帯。確定名簿を参照していないため今回の対象外）
- `page.tsx` の母集団クエリ・確定名簿クエリ③・`EntryBoardItem.hasConfirmedRoster`（いずれも引き続き必要）
- `AREAS` の区画定義（id・ラベル・並び・`deadlineHint`・折りたたみ）と `GROUP_AREA_PRIORITY`
- `deadlineBadgeOf` / `sortKeyOf` / `sortArea` / `isDue` / `isAreaHot` / `isPinnedWhenCollapsed` / `displayName`
- `entry-overdue-alert.ts` / `send-lifecycle-reminders.ts` / `EventLifecycleSection` と 4 つの Server Action
- `design-spec.md` / `design-prototype.patch`（見た目は不変）

---

## 出荷前の最終確認

- AC-34（manual）: 本番で、確定名簿が未取込のまま振込済にした大会が「完了」区画へ移っていることを確認する
- AC-32（manual・前回からの持ち越し）: 本番 375px で 5 区画が 1 画面に収まり、仕分けが実運用の認識と一致すること
