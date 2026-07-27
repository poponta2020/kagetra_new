---
name: feature-def-entry-management-roster-not-required
description: entry-management 改修要件（確定名簿を完了要件から外す）
type: project
---

# entry-management 改修: 確定名簿を「完了」の必須要件から外す（2026-07-27）

正典: docs/features/entry-management/requirements.md（§3.2.3 区画表・§4 AC・§7 設計判断14-16・§9 変更履歴）と docs/spec/events-attendance.md:177-185。実装手順書 = docs/features/entry-management/implementation-plan.md。親Issue #379（子Issueなし・1タスク単独 Wave）。

## 発端

「振り込みが完了しても、確定名簿が取り込まれてなかったらそこでストップしてしまう」。原因は `apps/web/src/app/(app)/admin/entries/entry-board-utils.ts` の `classify` が `applied` の枝の**先頭**で `hasConfirmedRoster` を見ていたこと（旧 202 行）。`/admin/entries` のボードだけの問題で、大会詳細の申込フロー帯（`lib/events/entry-flow.ts`）・LINE 通知・毎朝アラートは確定名簿を一切参照していない（調査で確認済み）。

## 変更（applied の枝のみ・評価順で表現）

```ts
// entryStatus === 'applied'
// 支払いの決着が付いた大会は確定名簿を待たない（2026-07-27）。
if (paymentType !== 'advance' || paymentStatus === 'paid') return 'done'
// ここから先は事前払いかつ未振込のみ。名簿の有無で待ちの種類が分かれる。
if (!item.hasConfirmedRoster) return 'applied_waiting'
return 'payment_due'
```
`paymentType` は `PaymentType | null`（`undefined` にはならない）ので NULL は `!== 'advance'` で done 側に落ちる。判定を反転させず**評価順**にしたのは、`hasConfirmedRoster` の条件式・page.tsx のクエリ③・EntryBoardItem のフィールド・AC-13 をすべて生かしたまま、戻すときは順序を戻すだけで済ませるため（設計判断16）。

## 設計判断（ユーザー確認済み・2026-07-27）

1. **支払いの決着 > 確定名簿**（設計判断14）。確定名簿は「主催者が発表」＋「こちらが取り込んで承認」の両方が揃って初めて true になる外部依存の値。振込済は管理者自身が押す確定的な事実で、そこから先に会としてやることは残らない。
2. **現地払い・支払い管理なし（payment_type NULL）も名簿なしで完了**（設計判断15）。★受容したリスク: これらは振込確認という判定点が無いため、**申込済にした瞬間に完了へ入り抽選待ちを一切経由しない**＝抽選の進行をボードで追えなくなる。ボードは「手を動かす必要のある大会」を出す画面なので追跡価値より滞留の害が上回る、というユーザー判断。
3. **「名簿確定・振込待ち」区画は条件不変**＝区画名も据え置き。ユーザーは「外さない」を選択（外すと抽選結果が分かる前に振込を促すことになるため）。結果として「申込済み・抽選待ち」区画は「事前払い・未振込・名簿待ち」専用に狭まる。
4. **ランタイム切替フラグは作らない**（Non-goals）。3行の述語にフラグを持たせると分岐が二重に生き続けテストも2系統要る。戻すときは `git revert`。★戻す条件 = 確定名簿なしで完了へ入った大会に、実際には会としてやることが残っていたケースが実運用で出たとき。

## 実装時の落とし穴

- `entry-board-utils.test.ts` の `makeItem` 既定は `paymentType: null` / `paymentStatus: unpaid`。そのため「applied かつ確定名簿なし → 抽選待ち」を期待している既存3箇所（classify の AC-10 ケース・dayStatusLabel の waiting・網羅テストの id:6）が**この改修で必ず落ちる**。`paymentType: \x27advance\x27` を明示して意図を固定する（想定内・回帰ではない）。
- `hasConfirmedRoster` はグループ単位（entry_group_id）・`paymentStatus` はイベント単位。同一グループに「振込済の日」と「未振込・名簿なしの日」が混在すると、`applied_waiting` のカードの中に `done` の日別行が並ぶ。既存設計（dayStatusLabel はカードの区画と独立）どおりだが今回初めて生じる組み合わせなのでテストで固定する。
- `entry-flow.test.ts` は無変更のまま green であることが「申込フロー帯を触っていない」回帰の証拠（AC-31b）。

## 別件として切り離した停滞（未 Issue 化）

大会詳細の申込フロー帯は `lottery_date` が未設定だと `lottery.done = isPast(null, today) = false` のまま `isNow` を掴み続けるため、**振込済でも現在地が「抽選」のまま**になる（`entry-flow.ts:110` 付近）。今回の依頼（確定名簿）とは原因が別なので Non-goals に置いた。実運用で気になったら /bug-report で扱う。※`internal_deadline` 未設定は同じ停滞ではない（`internal` は先頭ステップなので現在地が「会内締切」になるだけで、完了済みの支払を追い越さない）。
