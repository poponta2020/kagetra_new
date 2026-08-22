---
name: auto-review-round-pr513
description: auto-review PR #513
type: project
---

PR #513 (confirmed-roster-signal) の Codex 自動レビューループ記録。

| R | phase | model | effort | verdict | B/S/N | tokens |
|---|---|---|---|---|---|---|
| 1 | initial（全差分1512行/14ファイル） | gpt-5.6-sol | high（構造的高リスクパス=スキーマ変更） | needs_changes | 1/0/0 | 239,837 |
| 2 | delta（252行/5ファイル） | gpt-5.6-terra | medium | pass | 0/0/0 | 43,599 |
| 3 | final（全差分1659行） | gpt-5.6-sol | high | needs_changes | 1/0/0 | 242,675 |
| 4 | —（打ち切り記録） | — | — | cutoff (user-wontfix) | 0/0/0 | — |
| 5 | delta（CI修正 37行/1ファイル） | gpt-5.6-terra | low | pass | 0/0/0 | 45,423 |

累計 571,534 トークン（上限 500,000 を R3 完了時点で超過）。**R5 は規約上は 3-0 で止まるべきところを、未レビューのコミットを出荷する方が害が大きいと判断して追加実行した**（37行1ファイル・low）。

## R1 blocker → 修正（ユーザー判断=修正する）

「日ページのトグルが個人戦グループの境界を越えて更新できる」。Codex の実害見積もりは過大（ボードは `kind='individual'` で母集団を絞るので団体戦の日は区画に出ない／既存シグナル1〜3も全てグループ単位なので波及自体は新規欠陥ではない）だったが、**露出条件が2画面で食い違う**点は成立。日ページは `event.kind`（その日）、グループページは `isTeamGroup`（グループ全体）だった。

修正（de410b8）: `isIndividualOnlyGroup(entryGroupId)` を `lib/events/confirmed-roster.ts` に追加し、日ページの `adminControls` ゲートと Server Action の検証に使用。★**ガードは `value === true` のときだけ**——ON 後にグループへ団体戦の日が加わると `RosterSection` が描画されず UI から到達できなくなるため、OFF は常に許可しないと解除不能状態を作る。

## R3 final blocker → 見送り（WONTFIX・ユーザー判断）

`events/[id]/page.tsx` — 「イベント付け替え後の古い画面から移動元グループを更新できる」。日ページが描画時の `entryGroupId` を bind しているため、別タブで付け替えたあと古い画面でトグルを押すと移動元グループの override が変わる。

見送り理由: 2タブの競合が前提で運用者は1人、1クリックで戻せる可逆な誤り。なお `events/[id]/actions.ts` の他 Server Action は全て `resolveEntryGroupId(tx, eventId)` で毎回解決し直す規約（9箇所）で、このトグルだけが例外という指摘自体は正しい。**将来同種の指摘が出たら**「日ページ専用ラッパー `setConfirmedRosterOverrideForEvent(eventId, value)` を足して eventId 起点に揃える」が想定修正。

★C1 が選ぶ最新結果は r5.json（verdict=pass・CI修正のdeltaのみ）になるが、**この WONTFIX は取り下げていない**。r4.json の cutoff 記録が正典。

## CI 失敗（de410b8）とその修正

`src/lib/line-broadcast-helpers.test.ts` の 17 件が `delete from "entry_groups"` の FK 違反（23503）で全滅。原因と対策は [[feedback-test-db-leftover-rows-fk-restrict]]。修正 91da816 で `resetDb()` を `truncateAll()` へ寄せ、ローカルで 17 failed → 40 passed を実測。

## 運用上の学び

- **Codex 実行は 10 分の Bash タイムアウトを超える**（R1 は sol/high で 10 分超）。`run_in_background: true` で回すこと
- **R1 開始時に main との競合（DIRTY）が発覚**。`docs/features/INDEX.md` が PR #512 出荷で更新されていた。3-a の手順どおりレビュー前に解消（merge commit b68e461）
- **CI が直前に赤だった場合は auto-ship 前に CI 完了を待った**（既定は待たないが、赤の修正コミット自体の検証が保留中のまま main へ入れる方が高くつくため）
