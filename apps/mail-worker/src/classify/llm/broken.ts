import type {
  LLMExtractionInput,
  LLMExtractionResult,
  LLMExtractor,
} from './types.js'

/**
 * Deliberately failing extractor used to exercise the classifier's
 * Zod-validation retry path and the `ai_failed` persistence branch. The
 * classifier (Phase 4) calls `extract()`, catches errors, retries once, and
 * if both attempts fail records an `ai_failed` draft with the raw error
 * surface — `BrokenLLMExtractor` is the cleanest way to reach that branch
 * deterministically from a unit test.
 *
 * A `failOnce: true` mode is offered so tests can simulate the
 * fail-then-succeed shape we expect from a transient parse error. In that
 * mode the second `extract()` call throws a fresh "stub success placeholder"
 * — Phase 2 doesn't yet have a non-Anthropic, non-fixture happy path, so
 * the second-call payload is intentionally not produced here. Tests that
 * need a real success after a failure should compose `BrokenLLMExtractor`
 * with `FixtureLLMExtractor` at the call site.
 */
export class BrokenLLMExtractor implements LLMExtractor {
  readonly modelId = 'broken'
  private callCount = 0

  constructor(private readonly opts: { failOnce?: boolean } = {}) {}

  async extract(_input: LLMExtractionInput): Promise<LLMExtractionResult> {
    this.callCount += 1
    if (this.opts.failOnce && this.callCount > 1) {
      throw new Error(
        'BrokenLLMExtractor: failOnce mode does not produce a success payload — ' +
          'compose with FixtureLLMExtractor at the call site if you need recovery',
      )
    }
    throw new Error('BrokenLLMExtractor: forced failure')
  }
}
