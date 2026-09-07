---
status: completed
---

# mail-body-as-image 実装手順書（2026-09-07 改修: 本文リンクカード化）

親Issue: #594

> 要件は [requirements.md](./requirements.md)。本書は**今回の改修**のタスクで上書きしている
> （初版＝本文画像化のタスクは完了済みで git 履歴が保持する）。

## 前提メモ（調査済み・実装時に再調査しないでよい事実）

- `middleware.ts` の matcher は否定先読み 1 本。`api/line-broadcast` 等を除外している。
  **公開ページのパスをここに足さないと LINE から開いた全員がサインイン画面に飛ぶ。**
- `getOrCreateShareToken`（`attachment-image-render.ts`）が `INSERT ... ON CONFLICT` で
  「期限内は既存 token 維持／期限切れは再生成」を 1 文で実現している。**この SQL をそのまま踏襲する。**
- `splitForLine` は `event-grade-broadcast.ts` も使う → **削除しない**（import を外すだけ）。
- `buildBroadcastBody` は本改修で未使用になるが**削除しない**（Non-goal）。`stripMailFooter` は全文ページが使う。
- `image-cache.ts` は `attachment-preview.ts`（会員向け添付ビューア）が使う → **残す**。
  `/api/line-broadcast/images/[token]` は未使用になるが撤去しない（Non-goal）。
- RSC ページのテストは `/mail/[id]/page.test.tsx` のパターン（`testDb` + ページ関数直呼び + `render`）を踏襲する。
- 監査列は増やさない。`sent_text_count` に本文カード、`fallback_link_count` に添付カードを計上する。

---

## 実装タスク

### タスク1: 共有トークン基盤（スキーマ・発行モジュール・cleanup）
- [x] 完了
- **目的:** メール本文を公開 URL で配れるようにするトークンの土台を作る
- **対応AC:** AC-9, AC-10, AC-11, AC-12
- **主な変更領域:**
  - `packages/shared/src/schema/mail-body-share-tokens.ts`（新規。`attachment_share_tokens` と**同形**：
    `id` / `mail_message_id`（notNull・unique・FK `mail_messages` onDelete cascade）/ `token`（unique）/
    `expires_at` / `access_count` / `created_at`、index は mail 用と expires_at 用の 2 本）
  - `packages/shared/src/schema/index.ts`（export 追加）
  - `packages/shared/drizzle/0064_*.sql`（`drizzle-kit generate` で生成。**手書き ALTER 禁止**）
  - `apps/web/src/lib/mail-body-share.ts`（新規）＋ `mail-body-share.test.ts`
    - `MAIL_BODY_SHARE_TTL_DAYS = 60`
    - `getOrCreateMailBodyShareToken(db, mailMessageId, { ttlDays?, now? })`
    - `mailBodyShareUrl(token, baseUrl)` → `${baseUrl}/mail-share/${token}`
    - **DB にしか依存しない軽量モジュール**（sharp / libreoffice を持ち込まない）
  - `apps/web/scripts/cleanup-expired-tokens.ts` と対応テスト（新テーブルも期限+7日の猶予で削除）
- **依存タスク:** なし
- **必要なテスト:** upsert 3 系統（新規発行 / 期限内は同一 token 再利用 / 期限切れは再生成＋`access_count` リセット）、
  token が URL-safe base64 32 文字、TTL が 60 日、cleanup が**両テーブル**を猶予 7 日で削除する
- **完了条件:** vitest green・`pnpm db:migrate` が通る・typecheck 通過
- **対応Issue:** #595

### タスク2: 本文カードの Flex ビルダー（pure）
- [x] 完了
- **目的:** 件名だけを載せた「✉ メールカード」を LINE Flex JSON として組み立てる
- **対応AC:** AC-2, AC-3, AC-4, AC-5
- **主な変更領域:**
  - `apps/web/src/lib/line-flex-mail-body.ts`（新規）＋ `line-flex-mail-body.test.ts`
    - `buildMailBodyFlexMessage({ subject, url, isCorrection })`
    - カード: bubble/kilo → body(horizontal, paddingAll 16px, action uri) →
      48×48 角丸バッジ（背景 `#534286` ＝ `--kg-brand`・白の `✉`）＋ 件名（sm/bold/wrap/`maxLines: 3`）＋
      `タップして全文を見る`（xxs・グレー）
    - 件名が空・NULL → `(件名なし)`。`isCorrection` → 件名の先頭に `【訂正】`
    - `altText` = `📧 <件名>`（400 UTF-16 単位でコードポイント境界切り詰め）
  - `apps/web/src/lib/line-flex-attachment.ts`（`truncateToUtf16Units` / `ALT_TEXT_MAX` / 型を export するだけ。
    **★このファイルを編集するのは本タスクだけ**）
- **依存タスク:** なし（タスク1 と並行可）
- **必要なテスト:** カード JSON の構造（バッジ色・`✉`・件名・サブタイトル・body の `uri` アクション）、
  URL がテキスト要素として現れないこと、件名なし、訂正版、400 字超のサロゲートペア境界切り詰め
- **完了条件:** vitest green・node builtins を import していない（pure 維持）・typecheck 通過
- **対応Issue:** #596

### タスク3: 配信経路の差し替え（本文画像 → 本文カード）
- [x] 完了
- **目的:** `broadcastMailToEvent` が本文をカード 1 通で送るようにし、画像化経路を撤去する
- **対応AC:** AC-1, AC-6, AC-7, AC-8, AC-19, AC-20, AC-21, AC-22, AC-23
- **主な変更領域:**
  - `apps/web/src/lib/line-broadcast.ts`
    - `MessageRole` を `'lead_text' | 'body_link' | 'attachment_link'` に変更（`body_image` / `body_text` を廃止）
    - `includeBody` が true のとき: `getOrCreateMailBodyShareToken` → `mailBodyShareUrl(…, getBaseUrl())` →
      `buildMailBodyFlexMessage` を 1 通 push。**try/catch でテキストへ倒さない**（例外は既存の外側 catch に伝播 → 監査行 failed）
    - 撤去: `buildBodyImageMessages`、`attachmentImageUrl`、`sharp` 動的 import、`setCachedImage` の import、
      `renderBodyImageToJpegs` / `splitForLine` / `buildBroadcastBody` の import と使用
    - カウンタ: `body_link` → `sent_text_count`（`sent_image_count` は常に 0）
  - `apps/web/src/lib/line-broadcast.test.ts`（期待値更新。画像 fallback 系テストは削除し、カード系に置換）
  - `apps/web/src/lib/mail-body-image-render.ts` と `mail-body-image-render.test.ts`（**削除**）
  - ★ `line-flex-attachment.ts` は**触らない**（タスク2 の領域）。本文カードは `line-flex-mail-body.ts` から import する
- **依存タスク:** タスク1, タスク2
- **必要なテスト:** 本文カード 1 通のみ／image message ゼロ、送信順（リード文→本文カード→添付カード）、
  `includeBody=false` で本文カードを積まない＋`empty_message_set`、`PUBLIC_BASE_URL` 未設定で `status='failed'`
  かつテキスト送信なし、添付カードの出力が現行と同一、旧監査行（`sent_image_count > 0`）の再送で全件再送に倒れる
- **完了条件:** vitest green・`git grep renderBodyImageToJpegs` が 0 件・typecheck / lint 通過
- **対応Issue:** #597

### タスク4: 公開の全文ページ
- [x] 完了
- **目的:** トークン URL を未ログインで開くと、件名・受信日時・本文全文が読めるようにする
- **対応AC:** AC-13, AC-14, AC-15, AC-16, AC-17, AC-18
- **主な変更領域:**
  - `apps/web/src/app/mail-share/[token]/page.tsx`（新規。`(app)` グループの**外**＝ボトムナビ等を持たない）
    ＋ `page.test.tsx`
    - `export const dynamic = 'force-dynamic'` ／ `export const metadata = { robots: { index: false, follow: false } }`
    - token 形式ガード（`/^[A-Za-z0-9_-]{16,64}$/`）→ `expires_at > now()` の行を join で引く → `access_count` 加算
    - 表示: 件名（受信したまま。`【訂正】`は付けない）／受信日時（`formatMailDetailDateTime`）／
      本文（`stripMailFooter` 適用・`<pre className="whitespace-pre-wrap …">`。`dangerouslySetInnerHTML` 禁止）
    - 本文が空 → `(本文なし)`、件名が空 → `(件名なし)`
    - 無効・期限切れ・形式不正は**同一の案内ページ**（「有効期限が切れました」＋「会員はかげとらのメール画面から検索できます」）
    - 添付・大会名・イベントリンク・会員向けナビは出さない
  - `apps/web/src/middleware.ts`（matcher の否定先読みに `mail-share` を追加。既存の除外コメント様式に倣う）
    ＋ `apps/web/src/middleware.test.ts`（既存の「matcher（未認証前提ルートの除外）」describe に 1 ケース追加）
  - ★ `line-broadcast.ts` は触らない（タスク3 の領域）
- **依存タスク:** タスク1
- **必要なテスト:** 有効トークンで 200 かつ件名・受信日時・本文が出る、`<script>` を含む本文が
  テキストとして表示される（実行されない）、期限切れ／存在しない／形式不正が同一の案内ページ、
  添付ファイル名・大会名が出ない、`metadata.robots` が noindex。
  **★AC-18 は matcher 正規表現の単体テストで検証する** — `middleware.test.ts` が既にやっているように
  `config.matcher[0]` を `new RegExp('^' + matcher + '$')` として評価し、
  `/mail-share/<token>` が **`false`**（＝matcher の対象外）になることを assert する。
  ページ単体テストは matcher の漏れを検出できない（ページ関数を直接呼ぶだけなので、
  matcher に `mail-share` を足し忘れても green になり、本番で全員がサインイン画面へ飛ぶ）
- **完了条件:** vitest green・typecheck / lint 通過
- **対応Issue:** #598

---

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1: タスク1, タスク2** — スキーマ／DB 側と pure な Flex ビルダーで変更領域が完全に分離
- **Wave 2: タスク3, タスク4** — 配信ロジック（`lib/line-broadcast.ts`）と公開ページ（`app/mail-share/**` ＋ `middleware.ts`）で
  ファイルが重ならない。どちらもタスク1 の `mail-body-share.ts` に依存し、タスク3 はタスク2 にも依存する

## 出荷前チェック

- `git grep renderBodyImageToJpegs` / `git grep buildBodyImageMessages` が 0 件
- `git grep "mail-body-image-render"` が 0 件
- migration 番号が他ブランチと衝突していない（0064）
- 本番の `.env.production` に `PUBLIC_BASE_URL` が入っていること（既存前提。未設定だと配信が failed になる）
