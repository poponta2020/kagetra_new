---
name: ship-entry-board-done-without-roster
description: entry-board: 確定名簿を「完了」の必須要件から外す
type: project
---

**PR #380** [fix(entry-board): 確定名簿を「完了」の必須要件から外す (#379)](https://github.com/poponta2020/kagetra_new/pull/380) — Issue #379 をクローズ。

## 何を変えたか
申込管理ボード `/admin/entries` の仕分け純関数 `classify`（`apps/web/src/app/(app)/admin/entries/entry-board-utils.ts`）の `applied` 分岐を**評価順で**組み替え、支払いの決着（振込済／現地払い／支払い管理なし）が付いた大会を**確定名簿が未取込でも「完了」区画へ抜けさせる**ようにした。

| 区画 | before | after |
|---|---|---|
| 申込済み・抽選待ち | `applied` かつ 確定名簿なし | `applied` かつ `advance` かつ `unpaid` かつ 確定名簿なし |
| 名簿確定・振込待ち | `applied` かつ 確定名簿あり かつ `advance` かつ `unpaid` | 変更なし |
| 完了 | `applied` かつ 確定名簿あり（上記以外） | `applied` かつ（`paid` / `onsite` / `payment_type IS NULL`）。名簿の有無を問わない |

確定名簿は「主催者が発表する」「こちらが取り込む」の両方が揃って初めて true になる**外部依存の値**で、名簿が来ていないだけの済んだ大会が抽選待ちに滞留していたのが動機。**判定条件は反転させず評価順で表現した**ので、戻すときは `git revert` で順序が戻るだけで済む（確定名簿クエリ③・`hasConfirmedRoster`・AC-13 はいずれも生き続ける）。

スキーマ変更・migration・UI の見た目の変更なし（JSX 差分ゼロ）。実装差分は `admin/entries/` の4ファイル（本体1＋テスト3）。

## 設計上の要点（次に触るとき用）
- `PaymentStatus` は TS union（`LifecycleStatusBadge.tsx`）も DB enum（`packages/shared/src/schema/enums.ts`）も `'unpaid' | 'paid'` の**2値ちょうど**。`paymentType !== 'advance' || paymentStatus === 'paid'` が `advance && unpaid` の正しい補集合になる根拠がこれ。**3値目を足すならこの分岐を必ず見直す**
- `hasConfirmedRoster` はグループ単位・`paymentStatus` はイベント単位なので、同一グループ内に「振込済の日(done)」と「事前払い未振込・名簿なしの日(applied_waiting)」が混在しうる。カードは `GROUP_AREA_PRIORITY` で applied_waiting に載り、日別行は `dayStatusLabel` が各自のラベルを出す（テストで固定済み）
- `entry-flow.ts`（大会詳細の申込フロー帯）は確定名簿を参照していないため対象外。**`entry-flow.test.ts` を無変更のまま green にすることが AC-31b の回帰証拠**
- `docs/spec/events-attendance.md` は要件定義コミット(4d9725f)で既に新仕様へ更新済み

## 検証
- `pnpm --filter=@kagetra/web test -- --no-file-parallelism`: 137 files / 1945 passed / 1 skipped
- `pnpm check-types` / `pnpm lint`: 通過
- Codex auto-review: **1R・verdict=pass**（effort=medium・91,456 tokens・blockers/should_fix/nits すべて 0）。追加ラウンドなし
- DoD: A1/A2 PASS・A3 は CI 委譲・B0 CLEAN・B1 は pending のままマージ（v0.9.0 方針）・C1 pass・D2 PASS

## 残 DoD（本番実機）
- **AC-34**: 本番で、確定名簿が未取込の大会を大会詳細から「振込済」にし、`/admin/entries` の「完了」区画へ移る（抽選待ちから消える）ことを確認する
- AC-32（前回からの持ち越し）: 本番 375px で 5 区画が 1 画面に収まること

## 環境メモ
- **`C:/tmp/impl-entry-management` は .git を失った残骸ディレクトリ**（node_modules 込み）。`ensure-worktree.sh entry-management` が 'already exists' で落ちるため、今回は slug `impl-entry-board-done-without-roster` で作成した。掃除は未実施
- ブランチはローカル main（`4d9725f` = origin 未 push の要件定義コミット）から切ったため、PR 差分に要件定義コミットが含まれた
