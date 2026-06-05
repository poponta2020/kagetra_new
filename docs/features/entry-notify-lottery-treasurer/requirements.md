---
status: completed
---

# entry-notify-lottery-treasurer 要件定義書

## 1. 概要

### 目的
既存の [`event-lifecycle-notify`](../event-lifecycle-notify/requirements.md)（PR #85・本番稼働中）の **申込完了通知** を、宛先の関心ごとに合わせて拡張する。
申込完了（`entry_applied`）のタイミングで、同じ参加者 LINE グループへ次の 2 通を送る。

1. **参加者向け**: 既存の申込完了メッセージに **抽選日** の案内を追記する。
2. **会計向け**: 続けて 2 通目として、**振込方法・振込期限** を会計担当へ向けて送る。

### 背景・動機
- 現状、申込完了時に参加者グループへ送るのは `✅【〇〇大会】への参加申込が完了しました。` の 1 通のみ（[event-lifecycle-notify.ts](../../../apps/web/src/lib/event-lifecycle-notify.ts) の `entry_applied`）。
- 申込が通ると参加者は「**抽選はいつあるのか**（自分が出られるか、いつ分かるか）」を知りたい。今は別途口頭で連絡している。
- 会計担当は会で集めた参加費を主催者へ振り込む役割で、申込完了時に「**どう振り込むか・いつまでか**」を把握する必要がある。これも今は手動連絡で漏れやすい。
- これらの情報のうち **振込方法・期限・参加費は既に events に構造化済み**（`payment_method` / `payment_info` / `payment_deadline` / `fee_jpy`、[events.ts](../../../packages/shared/src/schema/events.ts)）。一方 **抽選日のカラムは存在しない**（新設が必要）。

### 位置付け
`event-lifecycle-notify` の延長。通知経路（紐付け済み参加者グループ）・push 基盤（[event-lifecycle-notify.ts](../../../apps/web/src/lib/event-lifecycle-notify.ts) の `pushTextToEventGroup`）・once-ever ログ基盤（`event_lifecycle_notifications`）をそのまま再利用する。**新しい通知先（会計ロール／会計専用チャネル）は作らない**。

---

## 2. ユーザーストーリー

### 対象ユーザー
- **管理者 / 副管理者**（`admin` / `vice_admin`、実質 1 名）: 抽選日・振込情報を入力し、申込状態を「申込済」にする。
- **大会参加者**: 紐付け済み LINE グループで申込完了＋抽選日の案内を受け取る。
- **会計担当**: 同じ参加者グループ内で、会計向けの 2 通目（振込方法・期限）を受け取る。専用の宛先・ロールは設けず、グループ内で「会計の方へ」と呼びかける形にする。

### 利用シナリオ

**シナリオ A: 抽選ありの大会で申込完了**
1. 管理者が大会編集画面で **抽選日**（例 1/20）と、必要なら振込方法・振込期限を入力しておく。
2. 出欠が固まり、主催者へ申込を提出。管理者が `/events/[id]` の進行管理で「申込済」にする。
3. Bot が参加者グループへ 2 通を push:
   - 参加者向け: `✅【〇〇大会】への参加申込が完了しました。\n抽選日は 1/20 です。`
   - 会計向け: `💴【〇〇大会】会計の方へ\n振込期限：1/25\n振込方法：◯◯銀行 …`

**シナリオ B: 抽選なしの大会（先着・全員参加）**
1. 抽選日を入力しない（`lottery_date` = NULL）。
2. 「申込済」にすると参加者向けは **従来どおり** `✅【〇〇大会】への参加申込が完了しました。`（抽選日の行は出ない）。
3. 会計向けの 2 通目は従来どおり送る（振込情報があれば載る）。

**シナリオ C: 振込情報が未入力 / 現地払い**
1. 振込方法・期限が未入力、または現地払いの大会でも、会計向けの 2 通目は **常に送る**（支払いタイプで出し分けない）。
2. 載せる項目が何も無ければ、`💴【〇〇大会】会計の方へ\n参加費の振込手続きをお願いします。振込方法・期限は大会ページでご確認ください。` の最小文面を送る。

**シナリオ D: 再トグル・cancelled**
1. 誤って未申込へ戻して再度申込済にしても **2 通とも再送しない**（種別ごとに once-ever）。
2. cancelled の大会では 2 通とも送らない（状態変更のみ記録、既存 `entry_applied` と対称）。

**シナリオ E: LINE グループ未紐付けの大会**
1. Bot が招待されていない大会では 2 通とも送らない（既存 `pushTextToEventGroup` が `skipped` を返す）。once-ever スロットは消費する（バックフィル防止、既存方針と一貫）。

---

## 3. 機能要件

### 3.1 画面仕様

#### 3.1.1 抽選日の入力（イベント新規作成・編集フォーム）
[event-form.tsx](../../../apps/web/src/components/events/event-form.tsx) に **抽選日**（`lotteryDate`）の `date` 入力を 1 つ追加する。配置は「大会申込締切 / 会内締切」付近が自然。`admin` / `vice_admin` のみが新規作成・編集できる（既存の権限と同じ）。

- 任意項目。未入力なら NULL（抽選なしを意味する）。
- 反映先: `/events/new`（作成）と `/events/[id]/edit`（編集）の両方。

#### 3.1.2 抽選日の参照表示（任意）
イベント詳細 [/events/[id]](../../../apps/web/src/app/(app)/events/[id]/page.tsx) に抽選日が設定されていれば表示する（参加費・締切と並べて）。会員にも参照のみ表示。

#### 3.1.3 申込完了トグル
進行管理セクションの「申込済」トグルは既存のまま（[EventLifecycleSection.tsx](../../../apps/web/src/components/events/EventLifecycleSection.tsx)）。挙動が「2 通送る」に変わるだけで UI は不変。確認モーダルの文言だけ「参加者向け・会計向けの通知が送られます」に更新してもよい（任意）。

### 3.2 ビジネスルール

#### 3.2.1 通知トリガー（申込完了時の 2 通）
| 種別 | 宛先 | 文面 | トリガー | 1 回限り保証 |
|---|---|---|---|---|
| 申込完了 (`entry_applied`) | 参加者グループ | `✅…申込が完了しました。`＋（抽選日があれば）`抽選日は M/D です。` | 未申込→申込済 の初回遷移（既存） | `(event_id,'entry_applied')` UNIQUE（既存） |
| 会計向け振込案内 (`entry_applied_treasurer`) **新規** | 同じ参加者グループ（2 通目） | `💴…会計の方へ`＋振込期限／振込方法／支払情報（あるものだけ） | 同上（同じ申込完了の初回遷移） | `(event_id,'entry_applied_treasurer')` UNIQUE（新規） |

- 2 通とも **同じトリガー**（`setEntryApplied(eventId, true)` の初回遷移）で送る。経路は同じ紐付け済み参加者グループ。

#### 3.2.2 参加者向け（`entry_applied`）文面の拡張
- `lottery_date` が **非 NULL** のとき、既存メッセージの末尾に改行＋ `抽選日は {M/D} です。` を追記。
- `lottery_date` が NULL のときは **従来どおり**（追記なし）。
- 日付整形は既存の `formatMMDD`（`M/D`、ゼロ埋めなし）を流用。

#### 3.2.3 会計向け（`entry_applied_treasurer`）文面
- ヘッダ: `💴【{title}】会計の方へ`
- 本文（値があるものだけを行として連結）:
  - `payment_deadline` があれば `振込期限：{M/D}`
  - `payment_method` があれば `振込方法：{payment_method}`
  - `payment_info` があれば `{payment_info}`（口座番号等の詳細。自由記述をそのまま）
- 上記いずれも空なら: `参加費の振込手続きをお願いします。振込方法・期限は大会ページでご確認ください。`
- **金額（`fee_jpy`）は載せない**（会計が集めた額を主催者へ振り込むため、1 人あたり額の併記はしない＝ユーザー確定）。
- **支払いタイプ（`payment_type`）では出し分けない**（事前払い／現地払い／未設定いずれでも常に送る＝ユーザー確定）。

> ※ 正確な文面・改行・絵文字はドラフトレビューで微調整可。

#### 3.2.4 通知の前提条件（既存 `entry_applied` と同一・2 通共通）
1. 当該 event に `event_line_broadcasts.status='linked'` かつ `line_group_id` がある（無ければ送信せず `skipped`）。
2. event が `cancelled` でない（cancelled なら 2 通とも claim せず送らない。状態変更のみ記録）。
3. 同じ `(event, 種別)` の `event_lifecycle_notifications` 行がまだ無い（once-ever）。

#### 3.2.5 重複防止（once-ever）
- `entry_applied` と `entry_applied_treasurer` は **別スロット**（種別ごとに `(event_id, type)` UNIQUE）。
- 申込完了の server action のトランザクション内で **両方を claim**（INSERT ON CONFLICT DO NOTHING）し、コミット後にそれぞれ push（既存 `claimLifecycleNotification` → `sendClaimedNotification` を 2 回）。
- 片方の push が失敗してももう片方には影響しない。失敗はログ `failed` で記録、best-effort（既存 §3.2.3 と同じ、自動再送なし）。

### 3.3 権限
- 抽選日・振込情報の入力、申込済トグル: `admin` / `vice_admin` のみ（既存と同じ）。
- 一般会員: 抽選日の参照のみ。

---

## 4. 技術設計

### 4.1 DB 設計

#### `events` テーブル変更（カラム追加）
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| lottery_date | date (mode:'string') | NULL | 抽選日。NULL=抽選なし。手動入力（AI 抽出は別 follow-up） |

- 既存 `payment_method` / `payment_info` / `payment_deadline` / `fee_jpy` は流用（変更なし）。

#### Enum 追加
- `event_lifecycle_notification_type`（[enums.ts](../../../packages/shared/src/schema/enums.ts)）に **`entry_applied_treasurer`** を追加（既存 8 種＋1）。

#### Migration
単一 migration（次番号は実装時に最新を再確認。**現状 main は 0020 まで（title-split #111 反映済）→ 0021**）。
- `events.lottery_date` 追加（nullable、既存行は NULL）。
- enum `event_lifecycle_notification_type` に値追加（`ALTER TYPE … ADD VALUE`）。
- 本番は `db:migrate`（journal ベース・非 interactive、[feedback](../../../.claude/memory) 参照）。
- **注意（並行作業・解消済）**: title-split は **PR #111 でマージ済**（migration 0020）。本 PR は現在の main から分岐すれば番号衝突なし（**0021**）。詳細は §5.3。

### 4.2 バックエンド設計

#### `apps/web/src/lib/event-lifecycle-notify.ts`（既存ファイルに追加）
- `LifecycleNotificationType` に `entry_applied_treasurer` が自動で増える（enum 由来）。
- `LifecycleMessageContext` に任意フィールドを追加:
  - `lotteryDateIso?: string | null`（参加者向け追記用）
  - `paymentMethod?: string | null` / `paymentInfo?: string | null`（会計向け用。期限は既存 `dateIso` を流用するか専用フィールドを足す）
- `buildLifecycleMessage` に 2 ケースを反映:
  - `entry_applied`: `lotteryDateIso` があれば末尾に `\n抽選日は {M/D} です。` を追記。
  - `entry_applied_treasurer`: §3.2.3 の文面を組み立て（空項目はスキップ、全空なら最小文面）。
  - exhaustiveness guard（`never`）に新ケースを追加（追加忘れはコンパイルエラー）。
- push / claim / finalize ヘルパーは既存をそのまま使う（変更なし）。

#### `apps/web/src/app/(app)/events/[id]/actions.ts` の `setEntryApplied` 拡張
- 状態 flip の `returning` に `lotteryDate` / `paymentMethod` / `paymentInfo` / `paymentDeadline` を追加。
- 同一トランザクション内で `claimLifecycleNotification(tx, eventId, 'entry_applied')` に加えて `claimLifecycleNotification(tx, eventId, 'entry_applied_treasurer')` も実行。
- コミット後、claim できたものについて `sendClaimedNotification` を **2 回**（participant / treasurer）。各 push は try/catch（best-effort、既存と同じ）。
- cancelled のときは 2 通とも claim しない（既存の早期 return を踏襲）。
- `setPaymentType` / `setPaymentPaid` は変更なし。

#### イベント新規作成・編集
- [events/new/page.tsx](../../../apps/web/src/app/(app)/events/new/page.tsx) と [events/[id]/edit/page.tsx](../../../apps/web/src/app/(app)/events/[id]/edit/page.tsx) の server action（insert/update events）で `lotteryDate` を保存。
- 編集画面の `defaultValues` に `lotteryDate` を渡す。

#### フォームスキーマ
- [form-schemas.ts](../../../apps/web/src/lib/form-schemas.ts) の `eventFormSchema` に `lotteryDate: optionalDateStr` を追加。`extractEventFormData` に `lotteryDate: formData.get('lotteryDate')` を追加。
- **注意（並行作業）**: title-split も form-schemas.ts を改修するため軽微な衝突可能性（§5.3）。

### 4.3 フロントエンド設計
- [event-form.tsx](../../../apps/web/src/components/events/event-form.tsx): `defaultValues.lotteryDate?: string | null` を追加し、`name="lotteryDate"` の `date` 入力を 1 つ描画（締切群の近く）。
- 進行管理 UI（`EventLifecycleSection`）の確認モーダル文言を必要なら更新（任意）。
- イベント詳細での抽選日表示（任意・3.1.2）。

### 4.4 環境変数 / 設定
- 追加なし（push 基盤・`LINE_NOTIFY_DRY_RUN` 等は既存を流用）。日次バッチ・systemd の追加もなし（トリガーは申込完了 server action のみ）。

---

## 5. 影響範囲

### 5.1 変更が必要な既存ファイル
- `packages/shared/src/schema/events.ts`: `lotteryDate` カラム追加。
- `packages/shared/src/schema/enums.ts`: `event_lifecycle_notification_type` に `entry_applied_treasurer` 追加。
- `packages/shared/drizzle/`: 新規 migration 1 本（lottery_date 追加＋enum 値追加）。
- `apps/web/src/lib/event-lifecycle-notify.ts`: `LifecycleMessageContext` 拡張、`buildLifecycleMessage` に 2 ケース反映。
- `apps/web/src/app/(app)/events/[id]/actions.ts`: `setEntryApplied` を 2 通送信に拡張。
- `apps/web/src/lib/form-schemas.ts`: `lotteryDate` のパース追加。
- `apps/web/src/components/events/event-form.tsx`: 抽選日入力欄追加。
- `apps/web/src/app/(app)/events/new/page.tsx` / `events/[id]/edit/page.tsx`: lottery_date 保存・defaultValues。
- 各 `*.test.ts(x)`: 文面生成・`setEntryApplied`・フォームスキーマ・E2E の更新／追加。

### 5.2 既存機能への影響
- **event-lifecycle-notify**: `entry_applied` の文面が「抽選日があれば追記」に変わる（抽選日 NULL の既存挙動は不変）。`payment_deadline` リマインド等の他種別は不変。
- **mail-tournament-import / 承認画面**: **本 PR では触らない**。AI 抽出での抽選日取得と承認画面での入力は、**別の AI 抽出 follow-up（本 PR の後）** に分離（§5.3）。承認直後の段階では `lottery_date` は NULL、管理者が編集画面で後から入力できる。
- **既存 events 行**: `lottery_date` は NULL で入る（抽選なし扱い）。副作用なし。
- 公開 HTTP エンドポイント・webhook の追加なし。systemd / cron の追加なし。

### 5.3 並行作業（tournament-title-split）— 解消済
`feature/tournament-title-split` は **PR #111 で main にマージ済**（merge `e664b3d`、migration 0020、本番反映済 2026-06-04）。AI 抽出（[schema.ts](../../../apps/mail-worker/src/classify/schema.ts) / [prompt.ts](../../../apps/mail-worker/src/classify/prompt.ts)）は既に `events[]` 配列形（PROMPT_VERSION 2.0.0）へ作り替え済みで main に載っている。**当初懸念したブロッキング衝突は解消**。

- **段取り**: 本機能は **現在の main（title-split 反映済）から分岐**して独立 PR 化。in-flight ブランチへの rebase は不要。migration は **0021**。
- **AI 抽出 follow-up（別 PR・本 PR の後）**: 抽選日の AI 自動抽出は、main に載った新 `EventUnitSchema`（[schema.ts](../../../apps/mail-worker/src/classify/schema.ts)）へ `lottery_date` を追加＋プロンプト調整する別 PR で対応。
- 共有ファイル（`events.ts` / migration journal / `form-schemas.ts`）は title-split が既に変更済み。本 PR はその上に**追加するだけ**（追加的・衝突なし）。

---

## 6. 設計判断の根拠

1. **会計向けを「新ロール・新経路」にせず参加者グループへ同送**（ユーザー確定）: 会計専用チャネルやロール追加は重い。同じグループに 2 通目として「会計の方へ」と呼びかければ、既存の push・紐付け基盤をそのまま使え、改修が最小。
2. **2 通に分ける（1 通統合にしない）**（ユーザー確定）: 参加者向けと会計向けで関心ごと・宛先が違うため、視覚的に分かれていた方が読みやすい。once-ever も種別ごとに独立管理できる。
3. **会計向けは支払いタイプで出し分けず常に送る**（ユーザー確定）: 「申込が済んだら会計に振込の段取りを知らせる」を確実にする。現地払い・未設定でも最小文面で送り、抜けを作らない。
4. **金額は載せない**（ユーザー確定）: 会計が振り込むのは集めた合計で、1 人あたり額（`fee_jpy`）の併記は計算式（チーム料金・割引）次第で誤解を生む。期日と振込方法だけを正確に伝える。
5. **抽選日は専用カラム（手動入力）を新設、AI 抽出は後回し**（ユーザー確定＋並行作業回避）: 文面差し込みには構造化された日付が要る。AI 抽出はスキーマを作り替え中の title-split と衝突するため、まず手動入力で機能を成立させ、AI 抽出は title-split マージ後の小 follow-up に分離。
6. **`entry_applied_treasurer` を独立 enum 種別にする**: 「申込完了」と「会計向け案内」を別スロットで once-ever 管理すると、再トグル・cron 再実行に強く、送信成否も種別ごとに監査できる（既存の「1 種別 = 1 スロット」設計と一貫）。
7. **トリガーは申込完了の server action のみ（日次バッチを足さない）**: ユーザー要望は「申込完了時に」。締切リマインドは既存 `payment_deadline_*` が担っており、本機能で新規バッチは不要。

---

## 7. 範囲外
- 抽選 **結果**（通過／落選など）の通知（ユーザー確定: 今回は抽選「日」の告知のみ）。
- 抽選日の **AI 自動抽出**（title-split マージ後の別 follow-up）。
- 会計専用ロール・会計専用 LINE グループ／チャネルの新設。
- 会計向け金額（合計・1 人あたり）の併記。
- 申込締切リマインドへの会計向け文面追加（本機能は申込完了時のみ。締切系は既存のまま）。
- 通知文面の編集 UI（固定テンプレ、将来拡張点）。

---

## 8. 開発・テスト戦略
- **ユニット（Vitest）**:
  - `buildLifecycleMessage('entry_applied', …)`: 抽選日あり／なしの両分岐。
  - `buildLifecycleMessage('entry_applied_treasurer', …)`: 期限のみ／方法のみ／詳細あり／全空（最小文面）の各パターン、金額を載せないこと。
  - `eventFormSchema` / `extractEventFormData` の `lotteryDate` パース（空→NULL、形式不正で弾く）。
- **統合（Vitest + 実 DB）**: `setEntryApplied(true)` の初回遷移で `entry_applied` と `entry_applied_treasurer` の 2 行が claim され、2 通 push されること（`LINE_NOTIFY_DRY_RUN=1`）。再トグルで再送されないこと（UNIQUE）。cancelled で 2 通とも送られないこと。未紐付けで `skipped`・スロット消費されること。
- **E2E（Playwright）**: `/events/[id]/edit` で抽選日を入力→保存、`/events/[id]` で申込済トグル（DRY_RUN 下で例外なく完了）。会員には抽選日が参照のみで表示されること。
- **デプロイ**: migration（`db:migrate`）→ apps/web リビルド（static cp 忘れ注意）→ DRY_RUN で 1 大会動作確認 → 本番。新規 systemd / cron なし。
