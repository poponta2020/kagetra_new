import type { ParsedResultPayload } from '../schema.js'
import type { RoutingResult } from './routing-schema.js'
import type {
  ExtractionCallResult,
  ExtractionInput,
  ResultImportAi,
  RoutingCallResult,
  RoutingInput,
} from './types.js'

/**
 * テスト・`--mock-llm` 用の決定的スタブ。`classify/llm/fixture.ts` と同じ
 * 思想 — 合成のトークン/コスト値は非ゼロにして、ログ上で「API を一度も
 * 呼んでいない」ケースと視覚的に区別できるようにする(0/0/0 は判別不能)。
 * `modelId: 'fixture'` により、下流が本番の課金データと取り違えないように
 * している。
 */
const FIXTURE_MODEL = 'fixture'
const FIXTURE_PROMPT_VERSION = 'fixture-1.0'

const FIXTURE_DEFAULT_ROUTING: RoutingResult = {
  verdict: 'adopt',
  outOfScopeKind: null,
  classMap: [],
  meta: {
    tournamentName: null,
    editionNumber: null,
    eventDate: null,
    isCorrection: false,
  },
  issues: [],
}

const FIXTURE_DEFAULT_EXTRACTION: ParsedResultPayload = {
  parserVersion: 'ai-extract-fixture-1.0',
  classes: [
    {
      className: 'A級',
      grade: 'A',
      sheetName: null,
      participants: [],
    },
  ],
}

export interface FixtureResultImportAiOpts {
  routing?: RoutingResult
  extraction?: ParsedResultPayload
  failRoute?: Error
  failExtract?: Error
  // Cost-guard test overrides (run.test.ts: AI 列の合算検証)。既定は現行の
  // 0 / 100 / 200 のまま — 省略時は ai-fixture.test.ts の既存アサーションを
  // 壊さない。
  tokensInput?: number
  tokensOutput?: number
  costUsd?: number
}

export class FixtureResultImportAi implements ResultImportAi {
  readonly modelId = FIXTURE_MODEL

  constructor(private readonly opts: FixtureResultImportAiOpts = {}) {}

  async route(_input: RoutingInput): Promise<RoutingCallResult> {
    if (this.opts.failRoute) {
      throw this.opts.failRoute
    }
    const parsed = this.opts.routing ?? FIXTURE_DEFAULT_ROUTING
    return {
      parsed,
      raw: JSON.stringify(parsed),
      tokensInput: this.opts.tokensInput ?? 100,
      tokensOutput: this.opts.tokensOutput ?? 200,
      costUsd: this.opts.costUsd ?? 0,
      model: FIXTURE_MODEL,
      promptVersion: FIXTURE_PROMPT_VERSION,
    }
  }

  async extract(_input: ExtractionInput): Promise<ExtractionCallResult> {
    if (this.opts.failExtract) {
      throw this.opts.failExtract
    }
    const parsed = this.opts.extraction ?? FIXTURE_DEFAULT_EXTRACTION
    return {
      parsed,
      raw: JSON.stringify(parsed),
      tokensInput: this.opts.tokensInput ?? 100,
      tokensOutput: this.opts.tokensOutput ?? 200,
      costUsd: this.opts.costUsd ?? 0,
      model: FIXTURE_MODEL,
      promptVersion: FIXTURE_PROMPT_VERSION,
    }
  }
}
