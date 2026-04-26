---
status: completed
---

# mail-tournament-import 要件定義書

## 1. 概要

### 目的
全日本かるた協会 ML（`taikai-ajka`）等で配信される大会案内メールを Yahoo!メールから自動取り込み、AI（Claude Sonnet 4.6）で構造化抽出し、管理者承認後に `events` テーブルへ登録する半自動パイプラインを構築する。

### 背景・動機
- 月 22 件程度の大会案内メールが ML / 個別主催者から到着
- 現状は管理者が手動で events に転記、抽出ミス・登録漏れが発生
- 添付の PDF / DOCX 大会要項から日時・場所・参加費・締切を読み取る作業が重い
- AI 抽出 + 管理者承認の半自動化で運用負荷を 1/5 程度に低減することを目指す
- これは **P3-A**（CLAUDE.md 記載の P3「AI+メール」のうち、メール取り込みパイプライン部分）に位置付ける。AI 名簿・AI 旅費見積もりは後フェーズで別途定義する

---

## 2. ユーザーストーリー

### 対象ユーザー
- **管理者（`admin` / `vice_admin` ロール）**: ML 受信 Yahoo!メールアカウントの所有者、`/admin/mail-inbox` の使用者。実質 1 名（運営担当）

### ユーザーの目的
- 大会案内メールを見落とさず、events 登録の手間を最小化する
- 抽出結果の検証・修正を最小限のクリック数で行える
- 異常（IMAP 接続失敗・AI 失敗）が発生したら気付ける

### 利用シナリオ

**シナリオ A: 平常時の取り込み**
1. 30 分ごとに `apps/mail-worker` が自動起動、Yahoo!メール IMAP から新着メールを取得
2. 大会案内と判定されたメールは AI が抽出 → `tournament_drafts` に pending で保存
3. 1 件以上の draft が作成されたら、LINE Bot が管理者に push 通知
4. 管理者が `/admin/mail-inbox` を開く → draft 一覧で件名・抽出された大会名・日時を確認
5. 各 draft の詳細を開く → 抽出値が pre-fill された events 編集フォームで内容確認・修正
6. 「承認 → events 登録」ボタンで `events` に INSERT、`tournament_drafts.status = 'approved'`、関連付けされる

**シナリオ B: 訂正版メール受信**
1. 既存の大会案内（draft 承認済み or pending）に対する訂正版メールが届く
2. AI が `is_correction: true` と判定、件名類似性から関連 draft を提案
3. `/admin/mail-inbox` 詳細画面に「以下の既存 draft の訂正版の可能性: 第 21 回兵庫大会」とヒント表示
4. 管理者が手動で「これを訂正として既存 draft / event を更新」ボタンを押す → 既存 draft の `superseded_by_draft_id` を新 draft に向ける、events を再編集する場合は events を編集
5. 関連付けは管理者の判断、自動マージはしない

**シナリオ C: 異常検知**
1. IMAP 接続が連続 3 回失敗、または AI API エラーが連続発生
2. LINE Bot が管理者に「⚠️ メール取り込みが失敗しています」を push 通知
3. 管理者が `/admin/mail-inbox` でエラーログ確認、必要なら `pnpm tsx apps/mail-worker/src/index.ts --once --debug` で手動再試行

**シナリオ D: 初回起動 / 手動取り込み**
1. 管理者が `/admin/mail-inbox` の「メール取り込み」ボタンを押す
2. since 日付（例: `2026-04-01`）を入力 → バックグラウンドジョブでその日以降の全メール取り込み
3. cron での自動実行とは独立、テスト・初回展開・特定期間の再取り込みに使用

---

## 3. 機能要件

### 3.1 画面仕様

#### 3.1.1 `/admin/mail-inbox`（管理者向けメール受信箱）

新規ページ。`admin` または `vice_admin` のみアクセス可（他ユーザーは 403 / リダイレクト）。

**構成**: `MobileShell` レイアウト + Card ベース

**ヘッダー部**:
- ページタイトル「メール受信箱」
- 右上に「メール取り込み」ボタン（手動トリガー、since パラメータ入力モーダルを開く）

**フィルタ行** (横並び):
- ステータス: `すべて` / `承認待ち` / `承認済み` / `却下` / `AI 失敗` / `ノイズ`
- 期間: 直近 7 日 / 30 日 / 全期間
- 検索: 件名・送信者で絞り込み（テキスト入力）

**一覧（カード形式、降順 = 受信日新しい順）**:
各 draft 1 行ごとに `Card`:
- 件名（クリックで詳細展開）
- 受信日時（JST）
- 送信者
- AI 信頼度バッジ: `>= 0.9` 緑、`0.5-0.9` 黄、`< 0.5` グレー
- 大会名（AI 抽出済み）
- 開催日（抽出済み）
- ステータス Pill: `承認待ち` / `承認済み (events #N)` / `却下` / `AI 失敗`
- 訂正版ヒント表示（あれば）: 「⚠ 第 21 回兵庫大会の訂正版の可能性」

**ノイズの扱い**:
- AI 判定が `is_tournament_announcement: false` & confidence > 0.7 のものは default ビューに表示しない
- フィルタ「ノイズ」を選ぶと表示、誤判定時に手動 draft 化のボタンを設ける

#### 3.1.2 `/admin/mail-inbox/[id]`（draft 詳細・編集画面）

**構成**:
- パンくず: ← メール受信箱
- 上部: 元メール情報（件名、送信者、受信日、本文プレビュー、添付ファイルリスト + ダウンロード/プレビューリンク）
- 中部: AI 抽出結果（`extracted_payload`）と信頼度の表示（折りたたみ可）
- 下部: events 編集フォーム（`/events/[id]/edit` と同じ `EventForm` を再利用、AI 抽出値で pre-fill）+ 追加カラム（fee_jpy, payment_method, capacity_a..e 等）
- フッター: 「却下」「保留」「承認 → events 作成」ボタン

**承認時の動作**:
- フォーム値で `events` に INSERT
- `tournament_drafts.status = 'approved'`、`tournament_drafts.event_id = <新 events.id>` を更新
- 既存 events に紐付ける場合（訂正版）は別途「既存 events に紐付ける」モードを用意

**却下時の動作**:
- `tournament_drafts.status = 'rejected'`、events 作成なし

#### 3.1.3 添付ファイルプレビュー

- PDF: 新規タブで `<iframe>` プレビュー or ブラウザネイティブ表示
- DOCX/XLSX: ダウンロードのみ（ブラウザネイティブプレビュー不可）
- 画像（JPG 等）: モーダルプレビュー
- API: `GET /api/admin/mail/attachments/:id` で `Content-Type` 付きでバイナリ返却（admin 認証必須）

### 3.2 ビジネスルール

#### 3.2.1 メール取り込みルール
- 対象: Yahoo!JAPAN メールの **Inbox 全件**
- 認証: App Password（通常パスワード使用禁止）
- de-dup: `Message-ID` ヘッダーで完全重複排除、同じ Message-ID のメールは再取得しない
- ヘッダーフィルタ（AI に渡す前にスキップ）:
  - `List-Unsubscribe` あり
  - `Auto-Submitted: auto-generated` 等
  - `Precedence: bulk` 等
  - `X-Spam-*` でスパム判定済み
- 取り込み頻度: 30 分間隔（systemd timer）
- 初回 / 手動: `/admin/mail-inbox` の取り込みボタンから since 指定で実行可

#### 3.2.2 AI 抽出ルール
- モデル: Claude Sonnet 4.6（プロバイダ抽象化レイヤ経由、将来 Gemini に切替可能）
- プロンプトキャッシュ: 1 時間 TTL でシステムプロンプト全体をキャッシュ
- 入力:
  - メール本文（text/plain or HTML→text）
  - 添付の PDF: ネイティブ PDF input（base64）として AI に直接渡す
  - 添付の DOCX: `mammoth` でテキスト抽出、テキストとして AI に渡す
  - 添付の XLSX: `xlsx` ライブラリで table → テキスト、デフォルトで省略（オプションで投入可）
- 出力: Zod スキーマで validate された JSON（後述 4.x 参照）
- 信頼度: AI が `confidence: 0.0-1.0` を出力、`tournament_drafts.confidence` に保存
- v1 では信頼度による自動承認なし、全件 manual review

#### 3.2.3 重複防止・再処理
- `Message-ID` で de-dup
- 同じ Message-ID は再取得しない
- 再 AI 抽出: 管理者 UI から手動トリガー（draft 詳細画面の「再 AI 抽出」ボタン）。バッチ再走らせは `pnpm tsx apps/mail-worker/src/reextract.ts --since=YYYY-MM-DD` でも可
- 自動再 AI（プロンプト変更時の全件再走）は実装しない（コスト爆発回避）

#### 3.2.4 訂正版メールの扱い
- AI が `is_correction: true` と `references_subject: string` を出力可能
- 一致する既存 draft があれば UI に「訂正版の可能性」ヒントを表示
- 自動マージは行わない、管理者の手動判断で:
  - 既存 draft が pending 状態 → 新 draft で上書き or 統合
  - 既存 draft が approved（events 化済み） → events を編集する経路を提供
- `tournament_drafts.superseded_by_draft_id integer | null` 自己参照 FK で関係を表現

#### 3.2.5 エラー処理
| 失敗種別 | 対応 |
|---|---|
| IMAP 接続失敗（一時的） | 次の cron まで待つ。連続 3 回失敗で LINE 通知 |
| 個別メールの取得失敗 | `mail_messages.status = 'fetch_failed'` で次回スキップ。手動再試行ボタンを UI に |
| 添付パース失敗 | `mail_attachments.extracted_text = null`、AI には body だけ渡す |
| AI API レート制限 | 指数バックオフで 3 回まで試行、失敗で `tournament_drafts.status = 'ai_failed'` |
| AI 出力 JSON 壊れ | 1 回再試行、ダメなら `ai_failed`。LINE 通知（連続失敗時のみ） |
| events INSERT 失敗 | 承認 UI で「保存失敗」表示、admin が修正 |

#### 3.2.6 LINE 通知
- 通知先: `line_channels` テーブルから `status='system'` の channel access token で push
- 通知タイミング:
  - 新規 draft 作成: 1 cron run で 1 件以上 draft 作成された場合に集約通知（「新規 draft N 件」）
  - エラー: IMAP 連続 3 回失敗、AI 連続 3 回失敗時に通知
- メッセージテンプレート（例）:
  - **新規検出**: `📬 新規大会案内 N 件を取り込みました\n・第 65 回全日本選手権大会 (2026-05-30)\n・...\n→ /admin/mail-inbox`
  - **エラー**: `⚠️ メール取り込みが連続 3 回失敗しています。\n直近エラー: <message>\n→ /admin/mail-inbox`

---

## 4. 技術設計

### 4.1 API 設計

主に **Next.js Server Actions** を使用、HTTP API は添付ファイル配信のみ。

#### Server Actions

**`approveDraft(draftId, eventFormData)`**
- 入力: draft ID + events 編集フォームの全フィールド
- 処理: events INSERT → tournament_drafts.status='approved' & event_id 更新
- 認可: admin / vice_admin のみ

**`rejectDraft(draftId, reason?)`**
- tournament_drafts.status='rejected', rejection_reason='reason'
- 認可: admin / vice_admin のみ

**`reextractDraft(draftId)`**
- AI 再抽出をトリガー（既存 draft.extracted_payload を上書き）
- prompt_version を最新に更新
- 認可: admin / vice_admin のみ

**`triggerMailFetch(sinceDate?)`**
- バックグラウンドジョブとして mail-worker を呼び出し
- 戻り値: ジョブ ID（フロントは進捗ポーリングで状態確認）
- 認可: admin / vice_admin のみ

**`linkDraftToEvent(draftId, eventId)`**
- 訂正版を既存 events に紐付け
- 認可: admin / vice_admin のみ

#### HTTP API

**`GET /api/admin/mail/attachments/:id`**
- 入力: `mail_attachments.id`
- 処理: bytea を `Content-Type` ヘッダー付きで返却、`Content-Disposition: inline; filename="..."`
- 認可: admin / vice_admin のセッション必須（middleware）

### 4.2 DB 設計

#### 新規テーブル

**`mail_messages`** (1 メール 1 行)
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | integer | pk | |
| message_id | text | unique not null | LINE/RFC 5322 Message-ID ヘッダー |
| from_address | text | not null | |
| from_name | text | nullable | |
| to_addresses | text[] | not null | |
| subject | text | not null | |
| received_at | timestamp tz | not null | |
| body_text | text | nullable | text/plain or HTML→text 化したもの |
| body_html | text | nullable | HTML 原本（保存しておく） |
| status | mail_message_status | not null | enum |
| classification | mail_classification | nullable | enum |
| imap_uid | integer | nullable | IMAP UID（再取得用、参考） |
| imap_box | text | nullable | "INBOX" 等 |
| created_at | timestamp tz | not null default now() | |
| updated_at | timestamp tz | not null default now() | |

`mail_message_status` enum: `'pending' | 'fetched' | 'parse_failed' | 'fetch_failed' | 'ai_processing' | 'ai_done' | 'ai_failed' | 'archived'`

`mail_classification` enum: `'tournament' | 'noise' | 'unknown'`（AI 判定結果）

**`mail_attachments`** (1 添付 1 行)
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | integer | pk | |
| message_id | integer | fk → mail_messages.id, not null | |
| filename | text | not null | 元のファイル名 |
| content_type | text | not null | "application/pdf" 等 |
| size_bytes | integer | not null | |
| data | bytea | not null | 原本バイナリ（PostgreSQL TOAST に自動格納） |
| extracted_text | text | nullable | PDF/DOCX/XLSX 抽出済みテキスト |
| extraction_status | attachment_extraction_status | not null | enum |
| created_at | timestamp tz | not null default now() | |

`attachment_extraction_status` enum: `'pending' | 'extracted' | 'failed' | 'unsupported'`

**`tournament_drafts`** (AI 抽出結果 + ワークフロー)
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | integer | pk | |
| message_id | integer | fk → mail_messages.id, not null | |
| status | tournament_draft_status | not null | enum |
| confidence | numeric(3,2) | nullable | 0.00-1.00 |
| is_correction | boolean | not null default false | |
| references_subject | text | nullable | AI が示唆した訂正元の件名 |
| superseded_by_draft_id | integer | nullable, self-fk | この draft を上書きした draft |
| extracted_payload | jsonb | not null | AI 出力の生 JSON |
| prompt_version | text | not null | 例 "v1.0.0" |
| ai_model | text | not null | 例 "claude-sonnet-4-6" |
| ai_tokens_input | integer | nullable | |
| ai_tokens_output | integer | nullable | |
| ai_cost_jpy | numeric(8,2) | nullable | 円換算コスト |
| event_id | integer | nullable, fk → events.id | 承認後に作成された events への参照 |
| approved_by_user_id | text | nullable, fk → users.id | |
| approved_at | timestamp tz | nullable | |
| rejected_by_user_id | text | nullable, fk → users.id | |
| rejected_at | timestamp tz | nullable | |
| rejection_reason | text | nullable | |
| created_at | timestamp tz | not null default now() | |
| updated_at | timestamp tz | not null default now() | |

`tournament_draft_status` enum: `'pending_review' | 'approved' | 'rejected' | 'ai_failed' | 'superseded'`

**`line_channels`** (LINE Messaging Channel プール)
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | integer | pk | |
| channel_id | text | unique not null | LINE Messaging Channel ID |
| channel_secret | text | not null | LINE channel secret |
| channel_access_token | text | not null | long-lived access token |
| bot_basic_id | text | not null | "@xxx" 友だち追加 URL 用 |
| status | line_channel_status | not null default 'available' | |
| assigned_user_id | text | nullable, fk → users.id | |
| notes | text | nullable | "システム通知用" 等 |
| created_at | timestamp tz | not null default now() | |
| updated_at | timestamp tz | not null default now() | |
| assigned_at | timestamp tz | nullable | |
| last_used_at | timestamp tz | nullable | |

`line_channel_status` enum: `'available' | 'assigned' | 'active' | 'system' | 'disabled'`

**P3-A スコープ内では `system` 用 1 行のみ手動 INSERT。100 チャネル展開・割当ロジックは別フェーズ（P2 想定）。**

#### 既存テーブルの変更

**`users`** に追加:
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| line_channel_id | integer | nullable, fk → line_channels.id | |
| notification_line_user_id | text | nullable | 配属チャネル経由の userId（push 用、Login 用とは別） |

**`events`** に追加:
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| fee_jpy | integer | nullable | 参加費（円） |
| payment_deadline | date | nullable | 入金期限 |
| payment_info | text | nullable | 振込先（自由文） |
| payment_method | text | nullable | 振込方法 自由文 |
| entry_method | text | nullable | 申込方法 自由文 |
| organizer | text | nullable | 主催者連絡先 自由文 |
| capacity_a | integer | nullable | A 級定員 |
| capacity_b | integer | nullable | B 級定員 |
| capacity_c | integer | nullable | C 級定員 |
| capacity_d | integer | nullable | D 級定員 |
| capacity_e | integer | nullable | E 級定員 |

**既存の `start_time` / `end_time` は活用継続（mail パイプラインからは抽出しない、手動入力可能性は残す）**。

### 4.3 フロントエンド設計

#### 新規画面・コンポーネント

```
apps/web/src/app/(app)/admin/mail-inbox/
  page.tsx                    # 一覧画面（filter + Card list）
  [id]/page.tsx               # draft 詳細・編集画面
  components/
    DraftCard.tsx             # 一覧カード
    ConfidenceBadge.tsx       # 信頼度バッジ
    AttachmentList.tsx        # 添付ファイル一覧 + プレビュー
    ExtractedPayloadView.tsx  # AI 抽出結果の折りたたみ表示
    CorrectionHint.tsx        # 訂正版ヒント
    ApprovalForm.tsx          # 承認フォーム（EventForm 再利用 + 追加カラム）
  actions.ts                  # Server Actions

apps/web/src/app/api/admin/mail/attachments/[id]/route.ts  # 添付配信
```

#### ナビゲーション
- `/admin` のサイドナビに「メール受信箱」を追加（admin/vice_admin のみ表示）

#### `EventForm` の拡張
- 新規カラム（fee_jpy, payment_method, capacity_a..e 等）を含むフォームフィールド追加
- 既存の `/events/new` `/events/[id]/edit` は新カラム対応を入れるが、optional フィールドなので空でも保存可

### 4.4 バックエンド設計

#### 新規パッケージ: `apps/mail-worker`

```
apps/mail-worker/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                  # エントリポイント (--once / --watch / --since)
    config.ts                 # env 読み込み
    fetch/
      imap-client.ts          # imapflow ラッパー
      fetcher.ts              # 新着メール取得 + de-dup
      pre-filter.ts           # ヘッダーフィルタ
    extract/
      pdf.ts                  # pdfjs-dist で PDF→テキスト
      docx.ts                 # mammoth で DOCX→テキスト
      xlsx.ts                 # xlsx で XLSX→テキスト
      orchestrator.ts         # 添付タイプ別分岐
    classify/
      llm/
        types.ts              # LLMExtractor interface
        anthropic.ts          # Anthropic Sonnet 4.6 実装
        index.ts              # provider factory
      schema.ts               # Zod schema (extraction output)
      prompt.ts               # system prompt + few-shot 例
      classifier.ts           # 1 メール → 抽出結果（with retry）
    persist/
      mail-message.ts         # mail_messages CRUD
      attachment.ts           # mail_attachments CRUD
      draft.ts                # tournament_drafts CRUD
    notify/
      line.ts                 # @line/bot-sdk push wrapper
      message-templates.ts    # 通知文テンプレート
    pipeline.ts               # メイン処理: fetch → extract → classify → persist → notify
  test/
    fixtures/
      *.eml                   # 過去メールのフィクスチャ
      *.expected.json         # 期待される抽出結果
    fetch.test.ts
    classify.test.ts
    pipeline.test.ts
```

#### 依存ライブラリ

| ライブラリ | 用途 |
|---|---|
| `imapflow` | IMAP クライアント |
| `pdfjs-dist` | PDF テキスト抽出 |
| `mammoth` | DOCX テキスト抽出 |
| `xlsx` (SheetJS) | XLSX 解析 |
| `@anthropic-ai/sdk` | Claude API 呼び出し |
| `@line/bot-sdk` | LINE Messaging API |
| `zod` | output validation（既存） |
| `zod-to-json-schema` | Zod → JSON Schema 変換 |
| `nodemailer` | エラー時メール通知（任意、LINE がメインなので保留可） |

#### LLMExtractor interface（プロバイダ抽象化）

```typescript
// apps/mail-worker/src/classify/llm/types.ts
export interface LLMExtractionInput {
  systemPrompt: string
  emailMeta: { subject: string; from: string; date: Date }
  emailBodyText: string
  attachments: Array<
    | { kind: 'pdf'; filename: string; data: Buffer }
    | { kind: 'text'; filename: string; text: string }
  >
  outputSchema: object  // JSON Schema
}

export interface LLMExtractionResult {
  parsed: ExtractionPayload  // Zod-validated
  raw: string                // 原文（debug 用）
  tokensInput: number
  tokensOutput: number
  model: string
  promptVersion: string
}

export interface LLMExtractor {
  extract(input: LLMExtractionInput): Promise<LLMExtractionResult>
}
```

実装は `AnthropicSonnet46Extractor` のみ v1 で提供、`GeminiPro25Extractor` は将来追加可能な構造。

#### Zod schema（AI 出力）

```typescript
// apps/mail-worker/src/classify/schema.ts
import { z } from 'zod'

const GradeSchema = z.enum(['A', 'B', 'C', 'D', 'E'])

export const ExtractionPayloadSchema = z.object({
  is_tournament_announcement: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  is_correction: z.boolean().optional(),
  references_subject: z.string().nullable().optional(),

  extracted: z.object({
    title: z.string().nullable(),
    formal_name: z.string().nullable(),
    event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    venue: z.string().nullable(),
    fee_jpy: z.number().int().nullable(),
    payment_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    payment_info_text: z.string().nullable(),
    payment_method: z.string().nullable(),
    entry_method: z.string().nullable(),
    organizer_text: z.string().nullable(),
    entry_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    eligible_grades: z.array(GradeSchema).nullable(),
    kind: z.enum(['individual', 'team']).nullable(),
    capacity_total: z.number().int().nullable(),
    capacity_a: z.number().int().nullable(),
    capacity_b: z.number().int().nullable(),
    capacity_c: z.number().int().nullable(),
    capacity_d: z.number().int().nullable(),
    capacity_e: z.number().int().nullable(),
    official: z.boolean().nullable(),
  }),

  // raw / 補助情報（events に上げない、参考用）
  extras: z.object({
    fee_raw_text: z.string().nullable().optional(),
    eligible_grades_raw: z.string().nullable().optional(),
    target_grades_raw: z.string().nullable().optional(),
    local_rules_summary: z.string().nullable().optional(),
    timetable_summary: z.string().nullable().optional(),
  }).optional(),
})

export type ExtractionPayload = z.infer<typeof ExtractionPayloadSchema>
```

#### 実行モード

```bash
# 単発（cron / 手動）
pnpm --filter=@kagetra/mail-worker start --once

# 特定日付以降の取り込み（初回・再取り込み）
pnpm --filter=@kagetra/mail-worker start --once --since=2026-04-01

# 既存 draft の再 AI 抽出
pnpm --filter=@kagetra/mail-worker reextract --since=2026-04-01

# Dry-run（DB 書き込みなし、ログのみ）
pnpm --filter=@kagetra/mail-worker start --once --dry-run
```

#### systemd timer 設定（Lightsail）

```
# /etc/systemd/system/kagetra-mail-worker.service
[Unit]
Description=kagetra mail-worker
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/opt/kagetra
EnvironmentFile=/etc/kagetra/.env
ExecStart=/usr/bin/pnpm --filter=@kagetra/mail-worker start --once
User=kagetra

# /etc/systemd/system/kagetra-mail-worker.timer
[Unit]
Description=Run kagetra mail-worker every 30 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
Unit=kagetra-mail-worker.service

[Install]
WantedBy=timers.target
```

#### 環境変数（`.env`）

```
# 既存
DATABASE_URL=...
NEXTAUTH_SECRET=...
LINE_LOGIN_CHANNEL_ID=...
LINE_LOGIN_CHANNEL_SECRET=...

# 新規追加
YAHOO_IMAP_HOST=imap.mail.yahoo.co.jp
YAHOO_IMAP_PORT=993
YAHOO_IMAP_USER=...@yahoo.co.jp
YAHOO_IMAP_APP_PASSWORD=...
ANTHROPIC_API_KEY=sk-ant-...
ATTACHMENT_BASE_DIR=（不要、bytea 直接保存に変更）
MAIL_WORKER_LOG_LEVEL=info
```

LINE Messaging Channel の token は `line_channels` テーブル管理のため env には含めない（system 用 1 行のみ DB に格納）。

---

## 5. 影響範囲

### 5.1 変更が必要な既存ファイル

#### `packages/shared/`
- `src/schema/enums.ts`: `mailMessageStatusEnum`, `mailClassificationEnum`, `attachmentExtractionStatusEnum`, `tournamentDraftStatusEnum`, `lineChannelStatusEnum` を追加
- `src/schema/mail-messages.ts`: 新規
- `src/schema/mail-attachments.ts`: 新規
- `src/schema/tournament-drafts.ts`: 新規
- `src/schema/line-channels.ts`: 新規
- `src/schema/events.ts`: 11 カラム追加（fee_jpy, payment_deadline, payment_info, payment_method, entry_method, organizer, capacity_a..e）
- `src/schema/auth.ts`: `users` に `line_channel_id`, `notification_line_user_id` 追加
- `src/schema/relations.ts`: 新規 relation を追加
- `src/schema/index.ts`: re-export

#### `apps/web/`
- `src/components/events/event-form.tsx`: 新規カラム入力フィールド追加（フォームスキーマ拡張、`form-schemas.ts` も更新）
- `src/lib/form-schemas.ts`: `eventFormSchema` 拡張、`extractEventFormData` 拡張
- `src/components/layout/`: admin ナビ追加（既存に項目を 1 つ追加）
- `src/app/(app)/admin/mail-inbox/`: 新規（page.tsx, [id]/page.tsx, actions.ts, components/）
- `src/app/api/admin/mail/attachments/[id]/route.ts`: 新規
- `src/middleware.ts`（または `src/auth.ts`）: `/admin/mail-inbox/*`, `/api/admin/mail/*` のロールガード追加

#### `apps/mail-worker/` (新規)
- 一式新規作成（src/, test/, package.json, tsconfig.json, vitest.config.ts）

#### `docker/`
- `docker-compose.yml`: mail-worker サービス（CI 用、本番は systemd）
- 必要なら nginx 設定変更（添付プレビューは Next.js API route 経由なので変更不要）

#### `.github/workflows/`
- CI に `apps/mail-worker` を含める（lint, test, type-check）
- E2E は Playwright で `/admin/mail-inbox` の最低限ハッピーパス（fixture を seed して draft 一覧 → 承認 → events 作成）

#### Drizzle migration
- 単一 migration で全テーブル + events 拡張を作成
- 既存 events データには新規カラムが nullable で追加されるだけなので破壊的変更なし

### 5.2 既存機能への影響

- **events 一覧 / 詳細 / 編集**: 新規カラムは optional なので既存 UI は壊れない。`/events/[id]/edit` の `EventForm` に新フィールドが加わるだけ
- **events 通知ロジック（将来 P2）**: 追加カラムを利用可能になる
- **手動 events 作成（`/events/new`）**: 新カラム対応、空のままでも保存可
- **mail-inbox は admin 限定**: 一般会員（member）の画面には影響なし
- **DB マイグレーション**: 単一 migration、ローカル & CI & 本番でそれぞれ実行
- **CI**: mail-worker テストは fixture ベースで実 IMAP / 実 AI 不要、CI で完結
- **依存関係追加**: `imapflow`, `pdfjs-dist`, `mammoth`, `xlsx`, `@anthropic-ai/sdk`, `@line/bot-sdk`, `zod-to-json-schema` を mail-worker に追加。web 側には影響なし

---

## 6. 設計判断の根拠

### 6.1 なぜ Yahoo IMAP 直接 + Sonnet 4.6 (option B = ハイブリッド) を選んだか
- Yahoo→Gmail 転送 + Gemini 案を検討したが、自動転送すると **Yahoo 側からメールが消える**ため原本喪失リスク大
- Gemini が安いのは事実だが、月コスト差は ~$0.7（年 $9）で意思決定要因にならない
- AI モデルだけ将来切り替えできる **プロバイダ抽象化レイヤ** を設けることで、コスト要件が変わったら 1 ファイル差し替えで Gemini に移行可能

### 6.2 なぜ 3 テーブル方式（mail_messages / tournament_drafts / events）にしたか
- mail_messages は大会案内じゃないノイズも入る、events は手動入力経路もあるので、責務を分離
- drafts は events の置き換えではなく、AI 抽出の audit trail + 承認の中継地点
- 1 メール → 複数 draft の可能性、再 AI 抽出時の上書き対応も draft 側で完結

### 6.3 なぜ events に個別カラム追加（fee_jpy 等）したか
- 通知機能（P2）で参加費 / 入金期限を直接使うことが確定
- jsonb 集約は型安全 / クエリしやすさ / 手動入力経路で持てない問題があり不適
- capacity も `gradeEnum` 固定なので、jsonb より個別 5 列（capacity_a..e）が適合

### 6.4 なぜ添付を bytea で DB に保存するか
- 月 ~100MB、5 年 ~6GB の容量見積もり、PostgreSQL TOAST で row 性能影響なし
- ファイルシステム + パス参照と比べてバックアップ統合（pg_dump or Lightsail snapshot で全部）、原本喪失リスク減
- Lightsail 単一インスタンスの規模では DB 統合管理がシンプル

### 6.5 なぜ 30 分 cron 間隔か
- 月 22 件 = 1〜2 日に 1 件のペースで、5〜15 分間隔は過剰
- 1 時間だと締切ギリギリのメール検出に遅延
- IMAP 接続コスト軽量、AI 呼び出しもまばら → 30 分が応答性とコストのバランス

### 6.6 なぜ AI 信頼度の閾値による自動承認を v1 で採用しないか
- サンプルが月 22 件 × 数ヶ月程度では「AI が信頼できる」確信を持てる統計が足りない
- 自動承認による誤登録リスクが、人手 1 クリックの省略メリットを上回る可能性
- confidence は最初から保存しておき、運用ログから閾値設計を後で行う方針

### 6.7 なぜ 100 LINE channel プール戦略にしたか（CLAUDE.md 既定）
- LINE Messaging API フリープランの月 200 通制限を、80 ユーザー × 200 = 16,000 通として無料運用するため
- v1（P3-A）スコープでは system 用 1 channel のみ実装、100 channel 展開・割当は P2 で別途設計

### 6.8 なぜ Lightsail systemd timer か
- `.env` ファイル直接読みでシークレット管理が完結（GitHub Secrets 不要）
- 公開 HTTP route を増やさない（攻撃面を減らす）
- 既存 Lightsail インスタンスに乗せられる（追加コスト 0）

### 6.9 なぜ mail-worker を新規 monorepo app にしたか
- `scripts/` 直下だと将来肥大化（migration, 運用 script と混ざる）
- `apps/api` 内 route は HTTP 公開を意味するが、systemd 直起動が前提なので不要
- 独立 app なら依存関係を限定でき、turbo の test/lint パイプラインに自然に乗る

---

## 7. 範囲外（P3-A スコープ外）

以下は本機能の範囲外、別フェーズで対応:

- **AI 名簿読み込み**（P3-B 想定）: 大会名簿の OCR / 抽出 → users への反映
- **AI 旅費見積もり**（P3-C 想定）: 札幌発の航空券 + 宿泊費見積もり
- **LINE 100 channel プールの展開**（P2 想定）: 100 channel 一括作成・自動割当ロジック
- **大会データ通知の本格運用**（P2 想定）: 試合結果通知、リマインダー
- **AI 自動承認**（v2 検討）: confidence 閾値による events 直行
- **旧 kagetra DB 重複チェック**: 移行作業時に別途設計
- **多メールアカウント対応**: 1 Yahoo!アカウント前提、複数アカウント運用は将来検討

---

## 8. 開発・テスト戦略

### 8.1 テスト方針
- **ユニットテスト** (Vitest): fetch / extract / classify / persist の各レイヤを fixture ベースで網羅
  - `apps/mail-worker/test/fixtures/` に過去メール eml + 期待抽出結果 JSON
  - `imapflow` をモック、AI クライアントをモック
- **統合テスト**: Vitest で pipeline 全体を fixture で再生 → DB 書き込みまで検証
- **E2E テスト** (Playwright): `/admin/mail-inbox` のハッピーパスを最低 1 シナリオ
  - DB に draft seed → ログイン → 一覧 → 詳細 → 承認 → events 作成確認
- **smoke test**: `pnpm tsx apps/mail-worker/src/index.ts --once --dry-run` を手動実行

### 8.2 ローカル開発環境
- 実 Yahoo!メール接続を avoid、fixture から再生する `--mock-imap` フラグ実装
- 実 AI 接続を avoid、fixture を返す `--mock-llm` フラグ実装
- `MAIL_WORKER_DRY_RUN=true` で DB 書き込みをスキップ

### 8.3 デプロイ手順
1. Drizzle migration を本番 DB に適用（`pnpm --filter=@kagetra/shared db:migrate`）
2. `apps/mail-worker` を build → Lightsail に deploy
3. systemd unit / timer を配置、`systemctl enable --now kagetra-mail-worker.timer`
4. `line_channels` に system 用 1 行を手動 INSERT、Bot を管理者が友だち追加 → `notification_line_user_id` 取得
5. `/admin/mail-inbox` で初回手動取り込み（since=今日）→ パイプライン動作確認
6. 数日 cron 自動運転で安定確認 → 通知文・抽出精度の microチューニング
