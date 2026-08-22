---
name: ship-confirmed-roster-signal
description: 確定名簿シグナルの拡張（確定名簿メール・手動フラグ）
type: project
---

**PR #513** https://github.com/poponta2020/kagetra_new/pull/513 — マージ済み（merge commit 58ca4a3）。Issue #509（親）/ #510 / #511 はいずれもクローズ済み。

## 何を出荷したか

「確定名簿あり」の判定材料を **2 → 4** に拡張し、3画面に散っていた組み立てを1つの正典へ寄せた。杉並AB（本番 `entry_group_id=13`）が「申込完了・抽選待ち」から動けなかった原因は、確定連絡メールに添付が1件も無く（名簿は本文記載）確定を記録する手段が存在しなかったこと。

| # | 材料 | 状態 |
|---|---|---|
| 1 | パース済み確定名簿（`tournament_entry_rosters`） | 既存 |
| 2 | 採用済み原本ファイル（`tournament_entry_roster_files`） | 既存 |
| 3 | 確定名簿メール（`mail_kind='confirmed_roster'` ∧ `triage_status='processed'` ∧ グループに紐付き） | 新規 |
| 4 | 手動フラグ（`entry_groups.confirmed_roster_override`） | 新規 |

- 正典 = `apps/web/src/lib/events/confirmed-roster.ts`（純関数 `isConfirmedRosterSettled` ＋ ローダー `loadConfirmedRosterStates/State` ＋ `isIndividualOnlyGroup`）
- `classify` / `buildEntryFlow` / `lib/upcoming-entrants.ts` は**無変更**（入力の作り方だけ変更）
- migration **0058**（`ALTER TABLE entry_groups ADD COLUMN confirmed_roster_override boolean NOT NULL DEFAULT false`。backfill 不要）
- 手動トグルは名簿セクション末尾（admin/vice_admin のみ）。値と bind 済み Server Action は `adminControls` 1 prop に束ね、非管理者・団体戦を含むグループには `undefined`

実装の詳細・踏んだ落とし穴は [[impl-confirmed-roster-signal]]、レビュー経緯は [[auto-review-round-pr513]]。

## レビュー（/auto-review-loop）

5R（initial + delta + final + cutoff + delta）／verdict=pass ／累計 **571,534 / 500,000 トークン（上限超過）**。effort は h→m→h→low。

- R1 blocker（露出条件が日ページ=その日の kind・グループページ=グループ全体で食い違う）→ **修正**（`isIndividualOnlyGroup` 追加。ガードは ON のみ・OFF は常に許可）
- R3 final blocker（bind 済み `entryGroupId` の stale。別タブで付け替え→古い画面でトグル→移動元グループが変わる）→ **ユーザー判断で見送り（WONTFIX）**。想定修正は「日ページ専用ラッパー `setConfirmedRosterOverrideForEvent(eventId, value)` で eventId 起点に揃える」
- 再レビューせずに修正した指摘: 0件

## CI

`Lint / Typecheck / Test` **pass**（11m5s）。★途中で1度赤になり修正している — 原因と対策は [[feedback-test-db-leftover-rows-fk-restrict]]。

## 残 DoD

- **AC-17（manual・未実施）**: 本番で杉並AB（group 13）がボードの「名簿確定・要振込」に出ることを確認する。※振込締切が未設定（`payment_deadline=NULL` / `kind='unspecified'`）なので**区画内の並びは末尾・強調なし**が正常（要件 §3.2.4）。区画に入っていれば OK
- 実機での見た目（トグル行の表示）は静的なコード照合のみで**未確認**
