---
status: completed
---

# event-lifecycle-notify 要件定義書

## 1. 概要

### 目的
LINE Bot を「承認メールの転送役」から「大会ライフサイクルの管理・通知役」に拡張する。
管理者がアプリ側で**申込・支払いのステータスを変更**すると、紐付け済みの参加者 LINE グループへ自動で連絡が飛び、
**申込締切・支払締切・現地払いの当日持参**を Bot が能動的にリマインドする。

### 背景・動機
- 現状の `event-line-broadcast`（PR #65/#70、本番稼働中）は「1 大会 = 1 LINE グループ」を紐付け、承認メールをそのグループへ**一方向転送するだけ**。
- 「申込はもう済んだのか」「締切はいつか」「支払いは終わったか」は管理者が口頭・手動で都度連絡しており、見落とし・連絡漏れが起きる。
- イベント（[events.ts](packages/shared/src/schema/events.ts)）には締切・料金の**日付/金額カラム**（`entry_deadline` / `payment_deadline` / `fee_jpy`）はあるが、**「申込済か」「支払済か」という状態フィールドが無い**。状態を持たせ、状態変化と締切到来を Bot 通知に繋げる。

### 位置付け
P2「大会運営」＋ `event-line-broadcast` の延長。既存の紐付け基盤（`event_line_broadcasts.status='linked'`）と push 基盤（[line-broadcast.ts](apps/web/src/lib/line-broadcast.ts)）、日次バッチ基盤（[release-expired-broadcasts.ts](apps/web/scripts/release-expired-broadcasts.ts) + systemd timer）をすべて再利用する。

---

## 2. ユーザーストーリー

### 対象ユーザー
- **管理者 / 副管理者**（`admin` / `vice_admin`、実質 1 名）: アプリ側で申込・支払いのステータスを更新する。
- **大会参加者**: 紐付け済み LINE グループで通知を受け取る（Bot への発言は不要）。

### 利用シナリオ

**シナリオ A: 申込完了の通知（要望①）**
1. 出欠が集まり、管理者が主催者へ大会申込を提出する。
2. 管理者が `/events/[id]` の進行管理セクションで申込状態を「申込済」にする。
3. Bot が紐付け済み参加者グループへ「✅【〇〇大会】への参加申込が完了しました。」を push。
4. 誤って未申込に戻して再度申込済にしても**再通知はしない**（初回遷移のみ）。

**シナリオ B: 申込締切リマインド（要望②）**
1. `entry_deadline`（大会申込締切＝本締切）が設定された大会で、まだ申込済になっていない。
2. 締切 **3 日前 0:00**（事前）と**当日 0:00** に、未申込なら参加者グループへ催促が飛ぶ。
   - 3 日前: 「⏰【〇〇大会】の申込締切は MM/DD（あと 3 日）です。まだ申込が完了していません。」
   - 当日: 「⚠️【〇〇大会】の申込締切は本日 MM/DD です。まだ申込が完了していません。」
3. 既に申込済なら何も飛ばない。締切を過ぎても再通知しない（毎朝催促はしない）。

**シナリオ C: 事前支払い（要望③・事前払い）**
1. 支払いタイプが「事前払い」（会が締切までに振込）の大会。
2. 管理者が支払状態を「支払済」にすると「✅【〇〇大会】の参加費（〇〇円）の支払いが完了しました。」を push（初回のみ）。
3. `payment_deadline` の 3 日前 0:00・当日 0:00 に未払いなら催促（申込締切と同じ挙動）。

**シナリオ D: 現地払い（要望③・現地払い）**
1. 支払いタイプが「現地払い」（大会当日に参加者各自が支払う）の大会。
2. 会レベルの「支払済」フラグは持たない。代わりに**当日持参リマインド**を送る。
   - 大会日 3 日前 0:00:「💰【〇〇大会】は当日現地払いです。参加費 〇〇円 を MM/DD 当日お持ちください。」
   - 大会日当日 0:00:「💰 本日は【〇〇大会】です。現地払い 〇〇円 をお忘れなく。」

**シナリオ E: LINE グループ未紐付けの大会**
1. Bot が招待されていない（`status='linked'` でない）大会では、状態変更も締切到来も**通知は飛ばない**（状態の記録だけ行う）。
2. 紐付け前に申込済/支払済にした分は**バックフィルしない**（`event-line-broadcast` シナリオ C と同じ方針）。

---

## 3. 機能要件

### 3.1 画面仕様

#### 3.1.1 `/events/[id]` 進行管理セクション（既存画面に追加）
`admin` / `vice_admin` のみ操作可。`MobileShell` 内、LINE 配信セクション付近に配置。

- **申込状態**: バッジ表示（未申込 / 申込済）＋トグルボタン。「申込済」表示時は申込日時を併記。
- **支払いタイプ**: セレクト（事前払い / 現地払い / 未設定）。
- **支払状態**（支払いタイプ=事前払いのときのみ表示）: バッジ（未払 / 支払済）＋トグルボタン。支払済表示時は支払日時を併記。
- **締切・料金の参照表示**: `entry_deadline` / `payment_deadline` / `fee_jpy`（編集は既存のイベント編集フォーム側、ここでは表示のみ）。
- **通知履歴**（任意）: この大会で送ったライフサイクル通知の一覧（種別・日時・成否）。

一般会員（`member`）には状態バッジの**参照のみ**（トグルは出さない）。

#### 3.1.2 状態変更時の確認
- トグル操作時、紐付け済みグループがある場合は「グループに通知が送られます」とモーダルで確認してから実行。
- 紐付けが無い場合は確認なしで状態のみ更新（通知は飛ばない旨を小さく注記）。

### 3.2 ビジネスルール

#### 3.2.1 通知トリガー
| 種別 | トリガー | 文面プレフィックス | 1 回限り保証 |
|---|---|---|---|
| 申込完了 (`entry_applied`) | 未申込→申込済 の初回遷移（server action） | ✅ | `event_lifecycle_notifications` の UNIQUE |
| 申込締切・事前 (`entry_deadline_advance`) | `entry_deadline = 今日+3` かつ 未申込（日次 0:00） | ⏰ | 同上 |
| 申込締切・当日 (`entry_deadline_day`) | `entry_deadline = 今日` かつ 未申込（日次 0:00） | ⚠️ | 同上 |
| 事前支払完了 (`payment_paid`) | 事前払い かつ 未払→支払済 の初回遷移（server action） | ✅ | 同上 |
| 事前支払締切・事前 (`payment_deadline_advance`) | 事前払い かつ `payment_deadline = 今日+3` かつ 未払（日次 0:00） | ⏰ | 同上 |
| 事前支払締切・当日 (`payment_deadline_day`) | 事前払い かつ `payment_deadline = 今日` かつ 未払（日次 0:00） | ⚠️ | 同上 |
| 現地払い・事前 (`onsite_payment_advance`) | 現地払い かつ `event_date = 今日+3`（日次 0:00） | 💰 | 同上 |
| 現地払い・当日 (`onsite_payment_day`) | 現地払い かつ `event_date = 今日`（日次 0:00） | 💰 | 同上 |

- 事前リマインドのリードタイムは **3 日**（定数、env `EVENT_LIFECYCLE_REMINDER_LEAD_DAYS` で上書き可、既定 3）。
- 「今日」は **JST** で算出（サーバ TZ=Asia/Tokyo、[release-expired-broadcasts.ts](apps/web/scripts/release-expired-broadcasts.ts) と同じ方式で明示的に日付境界を扱う）。

#### 3.2.2 通知の前提条件（すべて AND）
1. 当該 event に `event_line_broadcasts.status='linked'` かつ `line_group_id` が存在する。
2. event が `cancelled` でない。
3. 締切系は対象の日付カラム（`entry_deadline` / `payment_deadline`）が非 NULL。現地払い系は `event_date`（必ず非 NULL）。
4. 同じ (event, 通知種別) の `event_lifecycle_notifications` 行がまだ無い（once-ever）。
- いずれか満たさない場合は送らない。状態変更そのものは常に記録する。

#### 3.2.3 重複防止（once-ever）
- 通知種別ごとに `event_lifecycle_notifications (event_id, type)` を UNIQUE。
- **完了通知**（申込/支払）: server action のトランザクション内で「状態更新（ガード付き）＋ログ INSERT ON CONFLICT DO NOTHING」。新規 INSERT できたときのみ push。再トグルしても UNIQUE で抑止。
- **締切/当日リマインド**: 日次バッチが条件一致 event を抽出 → ログ行を INSERT（claim）→ push → 成否をログ status に記録。cron 再実行時は UNIQUE で二重送信されない。
- 送信失敗（LINE 4xx/5xx）はログに `failed` で記録。日付条件は翌日には外れるため**自動再送はしない**（best-effort、稀。失敗は管理画面/ログで確認）。

#### 3.2.4 支払いタイプの扱い
- `payment_type`: `advance`（事前払い）/ `onsite`（現地払い）/ **NULL（未設定 = 支払い通知なし）**。
- `advance` のときのみ `payment_status`（未払/支払済）と `payment_deadline` 系リマインドが有効。
- `onsite` のときは支払状態を持たず、`event_date` 起点の当日持参リマインドのみ。
- `fee_jpy` が NULL のときは文面の金額部分を省略（「参加費」とだけ表示）。

#### 3.2.5 LINE 送信
- 既存 push 基盤を再利用。単一 text メッセージを `event_broadcast` 用チャネルから対象 group へ push。
- `LINE_NOTIFY_DRY_RUN=1` で実 API 呼び出しを回避（既存と同一フラグ）。
- 401（token 失効）: 該当チャネルを `disabled` 化し管理者へ system 通知（既存の回復ロジックに準拠）。その他 4xx（group 不正/kick 済み）: 当該 binding を `revoked` に倒し channel をプールへ返却（既存 broadcast と同じ扱い）。

### 3.3 権限
- 状態トグル（申込/支払/支払いタイプ変更）: `admin` / `vice_admin` のみ。
- 締切リマインド（日次バッチ）: システム実行（cron）。
- 一般会員: 状態の参照のみ。

---

## 4. 技術設計

### 4.1 API 設計

#### Server Actions（`apps/web/src/app/(app)/events/[id]/actions.ts` に追加）
- `setEntryApplied(eventId, applied: boolean)` — 申込状態をトグル。`applied=true` かつ未申込からの初回遷移時のみ完了通知。`applied=false` は通知なし（誤操作戻し用）。
- `setPaymentType(eventId, type: 'advance' | 'onsite' | null)` — 支払いタイプ設定。
- `setPaymentPaid(eventId, paid: boolean)` — 事前払いの支払状態トグル。`paid=true` 初回遷移時のみ完了通知。
- いずれも `requireAdminSession()`（既存）→ `db.transaction` 内で状態更新＋ログ INSERT → コミット後に fire-and-forget で push → `revalidatePath`。

#### バッチ（cron）
- HTTP API は新設しない。日次スクリプトが直接 DB を読み push する。

### 4.2 DB 設計

#### 新規 Enum（[enums.ts](packages/shared/src/schema/enums.ts) に追加）
- `event_entry_status`: `'not_applied' | 'applied'`
- `event_payment_type`: `'advance' | 'onsite'`（カラムは nullable）
- `event_payment_status`: `'unpaid' | 'paid'`
- `event_lifecycle_notification_type`: `'entry_applied' | 'entry_deadline_advance' | 'entry_deadline_day' | 'payment_paid' | 'payment_deadline_advance' | 'payment_deadline_day' | 'onsite_payment_advance' | 'onsite_payment_day'`
- `event_lifecycle_notification_status`: `'sent' | 'failed' | 'skipped'`

#### `events` テーブル変更（カラム追加）
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| entry_status | event_entry_status | NOT NULL DEFAULT 'not_applied' | 会としての申込状態 |
| entry_applied_at | timestamptz | NULL | 申込済にした日時（戻すと NULL） |
| payment_type | event_payment_type | NULL | 事前払い/現地払い、NULL=未設定 |
| payment_status | event_payment_status | NOT NULL DEFAULT 'unpaid' | 事前払い時のみ意味を持つ |
| payment_paid_at | timestamptz | NULL | 支払済にした日時（戻すと NULL） |

#### 新規テーブル `event_lifecycle_notifications`（once-ever ログ）
| カラム | 型 | 制約 |
|---|---|---|
| id | integer | pk identity |
| event_id | integer | NOT NULL fk → events.id ON DELETE CASCADE |
| type | event_lifecycle_notification_type | NOT NULL |
| status | event_lifecycle_notification_status | NOT NULL DEFAULT 'sent' |
| line_group_id | text | NULL（送信先記録・監査用） |
| error_message | text | NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |

UNIQUE `(event_id, type)`、INDEX `(event_id)`。

#### Migration
単一 migration: 5 enum 作成 → `events` に 5 カラム追加（既存行は default 適用）→ `event_lifecycle_notifications` 作成 → UNIQUE/INDEX。本番は `db:migrate`（[feedback](.claude/memory) 参照、`db:push` は dev only）。

### 4.3 フロントエンド設計
```
apps/web/src/app/(app)/events/[id]/page.tsx        # 進行管理セクションを追加
apps/web/src/components/events/
  EventLifecycleSection.tsx                         # 新規（申込/支払トグル＋バッジ）
  LifecycleStatusBadge.tsx                          # 新規（参照表示・会員にも出す）
```
状態管理は server action + `revalidatePath` でサーバ状態を正とする（ローカル state は楽観更新程度）。

### 4.4 バックエンド設計
```
apps/web/src/lib/
  event-lifecycle-notify.ts        # 新規。通知文面テンプレ + pushTextToEventGroup + 各通知の送信関数
apps/web/scripts/
  send-lifecycle-reminders.ts      # 新規。日次 0:00 バッチ（締切/当日リマインド）
apps/web/systemd/
  kagetra-lifecycle-reminders.service / .timer   # 新規（OnCalendar=*-*-* 00:00:00 JST）
```

- `pushTextToEventGroup(db, eventId, text, opts)`: `event_line_broadcasts.status='linked'` の binding と channel access token を引き、単一 text を push。**line-broadcast.ts は触らず**、この新規ファイル内に単一テキスト用の軽量 push（fetch 1 発＋最小限のエラー処理、`LINE_NOTIFY_DRY_RUN` 対応）を自前で持つ。push コードの共通化は mail-body-as-image ship 後に別途リファクタで回収（並行作業の衝突回避）。
- 文面テンプレ: §3.2.1 のプレフィックス＋ `{title}` / `{MM/DD}` / `{fee}` 差し込み。固定テンプレ（編集 UI なし）。
- `send-lifecycle-reminders.ts`: JST の今日を算出し、8 種別のうち日次対象 6 種（advance/day × entry/payment + onsite advance/day）を一括処理。各 event について前提条件（§3.2.2）を満たすものへ once-ever で送信。

### 4.5 環境変数 / 設定
- 新規シークレットなし。`EVENT_LIFECYCLE_REMINDER_LEAD_DAYS`（既定 3）を追加。`PUBLIC_BASE_URL` / `LINE_NOTIFY_DRY_RUN` / `DATABASE_URL` は既存を流用。
- systemd timer を 1 本追加（00:00 JST）。既存の cleanup timer（04:00）とは別ユニット。

---

## 5. 影響範囲

### 5.1 変更が必要な既存ファイル
- `packages/shared/src/schema/enums.ts`: 5 enum 追加。
- `packages/shared/src/schema/events.ts`: 5 カラム追加。
- `packages/shared/src/schema/event-lifecycle-notifications.ts`: 新規。
- `packages/shared/src/schema/relations.ts` / `index.ts`: 追加・re-export。
- `apps/web/src/app/(app)/events/[id]/actions.ts`: 3 server action 追加。
- `apps/web/src/app/(app)/events/[id]/page.tsx`: 進行管理セクション組み込み。
- `apps/web/src/lib/line-broadcast.ts`: **変更しない**（並行作業 mail-body-as-image との衝突回避。単一 text 用の push は新規ファイルに自前実装。push 共通化は ship 後リファクタ）。
- 新規: `EventLifecycleSection.tsx` / `LifecycleStatusBadge.tsx` / `event-lifecycle-notify.ts` / `send-lifecycle-reminders.ts` / systemd ユニット。
- Drizzle migration 1 本。

### 5.2 既存機能への影響
- `event-line-broadcast`: **影響なし**（共有ファイル line-broadcast.ts を触らない。並行作業 mail-body-as-image との衝突回避）。
- `events` 詳細画面: 進行管理セクションが増えるだけ。出欠・LINE 配信表示は不変。
- 既存の cleanup timer / mail-worker timer とは独立した新規 timer。衝突なし。
- 公開 HTTP エンドポイントの追加なし（webhook も増えない）。
- DB: 既存 `events` 行は default で `entry_status='not_applied'` / `payment_status='unpaid'` / `payment_type=NULL` となり、通知は紐付け済み大会のみ対象なので既存データへの副作用なし。

---

## 6. 設計判断の根拠

1. **状態を `events` に持たせる（別テーブルにしない）**: 締切・料金（`entry_deadline` / `payment_deadline` / `fee_jpy`）が既に events にあり、申込/支払状態も event 固有プロパティ。同居が自然でクエリも単純。
2. **会レベル単一フラグ（会員ごとにしない）**: 申込・事前支払いは「会が主催者に対して」行う 1 アクション。会員ごとの出欠（`eventAttendances`）とは別レイヤ。粒度を上げると UI/スキーマが過剰に複雑化。
3. **支払いを `payment_type` で分岐**: 事前払いと現地払いは性質が別物（締切 vs 当日持参）。構造化フィールドで分岐し、現地払いは「支払済」概念を持たず当日持参リマインドに割り切る。自由記述 `payment_method` 判定は不安定なので採用しない。
4. **once-ever を専用ログ＋ UNIQUE で実現**: 「完了通知は初回のみ」「締切当日 0:00 に 1 回」を、(event, type) UNIQUE の `event_lifecycle_notifications` で機械的に保証。cron 再実行・状態の再トグルにも強い。
5. **事前リマインド 3 日前＋当日 0:00**: ユーザー要望。締切超過後の毎朝催促はしない（しつこさ回避）。リードタイムは env で調整可能に。
6. **紐付け前はバックフィルしない**: `event-line-broadcast` シナリオ C と一貫。グループ未作成時の過去状態は口頭/別経路で共有。
7. **日次 00:00 JST の新規 timer**: ユーザー指定の「当日 0:00」に忠実。既存 cleanup（04:00）に相乗りせず責務分離。`release-expired-broadcasts.ts` の実績パターンを踏襲。
8. **固定テンプレ（編集 UI なし）**: 文面は定型で十分という回答。将来テンプレ編集が欲しくなれば拡張点として残す。
9. **push を自前実装（line-broadcast.ts を触らない）**: 並行作業 `mail-body-as-image` が同ファイルを改修中のため、共有編集を避けて衝突をゼロにする。単一 text 送信は mail 配信（バッチ/画像/添付）と要件が異なり軽量実装で足りる。push コードの共通化は両ブランチ ship 後の小さなリファクタに回す（2026-06-01 ユーザー合意）。

---

## 7. 範囲外
- 会内締切（`internal_deadline`）起点の出欠リマインド（今回は申込締切＝`entry_deadline` のみ）。
- 会員ごとの申込/支払い管理。
- 通知文面の編集 UI・テンプレカスタマイズ（v2 拡張点）。
- 締切超過後の継続催促（毎朝送信）。
- 現地払いの「実際に払ったか」の会員別トラッキング。
- 管理者専用グループへの出し分け（今回は参加者グループに集約）。

---

## 8. 開発・テスト戦略
- **ユニット（Vitest）**: 文面テンプレ生成（差し込み・金額 NULL・プレフィックス）、JST 今日算出、対象抽出条件（締切=今日/今日+3、cancelled 除外、payment_type 分岐）。
- **統合（Vitest + 実 DB）**: 状態トグル→ログ INSERT→ once-ever（再トグルで再送しない）、日次バッチが対象のみ抽出し UNIQUE で二重送信しないこと、未紐付け大会は送らないこと。LINE は `LINE_NOTIFY_DRY_RUN=1`。
- **E2E（Playwright）**: `/events/[id]` で各トグル操作と確認モーダル、会員には参照のみ表示されること。
- **デプロイ**: migration（`db:migrate`）→ apps/web リビルド（static cp 忘れ注意）→ systemd timer 配置・enable → DRY_RUN で 1 大会動作確認 → 本番。
