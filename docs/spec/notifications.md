# 通知（LINE配信・Web Push）

> **責務:** 大会単位のLINEグループへのメール自動配信、申込/支払い等イベントライフサイクルのLINE通知、会員個人のLINEアカウント切替、管理者/副管理者向けWeb Push（メール受信バッジ）の仕様
> **関連画面:** `/settings/line-link`（LINEアカウント切替）、`/(app)/settings/notifications`（Web Push購読設定）、`/(app)/admin/line-channels`（Bot一覧）、`/(app)/admin/line-channels/[id]`（Bot詳細・手動紐付け）
> **主要実装:**
> - `apps/web/src/lib/line-broadcast.ts`（大会LINEグループへのメール配信本体）
> - `apps/web/src/lib/line-broadcast-guidelines.ts`（紐付け完了時の要綱ファイル送信・best-effort）
> - `apps/web/src/lib/event-related-mails.ts`（関連メール収集・要綱候補ローダー）
> - `apps/web/src/lib/line-webhook-handler.ts`（LINE Webhook: join/leave/招待コード）
> - `apps/web/src/lib/line-oauth.ts`（LINEアカウント切替の生OAuth2ヘルパー）
> - `apps/web/src/lib/event-lifecycle-notify.ts`（申込/支払い等の定型LINE通知・push transport）
> - `apps/web/src/lib/line-mention.ts`（textV2 メンションメッセージの組み立て・pure）
> - `apps/web/src/lib/line-mention-targets.ts`（`@会計` / `@管理者` の対象解決）
> - `apps/web/src/lib/entry-headcount.ts`（紐付け案内③の申込人数。実人数・ゲスト込み）
> - `apps/web/src/lib/payment-notice.ts` / `apps/web/src/lib/events/payment-notice-context.ts`（名簿確定後の振込連絡）
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

本ドメインは7つの独立した仕組みからなる。

1. **event-line-broadcast**: 申込グループ（`entry_groups`。同じ案内メール×同じ申込締切でまとまる大会単位。複数日開催は日ごとに `events` 行が分かれても1グループ）ごとに1つのLINEグループへ、承認済みメール（要項・訂正等）を自動配信する。実体は「30 Bot のプール」方式で、1申込グループが1台の配信専用Botチャネルを一時的に占有する（個人ごとにBotを持つ設計ではない）。紐付け・配信・要綱・自動解放の操作はグループ単位に作用し、グループ内のどの日の詳細画面（`/events/[id]`）から行っても同一の紐付けに作用する。
1b. **event-grade-group-broadcast**: 級別（A〜E）のLINEグループへ、新規登録された大会の**概要**を配信する。1. とは読み手が違う（1. は「その大会の申込者」、こちらは「会員全体」）。目的は詳細伝達ではなく**存在の周知**で、案内を見落として申込機会を失う導線の穴を埋める。紐付けは大会単位ではなく**常設**。
2. **event-lifecycle-notify**: 大会の申込/支払い状態がトグルされた際、同じLINEグループへ定型文の通知を送る（申込完了、支払完了、締切リマインド等）。
3. **entry-overdue-alert**: 会内締切を過ぎても未申込のままの大会を、**管理者個人のLINE**へ毎朝1通のサマリで通知する。宛先も冪等性も 2. とは別系統（後述）。
4. **LINEアカウント連携**: 会員個人がどのLINEアカウントで一次ログインしているか（Auth.js）とは別に、既存セッションのまま連携先LINEアカウントを切り替える機能。
4b. **openchat-broadcast**: 大会当日用の LINE オープンチャット招待 URL を、メールから抽出して 1. と同じ大会別 Bot グループへ Flex Message で配信する。**トリガーは人間**（管理者がメールを大会に紐付ける既存操作の延長）で、抽出は決定的（AI なし）。詳細は下記。
5. **mail-triage-badge (Web Push)**: 管理者/副管理者の端末に、新着メール到着をWeb Pushで通知し、未処理件数をPWAのアプリアイコンバッジに反映する。
6. **payment-notice**: 確定名簿が出た申込グループの会計へ、振込金額を 1. と同じ大会別 Bot グループへ手動で連絡する。宛先は 2. と同じグループだが、`@会計` メンションを使い、金額を扱う唯一の通知である点が違う。

メンションを使う仕組み（1. の紐付け案内・2. の会計向け・6.）は共通のメンション基盤に載る（後述）。

### event-line-broadcast: Botプールと配信

`line_channels` テーブルは `purpose` で2種類に分かれる。`system_notify` はメールワーカーの管理者通知用の単一チャネル（詳細は `spec/mail-worker.md`）、`event_broadcast` が本ドメインの30 Botプールである。各チャネルは `status`（`available` / `assigned` / `active` / `disabled` / `system`）と `assignedEntryGroupId`（UNIQUE・NULL可、FK→`entry_groups.id`）を持ち、1 Bot = 同時に1申込グループにしか割り当てられない。

**紐付けのライフサイクル**（`event_line_broadcasts.status`）:

```
invite_pending → joined_waiting_code → linked → revoked / released
```

- `invite_pending`: 管理者が `generateInviteCodeForEvent`（`apps/web/src/app/(app)/events/[id]/actions.ts`。シグネチャは `eventId` を受けるが、内部でその日が属する `entry_group_id` へ解決してからグループ基準で動く）を呼び、`available` なチャネルを1つ予約して6桁招待コード（`invite-code.ts`、TTL 30分・`crypto.randomInt` によるCSPRNG）を発行した直後の状態。同じ申込グループに既に `invite_pending`/`joined_waiting_code` の行があれば同じ行を再利用し（`entry_group_id` UNIQUE）、`linked` 中なら「現在配信中」としてエラーにする。招待コードのUNIQUE制約（`invite_code` の部分インデックス、有効なコードのみ対象）衝突時は3回までリトライする。
- `joined_waiting_code`: LINE Webhookの `join` イベントで、Botが招待されたグループの `groupId` を記録し、この状態に遷移する。**返信はしない**（replyTokenを消費せず状態の記録だけを行う）。管理者が招待コードを手元に持っている運用なので、グループ全員に見える案内を出す意味が無い。級別グループ用の `join` 案内は従来どおり残る。
- `linked`: グループ内で正しい6桁コードが発言されると、`event_line_broadcasts` を `linked` に、対応する `line_channels` を `status='active'` に更新する（同一トランザクション、CAS条件付きUPDATEで多重発言・レースを弾く）。招待コードはグループ紐付け専用のため、`user`/`room` からの発言や、別グループでの発言、既存 `lineGroupId` との不一致は拒否する。紐付け成立時は**4通の案内を1リクエストで返信**する（reply は1回5通まで）:
  1. `〇〇大会案内用LINEグループです！` / `以下確認をお願いします。`（`〇〇` は `deriveEntryGroupName`。複数日は `大阪AB` 形式）
  2. `@All` メンション＋主催者の申込締切（`events.entry_deadline`・`M/D(曜)`。NULLなら「未定」）と、締切までに申込アナウンスが届かなければ管理者を急かすよう促す文
  3. `@管理者` メンション＋景虎上の申込人数（`〇名（内他会〇名）`。ゲスト0名なら括弧ごと省略）と、グループ在籍人数との突き合わせ依頼
  4. `以下大会要項になります、適宜ご確認ください`（固定文。直後の要綱Flex送信への前置き）
  ③の人数は**実人数**（グループ全体で重複排除・ゲスト込み）で、参加費集計（延べ・ゲスト除外）とは母集団が異なる。LINEグループの在籍人数と突き合わせるための数字なので意図的に別物（`lib/entry-headcount.ts`）。締切・抽選日はグループ単位で同一という運用前提に立ち、日別に出し分けない。
- `revoked`: Botがグループから追い出された（`leave` イベント、`source.groupId` が現在の紐付け先と一致する場合のみ）、管理者による強制解放（`/admin/line-channels/[id]` の「強制解放」、`releaseChannel`）、または配信失敗時の自動リカバリ（後述）で遷移する。チャネルは `available` に戻り、招待コードはNULL化される。
- `released`: `apps/web/scripts/release-expired-broadcasts.ts`（日次バッチ）が、`linked` 状態のうち `COALESCE(extended_until, グループ内 MAX(event_date) + 30日)` を過ぎた行を自動解放する。複数日グループは最も遅い開催日を基準にする（相関サブクエリで算出。events への単純JOINは1行が日数分にfan outし誤判定するため使わない）。**イベントが0件になったグループ**（付け替えで空になったが紐付けを残しているグループ）は MAX(event_date) が NULL になるため、`extended_until` が未設定なら即解放対象として Bot をプールへ戻す。運営が反省会等の連絡を見込んで `extendBroadcastLifetime` で猶予日を個別延長できる。同バッチは、招待コード期限切れのまま `invite_pending`/`joined_waiting_code` に取り残された異常行（コードNULLも含む）も `revoked` へ回収する。

**メール配信**（`broadcastMailToEvent`）は1メール = 1回の配信を原則とし、`event_broadcast_messages` の `UNIQUE(eventLineBroadcastId, mailMessageId)` で冪等性を担保する。1回の承認で複数日グループの複数イベントが同時に作られても、配信呼び出し側（`broadcastApprovedUnits`）は `entry_group_id` で重複排除するため、実際のpushはグループにつき1回だけ発生する。メッセージは「冒頭見出し（任意）→本文→添付」の順で構築され、それぞれ役割別カウンタ（`sentLeadCount`/`sentTextCount`/`sentImageCount`/`fallbackLinkCount`）で送達数を記録する。

- 本文はA4 JPEGへ画像化して送る（画像化ロジック自体は `mail-body-image-render`、詳細は `spec/mail-worker.md`）。画像化が失敗・ページ超過・空・サイズ超過（10MB超）の場合はテキストfallback（`splitForLine` で分割）に切り替える。
- 添付は形式を問わず全て「署名URLを開くFlexファイルカード」1通に統一する（`line-flex-attachment.ts` の `buildAttachmentFlexMessage`。種別バッジ＝Excel緑/PDF赤/Word青/その他グレー＋ファイル名＋サイズ、カードタップのuriアクションで署名URLを開き、URL文字列はトークに露出しない。`altText`＝`📎 ファイル名`、400字上限）。かつてのPDF/Word画像化分岐、およびその後の「📎 ファイル名 + 生URL」テキスト形式はいずれも廃止済み。監査roleは従来どおり `attachment_link`。
- 冒頭見出し（`leadText`）は、進行中の大会に手動でメールを紐付ける操作（mail-inbox 側の統合処理フォーム（`MailProcessForm`）— 詳細は `spec/mail-worker.md`）でのみ付与できる任意テキストで、`broadcast-lead-presets.ts` にプリセット文言（抽選結果・組合せ・オープンチャット案内等、最大200文字）を持つ。AI下書きの自動配信・訂正紐付けでは付与されない。
- LINE Messaging APIへは5メッセージ/バッチ・バッチ間1.5秒sleepで送信し、429（レート制限）は `Retry-After` に従い最大3回リトライする。1回のpushは30秒でタイムアウトする。
- 途中失敗時は `partial` として送達済み件数を保存し、再送（`manualBroadcast`、UI操作）は未送達分のみ再送する。ただし前回と今回で送信計画（添付レンダリング結果等）が縮小していれば全件再送に切り替える。
- 送信直前に紐付け（Bot/グループ）を再取得し、添付処理中に管理者が連携解除・再紐付けを行っていた場合は送信を中止する（`binding_changed`）。
- 既に `status='sent'` なメールは自動配信では再送しない（`force=true` のUI再配信操作のみ例外）。
- LINE APIが401を返した場合はチャネルを `disabled` にして紐付けを `revoked` にする（トークン失効）。401以外の4xx（レート制限除く）はチャネルを `available` に戻して紐付けのみ `revoked` にする（グループ不正・Bot追放等）。いずれも「送信開始時に保持していたチャネル/グループ」が現在も有効な場合に限り実行し、レース中の再紐付けを壊さない。

**要綱の紐付け完了時送信**（broadcast-guidelines-on-link）は、上記のメール配信とは独立した経路で、紐付け完了（`linked`）の瞬間に「大会案内メールの要綱ファイル」だけをグループへ送る追加機能。紐付け前に承認済みだった案内メール（＝多くの場合、要綱そのもの）は既存の自動配信ではバックフィルされないため、その穴を要綱に限って埋める。

- **選択**: 招待コード発行モーダル（`InviteCodeModal`）で、対象イベント（その日）の全関連メール（3経路union。詳細は `spec/events-attendance.md` の関連メール）の添付をメール別に列挙し、管理者が要綱にあたるファイルを複数選択する。選択は `setGuidelineAttachments`（admin/vice_admin・replace意味論・候補外の添付idは拒否）で `event_broadcast_guideline_attachments`（`event_line_broadcasts` への join、両FK ON DELETE CASCADE）に即時保存する。`event_line_broadcasts` は1申込グループ1行で、招待コード再発行は同一行UPDATEなので選択は再発行をまたいで保持される。関連メール候補自体は対象イベント（その日）単位のままなので、同一グループの別の日から見ると候補一覧が異なりうる点に注意（選択・送信対象はグループ単位で共通）。
- **送信トリガー**: `event_line_broadcasts` が `linked` に遷移した時（Webhookの招待コード照合成功、および管理者の手動紐付け `manualLinkGroup`）に、選択済み添付があれば送信する。送信は紐付け成立**後**（reply枠は消費済み）に走るpushで、`sendGuidelinesOnLink`（`apps/web/src/lib/line-broadcast-guidelines.ts`）が担う。同モジュールはWebhook（nodejs runtime）から呼ばれるため `line-broadcast.ts`（本文画像化の重依存）を意図的にimportせず、署名URLの `getOrCreateShareToken` だけ再利用した自己完結の最小pushを持つ（5通/バッチ・1.5秒間隔・429リトライ・30秒タイムアウト・`LINE_NOTIFY_DRY_RUN` 尊重）。
- **送信内容**: 選択ファイルごとに「大会要綱」タグ付きFlexファイルカード1通（`buildAttachmentFlexMessage` に `tag: '大会要綱'` を渡す。`altText`＝`📎【大会要綱】ファイル名`、タップで署名URL `/api/line-broadcast/attachments/[token]`（60日）を開く）。既存の添付配信と同じ署名URL方式で、新規の公開エンドポイントは作らない。
- **best-effort**: 送信の成否は紐付け（`linked`）に影響しない（`sendGuidelinesOnLink` はthrowしない）。全通配信できたときだけ `event_line_broadcasts.guidelines_sent_at` を更新する。監査に `event_broadcast_messages`（メール単位・role別カウンタ）は流用しない（full-mail配信と衝突するため独立）。
- **再送・再連携**: `linked` 状態で `resendGuidelines`（events画面の「要綱を再送」）を押すと選択済み要綱を同形式で再送できる（best-effortの取りこぼし復旧）。連携解除→再発行→再紐付けでは、選択は保持され `guidelines_sent_at` はリセットされて新グループへ改めて送信される。
- **未選択時**: 紐付け完了時の要綱送信は行われない（既存挙動と完全に同じ）。多ファイル選択（>5）でWebhook応答が遅れLINEが再送しても、CASが再linkを弾くので二重送信にはならない。

### event-grade-group-broadcast: 級別グループへの概要配信

`line_channels.purpose` の3値目 `grade_broadcast` が本機能用のチャネル。既存30 Botプール（`event_broadcast`）から5個を確保し転換して使う（招待コード発行時に同一トランザクションで転換するため、運用スクリプトは不要）。**級ごとに専用チャネルを持つ**理由は、LINEの無料通数枠がチャネル単位で月200通のため — 1個を全級で共有すると5グループ合計で月20回程度で枯渇する。

**紐付け**（`line_grade_group_bindings`。`grade` UNIQUE / `line_channel_id` UNIQUE）は `invite_pending → joined_waiting_code → linked → revoked` で、申込グループ単位の `event_line_broadcasts` と違い**常設**（`released` を持たず、大会終了で解放されない）。招待コード方式・webhook の join/コード照合は大会用と同じ流儀だが、専用ハンドラに分離されており、級用チャネルでは `line_channels` の `status`/`assignedEntryGroupId` を触らず、要綱送信も行わず、Bot が追い出されてもチャネルをプールへ戻さない。**push 失敗で紐付けを自動解除しない**（常設なので自動解除すると運用のたびに繋ぎ直しになる）。

**配信対象の判定は `status='linked'` かつ `line_group_id IS NOT NULL` の行のみ**。「行が存在する」で判定してはならない（解除済みの級へ送り続けてしまう）。

**トリガー**は新規登録の3経路（AI下書き承認 `approveDraft`/`approveDraftUnits`、手動作成 `/events/new`、`/events/[id]` の再送ボタン）。いずれも `after()` の fire-and-forget で、配信の失敗は登録・承認を巻き戻さない。**編集経路には配線しない**（後から編集しても再送しない）。1回の承認で複数の大会が作られた場合は、作成した全 `event` を1回の呼び出しでまとめて渡し、同じ級に複数件該当しても**級ごと1通**に連結する。

**冪等性**は `event_grade_broadcasts`（`UNIQUE(event_id, grade)`）の **claim → push → 確定/取消**で担保する。claim はリースつき upsert（`ON CONFLICT DO UPDATE ... WHERE sent_at IS NULL AND claimed_at < now() - interval '5 minutes'`）で、push 成功なら `sent_at` を刻み、失敗なら claim 行を削除して未送信のまま残す（後から紐付け直して再送できる）。単純な `ON CONFLICT DO NOTHING` にしないのは、push 途中でプロセスが落ちると `sent_at IS NULL` の claim が残り、その `(大会, 級)` が永久に送信不能になる（再送ボタンも静かにスキップする）ため。

外部送信と DB 更新の間で落ちる窓は、次の3点で塞ぐ:

- **LINE が push を受理した後は claim を巻き戻さない。** 受理済みの claim を「失敗」として消すと、次回同じ本文が再び届く
- **`retry_key`（LINE の `X-Line-Retry-Key`）を claim 行に永続化し、一度決めたら変えない。** 同じ push にまとめた行が同じキーを共有するため、「まとめて送ったが確定だけ失敗し、後から一部の大会だけ再送する」場合でも元の送信と同じキーで再開でき、LINE 側が重複排除する（409 は「受理済み」＝送信成功として扱う）。キーをその場の行集合から導くと、再送で集合が変わった瞬間に別キーになり重複排除がすり抜ける。push は retry_key ごとにまとめるので、通常は級ごと1通のまま
- **確定・取消は claim 取得時の `claimed_at` との一致を条件にする（ownership CAS）。** リース失効で別プロセスが再 claim した行を、古いプロセスが後から消してしまう race を弾く

retry key は **元の push リクエストと 1:1** でなければならない。再試行時は、そのキーに属する未送信行を全て呼び戻して**元のバッチ構成を復元**し、同じ本文・同じ宛先で送り直す。復元しないと、A・B をまとめた push がタイムアウトした後に A だけを同じキーで送って受理された場合、続く B の再送が 409 になり **B は一度も送られていないのに送信済みとして確定する**（再送ボタンは1大会ずつ送るため現実に踏む経路）。LINE の retry key 保持期間は 24 時間で、これを超えると同じキーでも新規リクエスト扱いになるため、**期限を過ぎた受理不明の送信は自動再送せず**管理者へ「配信結果不明」として通知し、人が判断する。

push の結末は **3 値**で扱う。`accepted`（2xx / 同一キーの 409）は確定する。`failed`（429 を除く 4xx＝受理されていないことが確か）は claim を取り消して未送信へ戻す。**`unknown`（タイムアウト・5xx・リトライを使い切った 429）は claim と `retry_key` を残す** — 消して次回新しいキーで送ると、最初の要求が実は受理されていた場合に二重配信になるため（LINE 公式もこの経路は同一 retry key での再試行を求めている）。

束ねた本文が LINE の 5000 文字上限を超える場合は既存 `splitForLine` で分割し、**同一リクエストに最大5通まで載せる**（リクエストを分けると retry key を共有できず冪等性が崩れる）。5通に収まらない場合は**切り捨てずに送信失敗**とする（切り捨てて確定すると、末尾の大会が一度も送られないまま送信済みになり再送でも復旧できない）。

要綱 URL の解決失敗（`PUBLIC_BASE_URL` 不備）は**級単位で分離する**。URL を必要とする（添付が選択された）大会を含む級だけが失敗し、添付なしの級は通常どおり配信される。

**文面**は `M/D(曜) <title>の案内が来ました！` ＋ 要綱URL行 ＋ 空行と `締切 はM/Dです。`。要綱（`events.grade_broadcast_attachment_id`、承認フォームで1件選択・既定は未選択）と会内締切（`internal_deadline`）は無ければ行ごと省略する。要綱URLは既存の署名トークン方式（`/api/line-broadcast/attachments/[token]`、60日）をそのまま使い、新しい公開エンドポイントは作らない（級グループには未登録会員がいる可能性があるため未認証のまま維持する）。対象級は `events.eligible_grades`、**null または空なら全5級**（`isGradeEligible` と同ルール）。

**未紐付けでスキップした級と push に失敗した級は集計して管理者の個人LINEへ1通通知する**（`entry-overdue-alert.ts` の `loadSystemChannel`/`pushSystemText` を再利用）。無言でスキップすると「特定の級だけ永久に届いていない」状態に誰も気づけないため。

到達範囲の限界（受容済み）: 級グループに参加していない会員には届かない（会員100名超に対しグループ計50名程度）。通数超過は静かに送信不能になる（自動検知なし・手動対応）。遅延キュー・送信取消・配信時間帯ガードは持たないため、深夜に登録すれば深夜に通知が飛ぶ。

### メンション基盤と会計フラグ

LINE Messaging API の `textV2` を使い、`@All` / `@管理者` / `@会計` をメッセージに埋め込む。

- **組み立て**: `lib/line-mention.ts`（pure。DB・`node:`・`@kagetra/shared` を持ち込まない）。`buildMentionMessage({ mention, label, template, values })` が `{ type:'textV2', text, substitution }` を返す。プレースホルダは `m0` `m1` … の連番で、個人メンションは1人につき1つ。substitution は1メッセージ100件が上限（超過分は捨てる）。
- ★**メンションを含むメッセージに自由記述を混ぜない。** `textV2` は本文中の中括弧をプレースホルダ構文として解釈するため、大会名・支払情報などのユーザー入力が中括弧を含むと本文が壊れる。差し込める値を `number` と `{ dateIso }`（`M/D(曜)` へ整形）だけに型で限定し、`template` / `label` に中括弧が無いことを実行時にも検証する。自由記述は `buildTextMessage` でメンションを持たない別メッセージとして送る。
- **対象の解決**: `lib/line-mention-targets.ts`。共通条件は `line_user_id IS NOT NULL AND deactivated_at IS NULL` で、並び順は `users.id` 昇順（メンションの並びを決定的にするため）。`@会計` は `users.is_treasurer = true`、`@管理者` は `role IN ('admin','vice_admin')`。**0人なら素テキストの `@会計` / `@管理者` を出すだけ**でメッセージ自体は送る。`line_user_id` が無い担当者は黙って外れる。
- **会計フラグ**: `users.is_treasurer`（boolean）。**`@会計` で誰をメンションするかの識別専用で、認可判断には一切使わない**。会計の権限は副管理者と同一なので、会計担当には `role='vice_admin'` を併せて付与して運用する（`user_role` enum を増やさない理由は、`role !== 'admin' && role !== 'vice_admin'` の判定が多数のファイルにインライン展開されているため）。設定 UI は会員編集（`spec/auth-admin.md`）。
- **transport**: reply（`LineReplyClient.reply`）と push（`pushMessagesToEventGroup` / `pushMessagesToEntryGroup`）はいずれも `LineMessage[]` を受け取る。`pushMessagesToEntryGroup` は申込グループ単位で `event_line_broadcasts` を直接引く（振込連絡がグループ単位のキーを持つため、代表イベントを経由しない）。

### event-lifecycle-notify: 定型LINE通知

大会の状態遷移に応じて、`linked` なLINEグループへ固定テンプレートのテキストを1通push する（`event-lifecycle-notify.ts`）。通知種別は9種（`entry_applied`、`entry_applied_treasurer`、`entry_deadline_advance`、`entry_deadline_day`、`payment_paid`、`payment_deadline_advance`、`payment_deadline_day`、`onsite_payment_advance`、`onsite_payment_day`）で、`event_lifecycle_notifications` の `UNIQUE(eventId, type)` により **同一イベント×種別は生涯一度きり** しか送らない。

**文面（2026-08-22 全面改訂）**。宛先は1グループ＝1大会なので**大会名を出さない**。**金額もどの種別にも出さない** — 金額を知る必要があるのは会計だけで、その連絡は名簿確定後の振込連絡が担う。日付は `formatEventDate`（`M/D(曜)`）。`⚠️` は絵文字（U+26A0 U+FE0F）。

| 種別 | 文面 |
|---|---|
| `entry_applied` | `申し込みが完了しました！` + 空行 + `抽選日は7/20(月)です。`（`lottery_date` が NULL なら `抽選日は未定です。`） |
| `entry_applied_treasurer` | `@会計` + `振込連絡は名簿確定時に連絡します。` |
| `entry_deadline_advance` | `申込締切は7/20(月)（あと3日）です。まだ申し込みが行われていません。` |
| `entry_deadline_day` | `⚠️申込は今日までです！⚠️` |
| `payment_paid` | `参加費の振り込みが完了しました。` |
| `payment_deadline_advance` | `支払い締切は7/25(金)（あと3日）です。まだ振込が行われていません。` |
| `payment_deadline_day` | `⚠️振込締切は今日までです！⚠️` |
| `onsite_payment_advance` | `参加費は現地払いです。当日忘れないようにしてください。` |
| `onsite_payment_day` | `大会当日です！参加費を忘れないようにしてください。` |

- **申込完了**: `setEntryApplied(eventId, true)`（`events/[id]/actions.ts`）が `entryStatus` を `not_applied → applied` に一度だけ遷移させ、同一トランザクション内で `entry_applied`（参加者向け）と `entry_applied_treasurer`（会計向け）の2スロットを `claimLifecycleNotification` で確保する（once-everなので再トグルや同時実行では二重取得されない）。コミット後、それぞれ独立した try/catch でpushする（best-effort、push失敗でも状態変更は巻き戻さない）。大会が `cancelled` の場合はいずれも送らない。会計向けは `payment_deadline` / `payment_method` / `payment_info` を**参照しない**（申込完了の時点では抽選前で当選者が決まっておらず、振り込むべき金額が確定しないため、予告文だけを送る）。支払いタイプでも出し分けない。
- **支払完了**: `setPaymentPaid(eventId, true)` が `paymentType='advance'` かつ `paymentStatus='unpaid'` のときだけ `paid` に遷移させ、`payment_paid` を一度だけclaimしてpushする。
- **複数日（entry-groups の一括操作）**: `setEntryApplied` / `setPaymentPaid` / `setPaymentType` は複数 `eventId` を取る `setEntriesApplied` / `setPaymentsPaid` / `setPaymentTypes` への薄いラッパー。同グループの複数日を選んで一括トグルすると、id昇順ソート→各日ガード付きUPDATE（`cancelled` はここで再ガードしてclaim対象から除外）→**flipできた日のうちclaimできた集合だけ**で参加者向け・会計向けそれぞれ1通に集約してpushする（`sendClaimedNotificationBulk`）。大会名を名乗らなくなったため**日別ラベルは無く、束ねた文面は単一日と同一**になる（束ね処理そのものは維持する — 3日グループで3通に増やしてはならない）。
- **リマインド（日次バッチ）**: `apps/web/scripts/send-lifecycle-reminders.ts` が毎日（本番はsystemdタイマー、JST 00:00）実行し、以下の条件に合致する `linked` かつ非 `cancelled` の大会を対象に、`sendReminderNotification`（claim + push + finalize を1呼び出しに統合）で送る。
  - 申込締切: `entryStatus='not_applied'` かつ `entryDeadline` が「今日+リード日数」（事前）/「今日」（当日）
  - 事前払い締切: `paymentType='advance'` かつ `paymentStatus='unpaid'` かつ `paymentDeadline` が同様の条件
  - 現地払い: `paymentType='onsite'` かつ `eventDate` が同様の条件
  - `events.payment_type` の既定値は `'advance'`（参加費は基本前払い。設定箇所が進行管理の select 1つしか無く既定 NULL では支払締切リマインドが構造的に黙るため）
  - リード日数は既定3日（`EVENT_LIFECYCLE_REMINDER_LEAD_DAYS` env で上書き可）。日付判定はすべてJSTの `YYYY-MM-DD` 文字列比較（`jstTodayIso`）で行う。
  - 送信失敗は再試行しない（翌日には日付条件が外れるため、ベストエフォート設計）。`--dry-run` で候補一覧のみ確認できる。
  - **送信は (申込グループ, 通知種別, 締切日) 単位で1通に集約する。** 候補をこのキーでバケット化し、バケット内の全メンバーを**1回の INSERT（複数行 VALUES）+ `onConflictDoNothing` + `RETURNING`** で claim して1通 push する。once-ever の単位は `(event_id, type)` のまま維持されるので、cron を再実行すると「まだ claim できていない残りの日」だけが追加で1通送られる。
  - **紐付け判定の INNER JOIN は維持する**（`event_line_broadcasts.entry_group_id = events.entry_group_id` かつ `status='linked'`）。未紐付けグループは候補にもバケットにも現れず claim もしない — claim してしまうと「送っていないのに送信済み」になり永久に届かなくなる。
- push失敗時のリカバリ（401→チャネル`disabled`+紐付け`revoked`、その他4xx→紐付けのみ`revoked`）はevent-line-broadcastと同じパターンを個別実装している（`event-lifecycle-notify.ts` は `line-broadcast.ts` を意図的にimportしない自己完結モジュール）。

### payment-notice: 名簿確定後の振込連絡

確定名簿が出たグループの会計へ、振込金額を LINE で連絡する。**手動送信のみ・全自動送信はしない**（`/admin/entries/[groupId]` の「振込連絡」セクション）。

- **露出条件**（申込管理ボードの `payment_due` 区画と同じ）: `settled`（確定名簿あり。判定の正典は `lib/events/confirmed-roster.ts`）∧ 事前払い（`payment_type='advance'`）∧ 未振込（`payment_status='unpaid'`）∧ 申込済。手動トグル（`entry_groups.confirmed_roster_override`）で進めたグループも含む。現地払い・支払済・LINE未紐付けのグループでは出ない。判定と初期値は `lib/events/payment-notice-context.ts` に集約し、画面と Server Action の両方が呼ぶ（client から直接叩かれても fail-closed）。
- **人数**: 級ごとの人数の初期値は参加費集計と同じ母集団（`lib/entry-fee-tally.ts`。出欠回答「参加」・`is_invited`・`eligible_grades` 該当・**ゲスト除外**・複数日は延べ）。管理者は**級ごとの人数だけ**を直せ、**単価は直せない**（単価は協会規定額から `resolveEntryFee` が導出する値で、管理者が上書きしてよい種類の数字ではない）。直した人数は `entry_group_payment_notices` に保存し、再送時に同じ数字を再現する。集計の母集団は確定名簿ではなく出欠回答なので、抽選のある大会では落選者が混ざる — だからプレビューと人数編集が必須になっている。
- **文面**（`lib/payment-notice.ts`）は**2通**。1通目は `@会計` メンション＋数値由来の値だけ、2通目は支払情報（`payment_info`）の自由記述。**2通に分かれているのは `textV2` の中括弧問題を構造的に避けるためで、読みやすさのための分割ではない**（1通にまとめてはならない）。

  ```
  @会計
  7/25(金)までに
  A級：2500*3 = 7500円、
  B級：2500*2 = 5000円

  計12500円

  を、以下の口座に振り込んでください
  ```

  - 日付は `payment_deadline`。**NULL なら日付行ごと省略**する
  - 級ごとに1行（`{単価}*{人数} = {小計}円`。A→E順・人数0の級は行を出さない）。数値に桁区切りは入れない
  - 明細と `計` の間、`計` と末尾行の間に空行を1つ置く
  - `payment_info` が空なら2通目を送らない
  - 単価が解決できない級（非公認・団体戦）は明細から除外する（既存の総額計算と同じ規律）
- **送信**: 人数は push の前に保存し、**push が成功したときだけ** `last_sent_at` / `last_sent_by` を進める（失敗時は送信済みにせず再送できる状態のまま残す）。人数が全級0のときは送信させない。再送は要綱再送・オープンチャット再送と同じ扱いで何度でもできる。

### entry-overdue-alert: 管理者向け毎日アラート

会内締切を過ぎても会として主催者へ申し込んでいない大会を、`line_channels` の `status='system'` 行に設定された管理者LINE userId 宛に **1日1回・1通のサマリ**でpushする（`apps/web/src/lib/entry-overdue-alert.ts`）。**entry-groups: 明細は申込グループ単位で1行**に集約し（グループ内の該当日をまとめる）、グループ表示名は `deriveEntryGroupName`（導出できないときは代表イベントのタイトル）を使う。単独グループのときは従来の「1行1大会」と同じ文面になる。event-lifecycle-notify とは3軸すべてが異なるため、意図的に別モジュール・別バッチ・別タイマーにしている。

| 軸 | event-lifecycle-notify | entry-overdue-alert |
|---|---|---|
| 宛先 | 大会LINEグループ（`linked` 必須） | 管理者個人（system_notify Bot） |
| 冪等性 | once-ever（`UNIQUE(eventId, type)`） | **なし**（毎日繰り返すことが要件） |
| 配信時刻 | JST 00:00 | JST 07:00 |

**対象条件**（JST基準・すべて満たす大会）: `status != 'cancelled'` ／ `eventDate >= 今日` ／ `entryStatus = 'not_applied'` ／ 基準締切 `COALESCE(internalDeadline, entryDeadline)` が非NULLかつ今日より前 ／ **出欠「参加」が1名以上**。基準締切が今日と等しい（締切当日）は対象外で、超過した翌日から鳴り始める。会内締切は手入力のため未入力が起こりうるので、未入力なら大会申込締切で代替する（「未入力だから黙る」では締切を入れ忘れた大会＝最も危ない大会を検知できないため）。

参加希望者0名を対象外にするのは、申込管理ボード `/admin/entries` が同じ大会を「申し込む理由がない」として画面から外すため（[spec/events-attendance.md](events-attendance.md)）。画面が消した大会をLINEが鳴らし続けると定義が2つに割れ、管理者がどちらも信用しなくなる。副作用として、参加予定者がいるのに出欠登録されていないだけの大会もLINEで黙る — 移行過渡期のリスクとして明示的に受容している。

**`event_line_broadcasts` へは一切JOINしない。** LINEグループが未紐付けの大会も対象に含める設計で、これが event-lifecycle-notify のリマインドとの決定的な違い。既存リマインドは `linked` なグループを前提にしているため、グループ未紐付けの大会には1通も飛ばない — 申込漏れが最も起きやすいのはまさにその層である。

**文面**: 基準締切の超過日数が大きい順（tie-break は開催日昇順→id昇順の安定ソート）に上位5件を明細で出し、超過分は「他 N 件」に畳む。各明細は大会名・会内締切と超過日数（`entryDeadline` 代替時はその旨を併記）・大会申込締切と残日数・出欠「参加」人数・`{PUBLIC_BASE_URL}/events/{id}` の絶対URL。対象0件の日は送信しない。

**失敗ポリシーの適用順序**（順序で挙動が変わるため固定）: ①対象抽出 → 0件なら何もせず正常終了 → ②system_notifyチャネル解決（行なし／`notification_line_user_id` 未設定なら**警告してスキップ・正常終了**）→ ③`PUBLIC_BASE_URL` 解決（未設定は**例外で停止**）→ ④文面 → ⑤push。②を③より前に置くことで、system_notify を構成していない環境で毎朝 exit 1 が出るのを防ぐ。push失敗はリトライしない（429 の `Retry-After` 追従を除く。翌朝また対象になる）。

**通知ログ表を持たない。** `event_lifecycle_notifications` への claim も INSERT も行わないため、同じ日に2回実行すれば同じ内容が再送される。運用上はタイマーが1日1回起動する。

アラートの停止条件は、進行管理から `entryStatus` を `applied`（申込済）にするか `not_applying`（申込なし＝申込者がいないため見送り）にすること。`not_applying` は既存の申込締切リマインドの対象からも自動的に外れる（リマインドの `entryStatus='not_applied'` 条件をそのまま利用するため、この条件を「`applied` 以外」に緩めてはならない）。進行管理の状態遷移そのものは [spec/events-attendance.md](events-attendance.md) が正典。

デプロイ・運用手順は [deploy/entry-overdue-alert.md](../deploy/entry-overdue-alert.md)。

### LINE Webhook

`POST /api/webhook/line`（`runtime='nodejs'` 固定。署名検証がHMAC-SHA256で`node:crypto`必須のためEdgeランタイム不可）が全30+1 Botの受け口を兼ねる。payloadの `destination`（LINE Bot のユーザーID、Basic IDとは別値。`line_channels.webhookDestinationId` に保持）でチャネルを特定し、そのチャネル固有の `channelSecret` で `X-Line-Signature` を検証する。未知の `destination` は404、署名不一致は401、以降は常に200を返す（LINEの再送を避けるため、個々のイベント処理失敗は握りつぶしログのみ）。

チャネルの解決は `purpose IN ('event_broadcast','grade_broadcast')` で行い、**解決したチャネルの `purpose` で処理を振り分ける**。1チャネル = 1 purpose なので、大会用フローと級グループ用フローの排他は構造的に保証される（振り分け方式を新設していない）。以下は大会用（`event_broadcast`）の挙動で、級グループ用は専用ハンドラが同じイベントタイプを別テーブル（`line_grade_group_bindings`）に対して処理する。

処理するイベントタイプ:
- `join`: 上述の `joined_waiting_code` 遷移。**返信はしない**（大会用のみ。級別グループ用は従来どおり案内を返す）。
- `leave`: Bot自身がグループから外れた場合のみ（`memberLeft`＝一般メンバー退出は無視）。`source.groupId` が現在の紐付け先と一致する場合のみ `revoked` にする。
- `message`（テキストが `/^\d{6}$/` に一致）: 招待コード照合→`linked` 遷移。成功時は案内①〜④を1リクエストで返信する（上述）。不一致・形式不正・グループ以外からの発言はすべて同一の「❌ 招待コードが無効です」を返す（攻撃者に失敗理由を教えない設計）。
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

### openchat-broadcast: オープンチャット招待URLの抽出と配信

大会当日の対戦組合せ・進行は LINE オープンチャットで流すのが主流で、招待 URL は参加者確定後にメール本文・PDF・Word・QR コード画像と**バラバラの形式**で届く。

**自動検知・自動配信は採らない。** 本番メール286件の実測（正典: `docs/features/openchat-broadcast/feasibility.md`）により、AI の有無に関わらず 99% の正しさでは回せないと判明したため。招待を運ぶ20件のうちテキストから URL を取れるのは14件（70%）で残り6件は QR 画像のみ、URL がメールに存在しない大会（LINE 公式アカウント内で案内）もあり、全286件のうち当会イベントに紐付くのは21件（7%）しかない。1メールに複数 URL（級別・開催日別・部門別）があるのも普通で、**どれを誰に配るかは機械的に決まらない**。したがってトリガーは管理者の操作とし、確認画面で人が確定させることで正しさを担保する。

**抽出**（`lib/open-chat/`）は3段。Tier1 = `line.me/ti/g2/...` / `line.me/R/ti/g...` の直リンク、Tier2 = 短縮 URL（x.gd / ourl.jp / lin.ee / bit.ly / tinyurl。「未検証」印を付ける）、Tier3 = 画像添付・PDF/Word のページ画像から QR デコード（`sharp` で RGBA 化 → `jsqr`。ページ画像化は既存の `pdftoppm` / `libreoffice` 経路を再利用）。メール本文は76桁前後で折り返されるため**改行で割れた URL を結合して復元**し、復元できない・トークン長が不正な候補は出さない（壊れた URL の配信は「タップしても入れない」事故になる）。**短縮 URL はサーバーで展開しない**（外部 HTTP 依存を持ち込まない。抽出処理が `fetch` を呼ばないことはテストで機械的に担保）。級・開催日・パスワードは URL 周辺から推定するが**あくまで初期値**で、推定できなくてもエラーにしない。

**保存**は申込グループ単位（`entry_group_open_chats`）。1グループに複数行を持て、級・開催日・自由ラベル・パスワードを属性に持つ。「団体戦 / 1年 / 選抜の部」のような級でも日付でもない分かれ方は自由ラベルで吸収する。★**同一グループ内で最終ラベル（自動生成後の値）が重複してはならない** — 部門別では自動ラベルが全行「オープンチャットに参加」になり、そのまま配信すると同じ名前のボタンが5個並ぶ Flex が届く。重複判定は自動生成後の値で行い、重複がある間は保存できない。

**配信**は 1. と同じ大会別 Bot グループへ **Flex 1通のみ**（級別に LINE グループを分けない）。バブル内のテキストは「大会オープンチャット」と大会名の2つだけで説明文・注意書きを置かず、本文は各行のボタンを縦一列に並べる（carousel はスワイプしない人が他の級に気づかない）。ボタンは `uri` アクションで URL をトークに露出させず、パスワードのある行はボタン直下に表示する。**再配信は毎回全件を送る**（差分配信は「前に何が送られたか」を受け手が覚えている前提になる）ので、2回目以降は全件のラベルを列挙し前回配信以降に増えた行に「（今回追加）」を付けた確認を出す。

★**配信の記録は `entry_group_open_chat_broadcasts`（追記専用ログ）に持ち、`event_broadcast_messages` には一切書かない。** 同テーブルの `UNIQUE(event_line_broadcast_id, mail_message_id)` は「1メール=1配信」を DB レベルで強制するため「毎回全件」と原理的に両立せず、同じメールからの2回目の配信が制約違反で落ちる。この UNIQUE を緩める解決は禁止 — メール配信の冪等性は本機能と無関係に守られなければならない。binding の再検証（push 直前に紐付けが変わっていないか）と push 失敗時の復旧（401 → channel を disabled + binding revoke／401 以外の 4xx → binding のみ revoke）は `line-broadcast.ts` から切り出した共通ヘルパーを使い、**ヘルパー自身は監査行を書かない**（記録は呼び出し側の責務）。

LINE 未紐付けのグループでは保存だけ行い配信しない。配信の失敗は保存をロールバックせず、保存は成功・配信は失敗として記録して再試行できる。保存済み URL は `/events/[id]` のオープンチャット欄から**全会員が**辿れる（LINE を見逃した会員の救済。`spec/events-attendance.md`）。

## 画面

- **`/settings/line-link`**: 現在連携中のLINEアカウントID（末尾6文字以外マスク表示）と、切替導線のみのシンプルな画面。エラーコード（`missing_env` / `state_mismatch` / `denied` / `conflict` / `oauth_failed`）ごとに日本語メッセージを出し分ける。
- **`/(app)/settings/notifications`**: Web Push購読のON/OFFのみ。状態は `loading` / `unsupported`（Push API非対応）/ `no-key`（VAPID未設定）/ `denied`（OS拒否）/ `subscribed` / `unsubscribed` の6状態。
- **`/(app)/admin/line-channels`**: 30 Botの一覧（`purpose='event_broadcast'` のみ、system_notify行は非表示）。ステータス別フィルタ（空き/招待コード発行中/配信中/無効化）、`active` が全体の25/30以上になると枯渇警告バナーを表示する。各行に紐付け先大会・自動解放までの残日数を表示する。
- **`/(app)/admin/line-grade-groups`**: 級別グループ紐付けの管理（**admin のみ。vice_admin は不可**）。A〜Eの5行固定で、各行に状態（未紐付け/招待コード発行済み/参加済みコード待ち/紐付け済み）と操作（招待コード発行・解除）を出す。招待コード発行時に `event_broadcast` の空きチャネルを1個確保して `grade_broadcast` へ転換するため、転換後のチャネルは `/admin/line-channels` の一覧（`purpose='event_broadcast'` 固定）から自動的に消える。導線は `/admin/line-channels` からのリンク（ボトムナビは admin 時点で既に6タブのため追加しない）。
- **`/(app)/admin/line-channels/[id]`**: 個別Botの詳細。現在の紐付け先、紐付け履歴（直近20件）、操作ボタン（強制解放/無効化/有効化/手動紐付けモーダル `ManualLinkModal`）。手動紐付けは、Webhookが `join`/コード発言を受け取れなかった場合の運用フォールバックで、対象イベント・LINEグループIDを直接入力してその場で `linked` にする。

- **`/(app)/admin/entries/[groupId]`**: 申込グループページ内の「振込連絡」セクション（管理者/副管理者のみ・名簿確定フェーズかつLINE紐付けありのときだけ描画）。級ごとの人数入力とプレビュー、送信/再送ボタン、最終送信日時を持つ。**単価の入力欄は無い**。画面全体の構成は `spec/events-attendance.md`。

大会単体の配信状況（配信履歴・招待コード発行UI・現在の紐付け状態）は `/events/[id]` の「LINE 配信」開閉トグル（`LineBroadcastSection` / `BroadcastHistoryTable`）として表示される。**管理者以外には何も描画しない** — 会員向けの「この大会は LINE グループに自動配信されています」という案内は event-detail-redesign で廃止した。級別グループ配信（`GradeBroadcastSection`）も独立セクションをやめ、この LINE 配信トグルの中の1項目へ移した（`role === 'admin'` 限定は維持し、`vice_admin` には props ごと渡さない）。これらは大会本体の画面構成に属するため詳細は `spec/events-attendance.md` を参照。

## フロー

### 大会LINEグループの新規紐付け〜配信

1. 管理者が `/events/[id]` から招待コード発行を実行 → `generateInviteCodeForEvent` がBotプールから1台予約し6桁コード（30分TTL）を発行。同時に、招待コードモーダルで関連メール添付から「要綱として送信するファイル」を選択できる（任意・`setGuidelineAttachments` で即時保存）。
2. 運営がLINEグループを作成しBotを友だち追加・招待 → Webhook `join` を受けて `joined_waiting_code`。
3. グループ内で6桁コードを発言 → Webhook `message` が照合し `linked`。選択済み要綱があれば、この直後に `sendGuidelinesOnLink` が要綱ファイルをグループへpushする（best-effort）。
4. 以降、承認済みメール（AI下書き承認・訂正紐付け等、詳細は `spec/mail-worker.md`）のたびに `broadcastMailToEvent` が自動配信される。管理者は必要に応じて `/events/[id]` から手動再配信（`manualBroadcast`）や要綱の再送（`resendGuidelines`）もできる。
5. 大会終了30日後（またはoperatorが延長した日付）を過ぎると日次バッチが自動解放し、Botはプールに戻る。

### 級別グループの紐付け〜配信

1. 管理者が `/admin/line-grade-groups` で級を選び招待コードを発行 → 空きBotを1台 `grade_broadcast` へ転換し6桁コード（30分TTL）を発行。
2. その級のLINEグループへBotを招待 → Webhook `join` を受けて `joined_waiting_code`。
3. グループ内で6桁コードを発言 → `linked`。以降この紐付けは常設で、大会ごとに解放されない。
4. 大会が新規登録される（AI下書き承認 / 手動作成）たびに、対象級のグループへ概要が1通届く。未紐付け・送信失敗の級は管理者の個人LINEへまとめて通知される。
5. 取りこぼしは `/events/[id]` の「LINE 配信」→「級別グループ配信」トグル内の「未送信の級へ配信」で復旧できる（未送信の級にだけ届く）。

### イベントライフサイクル通知

1. 管理者が申込状態を「申込済」にトグル → `setEntryApplied` が状態遷移とonce-ever claimを同一トランザクションで行い、コミット後に参加者向け＋会計向けの2通をLINEグループへpush。
2. 事前払いの支払いを「支払済」にトグル → `setPaymentPaid` が同様に一度だけ完了通知をpush。
3. 締切が近づく/当日になると、日次バッチ（`send-lifecycle-reminders.ts`）が対象イベントを走査してリマインドをpush。

### 名簿確定後の振込連絡

1. 確定名簿が届く（パース済み名簿・採用済み原本・確定名簿メール・手動トグルのいずれか）と、グループが名簿確定フェーズへ入る。
2. 管理者が `/admin/entries/[groupId]` の「振込連絡」を開く → 級ごとの人数の初期値（参加費集計と同じ母集団）とプレビューが出る。
3. 抽選の落選者などを見て人数を直す（単価は直せない）→ 送信。`@会計` メンション付きの1通目と、支払情報の2通目がグループへ届く。
4. 人数は保存され、再送すると同じ数字が再現される。push に失敗したときは送信済みにならず、そのまま再送できる。

### Web Push購読

1. 管理者/副管理者が `/settings/notifications` で通知を有効化 → ブラウザ通知許可 → Service Worker経由でPush購読を作成 → `savePushSubscription` がDBへupsert。
2. 新着メール受信時、mail-worker側が `push_subscriptions` を読んで各端末へペイロード（title/body/url/badge）を送信（`spec/mail-worker.md`）。
3. Service Workerが通知表示とアプリバッジ更新を行う。

## API（Server Actions / route handlers）

| 関数・エンドポイント | 種別 | 認可 | 概要 |
|---|---|---|---|
| `startLineLink()` | Server Action | ログイン必須 | LINEアカウント切替の開始。CSRF state発行＋LINE認可URLへリダイレクト |
| `GET /api/line-link/callback` | route handler | ログイン必須（セッション一致検証あり） | LINEアカウント切替の完了処理 |
| `POST /api/webhook/line` | route handler | LINE署名検証（`X-Line-Signature`） | Bot群共通のWebhook受け口。join/leave/招待コードを処理。チャネルの `purpose` で大会用/級グループ用に振り分ける |
| `generateGradeInviteCode(grade)` | Server Action | **admin のみ** | 級別グループの招待コード発行。空きBotを1台 `grade_broadcast` へ転換（既存行がある級は同一行UPDATE） |
| `revokeGradeBinding(grade)` | Server Action | **admin のみ** | 級別グループの紐付け解除。チャネルはプールへ戻さない |
| `resendGradeBroadcast(eventId)` | Server Action | **admin のみ** | 級別グループへの再送。未送信の級にだけ送る（判定は claim に委ねる） |
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
| `sendGuidelinesOnLink(db, args, options)` | ライブラリ関数 | 呼び出し元（Webhook/manualLinkGroup/resendGuidelines）が認可を担保 | 選択済み要綱をFlexファイルカードでpush（best-effort・throwしない） |
| `pushTextToEventGroup(db, eventId, text, opts)` | ライブラリ関数 | 同上 | 定型テキスト1通のpush（lifecycle通知の下請け） |
| `claimLifecycleNotification` / `finalizeLifecycleNotification` / `sendClaimedNotification` / `sendReminderNotification` | ライブラリ関数 | 同上 | once-ever通知ログのclaim/finalize/送信ヘルパー群 |
| `collectOverdueEntries` / `buildOverdueAlertMessage` / `loadSystemChannel` / `pushSystemText` / `sendEntryOverdueAlert` | ライブラリ関数 | 呼び出し元（日次バッチ）が実行環境を担保 | 締切超過アラートの抽出・文面組立・system_notifyチャネル解決・push（`entry-overdue-alert.ts`） |
| `apps/web/scripts/send-entry-overdue-alert.ts` | バッチ（systemd timer） | ホスト実行（`kagetra` ユーザー） | 毎朝 JST 07:00 に `sendEntryOverdueAlert` を1回実行。`--dry-run` は候補と文面の表示のみ |

`generateInviteCodeForEvent` / `revokeBroadcast` / `extendBroadcastLifetime` / `manualBroadcast` / `setEntryApplied` / `setEntryNotApplying` / `setPaymentType` / `setPaymentPaid` は `apps/web/src/app/(app)/events/[id]/actions.ts` に実装されているが、大会画面のServer Actionとしての位置づけは `spec/events-attendance.md` の正典とし、本ファイルではLINE通知観点の挙動のみを機能仕様節で記述した。
