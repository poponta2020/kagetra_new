---
status: completed
---

# 確定名簿シグナルの拡張 実装手順書

要件: [requirements.md](./requirements.md)（AC は §4）

判定材料を 2 → 4 に増やす改修。`classify` / `buildEntryFlow` の**内部ロジックは
一切変えない**——`hasConfirmedRoster` という入力の作り方だけを変える。

## 実装タスク

### タスク1: 確定名簿判定を4材料へ拡張し、共通関数へ寄せる

- [x] 完了
- **目的:** 「確定名簿あり」の判定に「確定名簿メール」と「手動フラグ」を加え、
  現在3箇所に散っている組み立てを1つの正典へ寄せる。これだけで杉並AB（group 13）が
  `payment_due` へ移る。
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-14, AC-15, AC-16, AC-18
- **主な変更領域:**
  - `packages/shared/src/schema/entry-groups.ts` — `confirmedRosterOverride`
    (`boolean NOT NULL DEFAULT false`) を追加。**「意図的に列を持たない」旨の doc
    コメントを同じコミットで更新する**（この列がグループに属する理由＝判定材料が
    すべてグループスコープ／`events` に置くと entry-management AC-17 の
    「グループ内のどの日から見ても同じ」が壊れる）
  - `packages/shared/drizzle/0058_*.sql` — `drizzle-kit generate` で生成（次番号は 0058）。
    移行スクリプトは不要（default false・既存判定を変えない）
  - `apps/web/src/lib/events/confirmed-roster.ts`（新規） — 判定の正典。
    純関数（4材料の OR）＋ グループ単位の状態を返すサーバー関数の2層。
    ★サーバー関数は**判定結果（boolean）と `confirmed_roster_override` の生値を
    セットで返す**（例 `Map<groupId, { settled: boolean; override: boolean }>`）。
    タスク2 のトグルが自分の状態を描くのにフラグを必要とするため——ここで返さないと
    UI 側が4つ目の場当たりクエリを足し、「判定の正典は1つ」という本改修の目的が崩れる
    （要件 §6）。ボード（`admin/entries/page.tsx`）は `settled` しか使わない。
    ★このファイルは client からは import されない想定だが、`entry-board-utils.ts`
    冒頭の DB 依存漏れ注意は踏襲する（純関数側に schema/drizzle を持ち込まない）
  - `apps/web/src/app/(app)/admin/entries/page.tsx` — `groupIdsWithConfirmedRoster`
    の組み立てを共通関数へ置換（複数グループ一括）
  - `apps/web/src/app/(app)/admin/entries/[groupId]/page.tsx` — 同（単一グループ）
  - `apps/web/src/app/(app)/events/[id]/page.tsx` — 同（単一グループ。
    `entryGroup.rosters` / `rosterFiles` は**表示用としては残す**。判定だけ差し替える）
- **依存タスク:** なし（★スキーマがホットスポットなので必ず先行させる）
- **必要なテスト:**
  - 純関数: 4材料の各単独成立・全部なし・組み合わせ（AC-1, 3, 6, 7）
  - シグナル3の否定条件: `mail_kind=null` / `applicant_roster` /
    `tournament_notice` / 別グループのメール（AC-4, AC-5）
  - `classify` との結線: 杉並AB相当（`applied` / `advance` / `unpaid` / 名簿0件 /
    確定名簿メールあり）→ `payment_due`（AC-2）。`payment_deadline=NULL` でも
    区画に入ること（AC-10）
  - フロー帯: `buildEntryFlow` の抽選が done・現在地が支払（AC-9）
  - グループ単位: 同一グループの全日で判定が一致（AC-8）
  - 境界: `entry_status='not_applied'` ＋ `override=true` で区画が変わらないこと
    （`classify` は `applied` 分岐でしか `hasConfirmedRoster` を見ない＝AC-18）
  - 回帰: `upcoming-entrants` の出場者判定が不変（メール連動・override では
    confirmed パスへ切り替わらない＝AC-14）／採用ファイルありのグループは
    判定が変わらない（AC-15）
- **完了条件:** 上記テスト green・`check-types` 通過・`classify` /
  `buildEntryFlow` / `upcoming-entrants.ts` に差分が無いこと
- **対応Issue:** #510

### タスク2: 「確定名簿ありとして扱う」トグル（Server Action + UI）

- [ ] 完了
- **目的:** 名簿もメールも無いが先へ進めたいときの逃げ道。名簿セクションから
  グループ単位で ON/OFF する。
- **対応AC:** AC-6, AC-7, AC-11, AC-12, AC-13, AC-16
- **主な変更領域:**
  - `apps/web/src/app/(app)/events/[id]/actions.ts` — `setConfirmedRosterOverride(
    entryGroupId, value)` を追加。`requireAdminSession()`（既存・admin/vice_admin のみ）→
    グループ実在確認 → `entry_groups` を UPDATE → 既存の
    `revalidateAfterLifecycleChange(eventIds, entryGroupId)` で再検証
  - `apps/web/src/app/(app)/events/[id]/components/RosterSection.tsx` — 管理者向け
    トグル行を追加。★**`isAdmin` で JSX を隠すだけにしない**。管理者向けの値と
    Server Action は「管理者のときだけ渡す」optional prop 1つに束ね、非管理者には
    `undefined` を渡す（`'use client'` なので RSC payload に載る。PR #376 の教訓）
  - `apps/web/src/app/(app)/events/[id]/page.tsx` /
    `apps/web/src/app/(app)/admin/entries/[groupId]/page.tsx` — 上記 prop を
    管理者のときだけ組み立てて渡す。**トグルの現在値はタスク1 の共通ローダーが返す
    `override` を使う**（`entryGroup` のクエリに列を足す等、別経路で読まない）
  - 見た目は既存 `DisclosureSection` / `DisclosureActions` のパターンを踏襲
    （design-spec は作らない＝`design_required: false`）
- **依存タスク:** タスク1 (#510)（`confirmedRosterOverride` 列と判定関数が前提）
- **必要なテスト:**
  - Server Action: admin / vice_admin は成功、member / guest / 未ログインは拒否（AC-12）
  - ON → 判定 true → OFF → 判定 false（AC-6, AC-7）
  - 非管理者のレンダリング結果にトグルも Server Action も現れない（AC-11）
  - 名簿0件・ファイル0件でも名簿セクションが描画されトグルへ到達できる（AC-13）
- **完了条件:** 上記テスト green・`check-types` / `lint` 通過
- **対応Issue:** #511

## 実装順序（Wave = 並行実装できるタスクの組）

- Wave 1: タスク1（スキーマ＝共有ホットスポット。単独で先行させる）
- Wave 2: タスク2（タスク1 の列と判定関数に依存）

並行実装なし（2タスクは同じ列とページを触るため直列）。

## 出荷後の残作業

- AC-17（manual）: 本番で杉並AB（group 13）がボードの「名簿確定・要振込」に出ることを確認する。
  ※振込締切が未設定（`payment_deadline=NULL`）なので**区画内の並びは末尾・強調なし**。
  区画に入っていれば正常（要件 §3.2.4）。
