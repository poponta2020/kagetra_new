---
status: completed
---

# entry-overdue-alert 実装手順書

要件定義: [requirements.md](requirements.md)（Acceptance Criteria は §4）
親Issue: #305

## 技術設計の要点（未解決論点の解決）

要件 §6 の未解決論点 5 件をここで確定させた。

1. **管理者個人 LINE への push は apps/web 側に自己完結モジュールを新設する**（mail-worker の `pushSystemNotification` は再利用しない）
   - `@kagetra/mail-worker` の `exports` マップに `./notify/line` は無く、追加すると `@line/bot-sdk` が web 側の依存グラフに入る
   - web の既存 3 モジュール（`line-broadcast.ts` / `line-broadcast-guidelines.ts` / `event-lifecycle-notify.ts`）はいずれも SDK を使わず `fetch` で `https://api.line.me/v2/bot/message/push` を直接叩く自己完結実装。`line-broadcast-guidelines.ts` は「重依存を避けるため意図的に `line-broadcast.ts` を import しない」設計を明示している
   - 今回も同じ方針を踏襲する。必要なのは「`line_channels` の `status='system'` 行を引いて text 1 通を push」だけで、`event-lifecycle-notify.ts` の push 実装をそのまま縮小した形で足りる
2. **バッチは新規スクリプトに分離**（`send-lifecycle-reminders.ts` に相乗りしない）。宛先（管理者個人 vs 大会グループ）・冪等性（毎日 vs once-ever）・配信時刻（07:00 vs 00:00）がすべて異なる
3. **`setEntryApplied` は一切変更しない。「申し込まない」は新規 Server Action に切る**
   - 要件 §3.2.2 で `not_applying → applied` の直接遷移を UI に用意しないと決めたため、`setEntryApplied(eventId, true)` の `UPDATE ... WHERE entry_status = 'not_applied'` ガードは**そのままで正しい**。条件を `<> 'applied'` に緩める案は撤回した（呼び出し経路が存在しない dead code になるうえ、UI 外で状態が変わった行に対して二重に通す余地を作るため）
   - `setEntryApplied(eventId, false)` も従来どおり `not_applied` へ戻す（`not_applying` からの解除もこの経路に乗る）
   - 新規 `setEntryNotApplying(eventId)`（admin/vice_admin・通知なし・`not_applied` / `applied` のどちらからでも遷移可）
   - 復帰は `not_applying` →（`setEntryApplied(id, false)`）→ `not_applied` →（`setEntryApplied(id, true)`）→ `applied` の 2 ステップ。2 ステップ目は既存経路そのものなので、申込完了通知 2 通も once-ever も既存挙動のまま（AC-15）
4. **`/events` 一覧からの除外はクエリ条件**（`ne(events.entryStatus, 'not_applying')` を既存 `where` に AND）。取得後フィルタにすると件数表示・並び替えの母集団がずれる
5. **参加人数は相関サブクエリ**（`event_attendances` の `attend = true` を COUNT）。既存 `player-search-recent-affiliation` の相関サブクエリパターンを踏襲。バッチは対象が数件のため N+1 でも実害はないが、1 クエリで取れるものを分けない
6. **失敗ポリシーの適用順序を固定する**（要件 §3.2.3）: 対象抽出 → 0 件なら正常終了 → チャネル解決（未設定なら**警告してスキップ・exit 0**）→ `PUBLIC_BASE_URL` 解決（未設定なら**例外・exit 1**）→ 文面 → push。順序を逆にすると、system_notify を構成していない環境で毎朝 exit 1 が出る

### 変更対象の全体像

| 領域 | ファイル |
|---|---|
| スキーマ | `packages/shared/src/schema/enums.ts`、`packages/shared/drizzle/`（新規 migration） |
| アラート本体 | `apps/web/src/lib/entry-overdue-alert.ts`（新規） |
| バッチ | `apps/web/scripts/send-entry-overdue-alert.ts`（新規） |
| systemd | `apps/web/systemd/kagetra-entry-overdue-alert.{service,timer}`（新規） |
| 進行管理 | `apps/web/src/app/(app)/events/[id]/actions.ts`、`components/events/EventLifecycleSection.tsx`、`components/events/LifecycleStatusBadge.tsx` |
| 一覧 | `apps/web/src/app/(app)/events/page.tsx` |
| docs | `docs/spec/notifications.md`、`docs/spec/events-attendance.md`、`docs/design/db-tables-events.md`、`docs/deploy/entry-overdue-alert.md`（新規）、`docs/features/INDEX.md` |

---

## 実装タスク

### タスク1: `entry_status` に `not_applying` を追加（スキーマ + migration）
- [x] 完了（migration `0043_entry_status_not_applying.sql`）
- **目的:** 3 値目の enum 値を DB とスキーマ定義に追加し、後続タスクすべての前提を作る
- **対応AC:** AC-4, AC-12, AC-14, AC-16
- **主な変更領域:** `packages/shared/src/schema/enums.ts`（`eventEntryStatusEnum`）、`packages/shared/drizzle/`（`pnpm db:generate` で生成される新規 migration + snapshot）、`packages/shared/__tests__/schema-lifecycle.test.ts`、`docs/design/db-tables-events.md`
- **依存タスク:** なし（先行必須の共有ホットスポット）
- **担当:** **main が実施する**（project-profile §conventions: スキーマ変更・Drizzle migration 生成は実装ワーカーに投げない）
- **必要なテスト:** `schema-lifecycle.test.ts` に `not_applying` を含む 3 値であることのアサーションを追加
- **完了条件:** `pnpm db:generate` で migration が生成され、テスト DB へ `db:migrate` が通る／`pnpm --filter=@kagetra/shared test` green／`pnpm check-types` green
- **注意:** PostgreSQL の enum 値追加はロールバック不可。値名は `not_applying` で確定。並行 worktree があると migration 番号が衝突するため、生成前に `packages/shared/drizzle/` の最新番号を確認する
- **実装時の追加:** enum を広げると `events.entryStatus` の推論型が 3 値になり、`LifecycleStatusBadge` の `EntryStatus`（2 値）へ渡している `events/[id]/page.tsx` が型エラーになる。ツリーを緑に保つため、**`EntryStatus` の union 拡張（1 行）だけをタスク1 に含めた**（ピルの分岐・トーンはタスク3）
- **対応Issue:** #306

---

### タスク2: 毎日アラートの本体ライブラリ
- [x] 完了
- **目的:** 対象抽出・文面生成・system_notify チャネルへの push を、テスト可能な純粋関数＋薄い I/O に分けて実装する
- **対応AC:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11
- **主な変更領域:** `apps/web/src/lib/entry-overdue-alert.ts`（新規）、`apps/web/src/lib/entry-overdue-alert.test.ts`（新規）
- **依存タスク:** タスク1（`not_applying` を除外条件に使う）
- **公開する関数（想定）:**
  - `collectOverdueEntries(db, { today })` — 要件 §3.2.1 の 4 条件で抽出し、大会名・基準締切・基準締切の由来（`internal` / `entry`）・申込締切・参加人数・超過日数を返す。`LEFT JOIN` は使わず `event_line_broadcasts` に触れない（**AC-5: グループ紐付けの有無に依存させない**）
  - `buildOverdueAlertMessage(rows, { today, baseUrl })` — 純関数。超過日数降順、上位 5 件＋「他 N 件」、各行に大会名／会内締切と超過日数／申込締切と残日数／参加人数／`{baseUrl}/events/{id}`
  - `loadSystemChannel(db)` — `line_channels` の `status='system'` 行（複数あれば `updatedAt` 最新を採用し警告）
  - `pushSystemText(channel, text, { logger })` — `fetch` で LINE push。`LINE_NOTIFY_DRY_RUN=1` を尊重、30 秒タイムアウト、429 は `Retry-After` に従い最大 3 回リトライ（`event-lifecycle-notify.ts` の実装を縮小して踏襲）
  - `sendEntryOverdueAlert(db, { today, baseUrl, logger })` — 上記を**この順序で**束ねる: ①抽出 → 0 件なら push せず `{ skipped: 'no-candidates' }` ②チャネル解決 → 未設定／userId 未設定なら警告して `{ skipped: 'no-channel' | 'no-user-id' }`（**throw しない**）③`PUBLIC_BASE_URL` 解決 → 未設定なら **throw** ④文面 ⑤push。②を③より前に置くのが要件（未構成の環境で毎朝 exit 1 を出さない）
  - **通知ログ表を持たない。** `event_lifecycle_notifications` への INSERT も claim も一切行わない（AC-10 はこれを構造的に検証する）
- **必要なテスト（テストファースト）:**
  - 抽出条件: 会内締切超過で対象になる／締切当日は対象外／翌日から対象（AC-3）／`internal_deadline` NULL は `entry_deadline` で判定・両方 NULL は対象外（AC-2）／`applied`・`not_applying`・`cancelled`・開催日過去は対象外（AC-4）／**LINE グループ未紐付けでも対象（AC-5）**
  - 文面: 必須 5 情報が含まれる（AC-8）／6 件以上で上位 5 件＋「他 N 件」・超過日数降順（AC-9）
  - 送信: 1 件以上で push は 1 回だけ（AC-6）／0 件で push されない（AC-7）／チャネル未設定・userId 未設定で throw せずスキップ＋警告（AC-11）
  - **AC-10 は構造アサーションで書く**: 同じ引数で 2 回呼び、push スタブが 2 回呼ばれること**かつ** `event_lifecycle_notifications` の行数が 0 のままであること（「`today` を注入しているから 2 回通る」だけでは、後から抑止用の永続層が足された場合に検知できない）
  - `PUBLIC_BASE_URL` 未設定は例外（要件 §3.2.3）。ただしチャネル未設定のケースでは**そこに到達しない**ことも検証する
  - DB を使うテストは `TEST_DATABASE_URL` で隔離、LINE は `LINE_NOTIFY_DRY_RUN=1` または `fetch` の stub
- **完了条件:** `pnpm --filter=@kagetra/web test` green・`pnpm check-types` green
- **対応Issue:** #307

---

### タスク3: 進行管理の 3 状態化（Server Action + UI）
- [x] 完了
- **目的:** `/events/[id]` の進行管理から「申し込まない」を設定・解除できるようにし、進行状態ピルに「申込なし」を追加する
- **対応AC:** AC-12, AC-13, AC-15, AC-18, AC-20
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/actions.ts`（`setEntryApplied` の遷移ガード変更 + `setEntryNotApplying` 新規）、`apps/web/src/components/events/EventLifecycleSection.tsx`、`apps/web/src/components/events/LifecycleStatusBadge.tsx`、`apps/web/src/app/(app)/events/[id]/page.tsx`（props の型追従が必要な場合のみ）、および各 `.test.ts(x)`
- **依存タスク:** タスク1
- **実装内容:**
  - **`setEntryApplied` は変更しない**（`WHERE entry_status = 'not_applied'` ガードのまま。`not_applying → applied` の直接遷移を UI に用意しないため、緩める必要がない）。`setEntryApplied(eventId, false)` が `not_applying` からの解除も担う
  - `setEntryNotApplying(eventId)` を新設。`requireAdminSession()` → `entry_status='not_applying'`・`entry_applied_at=null` へ UPDATE → `revalidatePath('/events/${eventId}')` と `revalidatePath('/events')`。**通知 claim も push も行わない**
  - `LifecycleStatusBadge`: `EntryStatus` に `'not_applying'` を追加。`not_applying` は tone `info`・文言「申込なし」で、**支払いピルを描画しない**（requirements §8）
  - `EventLifecycleSection`: 申込状態行を 3 状態化。`not_applied` → 「申込済にする」＋「申し込まない」の 2 ボタン、`applied` → 「未申込に戻す」＋「申し込まない」、`not_applying` → 「未申込に戻す」のみ。「申し込まない」押下時のみ `window.confirm`（「この大会は大会申込一覧に表示されなくなります。よろしいですか？」）。既存の「参加者の LINE グループに通知が送られます」confirm は申込済化・支払済化のときだけのまま
- **必要なテスト:**
  - action: 一般会員は `setEntryNotApplying` を呼べない（AC-12）／`not_applying` への遷移で通知が送られない（AC-13）／`not_applying` →（解除）→ `not_applied` →（申込済化）→ `applied` で 2 通の claim が走る（AC-15）／再トグルで再送されない once-ever 回帰（AC-18）
  - コンポーネント: 3 状態それぞれのボタン構成、`not_applying` で支払いピルが出ない、`window.confirm` の発火条件（AC-20）
- **完了条件:** `pnpm --filter=@kagetra/web test` green・`pnpm check-types` green
- **対応Issue:** #308

---

### タスク4: `/events` 一覧から `not_applying` を除外
- [x] 完了
- **目的:** 「申し込まない」にした大会を大会申込一覧から消す（`/events-archive` は従来どおり）
- **対応AC:** AC-14
- **主な変更領域:** `apps/web/src/app/(app)/events/page.tsx`（一覧クエリの `where`）、`apps/web/src/app/(app)/events/*.test.ts(x)`。`events-archive/page.tsx` は**変更しない**
- **依存タスク:** タスク1
- **実装内容:** 既存の `where: gte(events.eventDate, todayStr)` を `and(gte(...), ne(events.entryStatus, 'not_applying'))` に変更する。件数表示・フィルタ・並び替えはこの母集団の上で従来どおり動く
- **必要なテスト:** `not_applying` の大会が一覧に出ない／`not_applied`・`applied` は従来どおり出る／`/events-archive` は開催日経過後に `not_applying` の大会も出す（AC-14）
- **完了条件:** `pnpm --filter=@kagetra/web test` green・`pnpm check-types` green
- **対応Issue:** #309

---

### タスク5: 日次バッチ + systemd ユニット + デプロイ手順
- [x] 完了
- **目的:** タスク2 のライブラリを毎朝 1 回起動する運用形にする
- **対応AC:** AC-21（本番実機は出荷後の manual 確認）
- **主な変更領域:** `apps/web/scripts/send-entry-overdue-alert.ts`（新規）、`apps/web/scripts/__tests__/send-entry-overdue-alert.test.ts`（新規）、`apps/web/systemd/kagetra-entry-overdue-alert.service`・`.timer`（新規）、`docs/deploy/entry-overdue-alert.md`（新規）
- **依存タスク:** タスク2
- **実装内容:**
  - スクリプトは `send-lifecycle-reminders.ts` と同構造（`dotenv` で `.env.local` 読み込み → `Pool` → `drizzle` → 実行 → `pool.end()`、`--dry-run` は候補一覧のみ表示して push しない、`isDirectRun` ガード、失敗時 exit 1）
  - `.service` は `Type=oneshot`・`User=kagetra`・`WorkingDirectory=/opt/kagetra`・`EnvironmentFile=/opt/kagetra/.env.production`・`ExecStart=/usr/bin/corepack pnpm --filter @kagetra/web exec tsx scripts/send-entry-overdue-alert.ts`。既存 2 ユニットと同じ形。**`PUBLIC_BASE_URL` が必須である旨をコメントに明記**（既存の lifecycle-reminders は「不要」と書いてあるので取り違えを防ぐ）
  - `.timer` は `OnCalendar=*-*-* 07:00:00`・`AccuracySec=5min`・`Persistent=true`
  - デプロイ手順書に、ユニット配置 → `systemctl enable --now` → `--dry-run` での候補確認 → `LINE_NOTIFY_DRY_RUN=1` での 1 回実行 → 本番実行、までを記す
- **必要なテスト:** `--dry-run` で push が呼ばれず候補が列挙される／引数なしで `sendEntryOverdueAlert` が 1 回呼ばれる（DB とタイマーはテスト対象外）
- **完了条件:** `pnpm --filter=@kagetra/web test` green・`pnpm check-types` green・systemd ユニットが既存 2 組と同じ構成になっている
- **対応Issue:** #310

---

### タスク6: 正典ドキュメントの更新
- [ ] 完了
- **目的:** 機能仕様の正典（`docs/spec/`）を変更後の姿に更新し、DoD の docs ゲートを満たす
- **対応AC:** AC-22（の一部。docs 単独では機械検証されないが gate-dod の D2 で確認される）
- **主な変更領域:** `docs/spec/notifications.md`（「管理者向け毎日アラート」節を新設。全体像の「4 つの独立した仕組み」を 5 つに更新、API 表に新規 Server Action とバッチを追加）、`docs/spec/events-attendance.md`（進行管理フローの 3 状態化・一覧の除外条件）、`docs/features/INDEX.md`（`entry-overdue-alert` を追記）
- **依存タスク:** タスク2, タスク3, タスク4, タスク5（実装が確定してから正典を書く）
- **注意:** テーブル定義・enum の記載は `docs/design/db-tables-events.md` の一箇所のみ（タスク1 で更新済み）。**spec 側にカラム定義表を書かない**（project-profile §docs の 1 事実 1 ファイル規律）。実装参照はファイルパス粒度で、行番号を書かない
- **完了条件:** `bash scripts/gate-dod.sh` の docs チェック（D2）が通る
- **対応Issue:** #311

---

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1:** タスク1（スキーマ + migration。**main が実施**。共有ホットスポットのため単独先行）
- **Wave 2:** タスク2, タスク3, タスク4（互いに依存なし・変更領域が重ならない → 並行実装可）
  - タスク2 = `src/lib/entry-overdue-alert.ts` のみ（新規ファイル）
  - タスク3 = `events/[id]/actions.ts` + `components/events/` 配下
  - タスク4 = `events/page.tsx` + その隣接テスト
- **Wave 3:** タスク5（タスク2 に依存）
- **Wave 4:** タスク6（全実装タスクに依存。docs ファイルの競合を避けるため単独）
