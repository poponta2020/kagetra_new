---
status: completed
---
# ホーム「会の出場予定」実装手順書 — 大会ピルの4値ステータス化

> 要件は [`requirements.md`](requirements.md)（改修モード・2026-09-21）。AC は §4。
> 初回実装（PR #400）のタスクは git 履歴（`bd2bfc2` 以前のこのファイル）が保持する。
> レイアウトの正は引き続き [`design-prototype.patch`](design-prototype.patch)。今回はピルの文言とトーンだけを変え、行構造には触れない。

## 技術設計（確定）

- **スキーマ変更なし・migration なし**
- **ステータス型**（`home-timeline-types.ts`）: `HomeEventStatus = 'open' | 'closed' | 'applied' | 'roster_confirmed'`。
  `HomeTimelineEvent.confidence`（`EntrantConfidence`）を `status: HomeEventStatus` に**置き換える**（`EntrantConfidence` 型は削除）
- **純関数**（`home-timeline-utils.ts`）:
  - `deriveHomeEventStatus(input, todayStr): HomeEventStatus`
    — `input = { rosterSettled: boolean; entryStatus: 'not_applied' | 'applied' | 'not_applying'; internalDeadline: string | null; entryDeadline: string | null }`。
    判定は requirements §3.2.1 の表の上から順（`rosterSettled` → `entryStatus === 'applied'` → `base < todayStr` → それ以外）。
    `base = internalDeadline ?? entryDeadline`。`not_applying` は `not_applied` と同じ扱い（特別分岐を書かない）。`Date.now()` を呼ばない
  - `HOME_EVENT_STATUS_PILL: Record<HomeEventStatus, { label: string; tone: PillTone }>`
    — `roster_confirmed: 名簿確定/brand`・`applied: 申込済/info`・`open: 参加受付中/warn`・`closed: 締切済/neutral`。`PillTone` は `@/components/ui/pill` から type-only import
  - 旧 `confidenceLabel` は削除（タスク3）
- **サーバー**（`page.tsx`）: 母集団が空でないとき `loadConfirmedRosterStates(upcomingEvents.map((e) => e.entryGroupId))`（`@/lib/events/confirmed-roster`＝判定の正典）を1回呼び、各大会の `status` を `deriveHomeEventStatus` で導出する。ホーム側で確定名簿の条件を独自に組まない
- **共有モジュール**（`lib/upcoming-entrants.ts`）: `events.entryStatus` を select に足し、`UpcomingEntrantsEvent.entryStatus` として返す（**追加のみ**）。出場者判定（`hasConfirmedRoster` による名簿パス切替・ゲスト合流・対象級絞り）は一切変えない。`hasConfirmedRoster` の doc コメント「`confidence` 導出用」は「名簿パス切替（出場者の出所）用。ホームのステータスは confirmed-roster.ts の settled で判定する」に直す
- **外部API**（`app/api/external/tournament-entrants/route.ts`）: 変更しない。項目を明示的に詰め替えているので `entryStatus` の追加は応答に出ない
- **表示**（`HomeTimeline.tsx`）: 今日カード（`size` 既定）とタイムライン行（`size="sm"`）の2箇所の `Pill` を `HOME_EVENT_STATUS_PILL[event.status]` の `tone` / `label` に置き換える。クラス・構造は他に変えない

## 実装タスク

### タスク1: ステータス導出の純関数とピル定義
- [x] 完了
- **目的:** 4値ステータスの判定とピルの文言・トーンを、DB に触れない純関数・定数として用意する（追加のみ。既存の `confidenceLabel` はまだ消さない）
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-10（定義側）
- **主な変更領域:** `apps/web/src/app/(app)/dashboard/home-timeline-utils.ts`・`home-timeline-utils.test.ts`（`home-timeline-types.ts` に `HomeEventStatus` 型を**追加**する。`confidence` の削除はタスク3）
- **依存タスク:** なし
- **必要なテスト（先に書く）:** `deriveHomeEventStatus` の判定表
  - rosterSettled=true なら entryStatus（not_applied / applied / not_applying）・締切（過去／未来／null）の全組合せで `roster_confirmed`（AC-1）
  - applied ∧ 基準締切が未来 → `applied`（AC-2）
  - not_applied ∧ 基準締切 = 昨日 → `closed`（AC-3）／= 今日 → `open`・= 明日 → `open`（AC-4）
  - internal=null ∧ entry=昨日 → `closed`、両方 null → `open`（AC-5）
  - internal=昨日 ∧ entry=明日 → `closed`（会内締切が優先。AC-6）
  - not_applying ∧ 基準締切 未来 → `open`／過去 → `closed`（AC-7）
  - `HOME_EVENT_STATUS_PILL` の4エントリの label・tone が requirements §3.2.4 の表どおり（AC-10）
- **完了条件:** 追加したテストが green・`pnpm check-types` 通過・対象ファイルの eslint 通過
- **対応Issue:** #650（親 #649）

### タスク2: 仕様書・コメントの同期
- [x] 完了
- **目的:** 「ホームでは確定名簿メール・手動フラグだけのグループが『希望』表示になる」という旧記述を、新仕様（ピルは「名簿確定」、名前チップは出欠ベースのまま）に揃える
- **対応AC:** なし（requirements §6「仕様書の同時更新」の履行）
- **主な変更領域:**
  - `docs/features/confirmed-roster-signal/requirements.md` §3.2.5 の本文（AC-14 は「出場者判定不変」で引き続き成立するので**AC は変えない**）＋同書の `## 変更履歴` に1行
  - `apps/web/src/lib/events/confirmed-roster.ts` 冒頭 doc コメントの「ホームでは『希望』表示になる」の一文（**コードは変えない**）
  - `docs/features/home-tournament-timeline/design-spec.md` §4「`Pill`（確定=brand・希望=neutral）」と §8 チェックリスト「確度ピルは 確定=`tone="brand"` / 希望=`tone="neutral"`」を4値の対応表（requirements §3.2.4）へ。§3 の見出し等で「確定／希望」「確度ピル」と書いている箇所も「ステータスピル」へ
- **依存タスク:** なし（タスク1・3 とファイルが重ならない）
- **必要なテスト:** なし（docs・コメントのみ）
- **完了条件:** `git grep -n "希望" -- docs/features/confirmed-roster-signal/requirements.md apps/web/src/lib/events/confirmed-roster.ts docs/features/home-tournament-timeline/design-spec.md` の結果に、旧仕様として「ホームのピルが希望になる」と読める記述が残っていない
- **対応Issue:** #651（親 #649）

### タスク3: ホームへの配線と旧「確定／希望」の撤去
- [ ] 完了
- **目的:** ホームの DTO を `confidence` から `status` へ置き換え、サーバーで4値を導出して今日カード・タイムライン行のピルに出す
- **対応AC:** AC-8, AC-9, AC-10（描画側）, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16
- **主な変更領域:**
  - `apps/web/src/lib/upcoming-entrants.ts`（`entryStatus` の追加のみ・doc コメント修正）
  - `apps/web/src/app/(app)/dashboard/home-timeline-types.ts`（`confidence`/`EntrantConfidence` 削除 → `status`。冒頭 doc コメントの「出場者『希望』『確定』」は**出場者の出所**の説明として残してよいが、ピルの説明はステータスへ書き換える）
  - `apps/web/src/app/(app)/dashboard/home-timeline-utils.ts`（`confidenceLabel` 削除）・`home-timeline-utils.test.ts`（`confidenceLabel` のテスト削除）
  - `apps/web/src/app/(app)/dashboard/HomeTimeline.tsx`（Pill 2箇所）・`HomeTimeline.test.tsx`
  - `apps/web/src/app/(app)/dashboard/page.tsx`・`page.test.tsx`
- **依存タスク:** タスク1（純関数・型を使う。同じ utils / types ファイルを触る）
- **必要なテスト（先に書く・既存を書き換える）:**
  - `HomeTimeline.test.tsx`: `event()` ファクトリの既定を `status: 'roster_confirmed'` に。旧「確度ピルは 確定 / 希望 を出し分ける」を「4ステータスの文言とトーン（`bg-brand-bg` / `bg-info-bg` / `bg-warn-bg` / `bg-neutral-bg`）がタイムライン行と今日カードの両方で出る」に置き換える（AC-10）。旧文言「希望」「確定」単独のテキストが出ないこと（AC-11）
  - `page.test.tsx`（DB 統合）:
    - 既存の `toContain('確定')` / `toContain('希望')` のピル判定を新ステータスへ書き換える（出場者の出所に関する既存アサーションはそのまま残す＝AC-13/14 の回帰）
    - ★「差し替え済み（superseded）の確定名簿」テストは会員の姓が `'希望'` でチップに「希望」が出るため、旧文言不在（AC-11）の判定と衝突する。姓を別の語に変えるか、ピル要素に限定して判定する
    - 確定名簿の4材料それぞれ単独（パース済み名簿／採用済み原本ファイル／確定名簿メール／手動フラグ）で「名簿確定」になる（AC-8。シードは `lib/events/confirmed-roster.test.ts` の `seedRosterFile` / `seedConfirmedRosterMail` / `setOverride` を参考にする）
    - 手動フラグだけのグループでは、ピルが「名簿確定」、チップは attend=true の会員のまま（AC-9）
    - `entry_status='applied'` ∧ 会内締切が未来 → 「申込済」／会内締切が過去 ∧ 未申込 → 「締切済」／会内締切が未来 → 「参加受付中」（AC-2〜4 の統合確認。境界の網羅はタスク1の純関数テストが持つ）
  - `lib/upcoming-entrants.test.ts`・`app/api/external/tournament-entrants/route.test.ts`・`lib/events/confirmed-roster.test.ts`・`admin/entries` 系・`entry-flow` 系は**変更しない**（AC-12 / AC-13 / AC-15 の回帰網）
- **完了条件:** `git grep -n "confidenceLabel\|EntrantConfidence" apps/web/src` が0件・ダッシュボード配下と upcoming-entrants のテストが green・`pnpm check-types` / `pnpm lint` 通過（フルスイートは CI で確認）
- **対応Issue:** #652（親 #649）

## 実装順序（Wave = 並行実装できるタスクの組）

- Wave 1: タスク1, タスク2（タスク1は dashboard の utils/types/test、タスク2は docs と confirmed-roster.ts のコメントのみ。変更領域が重ならない）
- Wave 2: タスク3（タスク1に依存。utils/types を再び触り、page・HomeTimeline・upcoming-entrants へ配線する）
