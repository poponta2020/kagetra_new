# 通知（LINE配信・Web Push）

> **責務:** 大会単位のLINEグループへのメール自動配信、申込/支払い等イベントライフサイクルのLINE通知、会員個人のLINEアカウント切替、管理者/副管理者向けWeb Push（メール受信バッジ）の仕様
> **関連画面:** `/settings/line-link`（LINEアカウント切替）、`/(app)/settings/notifications`（Web Push購読設定）、`/(app)/admin/line-channels`（Bot一覧）、`/(app)/admin/line-channels/[id]`（Bot詳細・手動紐付け）
> **主要実装:**
> - `apps/web/src/lib/line-broadcast.ts`（大会LINEグループへのメール配信本体）
> - `apps/web/src/lib/line-broadcast-guidelines.ts`（紐付け完了時の要綱ファイル送信・best-effort）
> - `apps/web/src/lib/event-related-mails.ts`（関連メール収集・要綱候補ローダー）
> - `apps/web/src/lib/line-webhook-handler.ts`（LINE Webhook: join/leave/招待コード）
> - `apps/web/src/lib/line-oauth.ts`（LINEアカウント切替の生OAuth2ヘルパー）
> - `apps/web/src/lib/event-lifecycle-notify.ts`（申込/支払い等の定型LINE通知）
> - `apps/web/src/lib/broadcast-lead-presets.ts`（配信冒頭見出しのプリセット文言）
> - `apps/web/src/lib/invite-code.ts`（6桁招待コードの生成・検証）
> - `apps/web/src/app/api/webhook/line/route.ts`（LINE Webhookエンドポイント）
> - `apps/web/src/app/api/line-broadcast/attachments/[token]/route.ts`（添付の署名URLダウンロード）
> - `apps/web/src/app/api/line-broadcast/images/[token]/route.ts`（本文画像のインメモリ配信）
> - `apps/web/src/app/api/line-link/callback/route.ts`（LINEアカウント切替コールバック）
> - `apps/web/src/app/settings/line-link/actions.ts` / `page.tsx`（LINEアカウント切替開始）
> - `apps/web/src/app/(app)/settings/notifications/actions.ts` / `NotificationSettings.tsx` / `page.tsx`（Web Push購読）
> - `apps/web/src/app/(app)/admin/line-channels/actions.ts` / `page.tsx` / `[id]/page.tsx`（Botプール管理画面）
> - `apps/web/public/sw.js`（Service Worker: push受信・バッジ・通知クリック）
> - `apps/web/scripts/send-lifecycle-reminders.ts`（日次リマインド送信バッチ）
> - `apps/web/scripts/release-expired-broadcasts.ts`（期限切れBot解放バッチ）

## 機能仕様

### 全体像

本ドメインは5つの独立した仕組みからなる。

1. **event-line-broadcast**: 大会ごとに1つのLINEグループへ、承認済みメール（要項・訂正等）を自動配信する。実体は「30 Bot のプール」方式で、1大会が1台の配信専用Botチャネルを一時的に占有する（個人ごとにBotを持つ設計ではない）。
2. **event-lifecycle-notify**: 大会の申込/支払い状態がトグルされた際、同じLINEグループへ定型文の通知を送る（申込完了、支払完了、締切リマインド等）。
3. **entry-overdue-alert**: 会内締切を過ぎても未申込のままの大会を、**管理者個人のLINE**へ毎朝1通のサマリで通知する。宛先も冪等性も 2. とは別系統（後述）。
4. **LINEアカウント連携**: 会員個人がどのLINEアカウントで一次ログインしているか（Auth.js）とは別に、既存セッションのまま連携先LINEアカウントを切り替える機能。
5. **mail-triage-badge (Web Push)**: 管理者/副管理者の端末に、新着メール到着をWeb Pushで通知し、未処理件数をPWAのアプリアイコンバッジに反映する。

### event-line-broadcast: Botプールと配信

`line_channels` テーブルは `purpose` で2種類に分かれる。`system_notify` はメールワーカーの管理者通知用の単一チャネル（詳細は `spec/mail-worker.md`）、`event_broadcast` が本ドメインの30 Botプールである。各チャネルは `status`（`available` / `assigned` / `active` / `disabled` / `system`）と `assignedEventId`（UNIQUE・NULL可）を持ち、1 Bot = 同時に1大会にしか割り当てられない。

**紐付けのライフサイクル**（`event_line_broadcasts.status`）:

```
invite_pending → joined_waiting_code → linked → revoked / released
```

- `invite_pending`: 管理者が `generateInviteCodeForEvent`（`apps/web/src/app/(app)/events/[id]/actions.ts`）を呼び、`available` なチャネルを1つ予約して6桁招待コード（`invite-code.ts`、TTL 30分・`crypto.randomInt` によるCSPRNG）を発行した直後の状態。同じイベントに既に `invite_pending`/`joined_waiting_code` の行があれば同じ行を再利用し、`linked` 中なら「現在配信中」としてエラーにする。招待コードのUNIQUE制約（`invite_code` の部分インデックス、有効なコードのみ対象）衝突時は3回までリトライする。
- `joined_waiting_code`: LINE Webhookの `join` イベントで、Botが招待されたグループの `groupId` を記録し、この状態に遷移する。返信で「30分以内に6桁コードを発言してください」と案内する。
- `linked`: グループ内で正しい6桁コードが発言されると、`event_line_broadcasts` を `linked` に、対応する `line_channels` を `status='active'` に更新する（同一トランザクション、CAS条件付きUPDATEで多重発言・レースを弾く）。招待コードはグループ紐付け専用のため、`user`/`room` からの発言や、別グループでの発言、既存 `lineGroupId` との不一致は拒否する。
- `revoked`: Botがグループから追い出された（`leave` イベント、`source.groupId` が現在の紐付け先と一致する場合のみ）、管理者による強制解放（`/admin/line-channels/[id]` の「強制解放」、`releaseChannel`）、または配信失敗時の自動リカバリ（後述）で遷移する。チャネルは `available` に戻り、招待コードはNULL化される。
- `released`: `apps/web/scripts/release-expired-broadcasts.ts`（日次バッチ）が、`linked` 状態のうち `COALESCE(extended_until, event_date + 30日)` を過ぎた行を自動解放する。運営が反省会等の連絡を見込んで `extendBroadcastLifetime` で猶予日を個別延長できる。同バッチは、招待コード期限切れのまま `invite_pending`/`joined_waiting_code` に取り残された異常行（コードNULLも含む）も `revoked` へ回収する。

**メール配信**（`broadcastMailToEvent`）は1メール = 1回の配信を原則とし、`event_broadcast_messages` の `UNIQUE(eventLineBroadcastId, mailMessageId)` で冪等性を担保する。メッセージは「冒頭見出し（任意）→本文→添付」の順で構築され、それぞれ役割別カウンタ（`sentLeadCount`/`sentTextCount`/`sentImageCount`/`fallbackLinkCount`）で送達数を記録する。

- 本文はA4 JPEGへ画像化して送る（画像化ロジック自体は `mail-body-image-render`、詳細は `spec/mail-worker.md`）。画像化が失敗・ページ超過・空・サイズ超過（10MB超）の場合はテキストfallback（`splitForLine` で分割）に切り替える。
- 添付は形式を問わず全て署名URLリンクのテキストメッセージに統一する（かつてのPDF/Word画像化分岐は廃止済み）。
- 冒頭見出し（`leadText`）は、進行中の大会に手動でメールを紐付ける操作（mail-inbox側の「既存イベントに紐付け」、`ExistingEventLinkSheet` — 詳細は `spec/mail-worker.md`）でのみ付与できる任意テキストで、`broadcast-lead-presets.ts` にプリセット文言（抽選結果・組合せ・オープンチャット案内等、最大200文字）を持つ。AI下書きの自動配信・訂正紐付けでは付与されない。
- LINE Messaging APIへは5メッセージ/バッチ・バッチ間1.5秒sleepで送信し、429（レート制限）は `Retry-After` に従い最大3回リトライする。1回のpushは30秒でタイムアウトする。
- 途中失敗時は `partial` として送達済み件数を保存し、再送（`manualBroadcast`、UI操作）は未送達分のみ再送する。ただし前回と今回で送信計画（添付レンダリング結果等）が縮小していれば全件再送に切り替える。
- 送信直前に紐付け（Bot/グループ）を再取得し、添付処理中に管理者が連携解除・再紐付けを行っていた場合は送信を中止する（`binding_changed`）。
- 既に `status='sent'` なメールは自動配信では再送しない（`force=true` のUI再配信操作のみ例外）。
- LINE APIが401を返した場合はチャネルを `disabled` にして紐付けを `revoked` にする（トークン失効）。401以外の4xx（レート制限除く）はチャネルを `available` に戻して紐付けのみ `revoked` にする（グループ不正・Bot追放等）。いずれも「送信開始時に保持していたチャネル/グループ」が現在も有効な場合に限り実行し、レース中の再紐付けを壊さない。

**要綱の紐付け完了時送信**（broadcast-guidelines-on-link）は、上記のメール配信とは独立した経路で、紐付け完了（`linked`）の瞬間に「大会案内メールの要綱ファイル」だけをグループへ送る追加機能。紐付け前に承認済みだった案内メール（＝多くの場合、要綱そのもの）は既存の自動配信ではバックフィルされないため、その穴を要綱に限って埋める。

- **選択**: 招待コード発行モーダル（`InviteCodeModal`）で、対象イベントの全関連メール（3経路union。詳細は `spec/events-attendance.md` の関連メール）の添付をメール別に列挙し、管理者が要綱にあたるファイルを複数選択する。選択は `setGuidelineAttachments`（admin/vice_admin・replace意味論・候補外の添付idは拒否）で `event_broadcast_guideline_attachments`（`event_line_broadcasts` への join、両FK ON DELETE CASCADE）に即時保存する。`event_line_broadcasts` は1大会1行で、招待コード再発行は同一行UPDATEなので選択は再発行をまたいで保持される。
- **送信トリガー**: `event_line_broadcasts` が `linked` に遷移した時（Webhookの招待コード照合成功、および管理者の手動紐付け `manualLinkGroup`）に、選択済み添付があれば送信する。送信は紐付け成立**後**（reply枠は消費済み）に走るpushで、`sendGuidelinesOnLink`（`apps/web/src/lib/line-broadcast-guidelines.ts`）が担う。同モジュールはWebhook（nodejs runtime）から呼ばれるため `line-broadcast.ts`（本文画像化の重依存）を意図的にimportせず、署名URLの `getOrCreateShareToken` だけ再利用した自己完結の最小pushを持つ（5通/バッチ・1.5秒間隔・429リトライ・30秒タイムアウト・`LINE_NOTIFY_DRY_RUN` 尊重）。
- **送信内容**: 選択ファイルごとに「📎【大会要綱】ファイル名 + 署名URL（`/api/line-broadcast/attachments/[token]`、60日）」のテキスト1通。既存の添付配信と同じ署名URL方式で、新規の公開エンドポイントは作らない。
- **best-effort**: 送信の成否は紐付け（`linked`）に影響しない（`sendGuidelinesOnLink` はthrowしない）。全通配信できたときだけ `event_line_broadcasts.guidelines_sent_at` を更新する。監査に `event_broadcast_messages`（メール単位・role別カウンタ）は流用しない（full-mail配信と衝突するため独立）。
- **再送・再連携**: `linked` 状態で `resendGuidelines`（events画面の「要綱を再送」）を押すと選択済み要綱を同形式で再送できる（best-effortの取りこぼし復旧）。連携解除→再発行→再紐付けでは、選択は保持され `guidelines_sent_at` はリセットされて新グループへ改めて送信される。
- **未選択時**: 紐付け完了時の要綱送信は行われない（既存挙動と完全に同じ）。多ファイル選択（>5）でWebhook応答が遅れLINEが再送しても、CASが再linkを弾くので二重送信にはならない。

### event-lifecycle-notify: 定型LINE通知

大会の状態遷移に応じて、`linked` なLINEグループへ固定テンプレートのテキストを1通push する（`pushTextToEventGroup` / `event-lifecycle-notify.ts`）。通知種別は9種（`entry_applied`、`entry_applied_treasurer`、`entry_deadline_advance`、`entry_deadline_day`、`payment_paid`、`payment_deadline_advance`、`payment_deadline_day`、`onsite_payment_advance`、`onsite_payment_day`）で、`event_lifecycle_notifications` の `UNIQUE(eventId, type)` により **同一イベント×種別は生涯一度きり** しか送らない。

- **申込完了**: `setEntryApplied(eventId, true)`（`events/[id]/actions.ts`）が `entryStatus` を `not_applied → applied` に一度だけ遷移させ、同一トランザクション内で `entry_applied`（参加者向け）と `entry_applied_treasurer`（会計向け）の2スロットを `claimLifecycleNotification` で確保する（once-everなので再トグルや同時実行では二重取得されない）。コミット後、それぞれ独立した try/catch でpushする（best-effort、push失敗でも状態変更は巻き戻さない）。参加者向けは抽選日が設定されていれば1行追記する。会計向けは振込期限・振込方法・振込先詳細のうち設定されている行だけを連結し、全て未設定なら最小文面になる。大会が `cancelled` の場合はいずれも送らない。
- **支払完了**: `setPaymentPaid(eventId, true)` が `paymentType='advance'` かつ `paymentStatus='unpaid'` のときだけ `paid` に遷移させ、`payment_paid` を一度だけclaimしてpushする。
- **リマインド（日次バッチ）**: `apps/web/scripts/send-lifecycle-reminders.ts` が毎日（本番はsystemdタイマー、JST 00:00）実行し、以下の条件に合致する `linked` かつ非 `cancelled` の大会を対象に、`claimLifecycleNotification` 相当の `sendReminderNotification`（claim + push + finalize を1呼び出しに統合）で送る。
  - 申込締切: `entryStatus='not_applied'` かつ `entryDeadline` が「今日+リード日数」（事前）/「今日」（当日）
  - 事前払い締切: `paymentType='advance'` かつ `paymentStatus='unpaid'` かつ `paymentDeadline` が同様の条件
  - 現地払い: `paymentType='onsite'` かつ `eventDate` が同様の条件
  - リード日数は既定3日（`EVENT_LIFECYCLE_REMINDER_LEAD_DAYS` env で上書き可）。日付判定はすべてJSTの `YYYY-MM-DD` 文字列比較（`jstTodayIso`）で行う。
  - 送信失敗は再試行しない（翌日には日付条件が外れるため、ベストエフォート設計）。`--dry-run` で候補一覧のみ確認できる。
- push失敗時のリカバリ（401→チャネル`disabled`+紐付け`revoked`、その他4xx→紐付けのみ`revoked`）はevent-line-broadcastと同じパターンを個別実装している（`event-lifecycle-notify.ts` は `line-broadcast.ts` を意図的にimportしない自己完結モジュール。将来的な統合はrequirements §6.9で「マージ後リファクタ」として据え置かれている）。

### entry-overdue-alert: 管理者向け毎日アラート

会内締切を過ぎても会として主催者へ申し込んでいない大会を、`line_channels` の `status='system'` 行に設定された管理者LINE userId 宛に **1日1回・1通のサマリ**でpushする（`apps/web/src/lib/entry-overdue-alert.ts`）。event-lifecycle-notify とは3軸すべてが異なるため、意図的に別モジュール・別バッチ・別タイマーにしている。

| 軸 | event-lifecycle-notify | entry-overdue-alert |
|---|---|---|
| 宛先 | 大会LINEグループ（`linked` 必須） | 管理者個人（system_notify Bot） |
| 冪等性 | once-ever（`UNIQUE(eventId, type)`） | **なし**（毎日繰り返すことが要件） |
| 配信時刻 | JST 00:00 | JST 07:00 |

**対象条件**（JST基準・すべて満たす大会）: `status != 'cancelled'` ／ `eventDate >= 今日` ／ `entryStatus = 'not_applied'` ／ 基準締切 `COALESCE(internalDeadline, entryDeadline)` が非NULLかつ今日より前。基準締切が今日と等しい（締切当日）は対象外で、超過した翌日から鳴り始める。会内締切は手入力のため未入力が起こりうるので、未入力なら大会申込締切で代替する（「未入力だから黙る」では締切を入れ忘れた大会＝最も危ない大会を検知できないため）。

**`event_line_broadcasts` へは一切JOINしない。** LINEグループが未紐付けの大会も対象に含める設計で、これが event-lifecycle-notify のリマインドとの決定的な違い。既存リマインドは `linked` なグループを前提にしているため、グループ未紐付けの大会には1通も飛ばない — 申込漏れが最も起きやすいのはまさにその層である。

**文面**: 基準締切の超過日数が大きい順（tie-break は開催日昇順→id昇順の安定ソート）に上位5件を明細で出し、超過分は「他 N 件」に畳む。各明細は大会名・会内締切と超過日数（`entryDeadline` 代替時はその旨を併記）・大会申込締切と残日数・出欠「参加」人数・`{PUBLIC_BASE_URL}/events/{id}` の絶対URL。対象0件の日は送信しない。

**失敗ポリシーの適用順序**（順序で挙動が変わるため固定）: ①対象抽出 → 0件なら何もせず正常終了 → ②system_notifyチャネル解決（行なし／`notification_line_user_id` 未設定なら**警告してスキップ・正常終了**）→ ③`PUBLIC_BASE_URL` 解決（未設定は**例外で停止**）→ ④文面 → ⑤push。②を③より前に置くことで、system_notify を構成していない環境で毎朝 exit 1 が出るのを防ぐ。push失敗はリトライしない（429 の `Retry-After` 追従を除く。翌朝また対象になる）。

**通知ログ表を持たない。** `event_lifecycle_notifications` への claim も INSERT も行わないため、同じ日に2回実行すれば同じ内容が再送される。運用上はタイマーが1日1回起動する。

アラートの停止条件は、進行管理から `entryStatus` を `applied`（申込済）にするか `not_applying`（申込なし＝申込者がいないため見送り）にすること。`not_applying` は既存の申込締切リマインドの対象からも自動的に外れる（リマインドの `entryStatus='not_applied'` 条件をそのまま利用するため、この条件を「`applied` 以外」に緩めてはならない）。進行管理の状態遷移そのものは [spec/events-attendance.md](events-attendance.md) が正典。

デプロイ・運用手順は [deploy/entry-overdue-alert.md](../deploy/entry-overdue-alert.md)。

### LINE Webhook

`POST /api/webhook/line`（`runtime='nodejs'` 固定。署名検証がHMAC-SHA256で`node:crypto`必須のためEdgeランタイム不可）が全30+1 Botの受け口を兼ねる。payloadの `destination`（LINE Bot のユーザーID、Basic IDとは別値。`line_channels.webhookDestinationId` に保持）でチャネルを特定し、そのチャネル固有の `channelSecret` で `X-Line-Signature` を検証する。未知の `destination` は404、署名不一致は401、以降は常に200を返す（LINEの再送を避けるため、個々のイベント処理失敗は握りつぶしログのみ）。

処理するイベントタイプ:
- `join`: 上述の `joined_waiting_code` 遷移。
- `leave`: Bot自身がグループから外れた場合のみ（`memberLeft`＝一般メンバー退出は無視）。`source.groupId` が現在の紐付け先と一致する場合のみ `revoked` にする。
- `message`（テキストが `/^\d{6}$/` に一致）: 招待コード照合→`linked` 遷移。不一致・形式不正・グループ以外からの発言はすべて同一の「❌ 招待コードが無効です」を返す（攻撃者に失敗理由を教えない設計）。
- その他（`follow`、`memberJoined` 等）は no-op。

### LINEアカウント切替（account-switch）

一次ログインはAuth.js v5のLINE providerが担う（`spec/auth-admin.md`）。本フローは、既にログイン中の会員が機種変更等で別のLINEアカウントに切り替えたいときに使う二次的な生OAuth2フローで、Auth.jsのセッションは発行しない。

1. `/settings/line-link` の「別のLINEに切り替える」ボタン → Server Action `startLineLink`（`settings/line-link/actions.ts`）が CSRF `state` を発行し、`state` と現在の `session.user.id` をペアでHMAC署名した値をhttpOnly Cookie（`line_link_state`、5分TTL）に保存してLINE認可URLへリダイレクトする。
2. コールバック `GET /api/line-link/callback` が、Cookie署名の検証・`state` 一致・**コールバック時のセッションが開始時と同一ユーザーであること**（別タブでの再ログインによる誤紐付け防止）を確認したうえで、認可コードをアクセストークンに交換しLINEプロフィールを取得する。
3. 取得した `lineUserId` が既に別ユーザーに紐付いていればコンフリクト（`?error=conflict`）。競合はDB UNIQUE違反（`23505`）のキャッチでも検出する。
4. `users.lineUserId` / `lineLinkedAt` / `lineLinkedMethod='account_switch'` を更新し、`unstable_update()` でJWTセッションも即時更新する（失敗しても次回リクエストのDB再読込で追いつく）。
5. アクセストークン自体は一度も永続化しない。
6. `LINE_OAUTH_TEST_MODE=true`（本番以外限定・`NODE_ENV`で二重ガード）でLINEとの実HTTP往復を省略し、Playwright/Vitest向けに決定的なfixtureプロフィールを返す。

### Web Push（mail-triage-badge）

管理者/副管理者が新着メールをPWAで即座に把握できるようにする通知観点の機構。`push_subscriptions`（`endpoint` UNIQUE。同一端末の再購読はupsert、1ユーザー複数端末は許容）に購読情報を保存し、実際の配信（新着メール検知→web-push送信）は `apps/mail-worker/src/notify/web-push.ts` が担う（詳細は `spec/mail-worker.md`）。

- `/(app)/settings/notifications` は `admin`/`vice_admin` のみアクセス可（それ以外は`/403`）。
- クライアント（`NotificationSettings.tsx`）はブラウザのPush API対応・VAPID公開鍵（`NEXT_PUBLIC_VAPID_PUBLIC_KEY`、未設定なら案内表示のみ）・通知許可状態を順に確認し、`pushManager.subscribe()` の結果を `savePushSubscription` Server Actionへ渡す。
- 解除時は「ブラウザ側 `unsubscribe()` → サーバ側 `deletePushSubscription`」の順で行う。逆順だとDB削除後にブラウザ側解除が失敗した場合、購読が有効に見えるのにサーバに配信先が無い不整合が生じるため。
- Service Worker（`public/sw.js`、素のJS・ビルド対象外）が `push` イベントで通知を表示し、ペイロードの `badge` フィールドがあれば `navigator.setAppBadge()` / `clearAppBadge()`（iOS/iPadOS 16.4+のホーム画面PWA対応）でアプリアイコンのバッジを更新する。`notificationclick` は既存タブがあればフォーカス、無ければ通知の `url`（既定 `/admin/mail-inbox`）を新規に開く。

## 画面

- **`/settings/line-link`**: 現在連携中のLINEアカウントID（末尾6文字以外マスク表示）と、切替導線のみのシンプルな画面。エラーコード（`missing_env` / `state_mismatch` / `denied` / `conflict` / `oauth_failed`）ごとに日本語メッセージを出し分ける。
- **`/(app)/settings/notifications`**: Web Push購読のON/OFFのみ。状態は `loading` / `unsupported`（Push API非対応）/ `no-key`（VAPID未設定）/ `denied`（OS拒否）/ `subscribed` / `unsubscribed` の6状態。
- **`/(app)/admin/line-channels`**: 30 Botの一覧（`purpose='event_broadcast'` のみ、system_notify行は非表示）。ステータス別フィルタ（空き/招待コード発行中/配信中/無効化）、`active` が全体の25/30以上になると枯渇警告バナーを表示する。各行に紐付け先大会・自動解放までの残日数を表示する。
- **`/(app)/admin/line-channels/[id]`**: 個別Botの詳細。現在の紐付け先、紐付け履歴（直近20件）、操作ボタン（強制解放/無効化/有効化/手動紐付けモーダル `ManualLinkModal`）。手動紐付けは、Webhookが `join`/コード発言を受け取れなかった場合の運用フォールバックで、対象イベント・LINEグループIDを直接入力してその場で `linked` にする。

大会単体の配信状況（配信履歴テーブル・招待コード発行UI・現在の紐付け状態表示等）は `/events/[id]` ページの一部（`LineBroadcastSection` / `BroadcastHistoryTable` コンポーネント）として表示されるが、これは大会本体の画面構成に属するため詳細は `spec/events-attendance.md` を参照。

## フロー

### 大会LINEグループの新規紐付け〜配信

1. 管理者が `/events/[id]` から招待コード発行を実行 → `generateInviteCodeForEvent` がBotプールから1台予約し6桁コード（30分TTL）を発行。同時に、招待コードモーダルで関連メール添付から「要綱として送信するファイル」を選択できる（任意・`setGuidelineAttachments` で即時保存）。
2. 運営がLINEグループを作成しBotを友だち追加・招待 → Webhook `join` を受けて `joined_waiting_code`。
3. グループ内で6桁コードを発言 → Webhook `message` が照合し `linked`。選択済み要綱があれば、この直後に `sendGuidelinesOnLink` が要綱ファイルをグループへpushする（best-effort）。
4. 以降、承認済みメール（AI下書き承認・訂正紐付け等、詳細は `spec/mail-worker.md`）のたびに `broadcastMailToEvent` が自動配信される。管理者は必要に応じて `/events/[id]` から手動再配信（`manualBroadcast`）や要綱の再送（`resendGuidelines`）もできる。
5. 大会終了30日後（またはoperatorが延長した日付）を過ぎると日次バッチが自動解放し、Botはプールに戻る。

### イベントライフサイクル通知

1. 管理者が申込状態を「申込済」にトグル → `setEntryApplied` が状態遷移とonce-ever claimを同一トランザクションで行い、コミット後に参加者向け＋会計向けの2通をLINEグループへpush。
2. 事前払いの支払いを「支払済」にトグル → `setPaymentPaid` が同様に一度だけ完了通知をpush。
3. 締切が近づく/当日になると、日次バッチ（`send-lifecycle-reminders.ts`）が対象イベントを走査してリマインドをpush。

### Web Push購読

1. 管理者/副管理者が `/settings/notifications` で通知を有効化 → ブラウザ通知許可 → Service Worker経由でPush購読を作成 → `savePushSubscription` がDBへupsert。
2. 新着メール受信時、mail-worker側が `push_subscriptions` を読んで各端末へペイロード（title/body/url/badge）を送信（`spec/mail-worker.md`）。
3. Service Workerが通知表示とアプリバッジ更新を行う。

## API（Server Actions / route handlers）

| 関数・エンドポイント | 種別 | 認可 | 概要 |
|---|---|---|---|
| `startLineLink()` | Server Action | ログイン必須 | LINEアカウント切替の開始。CSRF state発行＋LINE認可URLへリダイレクト |
| `GET /api/line-link/callback` | route handler | ログイン必須（セッション一致検証あり） | LINEアカウント切替の完了処理 |
| `POST /api/webhook/line` | route handler | LINE署名検証（`X-Line-Signature`） | Bot群共通のWebhook受け口。join/leave/招待コードを処理 |
| `GET /api/line-broadcast/attachments/[token]` | route handler | 署名トークン（発行時に検証済み・失効付き） | 添付ファイルの署名URLダウンロード |
| `GET /api/line-broadcast/images/[token]` | route handler | 署名トークン（インメモリキャッシュ） | 本文画像JPEGのLINE向け配信 |
| `savePushSubscription(input)` | Server Action | admin/vice_admin | Web Push購読の保存（endpoint UNIQUEでupsert） |
| `deletePushSubscription(endpoint)` | Server Action | admin/vice_admin | Web Push購読の削除 |
| `releaseChannel(channelId, expectedEventId?)` | Server Action | admin/vice_admin | Botの強制解放（紐付け`revoked`＋チャネル`available`） |
| `disableChannel(channelId)` | Server Action | admin/vice_admin | Botの無効化（紐付け中は拒否） |
| `enableChannel(channelId)` | Server Action | admin/vice_admin | 無効化されたBotをプールに復帰 |
| `manualLinkGroup(input)` | Server Action | admin/vice_admin | 招待コードフローを介さない手動紐付け（運用フォールバック）。紐付け完了後に選択済み要綱を送信 |
| `setGuidelineAttachments(eventId, attachmentIds)` | Server Action | admin/vice_admin | 紐付け完了時に送る「要綱」添付の選択保存（replace意味論・候補外id拒否） |
| `resendGuidelines(eventId)` | Server Action | admin/vice_admin | `linked` 状態で選択済み要綱を再送（best-effort取りこぼし復旧） |
| `broadcastMailToEvent(db, args, options)` | ライブラリ関数 | 呼び出し元（承認フロー/manualBroadcast）が認可を担保 | メール本文＋添付をLINEグループへ配信する本体処理 |
| `sendGuidelinesOnLink(db, args, options)` | ライブラリ関数 | 呼び出し元（Webhook/manualLinkGroup/resendGuidelines）が認可を担保 | 選択済み要綱を署名URLリンクでpush（best-effort・throwしない） |
| `pushTextToEventGroup(db, eventId, text, opts)` | ライブラリ関数 | 同上 | 定型テキスト1通のpush（lifecycle通知の下請け） |
| `claimLifecycleNotification` / `finalizeLifecycleNotification` / `sendClaimedNotification` / `sendReminderNotification` | ライブラリ関数 | 同上 | once-ever通知ログのclaim/finalize/送信ヘルパー群 |
| `setEntryNotApplying(eventId)` | Server Action | admin/vice_admin | 「申し込まない」への遷移。**LINE通知は一切送らない**（毎日アラートの停止条件かつ `/events` 一覧の除外条件。詳細は `spec/events-attendance.md`） |
| `collectOverdueEntries` / `buildOverdueAlertMessage` / `loadSystemChannel` / `pushSystemText` / `sendEntryOverdueAlert` | ライブラリ関数 | 呼び出し元（日次バッチ）が実行環境を担保 | 締切超過アラートの抽出・文面組立・system_notifyチャネル解決・push（`entry-overdue-alert.ts`） |
| `apps/web/scripts/send-entry-overdue-alert.ts` | バッチ（systemd timer） | ホスト実行（`kagetra` ユーザー） | 毎朝 JST 07:00 に `sendEntryOverdueAlert` を1回実行。`--dry-run` は候補と文面の表示のみ |

`generateInviteCodeForEvent` / `revokeBroadcast` / `extendBroadcastLifetime` / `manualBroadcast` / `setEntryApplied` / `setPaymentType` / `setPaymentPaid` は `apps/web/src/app/(app)/events/[id]/actions.ts` に実装されているが、大会画面のServer Actionとしての位置づけは `spec/events-attendance.md` の正典とし、本ファイルではLINE通知観点の挙動のみを機能仕様節で記述した。
