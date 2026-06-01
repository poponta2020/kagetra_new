---
status: completed
---
# mail-triage-badge 要件定義書

## 1. 概要

### 目的
管理者がメールの見落としをゼロにする。届いた**全メール**（AI がノイズ判定したものを含む）に必ず目を通して処理し、**未処理件数を PWA アプリアイコンのバッジでリアルタイムに把握**できるようにする。

### 背景・動機
- 現状、メール受信時の通知は「AI が大会案内と判定しドラフト化したとき」だけ LINE に飛ぶ（`apps/mail-worker/src/notify/orchestrator.ts`）。ノイズ判定・非大会メールは一切通知されない。
- AI のノイズ判定には限界があり、重要メールがノイズに紛れて見落とされるリスクがある。
- `mail-inbox` は全メールを一覧表示しているが、ドラフトを持たないメールには**処理アクションも処理状態も無く**、「全部に目を通した」ことを担保できない。

## 2. ユーザーストーリー

- **対象ユーザー**: 管理者・副管理者（`admin` / `vice_admin`）
- **目的**: 届いた全メールを確実に処理し、未処理が残っていることをアプリアイコンのバッジで一目で知る。
- **利用シナリオ**:
  1. 新着メール → 端末に Web Push 通知（**1メール1通知**）＋アプリアイコンのバッジが増える。
  2. PWA を開き、未処理メールを確認。
  3. 各メールを「大会として取込／既存大会に紐付け／対応不要で片付け／保留」のいずれかで処理。
  4. 処理するとバッジが減る。未処理0でバッジが消える。
  5. 副管理者が処理した分も、自分が次に開いたときに反映される。

## 3. 機能要件

### 3.1 画面仕様
- **mail-inbox 一覧**:
  - 全メール（noise 含む）を「未処理 / 保留 / 処理済み」で区分表示。未処理を最上部に。
  - 既存の tier 分け（要対応/要確認/その他）は未処理グループ内の整理として活かす。
- **メール詳細（mail id ベース・新規）**:
  - 本文・添付・AI 分類・ドラフト情報（あれば）を表示。
  - 処理アクション4種のボタンを設置。
- **`/settings` の「メール通知」設定**:
  - 通知を有効化（許可＋購読）/ 無効化（解除）トグル。`admin`/`vice_admin` のみ表示。
  - iOS は「ホーム画面追加（PWA standalone）＋ユーザー操作で通知許可」が必須である旨を案内表示。

### 3.2 ビジネスルール
- **処理状態**: `unprocessed`（未処理）/ `deferred`（保留）/ `processed`（処理済み）。
- **未処理バッジ件数** = `processed` 以外（`unprocessed` + `deferred`）の全メール件数。
- **処理アクションと状態遷移**:
  | アクション | 既存実装の流用 | 遷移先 |
  |---|---|---|
  | 大会として取込 | approveDraft 相当 | processed |
  | 既存大会に紐付け | linkDraftToEvent 相当 | processed |
  | 対応不要で片付け | 新規（dismiss） | processed |
  | 保留 | 新規（defer） | deferred（バッジに残る） |
  | 取消／保留解除 | 新規（undo） | unprocessed |
- ドラフトの有無に関わらず全メールで上記アクションを実行可能。draft 無しメールを「大会として取込」する場合は AI 強制再抽出 or 手動イベント作成で対応（実装手順書で詳細化）。
- **既存（リリース前）メール**: migration で全行を `processed` に。バッジは 0 から開始。
- **通知**: 新規取り込みメール1通ごとに Web Push 1件（noise 含む全件）。
- **バッジ同期**: 新着によるバッジ増加はリアルタイム（Push）、自端末での処理による減少は即時。他端末（他管理者）の処理結果は次回フォアグラウンド時に count API で同期する**準リアルタイム**方式。

## 4. 技術設計

### 4.1 API 設計
- `GET /api/admin/mail/unprocessed-count` → `{ count: number }`（admin/vice_admin）。フォアグラウンドのバッジ同期に使用。
- Server Actions（mail-inbox）:
  - 新規: `dismissMail(mailId)` / `deferMail(mailId)` / `undoTriage(mailId)`
  - 既存 `approveDraft` / `rejectDraft` / `linkDraftToEvent` に `triage_status='processed'` 更新を追加。
  - `savePushSubscription(subscription)` / `deletePushSubscription(endpoint)`（/settings）。
- VAPID 公開鍵をクライアントへ渡す経路（環境変数 → 公開 config or API）。

### 4.2 DB 設計
- `enums.ts`: `mailTriageStatusEnum = ['unprocessed', 'processed', 'deferred']`
- `mail_messages` 追加カラム: `triage_status`（not null, default `'unprocessed'`）, `triaged_at`, `triaged_by_user_id`。
- 新テーブル `push_subscriptions`: `id`, `user_id`(FK auth users), `endpoint`(unique), `p256dh`, `auth`, `user_agent`, `created_at`, `last_used_at`。1ユーザー複数端末。
- migration（現在の最新は `0017`。本機能は `0018` から採番）:
  1. `triage_status` 等のカラム追加 ＋ **既存全行を `processed` 化**（ベースライン）。
  2. `push_subscriptions` 作成。

### 4.3 フロントエンド設計
- **Service Worker**: `apps/web/public/sw.js`。`push` イベント → `showNotification` + `navigator.setAppBadge(count)`。`notificationclick` → `/admin/mail-inbox` を開く。
- **SW 登録**: クライアントコンポーネントで `navigator.serviceWorker.register('/sw.js')`。
- **middleware**: `apps/web/src/middleware.ts` の matcher に `/sw.js` を除外追加（既存 PWA 静的アセット除外パターン）。
- **バッジ更新の3経路**: ①SW push（バックグラウンド）②アプリ起動/可視化時に count API（フォアグラウンド）③処理アクション後に再取得。
- **購読 UI**: `/settings` 配下の通知設定コンポーネント。`'setAppBadge' in navigator` / Notification 対応の feature detection を入れる。
- **一覧/詳細の再構成**: mail id ベースの詳細ページ。draft があればドラフト情報も併記。

### 4.4 バックエンド設計（mail-worker）
- `web-push` ライブラリ追加。VAPID 秘密鍵で送信。
- pipeline の新規 `inserted` メールごとに、`admin`/`vice_admin` の全 `push_subscriptions` へ送信。
  - ペイロード: `title`/`body`（件名・送信元）, `badge`=未処理総数, `url`。
  - HTTP 410/404 が返った subscription は DB から削除（クリーンアップ）。
- 既存 LINE 通知（`notify/orchestrator.ts`）とは独立。両立させる。

## 5. 影響範囲

- **packages/shared**: `enums.ts`, `mail-messages.ts`, 新 `push-subscriptions.ts`, `relations.ts`, drizzle migration, `index.ts`
- **apps/web**: settings 通知 UI, `public/sw.js`, SW 登録, `middleware.ts` matcher, mail-inbox page/詳細/actions, 未処理数 API route, バッジ更新ロジック
- **apps/mail-worker**: web-push 送信モジュール, pipeline 配信フック, `config`(VAPID), `package.json`
- **環境変数**: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`（`.env.example`, `.env.production.example`, デプロイ docs）
- **互換性**: `triage_status` は default `unprocessed` だが既存行は migration で `processed` 化。`mail_messages.status='archived'` は温存し既存 reextract ガード等に影響させない。
- **並行作業（CLAUDE.md ルール11）**: `event-lifecycle-notify` は PR #85 で merge 済（migration `0017` 適用）。本機能の migration は `0018` から採番。今後の並行 PR と `enums.ts`/`relations.ts` で競合し得る点に注意（マージ時リベース）。

## 6. 設計判断の根拠

- **処理状態を `status` とは別カラム（`triage_status`）に**: `status` は IMAP/AI パイプラインの技術状態を表し、人間の処理状態と直交する（例: `ai_done` でも未処理）。混在させると既存ロジックを壊す。
- **未処理 = `processed` 以外**: 保留（`deferred`）もバッジに残すことで「後で対応」を可視化しつつ見落としを防ぐ。
- **通知は1メール1件**: ユーザー選択（見落とし最小化優先）。iOS は同一アプリ通知をスタック表示するため連発の体感負荷は緩和される。
- **web-push（自前 VAPID）採用**: OS ネイティブのアプリアイコンバッジをバックグラウンド更新できるのは Web Push 経由のみ。LINE Bot 通知とは別レイヤで必須。
- **リリース前メールは `processed` 化**: 既存の noise 含む大量メールを未処理にすると初期バッジが数百になり実用性を損なう。
- **バッジ同期は準リアルタイム**: 処理を担うのは主に管理者（副管理者もアクセス可だが実運用では稀）。他端末の処理結果は次回フォアグラウンド時の count API 同期で十分とし、処理操作ごとの全管理者 Push（完全同期）は過剰実装として見送った。
