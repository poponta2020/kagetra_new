---
status: completed
mode: delta
supersedes: 2026-07-27 改修の手順書（完了済み。内容は git 履歴が保持する）
---
# entry-management 実装手順書（2026-07-28 delta / round 13）

対象は **`/admin/entries` の区画名改称・1グループ1行化・round 13 のビジュアル移植**。
要件＝[requirements.md](requirements.md)（§3.2.3 改称 / §3.2.5 行モデルと名前導出 / §3.2.5.1 集約規則 / §3.2.7 強調）。
見た目の正＝[design-spec.md](design-spec.md)（round 13・locked）と [design-mock/](design-mock/) の 2 ファイル。

> 新規構築（#323〜#326）・entry-groups 対応（#360〜#367）・2026-07-27 改修（#379）のタスクは完了済みで、手順は git 履歴が保持している。
> 本ファイルは**今回の改修のタスクだけ**を持つ（`/implement` は未完了タスクのみを見るため整合する）。

> **`design-prototype.patch` は適用しない**（二重に古い。design-spec 冒頭の警告）。移植元は `design-mock/` の HTML。
> **モックと同じトークン変数名を使う**（`--kg-brand-fg` → `text-brand-fg` 等）。値を読み取って書き直さない。
> **スキーマ変更・migration は無い。** 既存列・既存テーブルのみ。

---

## 実装タスク

### タスク1: entry-board-utils.ts — 改称・日別関数の削除・グループ集約の純関数

- [ ] 完了
- **目的:** 表示文字列の改称と、1 グループ 1 行に必要な集約規則を純関数として確定させる。以降のタスクが依存する型もここで確定させる
- **対応AC:** AC-35, AC-36, AC-37, AC-38, AC-40, AC-31c（回帰）
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/entry-board-utils.ts` と同 `entry-board-utils.test.ts`。★**加えて `page.tsx` を 1 行だけ**（下記「型を単独で閉じる」参照）
- **依存タスク:** なし（**共有ホットスポット。Wave 1 で単独実行**）
- **やること:**
  - `AREAS` の `label` を 3 件改称（要対応→要申込／申込済み・抽選待ち→申込完了・抽選待ち／名簿確定・振込待ち→名簿確定・要振込）。**`id`（`AreaId`）は触らない**
  - `dayStatusLabel` と `commonDeadlineBadge` を**削除**（日別行と共に不要になる）
  - `EntryBoardItem` に `groupDisplayName: string`（**必須**）を追加。この型追加が 2 と 3 の接点
  - ★**型を単独で閉じる:** `groupDisplayName` を必須にした瞬間、`EntryBoardItem` を組み立てている `page.tsx` が型エラーになる（＝タスク1 単独で `check-types` が通らなくなる）。これを避けるため、**このタスクで `page.tsx` に `groupDisplayName: groupMeta.name,` の 1 行を暫定で足す**（既存の title 由来の名前をそのまま入れるだけ）。タスク2 がこの 1 行の**値の作り方**を通称ベースの導出へ差し替える
  - **`EntryBoardItem.groupName` は残す**（削除しない）。タスク2 の導出でフォールバック元として使い、ボードは読まなくなるが、DTO から外すと `EntryBoardClient.test.tsx` 等のフィクスチャが余剰プロパティエラーになりタスク間の結合が増えるため。DTO のスリム化は今回のスコープ外
  - `pickRepresentativeDay(group, todayStr): EntryBoardItem` を追加 — `sortKeyOf` が最小の可視日（NULL は末尾、同値は開催日 → id で安定化）
  - `groupDeadlineBadge(group, todayStr): DeadlineBadge` を追加 — `pickRepresentativeDay` が選んだ日の `deadlineBadgeOf`
  - `groupAttendCount(group): number` を追加 — `days` の `attendCount` 合計
  - **`groupSortKey` を `pickRepresentativeDay` 経由に統一する**（並び順と表示日付が同一の日から出ることを構造で保証する。AC-37 の肝）
  - `EntryBoardGroup.name` は `groupDisplayName` を転記する（`groupName` からの転記をやめる）。タスク1 の時点では暫定値（title 由来）が入るので**このタスク単独でもフィクスチャは `undefined` にならない**
- **必要なテスト（テストファースト）:**
  - 既存の `dayStatusLabel` / `commonDeadlineBadge` のテストを削除
  - `AREAS` の label が新名称・`id` が不変であること
  - `pickRepresentativeDay`: 最早日を選ぶ／全日 NULL のとき安定した 1 件を返す／同値は開催日→id
  - `groupDeadlineBadge` が `groupSortKey` と同じ日から出ること（グループ内で締切が食い違うケースで検証）
  - `groupAttendCount` が可視日の合計であること
  - `classify` / `sortArea` / `isAreaHot` / `isPinnedWhenCollapsed` / `GROUP_AREA_PRIORITY` の回帰
- **完了条件:** `entry-board-utils.test.ts` green・**`check-types` がリポジトリ全体で通過**（上の暫定 1 行によりタスク1 単独で閉じる）・`git grep -n "dayStatusLabel\|commonDeadlineBadge" apps/` が 0 件
- **対応Issue:** #394

### タスク2: page.tsx — 通称ベースのグループ表示名を導出して渡す

- [ ] 完了
- **目的:** 1 行化で表示名が正式名称へ退行するのを防ぐ（§3.2.5 の導出順序）
- **対応AC:** AC-16, AC-16b, AC-16c
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/page.tsx` と同 `page.test.tsx` のみ
- **依存タスク:** タスク1（`EntryBoardItem.groupDisplayName` の型と、`page.tsx` の暫定 1 行）
- **やること:**
  - タスク1 が置いた暫定行 `groupDisplayName: groupMeta.name,` の**値の作り方を差し替える**（行そのものは既にある）
  - **`groupMemberRows` クエリを拡張**して `tournament_series.short_name` と `events.eligible_grades` も取る（現在は id / title / eventDate / entryGroupId のみ）。`edition_id` は nullable なので **leftJoin** を維持する
  - グループごとに: ①各メンバーの通称ベース名 `shortName + grades`（`shortName` が NULL なら `title`）を作る → ②`deriveEntryGroupName` へ渡して畳む → ③NULL なら既存の `groupName`（title 由来）へフォールバック
  - **導出母集団はグループの全イベント**（今日以降・非 cancelled に絞らない）。既存 `groupName` / 代表イベントと同じ扱いを維持する（r3 review の指摘に従った既存判断）
  - 結果を `EntryBoardItem.groupDisplayName` として全メンバーにコピーする（`groupName` と同じ配り方）
  - `deriveEntryGroupName` は `@/lib/entry-groups`（DB 層）にあるため**サーバーのここでだけ呼ぶ**。client へは平らな値で渡す（既存の禁止事項）
- **必要なテスト:**
  - 単独イベント（通称あり）→ 現行と同一文字列（AC-16b の回帰）
  - 単独イベント（通称なし）→ `title` フォールバック
  - 複数日（杉並B + 杉並A）→ 「杉並AB」
  - 複数日で畳めない組み合わせ → `groupName` へフォールバック
- **完了条件:** `page.test.tsx` green・`check-types` 通過
- **対応Issue:** #395

### タスク3: EntryBoardClient.tsx — 1行化と round 13 のビジュアル移植

- [ ] 完了
- **目的:** 日別行を廃して 1 グループ 1 行にし、確定デザインを実装へ移植する
- **対応AC:** AC-35, AC-36, AC-39, AC-22b, AC-42
- **主な変更領域:** `apps/web/src/app/(app)/admin/entries/EntryBoardClient.tsx` と同 `EntryBoardClient.test.tsx` のみ
- **依存タスク:** タスク1（純関数と型）
- **やること:**
  - `EntryGroupCard` / `EntryGroupDayRow` を**削除**し、グループ 1 行のコンポーネントへ統合（`groupDisplayName` / `groupAttendCount` / `groupDeadlineBadge` / `representativeEventId` を使う）
  - `design-mock/` から移植（値ではなくトークン名で）:
    - 区画見出し = `font-display text-[15px] font-bold tracking-[0.03em] text-brand-fg`。**`font-semibold` は使わない**（design-spec §4 の注意書き＝Noto Serif JP は 700 のみロード）
    - 区画の面 = 常に `bg-surface`、`-ml-1.5` でレールへ食い込ませ `rounded-r-md`。強調時のみ `bg-danger-bg`
    - 玉を見出し行の中へ移動し**常に 13px**。負マージンでレール中心と一致させる（**px 値を写さず「中心が一致する」ことを条件に**。design-spec §3-1）
    - 行間の `divide-y divide-border-soft` を**撤去**
    - レール線は**最初の玉の中心から**始め、**最後の区画の最終行まで**伸ばす
    - **0 件は行動フェーズでもグレー**（`text-ink-muted` / `border-border`）。朱にしない
  - 折りたたみ（締切前）・`ほかN件`・空状態・`isPinnedWhenCollapsed` は**現行挙動を維持**
- **必要なテスト:**
  - 複数日グループが 1 行で描画され、日別行（開催日・級・日別状態）が DOM に無い
  - 区画見出しが新名称・順序どおり／旧名が DOM に無い
  - 0 件区画が行動フェーズでも朱系クラスを持たない（AC-22b）
  - 行タップの href が代表イベント
  - 折りたたみ・`ほかN件`・空状態の回帰
- **完了条件:** `EntryBoardClient.test.tsx` green・`check-types`・`lint` 通過
- **対応Issue:** #396

### タスク4: 照合と後始末

- [ ] 完了
- **目的:** 確定デザインが劣化していないこと、改称が無関係な箇所へ波及していないことを機械的に確認する
- **対応AC:** AC-41, AC-42, AC-33
- **主な変更領域:** 確認のみ（必要なら design-spec の申し送り追記）
- **依存タスク:** タスク2, タスク3
- **やること:**
  - **design-spec §8 忠実度チェックリストの全 11 項目**を 375px の実画面で 1 項目ずつ照合する（`getBoundingClientRect` / `scrollHeight` の実測で行う。screenshot は不安定）
  - `git grep -n "要対応\|申込済み・抽選待ち\|名簿確定・振込待ち" apps/` の結果が **`admin/mail-inbox/` 配下のみ**であること（AC-41。`admin/entries/` 配下に 0 件）
  - `git grep -n "DESIGN-PROTO" apps/` が 0 件
- **完了条件:** 忠実度チェックリスト全項目クリア・上記 grep が期待どおり
- **対応Issue:** #397

---

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1** — `entry-board-utils.ts` は 2・3 の共有ホットスポット（型と純関数）。単独で先行させる
- **Wave 2: タスク2, タスク3** — 触るファイルが `page.tsx`＋`page.test.tsx` と `EntryBoardClient.tsx`＋`EntryBoardClient.test.tsx` で完全に直交するため並行可
- **Wave 3: タスク4** — 2・3 の完了後に照合

## 申し送り

- **`/admin/mail-inbox` の tier 0 ラベル「要対応」は別物。改称してはならない**（requirements §3.3）。リポジトリ全体の一括置換は禁止
- 既存 `entry-board-utils.test.ts` / `EntryBoardClient.test.tsx` は**削除対象の関数・日別行を検証している**ため、タスク1・3 の着手時点で赤くなる。これは想定内（自分が壊した回帰ではない）
- `apps/web` の Vitest は `--no-file-parallelism` で実行する
- 並行 worktree では `TEST_DATABASE_URL` で test DB を隔離する
