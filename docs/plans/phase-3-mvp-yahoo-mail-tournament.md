# Phase 3 MVP — Yahoo Mail → AI 大会案内抽出 → 管理者承認 → events 昇格

- 作成日: 2026-04-22
- 対象: Phase 3 の最小 PoC。PDF/Word 添付解析・AI 名簿反映・AI 旅費見積もりはスコープ外（別 PR）
- 調査資産: `scripts/review/output/yahoo-mail-tournament-investigation-2026-04-17.md`
- ユーザー承認済決定: Gemini 2.5 Flash-Lite 無料枠 / `tournament_announcements` pending → approved → events 昇格 / 管理画面の手動トリガー / Yahoo App Password / スルー通知は管理画面内のみ

## PR 分割方針

**1 機能だが量が大きいため 2 PR に分割**（CLAUDE.md 原則: 小さく、混ぜない）。

| PR | 含む Phase | ship 条件 |
|---|---|---|
| PR-E1 (backend) | Phase 1〜4 | バックエンドのみ・API テスト緑・UI なしでもマージ可能 |
| PR-E2 (frontend) | Phase 5〜7 | 管理画面 + E2E + スマホ実機確認で完成 |

ブランチ:
- `feat/phase-3-mvp-yahoo-mail-backend` (PR-E1)
- `feat/phase-3-mvp-yahoo-mail-frontend` (PR-E2, PR-E1 merge 後に main から切る)

---

## Phase 0: Documentation Discovery (DONE)

調査結果は本ドキュメント末尾の「Allowed APIs」と「Anti-Patterns」に集約。以下 Phase で参照するので独立 section に切り出してある。

---

## Phase 1: DB Schema と型定義

### 目的
`tournament_announcements` テーブルと `announcementStatusEnum` を `packages/shared` に追加し、migration `0005_tournament_announcements.sql` を生成する。

### 作業対象
- `packages/shared/src/schema/enums.ts` — `announcementStatusEnum` 追加
- `packages/shared/src/schema/tournament-announcements.ts` — 新規作成（テーブル定義）
- `packages/shared/src/schema/relations.ts` — events / users との relation 追加
- `packages/shared/src/schema/index.ts` — 新 schema を wildcard export（line 1-7 の既存パターンに追加行）
- `packages/shared/drizzle/0005_tournament_announcements.sql` — 自動生成
- `packages/shared/drizzle/meta/_journal.json` — 自動更新

### コピー元
- **スキーマ定義パターン**: `packages/shared/src/schema/events.ts` lines 6-26（serial id + pgEnum + FK + timestamps）
- **enum 追加パターン**: `packages/shared/src/schema/enums.ts` lines 1-13
- **relation 追加パターン**: `relations.ts` の events/users 既存定義を踏襲

### 確定 schema（plan 内で決定）
```
tournament_announcements
- id: serial primary key
- message_id: text not null unique           ← IMAP Message-ID、再処理防止の key
- mail_subject: text not null
- mail_from: text not null
- mail_received_at: timestamp not null
- mail_body_excerpt: text not null           ← AI に渡した本文（サイズ上限 8KB 程度でトリム）
- ai_is_tournament: boolean not null         ← AI 判定結果
- ai_confidence: numeric(4,3) not null       ← 0.000〜1.000
- ai_reason: text                            ← 判定根拠
- ai_extracted: jsonb                        ← {title, event_date, venue, entry_deadline, fee_jpy, ...}
- status: announcementStatusEnum not null default 'pending'
- processed_at: timestamp not null default now()
- reviewed_at: timestamp
- reviewed_by: uuid references users(id) on delete set null
- linked_event_id: integer references events(id) on delete set null   ← 承認時に作成した events 行
- created_at / updated_at: timestamp not null default now()
```

enum: `pending` | `approved` | `rejected` | `skipped`
- `pending`: AI が tournament と判定した行の初期 status（管理者レビュー待ち）
- `approved`: 管理者承認 → events 昇格済み
- `rejected`: 管理者が大会案内ではないと判定
- `skipped`: AI が非大会と判定した行（管理画面のスルー一覧用）

### テスト (Phase 1 で書くもの)
Phase 1 単体ではロジック追加なし。schema の型チェックと migration dry-run のみ:
- `pnpm --filter @kagetra/shared db:generate` で migration 生成
- 生成された SQL を目視レビュー（`0005_tournament_announcements.sql`）
- `pnpm typecheck` が通ること

### 検証チェックリスト
- [ ] `announcementStatusEnum` が `enums.ts` に追加済み
- [ ] `tournament-announcements.ts` が events.ts と同じ import / export パターンで書かれている
- [ ] `index.ts` に `export * from './tournament-announcements'` を追加
- [ ] `relations.ts` に users と events への relation を追加
- [ ] migration 番号が `0005` (最新が 0004)
- [ ] `_journal.json` の最終 entry が `0005` で更新されている
- [ ] `pnpm typecheck` 緑

### Anti-pattern guard
- ❌ schema ファイルに JS ロジックを書く（schema は定義のみ）
- ❌ `drizzle/0005_*.sql` を手書き編集（常に `db:generate` で regenerate）
- ❌ `serial` と `uuid` を混在させる（既存テーブルに合わせる: events は serial、users は uuid）

---

## Phase 2: Gemini Client + Classifier Service

### 目的
Gemini 2.5 Flash-Lite で「メールが大会案内か判定 + 要項抽出」を行う純粋関数を作る。IMAP や DB には触れない。

### 作業対象
- `apps/api/package.json` — `@google/genai@^1.50`, `zod-to-json-schema@^3.x` 追加
- `apps/api/src/lib/gemini.ts` — SDK thin wrapper（client 初期化のみ）
- `apps/api/src/services/classifier.ts` — 分類ロジック（指数バックオフ付き）
- `apps/api/src/services/classifier.test.ts` — unit test（Gemini mock）

### コピー元（外部 URL）
- https://github.com/googleapis/js-genai README の初期化コード
- https://ai.google.dev/gemini-api/docs/structured-output の `responseJsonSchema` サンプル（本文 verbatim）

### API 呼び出し形（Phase 0 調査で確定）
```ts
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const classificationSchema = z.object({
  is_tournament_announcement: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300),
  extracted: z.object({
    title: z.string().optional(),
    event_date: z.string().optional(),      // ISO 8601 date
    venue: z.string().optional(),
    entry_deadline: z.string().optional(),  // ISO 8601 datetime
    fee_jpy: z.number().int().nonnegative().optional(),
  }).nullable(),
});

const res = await client.models.generateContent({
  model: 'gemini-2.5-flash-lite',
  contents: buildPrompt(subject, body),
  config: {
    responseMimeType: 'application/json',
    responseJsonSchema: zodToJsonSchema(classificationSchema),
  },
});
return classificationSchema.parse(JSON.parse(res.text));
```

### リトライ/エラーハンドリング（Phase 0 調査で確定）
- **429 `RESOURCE_EXHAUSTED`**: 指数バックオフ `[1s, 2s, 4s, 8s, 16s]` 最大 5 回リトライ
- **`RPD hit` (1,000/日 超過)**: 24h クールダウン。classifier は `RateLimitExhausted` エラーを throw し、上位で全処理停止 + 管理者通知
- **400 safety block**: 同じ入力は同じ結果のため retry 不可。`SafetyBlocked` として該当メールを `skipped` status + reason 付きで保存（管理画面に出す）
- **プロンプトは個人情報を極力含めない**: 無料枠は学習利用される規約なので、**差出人メアドは domain 部のみ投入 / 本文 8KB で truncate**

### テスト (API テスト、テストファースト)
1. **Green path**: Gemini mock が `{ is_tournament: true, confidence: 0.9, extracted: {...} }` を返す → schema parse 成功
2. **Ambiguous**: `{ is_tournament: false, confidence: 0.3, extracted: null }` → skipped 判定になる
3. **Retry on 429**: 1 回目 429, 2 回目成功 → 最終結果が成功
4. **Max retry exceeded**: 5 連続 429 → `RateLimitExhausted` throw
5. **Safety block**: 400 with blockReason → `SafetyBlocked` throw
6. **Invalid JSON returned**: parse エラー時は `ClassifierOutputInvalid` throw

### 検証チェックリスト
- [ ] パッケージ名が `@google/genai`（旧 `@google/generative-ai` は deprecated）
- [ ] モデル ID が `gemini-2.5-flash-lite`
- [ ] `responseMimeType: 'application/json'` + `responseJsonSchema` で structured output
- [ ] zod schema と `zodToJsonSchema` 組合せで型整合
- [ ] リトライ 5 回、バックオフ間隔が指数的
- [ ] すべてのテストが緑
- [ ] 本文 truncate 上限が定数化されている（再調整可能）

### Anti-pattern guard
- ❌ 旧 `@google/generative-ai` を import する（deprecated, 2025-12-16 archive）
- ❌ `GoogleGenerativeAI` クラス名を使う（正しくは `GoogleGenAI`）
- ❌ `responseSchema` + Type enum の旧 API を使う（`responseJsonSchema` が新推奨）
- ❌ 429 で無限リトライ
- ❌ `c` 等の Hono Context を classifier に渡す（純粋関数を維持）

---

## Phase 3: IMAP Fetch + Mail Parse Service

### 目的
Yahoo Mail IMAP から未読メールを取得し、`mailparser` でパースする純粋 service を作る。DB や Gemini は呼ばない。

### 作業対象
- `apps/api/package.json` — `imapflow@^1.3`, `mailparser@^3.9`, `@types/mailparser@^3.4` 追加
- `apps/api/src/lib/imap.ts` — 接続ラッパー（ImapFlow client factory）
- `apps/api/src/services/mail-collector.ts` — `fetchUnread(): Promise<ParsedMail[]>` 実装
- `apps/api/src/services/mail-collector.test.ts` — unit test（imapflow mock）

### コピー元
- https://imapflow.com/docs/getting-started/quick-start の connect + fetch パターン
- https://nodemailer.com/extras/mailparser/ の simpleParser

### 接続コード形（Phase 0 調査で確定）
```ts
const client = new ImapFlow({
  host: 'imap.mail.yahoo.co.jp',
  port: 993,
  secure: true,
  auth: { user: process.env.YAHOO_IMAP_USER!, pass: process.env.YAHOO_IMAP_APP_PASS! },
  logger: false,
});
await client.connect();
const lock = await client.getMailboxLock('INBOX');
try {
  const uids = await client.search({ seen: false }, { uid: true });
  for await (const msg of client.fetch(uids, { envelope: true, source: true, uid: true })) {
    const parsed = await simpleParser(msg.source as Buffer);
    // ...
  }
} finally {
  lock.release();
  await client.logout();
}
```

### 仕様
- フォルダ: `INBOX` 決め打ち
- 検索: `{ seen: false }`（未読のみ）
- AI に渡す本文: `parsed.text || htmlToText(parsed.html || '')`
- 既読化: 処理完了後 `client.messageFlagsAdd(uid, ['\\Seen'])` を呼ぶ（**削除はしない**）
- 添付: Phase 3 MVP では保存のみ。DB には `ai_extracted` 経由で保存しない（将来 Phase 3.2 で拡張）

### テスト (API テスト、テストファースト)
1. **未読 3 件取得** → subject/from/date/text が正しく抽出される
2. **未読 0 件** → 空配列を返す
3. **multipart + 添付あり** → text/plain が優先、添付 Buffer は Attachment[] で返る
4. **IMAP 接続失敗** → `ImapConnectionError` throw
5. **lock release & logout** が例外パスでも呼ばれる（finally 保証）

### 検証チェックリスト
- [ ] `imapflow` v1.3.x, `mailparser` v3.9.x を pin
- [ ] `ImapFlow` 接続パラメータが Yahoo JP 用（host/port/secure 定数）
- [ ] `simpleParser(msg.source as Buffer)` が正しく呼ばれている
- [ ] フラグ操作は `\\Seen` 付与のみ、`\\Deleted` は使わない
- [ ] `getMailboxLock('INBOX')` → `lock.release()` が try/finally で保証されている
- [ ] すべてのテストが緑

### Anti-pattern guard
- ❌ `node-imap` / `imap-simple` を使う（imapflow を採用）
- ❌ `\\Deleted` + EXPUNGE で Yahoo 側からメールを消す（Yahoo は EXPUNGE 挙動がプロバイダ依存、MVP では触らない）
- ❌ 生パスワードで auth（必ず Yahoo App Password）
- ❌ connection pool を作る（PoC は 1 実行 1 接続で十分）

---

## Phase 4: Orchestrator Route + Rate Guards + 環境変数

### 目的
`POST /api/tournament-announcements/fetch` を追加し、mail-collector → classifier → DB 保存を束ねる。二重安全ガードも実装。

### 作業対象
- `.env.example` — `GEMINI_API_KEY`, `YAHOO_IMAP_USER`, `YAHOO_IMAP_APP_PASS` を追記（説明コメント付き）
- `apps/api/src/routes/tournament-announcements.ts` — 新規ルート
- `apps/api/src/app.ts` — `.route('/tournament-announcements', ...)` を追加
- `apps/api/src/services/announcement-orchestrator.ts` — mail-collector + classifier + DB 書込の orchestration
- `apps/api/src/services/rate-guard.ts` — 日次実行回数・1実行最大メール数の guard
- `apps/api/src/routes/tournament-announcements.test.ts` — route 単位テスト

### コピー元
- **Hono route 構造**: `apps/api/src/routes/events.ts` lines 29-48
- **App 登録**: `apps/api/src/app.ts` lines 1-22 の `.route()` mount パターン
- **DB insert pattern**: `events.ts` lines 45-48 の `db.insert(events).values(body).returning()`

### ルート仕様
```
POST /api/tournament-announcements/fetch
- Request: empty body（管理者が手動でポチる）
- Response (200): {
    runId: string, fetched: number, classified: number,
    tournament: number, skipped: number, errors: Array<{uid, reason}>
  }
- Response (429): {
    error: 'rate_limit', reason: 'daily_runs_exceeded' | 'too_many_new_mails'
  }
- Response (503): { error: 'upstream', reason: 'imap' | 'gemini' }
```

※ Hono 認証は Phase 1-V で入るため、**このルートはいったん無認証で公開**。代わりに **apps/web の server action 経由でしか呼ばれない**ことを前提にする（環境変数で `INTERNAL_API_TOKEN` を要求するガードを追加）。

### Rate guard 仕様
- **1実行あたりメール上限**: 30 通。31 通目以降はその run では処理せず、次 run に持ち越し（未読フラグで自然に残る）
- **日次実行回数上限**: 3 回/日。run count は `tournament_announcements` の `processed_at` を DATE 単位で count
- **新着閾値**: 未読が 100 通超なら実行せず `too_many_new_mails` エラー（管理者が手動 cleanup してから再実行）

### テスト (API + service テスト)
1. **正常系**: 未読 3 通 → AI 判定 → DB insert 3 行（pending 2, skipped 1）→ 200 response
2. **既存 message_id との重複** → unique 制約で skip されログに警告出力
3. **Rate guard: 日次 3 回超** → 429 `daily_runs_exceeded`
4. **Rate guard: 未読 100 超** → 429 `too_many_new_mails`
5. **IMAP エラー伝播** → 503 `imap`
6. **Gemini RateLimitExhausted 伝播** → 503 `gemini` + 部分成功行は保存済み
7. **Internal token 不一致** → 401

### 検証チェックリスト
- [ ] `.env.example` に 3 変数を追加（description コメント込）
- [ ] Orchestrator が失敗してもすでに保存した行はコミットされる（partial failure の扱い明記）
- [ ] Rate guard が DB 問い合わせベース（外部 KV 不要）
- [ ] Internal token が `crypto.timingSafeEqual` で比較（タイミング攻撃対策）
- [ ] すべてのテストが緑
- [ ] `pnpm --filter @kagetra/api test` 緑

### PR-E1 の DoD
- [ ] Phase 1〜4 完了
- [ ] API テスト+service テスト全部緑
- [ ] CI 緑（typecheck + lint + test）
- [ ] Codex レビュー完了・指摘対応済み
- [ ] claude-mem に「Phase 3 MVP PR-E1 完了」記録
- [ ] PR description に「UI は PR-E2 で実装」明記

### Anti-pattern guard
- ❌ orchestrator 内で try/catch を握り潰す（partial failure は構造化ログに記録）
- ❌ rate guard を外部 Redis 等に依存させる（MVP は DB で十分）
- ❌ Internal token を `===` で比較
- ❌ `apps/web` から `apps/api` を import（HTTP 経由で呼ぶ、Hono RPC client 型のみ共有）

---

## Phase 5: Admin 一覧 UI (frontend)

### 目的
`/admin/tournament-announcements` 一覧ページと「メール取込」ボタンを作る。

### 作業対象
- `apps/web/src/app/(app)/admin/tournament-announcements/page.tsx` — 一覧（server component）
- `apps/web/src/app/(app)/admin/tournament-announcements/actions.ts` — `triggerFetch` server action
- `apps/web/src/app/(app)/admin/tournament-announcements/actions.test.ts`

### コピー元
- **一覧ページ構造**: `apps/web/src/app/(app)/admin/members/page.tsx`（table + 役割 guard + inline action）
- **役割 guard**: 同ファイル lines 34-37 の `if (!session || session.user?.role !== 'admin' ...) redirect('/403')`
- **server action + admin 検査**: `apps/web/src/app/(app)/admin/members/[id]/edit/actions.ts` lines 45-52 `assertAdminSession`

### UI 仕様
- Section A: 未承認一覧（status=pending を新しい順）— 列: 受信日時, 件名, AI 信頼度, 抽出大会名, [詳細]リンク
- Section B: スルー一覧（status=skipped を新しい順）— 列: 受信日時, 件名, AI 判定理由
- トップに `[メール取込]` ボタン（form action で server action 呼出）
- Rate limit エラーは toast 風にメッセージ表示
- ページネーション無し（MVP、50 件決め打ち）

### テスト
1. **server action**: admin が呼ぶと `POST /api/tournament-announcements/fetch` に internal token 付きで到達
2. **非 admin**: `redirect('/403')` が呼ばれる（既存 `mockAuthModule` パターン踏襲）
3. **ページレンダリング**: pending 3 + skipped 2 を seed して render（server component の vitest 代替は snapshot or プリミティブ assert）

### 検証チェックリスト
- [ ] 役割 guard が存在（admin + vice_admin のみ通す、または admin 限定？ → **admin 限定**推奨）
- [ ] UI は既存 admin/members と同じ Tailwind plain HTML スタイル
- [ ] shadcn/ui はこの PR では導入しない（UI 固めフェーズの範囲外）
- [ ] server action テスト緑

---

## Phase 6: Admin 承認 UI + events 昇格

### 目的
`/admin/tournament-announcements/[id]` 詳細ページと承認/却下 action を実装。承認時に events 行を作成して `linked_event_id` を紐付ける。

### 作業対象
- `apps/web/src/app/(app)/admin/tournament-announcements/[id]/page.tsx`
- `apps/web/src/app/(app)/admin/tournament-announcements/[id]/actions.ts` — `approveAnnouncement`, `rejectAnnouncement`
- `apps/web/src/app/(app)/admin/tournament-announcements/[id]/actions.test.ts`

### コピー元
- **詳細 + edit form**: `apps/web/src/app/(app)/admin/members/[id]/edit/page.tsx`
- **approve action shape**: 既存 `updateMemberProfile` の Error handling + `UpdateProfileState` pattern

### 承認フロー
1. 管理者が pending 行の「承認」ボタンを押す
2. `approveAnnouncement` server action が `ai_extracted` を読み、`events` テーブルに insert
   - title ← `ai_extracted.title`
   - eventDate ← `ai_extracted.event_date`
   - location ← `ai_extracted.venue`
   - entryDeadline ← `ai_extracted.entry_deadline`
   - status ← `'draft'`（管理者が後から publish に変更）
   - createdBy ← current admin user id
3. 作成した events.id を `tournament_announcements.linked_event_id` に書き込み、status を `approved` に
4. 失敗時はトランザクション rollback

### 詳細ページ UI
- 受信メール原文（subject, from, body text）
- AI 判定結果（is_tournament, confidence, reason）
- AI 抽出 JSON（編集可能なフォーム: title/event_date/venue/fee/deadline）
- 承認前に抽出値を修正できる（admin が AI の間違いを直して保存）
- [承認して events に作成] / [却下] / [キャンセル] ボタン

### テスト
1. **承認正常系**: pending 行 → events insert + 紐付け + status=approved
2. **承認: AI 抽出値を admin が修正** → 修正後の値で events が作成される
3. **却下**: status=rejected、events は作成されない
4. **非 admin による承認試行** → Unauthorized
5. **トランザクション失敗**: events insert 失敗時 tournament_announcements の更新も rollback
6. **重複承認**: すでに approved な行を再承認しても idempotent

### 検証チェックリスト
- [ ] `approveAnnouncement` が Drizzle transaction を使っている
- [ ] `assertAdminSession` を server action の先頭で呼んでいる
- [ ] フォーム入力値が zod で検証されている
- [ ] テスト全部緑

---

## Phase 7: E2E + 最終検証

### 目的
Playwright E2E テストで admin ログイン → メール取込（mock）→ 承認 → events 作成の一連フローを確認し、スマホ実機で UI 確認。

### 作業対象
- `apps/web/e2e/tournament-announcements-approval.spec.ts` — 新規 E2E
- `apps/web/e2e/fixtures/tournament-announcements.ts` — シードデータ helper（必要なら）

### コピー元
- **E2E 構造**: `apps/web/e2e/self-identify-flow.spec.ts` lines 1-66
- **admin session seed**: `apps/web/src/test-utils/playwright-auth.ts` の `seedAdminSession`
- **cookie 注入**: 同ファイルの cookie pattern

### E2E シナリオ
1. `seedAdminSession` で admin セッション作成
2. `tournament_announcements` に pending 行を 2 件 direct insert（IMAP と Gemini はテストでは呼ばない。orchestrator を bypass）
3. admin としてログイン → `/admin/tournament-announcements` に遷移
4. 一覧に 2 件表示される
5. 1 件目の「詳細」→「承認」→ events が作成される
6. DB 側で events row と `linked_event_id` を検証

### 手動 smoke test
- **実機 IMAP 接続テスト**: 1 Yahoo アカウントに事前にテストメールを流し、`[メール取込]` ボタンを押して pending 行が生成されることを確認
- **Gemini API 実接続**: 大会案内メールと非大会メールを 1 通ずつ入れ、分類が正しく行われることを確認
- **スマホ実機**: iPhone Safari で `/admin/tournament-announcements` が table scroll で崩れていないか確認

### PR-E2 の DoD
- [ ] Phase 5〜7 完了
- [ ] vitest + Playwright E2E 緑
- [ ] CI 緑
- [ ] Codex レビュー完了・対応済み
- [ ] スマホ実機確認済み
- [ ] 実機 IMAP + Gemini の smoke test 成功
- [ ] claude-mem に「Phase 3 MVP PR-E2 完了」記録
- [ ] PR description に「次ステップ: cron 実行基盤, PDF/Word 解析, LINE 通知連携」と明記

---

## Allowed APIs 一覧（Phase 0 調査の結論）

| 用途 | パッケージ | バージョン | 公式 URL |
|---|---|---|---|
| Gemini SDK | `@google/genai` | ^1.50.0 | https://github.com/googleapis/js-genai |
| Gemini structured output | （上記 SDK 内蔵） | — | https://ai.google.dev/gemini-api/docs/structured-output |
| zod → JSON schema | `zod-to-json-schema` | ^3.x | https://www.npmjs.com/package/zod-to-json-schema |
| IMAP client | `imapflow` | ^1.3.0 | https://imapflow.com/ |
| Mail parser | `mailparser` | ^3.9.0 | https://nodemailer.com/extras/mailparser/ |
| Mail parser 型 | `@types/mailparser` | ^3.4.0 | DefinitelyTyped |

### 確定 API シンボル
- `GoogleGenAI` クラス（`GoogleGenerativeAI` ではない）
- `ai.models.generateContent({ model, contents, config })`
- `config.responseMimeType: 'application/json'` + `config.responseJsonSchema: zodToJsonSchema(...)`
- `ImapFlow` クラス、`client.connect() / getMailboxLock() / search() / fetch() / messageFlagsAdd() / logout()`
- `simpleParser(buffer): Promise<ParsedMail>` — `{ text, html, subject, from, date, attachments[] }`

---

## Anti-Patterns（全 Phase 共通・必ず避ける）

- ❌ `@google/generative-ai` の import（2025-12 deprecated）
- ❌ `GoogleGenerativeAI` class の使用（正しくは `GoogleGenAI`）
- ❌ 旧 `responseSchema` + Type enum（正しくは `responseJsonSchema`）
- ❌ `node-imap` or `imap-simple` の使用（imapflow 採用）
- ❌ Yahoo IMAP に通常パスワードで接続（App Password 必須）
- ❌ `\\Deleted` フラグ + EXPUNGE（MVP は既読化のみ）
- ❌ AI 呼び出しに課金口座を紐付け（無料枠のまま、AI Studio API key のみで運用）
- ❌ Phase 1-V の Hono 認証が入る前提のコード（Phase 1-V 前なので internal token で代用）
- ❌ schema 変更を `db:generate` なしで手書き SQL 作成
- ❌ `apps/web` から `apps/api` を直接 import（HTTP または RPC client 型経由）

---

## 運用前に再確認すべき Gap

1. **AI Studio rate-limit ダッシュボード** (https://aistudio.google.com/rate-limit) で `gemini-2.5-flash-lite` の実効 RPD/RPM を確認（2025-12 に free tier が 50〜80% 絞られた前例あり）
2. **Yahoo JP の App Password** 発行 + 1 アカウントで smoke test を事前実施（プロバイダ仕様変更リスク）
3. **データ保護**: Gemini 無料枠は入力を学習に利用する規約。本文に個人名・連絡先が含まれるメールを原文のまま投入するか、差出人ドメイン以外マスクするか、運用ルールを PR-E1 merge 前に確定

---

## サイズ見積もり

| Phase | 規模 | 見積工数 |
|---|---|---|
| Phase 1 | schema 1 + migration | 30 分 |
| Phase 2 | service + 6 テスト | 半日 |
| Phase 3 | service + 5 テスト | 半日 |
| Phase 4 | route + orchestrator + 7 テスト | 1 日 |
| Phase 5 | 一覧ページ + action | 半日 |
| Phase 6 | 承認 action + 詳細ページ + 6 テスト | 1 日 |
| Phase 7 | E2E + 実機検証 | 半日 |
| **合計** | — | **4〜5 営業日**（レビュー待ち除く） |

---

## 承認後のフロー

1. ユーザー承認
2. `feat/phase-3-mvp-yahoo-mail-backend` ブランチを worktree で作成
3. `/claude-mem:do` の明示指示を待って Phase 1 から実装開始
4. Phase 4 完了時点で PR-E1 作成 → Codex レビュー → ship
5. main 同期後 `feat/phase-3-mvp-yahoo-mail-frontend` で Phase 5〜7 実施
6. PR-E2 ship → Phase 3 MVP 完了
