# PR3 実装計画 — AI 抽出 + tournament_drafts

`/claude-mem:do` で execute する phased plan。各 phase は subagent session に投げられる程度に self-contained。

参照: [requirements.md](./requirements.md) / [implementation-plan.md](./implementation-plan.md) / 親 Issue #11 / 子 Issue #14

---

## Phase 0: Documentation Discovery 結果（必読）

### Anthropic SDK 公認ファクト

- **SDK バージョン**: `@anthropic-ai/sdk@^0.91.1`（npm 最新安定版、Node 22.13+ で動く、`engines` 制約なし）
- **モデル ID**: `'claude-sonnet-4-6'`（日付 suffix 無し、これが正しい）
- **Tool use 強制 structured output**:
  ```ts
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    tools: [{
      name: 'record_extraction',
      description: 'Record the extracted tournament announcement fields.',
      input_schema: zodToJsonSchema(ExtractionPayloadSchema), // JSON Schema object
    }],
    tool_choice: { type: 'tool', name: 'record_extraction' },
    messages: [{ role: 'user', content: [...] }],
  });

  // Reading: narrow by .type === 'tool_use'
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  const parsed = toolUse?.input; // 既に parsed object（JSON.parse 不要）
  ```
- **PDF document block**:
  ```ts
  content: [
    { type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      cache_control: { type: 'ephemeral' }, // optional
    },
    { type: 'text', text: 'Extract...' },
  ]
  ```
  - Sonnet 4.6 (1M context) は 600 page / 32MB max（200K context モデルだと 100 page）
  - PDF は text の **前** に置くのが推奨
- **Cache control**:
  - `cache_control: { type: 'ephemeral', ttl: '1h' }`（5min default、`ttl` 省略可）
  - **beta header 不要**（GA on `2023-06-01` API）
  - 配置可能: system / user / assistant / tool definitions / 個別 content block
  - 最大 4 breakpoints、最低 2048 tokens 以下は no-op
- **Token usage 響応フィールド**: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
- **Retry**: SDK 内蔵で 429（`Retry-After` honor）+ 5xx を exponential backoff、`new Anthropic({ maxRetries: 3 })` で 3 回に上げる（default 2）
- **Cost (USD / 1M tokens)**: input $3 / output $15 / cache read $0.30 / cache write 5m $3.75 / cache write 1h $6.00

### Codebase 参照ポイント（コピー元）

| 用途 | パス | line |
|------|------|------|
| pgEnum 宣言 | `packages/shared/src/schema/enums.ts` | 15-30 |
| pgTable + serial PK + UNIQUE + index | `packages/shared/src/schema/mail-messages.ts` | 17-42 |
| customType (PR3 では使わない、参考) | `packages/shared/src/schema/mail-attachments.ts` | 22-26 |
| FK + onDelete cascade | `packages/shared/src/schema/mail-attachments.ts` | 47-49 |
| check constraint with `sql\`\`` | `packages/shared/src/schema/auth.ts` | 39-43 |
| relations 1:0..1 | `packages/shared/src/schema/relations.ts` | 48-57 |
| MailSource interface (LLMExtractor の型枠) | `apps/mail-worker/src/fetch/fetcher.ts` | 18-21 |
| Live/Fixture 実装ペア | `apps/mail-worker/src/fetch/fetcher.ts` | 27-96 |
| Pipeline txn 境界 | `apps/mail-worker/src/pipeline.ts` | 167-203 |
| ON CONFLICT idempotent insert | `apps/mail-worker/src/persist/mail-message.ts` | 39-75 |
| Extractor routing (LLM provider 同形) | `apps/mail-worker/src/extract/orchestrator.ts` | 19-86 |
| vitest config | `apps/mail-worker/vitest.config.ts` | 1-16 |
| TRUNCATE helper | `apps/mail-worker/test/test-db.ts` | 25-30 |
| eml builder | `apps/mail-worker/test/fixtures/attachments/builders.ts` | 154-205 |
| CLI flag parsing | `apps/mail-worker/src/index.ts` | 31-56 |
| config split (loadLlmConfig 同形) | `apps/mail-worker/src/config.ts` | 25-88 |
| mail-inbox relation query | `apps/web/src/app/(app)/admin/mail-inbox/page.tsx` | 66-88 |
| AttachmentList (DraftCard 同形) | `apps/web/src/app/(app)/admin/mail-inbox/components/AttachmentList.tsx` | 47-76 |
| Pill 6 tones | `apps/web/src/components/ui/pill.tsx` | 1-59 |
| 直前 migration 例 | `packages/shared/drizzle/0005_mail_messages.sql` | 1-21 |

### Anti-patterns（やらない）

- ❌ tool response を `JSON.parse(content[0].text)` する — `content` を `.type === 'tool_use'` で narrow して `.input` を直接使う
- ❌ Postgres txn 内で AI 呼び出し — pool 占有、PR2 で確立した「extract は txn 外、persist だけ txn 内」の原則を維持
- ❌ ON CONFLICT DO NOTHING の followup SELECT を省く — race 防御
- ❌ Config schema を 1 本にまとめる — `loadLlmConfig` を独立追加（PR1 r4 で確立した分割原則）
- ❌ 古い date-suffixed Sonnet モデル ID (`claude-sonnet-4-5-20251022` など) を使う — `claude-sonnet-4-6` のみ
- ❌ tool input schema に Zod object 直接渡し — 必ず `zodToJsonSchema()` 経由で JSON Schema 化

---

## Phase 1: Schema + migration

### What to implement

1. **Add enum** `tournamentDraftStatusEnum` in [enums.ts](../../../packages/shared/src/schema/enums.ts)
   - 値: `'pending_review' | 'approved' | 'rejected' | 'ai_failed' | 'superseded'`
   - 既存 `mailMessageStatusEnum` (line 16-25) のパターンを **コピー**

2. **Create** `packages/shared/src/schema/tournament-drafts.ts`
   - PK: `integer('id').primaryKey().generatedAlwaysAsIdentity()`
   - `messageId integer NOT NULL UNIQUE references mail_messages.id ON DELETE CASCADE`
   - `status tournamentDraftStatusEnum NOT NULL DEFAULT 'pending_review'`
   - `confidence numeric(3,2)` nullable + check `BETWEEN 0 AND 1`（`auth.ts` line 39-43 のパターン）
   - `isCorrection boolean NOT NULL DEFAULT false`
   - `referencesSubject text` nullable
   - `supersededByDraftId integer` nullable, **self-FK**（migration では同 file 末尾の ALTER で）
   - `extractedPayload jsonb NOT NULL DEFAULT sql\`'{}'::jsonb\``
   - `aiRawResponse text` nullable
   - `promptVersion text NOT NULL`
   - `aiModel text NOT NULL`
   - `aiTokensInput integer` nullable
   - `aiTokensOutput integer` nullable
   - `aiCostUsd numeric(10,6)` nullable
   - `eventId integer references events.id ON DELETE SET NULL` nullable
   - `approvedByUserId text references users.id ON DELETE SET NULL` nullable
   - `approvedAt timestamp tz` nullable
   - `rejectedByUserId text references users.id ON DELETE SET NULL` nullable
   - `rejectedAt timestamp tz` nullable
   - `rejectionReason text` nullable
   - `createdAt`, `updatedAt timestamp tz NOT NULL DEFAULT now()`
   - Index: `(status, created_at DESC)` 名は `idx_drafts_status_created`

3. **Update** [relations.ts](../../../packages/shared/src/schema/relations.ts)
   - `mailMessages` ← `tournamentDrafts` を 1:0..1 で `one()` 追加（mail_attachments パターン line 52-57 をコピー）
   - `tournamentDrafts` → `mailMessages` を `one()` で逆方向
   - `tournamentDrafts` → `events` を `one()` で
   - `tournamentDrafts` → 自身（`supersededByDraftId`）の関係は relations では宣言しない（drizzle 自己参照は ambiguous、生 SQL のみで FK）

4. **Update** [index.ts](../../../packages/shared/src/schema/index.ts) で re-export

5. **Generate migration**:
   ```bash
   pnpm --filter=@kagetra/shared db:generate
   ```
   → `packages/shared/drizzle/0008_<auto-name>.sql` が生成される。生成 SQL を **手動レビュー**:
   - enum CREATE TYPE が table CREATE より前にある
   - 自己 FK は同 migration 末尾の `ALTER TABLE ADD CONSTRAINT` で（drizzle がそうしない場合は手で並べ替え）
   - check constraint と UNIQUE が反映されている

### Verification

```bash
# Schema 通る
pnpm --filter=@kagetra/shared check-types

# Migration が test DB に push できる
pnpm test:db:push

# 既存 mail-worker test が壊れていない
pnpm --filter=@kagetra/mail-worker test
```

### Anti-pattern guards

- ❌ enum 名を `draftStatusEnum` にしない（衝突回避のため `tournamentDraftStatusEnum` 固定）
- ❌ migration を手書きしない（必ず `db:generate` から）
- ❌ 自己参照 FK を drizzle スキーマで `references(() => tournamentDrafts.id)` として書く — TypeScript の循環参照になる、SQL 側の ALTER のみ

---

## Phase 2: LLMExtractor 抽象 + Zod schema + cost

### What to implement

1. **Add deps** to `apps/mail-worker/package.json`:
   ```json
   "@anthropic-ai/sdk": "^0.91.1",
   "zod-to-json-schema": "^3.23.0"  // npm 最新確認のうえ pin
   ```

2. **Create** `apps/mail-worker/src/classify/schema.ts` — Zod schema
   - `ExtractionPayloadSchema` を [requirements.md §4](../requirements.md) §4.1 (line 451-498) からコピー
   - `export type ExtractionPayload = z.infer<typeof ExtractionPayloadSchema>`

3. **Create** `apps/mail-worker/src/classify/llm/types.ts` — interface
   - [fetcher.ts:18-21](../../../apps/mail-worker/src/fetch/fetcher.ts) の `MailSource` パターンをコピー
   - `LLMExtractionInput` / `LLMExtractionResult` / `LLMExtractor` を spec [requirements.md:418-445](../requirements.md) のままで定義

4. **Create** `apps/mail-worker/src/classify/cost.ts` — token → USD
   ```ts
   // Sonnet 4.6 prices (USD per 1M tokens, Apr 2026)
   const PRICE_INPUT = 3.0
   const PRICE_OUTPUT = 15.0
   const PRICE_CACHE_READ = 0.30
   const PRICE_CACHE_WRITE_1H = 6.0

   export function calculateCostUsd(usage: {
     input_tokens: number
     output_tokens: number
     cache_creation_input_tokens?: number
     cache_read_input_tokens?: number
   }): number {
     const fresh = (usage.input_tokens / 1e6) * PRICE_INPUT
     const cached = ((usage.cache_read_input_tokens ?? 0) / 1e6) * PRICE_CACHE_READ
     const written = ((usage.cache_creation_input_tokens ?? 0) / 1e6) * PRICE_CACHE_WRITE_1H
     const out = (usage.output_tokens / 1e6) * PRICE_OUTPUT
     return fresh + cached + written + out
   }
   ```

5. **Create** `apps/mail-worker/src/classify/llm/fixture.ts` — `FixtureLLMExtractor`
   - subject ベースの `Map<string, ExtractionPayload>` lookup
   - default は noise レスポンス
   - `model: 'fixture'`, `promptVersion: 'fixture-1.0'`

6. **Create** `apps/mail-worker/src/classify/llm/broken.ts` — `BrokenLLMExtractor`
   - 常に validate 失敗する `parsed` を返す（schema に合わない object）
   - test で classifier の retry 経路を発火させる用途

### Verification

```bash
pnpm --filter=@kagetra/mail-worker check-types
# zod-to-json-schema が import できる
node -e "import('zod-to-json-schema').then(m => console.log(typeof m.zodToJsonSchema))"
```

### Anti-pattern guards

- ❌ cost の static USD→JPY rate を入れない — DB は USD で保存、JPY 換算は表示時のみ
- ❌ `LLMExtractor.extract()` に Anthropic 固有型を漏らさない — interface は provider 中立

---

## Phase 3: Anthropic 実装

### What to implement

`apps/mail-worker/src/classify/llm/anthropic.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ExtractionPayloadSchema, type ExtractionPayload } from '../schema.js'
import type { LLMExtractor, LLMExtractionInput, LLMExtractionResult } from './types.js'
import { calculateCostUsd } from '../cost.js'

const TOOL_NAME = 'record_extraction'
const MODEL_ID = 'claude-sonnet-4-6'

export class AnthropicSonnet46Extractor implements LLMExtractor {
  private client: Anthropic
  constructor(opts: { apiKey: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3 })
  }

  async extract(input: LLMExtractionInput): Promise<LLMExtractionResult> {
    const inputSchemaJson = zodToJsonSchema(ExtractionPayloadSchema)
    const userContent = [
      ...input.attachments.map((a) => /* PDF document blocks first */),
      { type: 'text' as const, text: buildUserPrompt(input) },
    ]

    const response = await this.client.messages.create({
      model: MODEL_ID,
      max_tokens: 4096,
      system: [
        { type: 'text', text: input.systemPrompt,
          cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      tools: [{
        name: TOOL_NAME,
        description: 'Record extracted tournament fields.',
        input_schema: inputSchemaJson as Anthropic.Tool.InputSchema,
      }],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: userContent }],
    })

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    if (!toolUse) {
      throw new LLMNoToolUseError('AI returned no tool_use block', response.content)
    }
    const parsed = ExtractionPayloadSchema.parse(toolUse.input) // Zod 失敗は throw
    return {
      parsed,
      raw: JSON.stringify(toolUse.input),
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      costUsd: calculateCostUsd(response.usage),
      model: MODEL_ID,
      promptVersion: input.promptVersion,
    }
  }
}

export class LLMNoToolUseError extends Error {
  constructor(msg: string, public content: Anthropic.ContentBlock[]) {
    super(msg)
  }
}
```

PDF block 構築:
```ts
{ type: 'document' as const,
  source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } }
```

### Verification

```bash
pnpm --filter=@kagetra/mail-worker check-types
# 実 API は叩かない（Phase 8 の cache-smoke で）
```

### Anti-pattern guards

- ❌ `tool_choice` を `{ type: 'auto' }` で出さない — 強制呼び出ししないと AI が説明文を返す
- ❌ `cache_control` を user content block 全部に付ける — 4 breakpoints 制限。system block + 動かない部分にだけ付与
- ❌ `Anthropic.ToolUseBlock` に narrow せず `content[0]` を盲目アクセス — type narrow 必須
- ❌ Zod schema を tool 引数にそのまま渡す — `zodToJsonSchema()` 経由

---

## Phase 4: classifier + persist + reextract CLI

### What to implement

1. **Create** `apps/mail-worker/src/classify/classifier.ts`:
   - `classifyMail(messageId: number, llm: LLMExtractor, opts?: { force?: boolean }): Promise<ClassifyResult>`
   - 流れ:
     1. `mail_messages.findFirst({ where: id, with: { attachments: { columns: { ... } } } })`
     2. `mail_messages.classification === 'noise'` なら早期 return（`opts.force` で override 可）
     3. system prompt + user content build
     4. `llm.extract()` を try/catch で 1 回 retry on Zod validate fail
     5. 成功時: parsed を返す
     6. 失敗時: ai_failed result を返す（raw text 保存用）
   - **noise 判定**: AI 結果の `is_tournament_announcement === false` なら mail.classification を `'noise'` に upgrade（直接 update せず ClassifyResult に含めて呼び出し側で）

2. **Create** `apps/mail-worker/src/classify/prompt.ts`:
   - `export const PROMPT_VERSION = '1.0.0'`
   - `export function buildSystemPrompt(): string` — few-shot 3 件: 陽性（大会案内 PDF）、陰性（メルマガ）、訂正版
   - `export function buildUserPrompt(input: LLMExtractionInput): string`

3. **Create** `apps/mail-worker/src/persist/draft.ts`:
   - `upsertDraft(db, input): Promise<{ row, action: 'inserted' | 'updated' }>`
   - `INSERT ... ON CONFLICT (message_id) DO UPDATE SET extracted_payload, prompt_version, ai_model, ... = excluded.*, updated_at = now() RETURNING *`
   - 再抽出時の UPDATE 経路を 1 SQL で表現

4. **Create** `apps/mail-worker/src/reextract.ts` CLI:
   - `pnpm tsx apps/mail-worker/src/reextract.ts --since=YYYY-MM-DD`
   - `mail_messages.findMany({ where: receivedAt >= since AND status IN ('ai_done','ai_failed') })` で対象列挙
   - 各 mail に対し `classifyMail(id, llm, { force: true })` → `upsertDraft`
   - エントリポイント: `if (import.meta.url === `file://${process.argv[1]}`) main()`

### Verification

```bash
pnpm --filter=@kagetra/mail-worker check-types
# 単体テストは Phase 7 で
```

### Anti-pattern guards

- ❌ classifier 内で DB 書き込み — classifier は **読み取り + LLM 呼び出しのみ**、書き込みは pipeline / reextract に分離
- ❌ Server Action から apps/mail-worker を直接 import — apps/web は CLI package を import しない（PR4 で分離方法を決める）
- ❌ classifier で `--force` を毎回 true にする — pipeline は noise スキップ、reextract のみ force

---

## Phase 5: Pipeline 統合 + index.ts CLI

### What to implement

1. **Update** `apps/mail-worker/src/pipeline.ts` (line 167-203 周辺):
   - `runPipeline({ source, llmExtractor })` に `llmExtractor: LLMExtractor` option 追加
   - 既存の mail+attachments txn の **後**、別 txn で classifier → upsertDraft 流す
   - 流れ:
     1. mail+attachments txn コミット成功（既存）
     2. `if (mail.classification === 'noise') skip AI`（既存 pre-filter で確定済み）
     3. `await db.update(mailMessages).set({ status: 'ai_processing' }).where(id)`
     4. `const result = await classifyMail(mail.id, llmExtractor)`
     5. 結果に応じて:
        - 陽性 (`is_tournament_announcement === true`) → `upsertDraft({ status: 'pending_review', ...result })` + `mail.status = 'ai_done'`
        - 陰性 (`is_tournament_announcement === false`) → draft 作らず `mail.status = 'ai_done'` + `classification = 'noise'`
        - 失敗 → `upsertDraft({ status: 'ai_failed', aiRawResponse: ..., extractedPayload: '{}' })` + `mail.status = 'ai_failed'`
   - エラー隔離: 1 mail の AI 失敗が batch を止めない（PR1 の per-mail try/catch と同形）
   - Counter: `summary.draftsInserted`, `draftsUpdated`, `aiFailed`, `aiSkippedNoise` を `PipelineSummary` に追加

2. **Update** `apps/mail-worker/src/config.ts`:
   - `loadLlmConfig()` を追加 — `ANTHROPIC_API_KEY` を要求（`--mock-llm` 時は不要なので呼び出し側で分岐）

3. **Update** `apps/mail-worker/src/index.ts`:
   - `--mock-llm` flag を [parseArgs](../../../apps/mail-worker/src/index.ts) line 31-56 に追加
   - flag 時: `new FixtureLLMExtractor(loadFixturesFromDir())` を渡す
   - 通常時: `new AnthropicSonnet46Extractor({ apiKey: loadLlmConfig().anthropicApiKey })`

4. **Update** `.env.example`:
   - `ANTHROPIC_API_KEY=sk-ant-...` を追加

### Verification

```bash
pnpm --filter=@kagetra/mail-worker check-types

# mock 経路で smoke
pnpm --filter=@kagetra/mail-worker exec tsx src/index.ts \
  --once --mock-imap --mock-llm --dry-run
# → drafts inserted/skipped counter が log される
```

### Anti-pattern guards

- ❌ AI 呼び出しを mail+attachments txn の中に入れる — connection pool 占有
- ❌ classify エラーで pipeline 全体を止める — 1 mail 失敗で他がスキップされる、PR1 の per-mail isolation と整合させる
- ❌ `--mock-llm` 時に `ANTHROPIC_API_KEY` を要求 — config が load 時に検証すると mock smoke が壊れる、loadLlmConfig は遅延評価

---

## Phase 6: UI — ConfidenceBadge + DraftCard + page.tsx

### What to implement

1. **Create** `apps/web/src/app/(app)/admin/mail-inbox/components/ConfidenceBadge.tsx`:
   - props: `{ confidence: number | null }`
   - `>= 0.9` → `<Pill tone="success">高 (0.95)</Pill>` 形式
   - `>= 0.5` → `<Pill tone="warn">中 (0.72)</Pill>`
   - `< 0.5` → `<Pill tone="neutral">低 (0.30)</Pill>`
   - `null` → `<Pill tone="neutral">—</Pill>`
   - 既存 [Pill](../../../apps/web/src/components/ui/pill.tsx) line 4-59 をそのまま使う、新規 component を作らない

2. **Create** `apps/web/src/app/(app)/admin/mail-inbox/components/DraftCard.tsx`:
   - props: `{ draft: { status, confidence, extractedPayload, isCorrection, referencesSubject } }`
   - 表示: 大会名 (extractedPayload.title) / 開催日 (extractedPayload.event_date) / ConfidenceBadge / status pill
   - 訂正版ヒント: `isCorrection` 時に「⚠ ${referencesSubject} の訂正版の可能性」を inline で（PR4 で正式 component 化予定）
   - layout は [AttachmentList](../../../apps/web/src/app/(app)/admin/mail-inbox/components/AttachmentList.tsx) line 47-76 を参考に flex col

3. **Update** `apps/web/src/app/(app)/admin/mail-inbox/page.tsx`:
   - line 76-84 の `findMany({ with: { attachments: ... } })` に `draft: { columns: { ... } }` を追加（Phase 1 の relation declaration が前提）
   - 各メールカードに `<DraftCard draft={mail.draft} />` を追加（draft が存在するときのみ）
   - filter 行は **追加しない**（PR4 へ持ち越し）

### Verification

```bash
pnpm --filter=@kagetra/web check-types
pnpm --filter=@kagetra/web lint
pnpm --filter=@kagetra/web test
# 必要なら pnpm dev:web で /admin/mail-inbox を実機確認（admin login で）
```

### Anti-pattern guards

- ❌ ConfidenceBadge を新規プリミティブ component として作る — 既存 Pill を流用
- ❌ draft が `null` の mail（pre-filter noise / AI 未実行）を「draft が無いメール」として hide — 一覧では「メール」が単位、draft は付加情報
- ❌ filter 行を実装する — PR4 スコープ、PR3 で先取りすると review 範囲が肥大

---

## Phase 7: Tests

### What to implement

1. **Create** `apps/mail-worker/test/fixtures/correction-tournament.eml` — 訂正版 eml
   - subject: `Re: 【訂正】第 65 回全日本選手権大会のご案内`
   - body に「先日の案内に誤りがありました」など訂正示唆フレーズ
   - [buildEml](../../../apps/mail-worker/test/fixtures/attachments/builders.ts) line 154-205 で生成

2. **Create** `apps/mail-worker/test/fixtures/llm/*.expected.json`:
   - `tournament-announcement.expected.json` — `is_tournament_announcement: true, confidence: 0.95, extracted: { title: '第 65 回...', event_date: '2026-05-30', ... }`
   - `newsletter.expected.json` — `is_tournament_announcement: false, confidence: 0.92`
   - `ml-tournament.expected.json` — 陽性、ML 系
   - `correction.expected.json` — `is_correction: true, references_subject: '第 65 回全日本選手権大会'`

3. **Create** `apps/mail-worker/test/classify/classifier.test.ts`:
   - test cases:
     - 陽性 fixture → `parsed.is_tournament_announcement === true`
     - 陰性 fixture → `parsed.is_tournament_announcement === false`
     - 訂正版 fixture → `parsed.is_correction === true`
     - `BrokenLLMExtractor` → retry 1 回 → 失敗 → `result.status === 'ai_failed'`
     - 再抽出: 同 mail を 2 回 classifyMail → `upsertDraft` が UPDATE 経路（`action: 'updated'`）
     - noise mail を `force: false` で classify → 早期 return、LLM 呼ばれない

4. **Create** `apps/mail-worker/test/classify/anthropic.test.ts`:
   - vi.mock で `@anthropic-ai/sdk` をモック
   - `AnthropicSonnet46Extractor.extract()` 呼び出し時の引数を spy
   - 検証:
     - `messages.create` が呼ばれた引数の `system[0].cache_control.type === 'ephemeral'`
     - `system[0].cache_control.ttl === '1h'`
     - `tool_choice === { type: 'tool', name: 'record_extraction' }`
     - `model === 'claude-sonnet-4-6'`
     - PDF が user content 先頭に置かれている（複数 PDF 添付時も）

5. **Update** `apps/mail-worker/test/pipeline.test.ts`:
   - `FixtureLLMExtractor` を pipeline に注入する経路を追加
   - end-to-end: eml fixture 入力 → mail+attachments insert → AI → drafts insert
   - noise eml は AI スキップ確認

6. **Update** `apps/mail-worker/test/test-db.ts`:
   - `truncateMailTables` を `tournament_drafts` も TRUNCATE するように拡張（CASCADE で entirely 落ちるか確認）

### Verification

```bash
pnpm --filter=@kagetra/mail-worker test
# 全 test pass、新規 ~20 test ケースが追加されている想定
```

### Anti-pattern guards

- ❌ 実 Anthropic API を test で叩く — 必ず mock SDK か `FixtureLLMExtractor`
- ❌ fixture JSON を Zod schema で validate していない — fixture 自体が `ExtractionPayloadSchema.parse()` を通ることを 1 つの test で確認
- ❌ test 内で `vi.spyOn` を `messages.create` 直接 — `vi.mock('@anthropic-ai/sdk')` で module 全体を差し替える方が安定

---

## Phase 8: Verification + cache smoke doc

### What to implement

1. **Run all checks**:
   ```bash
   pnpm check-types
   pnpm lint
   pnpm test
   pnpm test:e2e  # 既存 E2E が通ること
   ```

2. **Create** `docs/features/mail-tournament-import/cache-smoke.md`:
   - 手動 smoke 手順:
     1. `.env` に実 `ANTHROPIC_API_KEY` を入れる
     2. `pnpm --filter=@kagetra/mail-worker exec tsx src/index.ts --once --mock-imap` を 1 回叩く
     3. log で `cache_creation_input_tokens > 0` を確認（初回 cache 書き込み）
     4. 続けて同じコマンドを 5 分以内に再実行
     5. log で `cache_read_input_tokens > 0` を確認（cache hit）
     6. ship 前に 1 回実施、結果を PR description に貼る

3. **Final grep checks** (anti-pattern verification):
   ```bash
   # 古い model ID 残存確認
   pnpm exec grep -rn "claude-sonnet-4-5\|claude-3-5-sonnet" apps/ packages/ || echo "clean"

   # txn 内 LLM 呼び出し残存確認
   pnpm exec grep -rn "extract.*await.*db.transaction\|db\.transaction.*llm" apps/mail-worker/src/ || echo "clean"

   # tool_choice auto 残存確認
   pnpm exec grep -rn "type.*['\"]auto['\"]" apps/mail-worker/src/classify/ || echo "clean"
   ```

4. **Worklog 準備** (ship 時に書く、ここでは下書き):
   - PR3 で何を入れたか / 学び / git 状態 / 次回 を docs/worklog.md 用に控える

### Verification

- 全 check 緑
- cache-smoke は手動なので CI には乗せない、PR description に「smoke 実施済み: cache_read_input_tokens=XX」を記録

---

## 想定 commit 構造

PR3 は単一 PR だが、レビュー容易性のため commit を分割:

1. `feat(shared): PR3 phase 1 — tournament_drafts schema + migration`
2. `feat(mail-worker): PR3 phase 2 — LLMExtractor abstraction + Zod schema + cost`
3. `feat(mail-worker): PR3 phase 3 — Anthropic Sonnet 4.6 extractor (tool use + PDF + cache)`
4. `feat(mail-worker): PR3 phase 4-5 — classifier + draft persist + pipeline integration + reextract CLI`
5. `feat(web): PR3 phase 6 — ConfidenceBadge + DraftCard + inbox draft display`
6. `test(mail-worker): PR3 phase 7 — classifier tests + AI fixtures + pipeline-ai integration`
7. `docs: PR3 phase 8 — cache-smoke runbook`

---

## 完了後の workflow

1. `/claude-mem:do` で本 plan を実行（worktree `C:/tmp/impl-mail-pr3`）
2. `/prepare-pr` で PR description 自動生成 + push
3. `/review` で Codex r1 prompt 生成
4. r1 → r2 → r... を fix サイクルで回す
5. 実 API smoke (cache-smoke.md) を ship 前に実施
6. `/ship` でマージ

---

## オープン懸念（実装中に判断）

- **PDF の base64 encode タイミング**: bytea から取り出した時に encode するか、classifier 内でやるか。多分 classifier 内（pipeline は bytea のまま運ぶ）
- **Sonnet 4.6 cost 数値**: Phase 0 で formula 由来、ship 前に Anthropic console で実数確認
- **system prompt の長さ**: 2048 tokens 未満だと cache 効かない。few-shot 3 件 + 説明で足りる想定だが実測必要
- **訂正版マッチング**: AI が出す `references_subject` を既存 draft とマッチする UI ヒントは PR4。PR3 では受信のみ
