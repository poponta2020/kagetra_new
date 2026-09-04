---
status: in_progress
---
# 大会別LINE Bot メッセージ改訂 実装手順書

親Issue: #567

> **2026-09-04 改訂**: メール処理画面への振込連絡導線追加（requirements §3.3.5 / §4.1 AC-31〜51）の
> タスクで上書きした。初版（会計フラグ・メンション基盤・振込連絡の新設。PR #530 で出荷済み）の
> タスクは git 履歴が保持する。

## 前提となる調査結果（実装前に読む）

- **`processMail` の構造**（`apps/web/src/app/(app)/admin/mail-inbox/actions.ts:1634`）:
  1 トランザクションで「mail を FOR UPDATE → 代表イベント決定 → 添付採用（全件 or 全ロールバック）
  → `mail_kind` / `linked_event_id` / `triage_status='processed'` / `triaged_at` を UPDATE」。
  コミット後に revalidate、最後に `after()` で LINE 配信。`after()` 内は
  `isCurrentGeneration()`（`triaged_at` を **text のまま**比較する世代トークン）を
  **push のたびに引き直す**。振込連絡もこの規律に従う。
- **`loadPaymentNoticeContext`**（`apps/web/src/lib/events/payment-notice-context.ts`）:
  `settled` が false なら `null` を返す。母集団は `dueDays`（申込済 ∧ 事前払い ∧ 未振込）だけ。
  この「グループ全日を合算しない」規律を壊さないこと（二重請求になる）。
- **共通項目の伝播**: `propagateFieldsToGroup(tx, { groupId, targetEventIds, changed })`
  （`apps/web/src/lib/entry-groups.ts:447`）。`PropagatableFields` は Partial なので
  3 項目だけ渡せる。`saveGroupCommonFields` は **cancelled も含む全イベント**を対象にしている。
- **支払締切の CHECK**: `(payment_deadline IS NOT NULL) = (payment_deadline_kind = 'fixed')`。
  書き込みは必ず `normalizePaymentDeadline`（`apps/web/src/lib/events/payment-deadline.ts:47`）経由。
- **クライアントから Server Action で文脈を引く既存パターン**:
  `MailProcessForm` の `loadOpenChatBroadcastSummary` 呼び出し（`useEffect` で `groupId` 変化時に取得・
  取得前は**同期的に**前の値を捨てる・読み込み中とエラー時は「実行する」を押させない）。
  振込連絡のドラフト取得もこの形を踏襲する。
- **ロック順の確認（済）**: `adoptRosterFileTx` は `events` を**素の SELECT** でしか読まない
  （`apps/web/src/app/(app)/admin/mail-inbox/actions.ts:3328`）。`processMail` の tx が取る行ロックは
  `mail_messages` → `tournament_drafts` の順で、`events` は取っていない。したがって
  `propagateFieldsToGroup` → `lockEventRowsAscending`（**id 昇順**）を足しても、同じ順で
  `events` を取る `saveGroupCommonFields` と巡回待ちにならない。★この順序を崩さないこと
  （過去に `deadlock detected` (40P01) を踏んでいる）
- **client バンドル汚染の罠**: `use client` から辿るファイルに `server-only` /
  `@kagetra/shared/schema` / `drizzle-orm` の import（型 import 含む）を入れない。
  lint / vitest / check-types のどれでも検知できず `next build` で初めて壊れる。

## 実装タスク

### タスク1: 失敗記録の列を追加（migration）
- [ ] 完了
- **目的:** 非同期送信の失敗を画面に出せるよう、`entry_group_payment_notices` に試行記録を持たせる
- **対応AC:** AC-45（の前提）
- **主な変更領域:**
  - `packages/shared/src/schema/entry-group-payment-notices.ts` — `lastAttemptedAt`
    (`timestamptz`, nullable) と `lastError` (`text`, nullable) を追加。既存行に影響しない非破壊 ALTER
  - `packages/shared/drizzle/0063_*.sql`（`pnpm db:generate`。番号は 0062 の次）
  - `packages/shared/__tests__/` にスキーマの存在確認テスト（既存 `schema-lifecycle.test.ts` の流儀）
- **依存タスク:** なし
- **必要なテスト:** 列が存在し既定 NULL であること。既存行への影響がないこと
- **完了条件:** `pnpm test`（packages/shared）green・`pnpm check-types` 通過
- **対応Issue:** #568

### タスク2: 露出判定と「送信できない理由」を共有ロジックへ
- [ ] 完了
- **目的:** メール画面（`settled` 判定前）とグループページ（`settled` 判定後）が、同じ母集団・同じ規律で
  露出条件と初期値を組めるようにする。別ローダーを書かせない
- **対応AC:** AC-31, AC-33, AC-34, AC-35, AC-36, AC-48（回帰）
- **主な変更領域:**
  - **新規** `apps/web/src/lib/events/payment-notice-availability.ts` — DB 非依存の pure 関数。
    非中止の日の配列・LINE 紐付けの有無・単価解決済み級の有無から、送信可否と理由
    （`not_applied` / `onsite` / `paid` / `no_line_binding` / `no_priced_grade`）を返す。
    要件 §3.3.5.2 の**優先順位どおり**に判定する。★client から import されるので
    `server-only` / schema / drizzle を入れない
  - `apps/web/src/lib/events/payment-notice-context.ts` — `settled` チェックを外せる入口を追加
    （例: `loadPaymentNoticeContext(groupId, { requireSettled: false })`）。戻り値を
    「不可なら理由つき」の形へ広げ、`lastAttemptedAt` / `lastError` と共通項目の初期値
    （`paymentDeadline` / `paymentDeadlineKind` / `paymentInfo`）を含める。
    **`dueDays` だけを母集団にする既存規律は変更しない**
  - 既存呼び出し元（グループページ `page.tsx` / `sendPaymentNotice`）を新しい戻り値へ追従。
    **挙動は不変**（`settled` 必須のまま）
  - 各 `*.test.ts`
- **依存タスク:** タスク1（`lastError` 等を返すため）
- **必要なテスト:** 理由判定の純関数を境界ごとに（未申込のみ／全部現地払い／全部支払済／紐付けなし／
  単価解決不可、および混在時に優先順位どおりの理由が出ること）。`requireSettled: false` で
  settled 前でも context が返ること。**回帰**: グループページ経路の露出条件が変わらないこと
- **完了条件:** web の該当テスト green・`pnpm check-types` 通過
- **対応Issue:** #569

### タスク3: 送信処理を共通化し、失敗を記録する
- [ ] 完了
- **目的:** 2 導線が同じ送信処理（人数保存 → push → 成否で `last_sent_at` / 失敗記録）を使う。
  失敗の可視化をグループページ経路にも足す
- **対応AC:** AC-45, AC-45b, AC-47, AC-48（回帰）, AC-19（既存回帰）
- **主な変更領域:**
  - **新規** `apps/web/src/lib/events/payment-notice-send.ts` — `sendPaymentNoticeCore(dbc, input)`。
    人数の upsert → `resolveTreasurerMention` → `buildPaymentNoticeMessages` →
    `pushMessagesToEntryGroup` → 成功なら `last_sent_at` / `last_sent_by` を進め**`last_error` を
    NULL へ戻す**（AC-45b。残すと「送信済」と「失敗」が同時に出る）、失敗なら
    `last_attempted_at` / `last_error` だけを書く。`server-only`
  - `apps/web/src/app/(app)/admin/entries/[groupId]/actions.ts` — `sendPaymentNotice` を
    このコアへ載せ替える（**外から見た挙動は不変**）
  - 各 `*.test.ts`
- **依存タスク:** タスク2
- **必要なテスト:** push 失敗時に `last_sent_at` が進まず `last_error` が入ること。成功時に
  `last_error` がクリアされること。人数が push の前に保存されること。**回帰**: 既存の
  `sendPaymentNotice` のテストがそのまま green
- **完了条件:** web の該当テスト green
- **対応Issue:** #570

### タスク4: メール画面用のドラフト取得 Server Action
- [ ] 完了
- **目的:** クライアントが対象グループを選んだ時点で、送信可否・人数の初期値・共通項目の初期値・
  送信済み情報を1回で引けるようにする
- **対応AC:** AC-31, AC-32, AC-33, AC-34, AC-35, AC-36, AC-41
- **主な変更領域:**
  - **新規** `apps/web/src/app/(app)/admin/mail-inbox/payment-notice-actions.ts` —
    `loadPaymentNoticeDraft(groupId)`。`requireAdminSession` → タスク2 の
    `requireSettled: false` 経路 → 送信可否 / 理由 / 級ごとの人数と単価 /
    支払締切・kind・振込先 / `lastSentAt` / `lastAttemptedAt` / `lastError` を返す DTO
  - `*.test.ts`
- **依存タスク:** タスク2, タスク3
- **必要なテスト:** 認可（一般会員は拒否）・不可時に理由が返ること・DTO に単価が含まれ人数0の級も
  行として返ること
- **完了条件:** web の該当テスト green
- **対応Issue:** #571

### タスク5: `processMail` の入力拡張と送信
- [ ] 完了
- **目的:** メール処理の実行に振込連絡を相乗りさせる。共通項目はコミット前に保存し、push は
  コミット後・配信の**後**に世代トークン検証つきで走らせる
- **対応AC:** AC-38, AC-39, AC-40, AC-42, AC-42b, AC-43, AC-44, AC-45, AC-46, AC-49（回帰）, AC-50（回帰）
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `ProcessMailInput` に
    `paymentNotice?: { send: boolean, counts, paymentDeadline, paymentDeadlineKind, paymentInfo } | null`
    を追加。★**保存と送信を分ける**（要件 §3.3.5.3）:
    - `null` / 未指定（＝セクションが出ていない）→ 何も保存せず何も送らない
    - `send: false` → 支払締切・振込先だけ保存し、push はしない
    - `send: true` → 保存したうえで push する

    サーバー側で fail-closed に再判定する: 種別 = `confirmed_roster` ∧ `entryGroupId` あり ∧
    タスク2 の可否判定が ok（`paymentNotice` を受け付ける条件）。さらに `send: true` のときだけ
    振込先が非空 ∧ 人数が全級0でないことを要求する。**tx 内**で `propagateFieldsToGroup` により
    支払締切（`normalizePaymentDeadline` 経由）と振込先をグループ内の全イベントへ保存
    （`lockEventRowsAscending` の昇順ロック順を崩さない）。**コミット後の `after()`** で、
    既存の `broadcastMailToEvent` →（オープンチャット）→ **振込連絡**の順に、
    `isCurrentGeneration()` を push 直前に引き直してから `sendPaymentNoticeCore` を呼ぶ。
    try/catch は既存 2 系統と**独立**させる
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts` ほか
- **依存タスク:** タスク3, タスク4
- **必要なテスト:** `send: true` で振込先が空／人数全級0／種別が確定名簿でない／可否判定が不可 の
  とき送らないこと。`send: false` でも共通項目が保存されること（AC-42）。`paymentNotice` 未指定なら
  共通項目も保存されないこと（AC-42b）。共通項目が全日へ保存され CHECK を満たすこと。
  採用失敗で全体がロールバックされ、そのとき振込連絡も送られないこと。取り消し後は世代トークン
  不一致で送られないこと。**呼び出し順**: 振込連絡の push が `broadcastMailToEvent` の解決後に
  呼ばれること（モックの呼び出し順で表明・AC-44）。**回帰**: 既存の `processMail` テスト
  （採用の原子性・配信・オープンチャット）がそのまま green
- **完了条件:** web の該当テスト green
- **対応Issue:** #572

### タスク6: メール処理画面の UI
- [ ] 完了
- **目的:** 「会計へ振込連絡を送る」セクションを統合処理フォームに組み込む
- **対応AC:** AC-31, AC-32, AC-34, AC-35, AC-37, AC-38, AC-41, AC-42, AC-42b
- **主な変更領域:**
  - **新規** `apps/web/src/app/(app)/admin/mail-inbox/components/PaymentNoticeFields.tsx` —
    級ごとの人数入力（単価は表示のみ）・支払締切（日付＋状態セレクト）・振込先（textarea）・
    文面プレビュー。プレビューは pure な `@/lib/payment-notice` だけを import する
  - `apps/web/src/app/(app)/admin/mail-inbox/components/MailProcessForm.tsx` —
    種別 = 確定名簿 ∧ グループ選択済みでセクションを描く。`loadPaymentNoticeDraft` を
    `groupId` 変化時に取得（`loadOpenChatBroadcastSummary` と同じ規律: 前の値を同期的に捨てる・
    読み込み中とエラー時は「実行する」を押させない）。チェックの既定は
    **未送信 = ON / 送信済 = OFF**。OFF のときは中身を畳むが、`paymentNotice` は
    `send: false` として**送る**（支払締切・振込先を保存させるため。要件 §3.3.5.3）。
    セクション自体が出ていないときだけ `paymentNotice` を渡さない
  - `MailProcessForm.test.tsx` / `PaymentNoticeFields.test.tsx`
- **依存タスク:** タスク4, タスク5
- **必要なテスト:** 種別を切り替えたときのセクションの出入り・既定値の ON/OFF・不可時の理由表示と
  実行ボタンの状態・**チェック ON で**振込先が空のときに実行できないこと（OFF なら実行できる）・
  単価入力欄が存在しないこと・OFF で実行すると `send: false` が渡ること・
  種別が確定名簿でないときは `paymentNotice` 自体が渡らないこと
- **完了条件:** web の該当テスト green・`pnpm lint` 通過
- **対応Issue:** #573

### タスク7: 失敗の表示（2画面）
- [ ] 完了
- **目的:** 非同期送信の失敗に気づけるようにする
- **対応AC:** AC-45, AC-45b
- **主な変更領域:**
  - `apps/web/src/app/(app)/admin/mail-inbox/mail/[id]/page.tsx` — 「処理済み」カードに、
    そのメールの `linked_event_id` から辿った申込グループの振込連絡の状態
    （送信済 / 送信に失敗しました＋試行日時）を出す
  - `apps/web/src/app/(app)/admin/entries/[groupId]/components/PaymentNoticeSection.tsx` —
    `lastAttemptedAt` / `lastError` があるときに失敗を表示（`lastSentAt` の表示は維持）
  - 各テスト
- **依存タスク:** タスク6（`PaymentNoticeSection` / メール画面を触るタスクとの順序制約）
- **必要なテスト:** 失敗記録があるときに両画面へ出ること・成功後は消えること（AC-45b）
- **完了条件:** web の該当テスト green
- **対応Issue:** #574

## 実装順序（Wave = 並行実装できるタスクの組）

- Wave 1: タスク1 #568（スキーマ）
- Wave 2: タスク2 #569（判定ロジック）
- Wave 3: タスク3 #570（送信コア）
- Wave 4: タスク4 #571（ドラフト取得 Server Action）, タスク5 #572（`processMail` 拡張）
  — 触るファイルが `payment-notice-actions.ts`（新規）と `actions.ts` で重ならない
- Wave 5: タスク6 #573（UI）
- Wave 6: タスク7 #574（失敗表示）

依存が一本道なのは、下から順に「スキーマ → 判定 → 送信 → 入口 → 画面」と積み上がる構造のため。
Wave 4 だけが並行できる。
