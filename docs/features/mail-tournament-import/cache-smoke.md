# Prompt cache smoke check

PR3 wires `cache_control: { type: 'ephemeral', ttl: '1h' }` on the system prompt
in [`apps/mail-worker/src/classify/llm/anthropic.ts`](../../../apps/mail-worker/src/classify/llm/anthropic.ts).
Unit tests in [`apps/mail-worker/test/classify/anthropic.test.ts`](../../../apps/mail-worker/test/classify/anthropic.test.ts)
verify the SDK is called with the right cache parameters, but the SDK contract
does not guarantee the parameter actually triggers a cache hit on the server.
This runbook confirms the cache lands on the real Anthropic API once.

## When to run

Once before shipping PR3 to main. Re-run when:

- `PROMPT_VERSION` in [`apps/mail-worker/src/classify/prompt.ts`](../../../apps/mail-worker/src/classify/prompt.ts)
  is bumped (system prompt changed → cache key invalidated).
- `MODEL_ID` in [`anthropic.ts`](../../../apps/mail-worker/src/classify/llm/anthropic.ts)
  changes (cache is keyed by exact prompt + model combo).
- The `@anthropic-ai/sdk` major version is upgraded (ensure cache headers still
  flow through — Phase 0 fact: GA on the `2023-06-01` API, no beta header
  required, but worth re-confirming on any major SDK bump).

## Prerequisites

- Real `ANTHROPIC_API_KEY` in `.env` at the repo root. mail-worker reads it via
  `loadLlmConfig()` ([`apps/mail-worker/src/config.ts`](../../../apps/mail-worker/src/config.ts)),
  which is invoked only when `--mock-llm` is **not** passed.
- Local Postgres reachable via the `DATABASE_URL` mail-worker config expects.
- `pnpm install` has run on this branch (Anthropic SDK + zod-to-json-schema
  installed).
- The IMAP fixture path (`--mock-imap`) seeds 4 known mails — no real Yahoo IMAP
  account needed for the smoke. The eml fixtures live under
  `apps/mail-worker/test/fixtures/`.

## Steps

1. **First run (cold cache).**

   ```bash
   cd /path/to/kagetra_new
   pnpm --filter=@kagetra/mail-worker exec tsx src/index.ts \
     --once --mock-imap 2>&1 | tee /tmp/cache-smoke-1.log
   ```

   In the log, look for `extracted` log entries (one per mail that reaches the
   classifier). On the first run, the very first mail that triggers
   `llm.extract()` should show:

   - `cache_creation_input_tokens > 0` — the system prompt was just written to
     the cache (1h TTL).
   - `cache_read_input_tokens === 0` — nothing to read on a cold start.

   Subsequent mails in the same run can already show
   `cache_read_input_tokens > 0` because the cache was warmed by the first
   call.

2. **Second run within 1 hour.**

   ```bash
   pnpm --filter=@kagetra/mail-worker exec tsx src/index.ts \
     --once --mock-imap 2>&1 | tee /tmp/cache-smoke-2.log
   ```

   Expectations on the first mail of the second run:

   - `cache_creation_input_tokens === 0` — no fresh write needed, cache is
     still warm.
   - `cache_read_input_tokens > 0` — the system prompt was read from cache.
   - Per-call `aiTokensInput` (the cost-bearing fresh tokens) should be small
     compared to run 1 (the bulk moved into `cache_read_input_tokens`).
   - Aggregate cost roughly **0.3x** of run 1 (Phase 0 pricing: cache read is
     `$0.30 / 1M` vs fresh input `$3 / 1M`, output unaffected).

## Recording results

After the smoke passes, paste the relevant `cache_read_input_tokens` line from
`/tmp/cache-smoke-2.log` into the PR description as evidence. Format:

```
cache-smoke run 1: cache_creation_input_tokens=<N>, cache_read_input_tokens=0
cache-smoke run 2: cache_creation_input_tokens=0, cache_read_input_tokens=<M>
```

The smoke is a one-time pre-ship gate, not a recurring CI check — the real API
costs money and we don't want to burn cache writes on every PR.

## What if cache doesn't hit

- **System prompt < 2048 tokens.** Below the floor, `cache_control` silently
  no-ops (Phase 0 fact). Check `buildSystemPrompt()` output length. PR3 ships
  with three few-shot examples + extraction instructions, projected ~3700
  tokens, which is well above the floor — but a future refactor that trims the
  prompt could fall under it.
- **Model ID changed without re-warming.** Cache is keyed by the exact
  `(system_prompt, model)` tuple. Switching from `claude-sonnet-4-6` to
  another model (or vice versa) invalidates the cache. Wait one full warm cycle
  on the new model before re-checking.
- **TTL expired.** If more than 1 hour passes between runs, the cache is gone
  and run 2 will look identical to run 1. Expected — just re-run inside the 1h
  window.
- **Different `cache_control` placement.** Phase 0 facts: max 4 breakpoints,
  and the breakpoint must be on a stable block. PR3 only puts one breakpoint
  on the system text. Adding more (especially on per-mail user content) can
  shift hashes and miss cache.

## Cost note

Phase 0 USD pricing (Sonnet 4.6, Apr 2026):

- Fresh input: `$3 / 1M tokens`
- Output: `$15 / 1M tokens`
- Cache read (1h or 5m TTL, same read price): `$0.30 / 1M tokens`
- Cache write 1h TTL: `$6 / 1M tokens` (2x fresh-input multiplier)
- Cache write 5m TTL: `$3.75 / 1M tokens`

The 1h cache write is **2x** the fresh input cost — paid once per warm cycle.
Subsequent reads are **0.1x** of fresh. For the tournament use case (≤ a few
mails per cron run, 30-min cron interval set by PR1 ops), the same prompt is
hit ~3 times before the 1h TTL expires → break-even at the 2nd run, net
savings from the 3rd onward. The 1h TTL was chosen specifically to span at
least one cron interval comfortably; 5m would expire mid-cycle on quiet weeks.
