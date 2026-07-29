import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, PROMPT_VERSION } from '../../src/classify/prompt.js'

/**
 * Content tests for the 3.0.0 prompt (mail-ai-extract-refinements, task4).
 *
 * AC-9 / AC-12 / AC-13 / AC-14 describe behaviour that only a live LLM call
 * can fully verify (what the model actually returns for a given fixture). In
 * this CI-runnable form we instead assert that the prompt *contains the
 * guidance* that would produce that behaviour — a fixture-driven "the LLM
 * returns X" test would be tautological here since `FixtureLLMExtractor`
 * just echoes canned JSON, it doesn't run the prompt through a model.
 */
describe('buildSystemPrompt (PROMPT_VERSION 3.0.0)', () => {
  const prompt = buildSystemPrompt()

  it('AC-6: PROMPT_VERSION is 3.0.0', () => {
    expect(PROMPT_VERSION).toBe('3.0.0')
  })

  // ── AC-5: forbidden strings from the removed classification era ──
  it('AC-5: does not contain classification-era strings', () => {
    for (const forbidden of [
      '大会案内でない',
      'confidence',
      'メーリングリストのダイジェスト',
      '訂正',
    ]) {
      expect(prompt).not.toContain(forbidden)
    }
  })

  it('does not instruct the model to judge whether the mail is an announcement', () => {
    expect(prompt).not.toContain('is_tournament_announcement')
    expect(prompt).not.toContain('short_name_stem')
    expect(prompt).not.toContain('fee_jpy')
  })

  // ── source_mismatch must stay narrow, not a reincarnation of classification ──
  it('source_mismatch guidance is scoped to "obviously the wrong document", not "is this an announcement"', () => {
    expect(prompt).toContain('source_mismatch')
    expect(prompt).toContain('明らかに別種の文書')
    expect(prompt).not.toContain('大会案内かどうかを判定')
  })

  // ── AC-9: payment_deadline_kind "後日連絡" judgement material ──
  it('AC-9: documents the "後日連絡" signal ("振込先は抽選後に別途ご連絡します")', () => {
    expect(prompt).toContain('後日連絡')
    expect(prompt).toContain('振込先は抽選後に別途ご連絡します')
    expect(prompt).toContain('payment_deadline_kind')
  })

  it('documents all three payment_deadline_kind values', () => {
    expect(prompt).toContain('日付あり')
    expect(prompt).toContain('後日連絡')
    expect(prompt).toContain('記載なし')
  })

  // ── AC-10 / AC-11: closed Japanese enums for payment_method / entry_method ──
  it('AC-10: documents the payment_method choices (口座振込 / 現地支払い / その他)', () => {
    expect(prompt).toContain('payment_method')
    expect(prompt).toContain('口座振込')
    expect(prompt).toContain('現地支払い')
  })

  it('AC-11: documents the entry_method choices (Excel申込書 / Googleフォーム / メール / その他)', () => {
    expect(prompt).toContain('entry_method')
    expect(prompt).toContain('Excel申込書')
    expect(prompt).toContain('Googleフォーム')
  })

  // ── AC-12 / AC-13 / AC-14: capacity_total and per-grade capacity independence ──
  it('AC-12/AC-13: documents capacity_total as the whole-announcement capacity, extracted independently from per-grade capacity', () => {
    expect(prompt).toContain('capacity_total')
    expect(prompt).toContain('全体定員')
  })

  it('AC-14: re-states the no-back-computation rule for capacity fields', () => {
    expect(prompt).toContain('逆算')
    expect(prompt).toContain('均等割り')
  })

  // ── Removed sections stay removed ──
  it('does not contain the removed noise-classification section header', () => {
    expect(prompt).not.toContain('# 大会案内 vs ノイズ')
  })

  it('does not contain the removed short_name_stem section header', () => {
    expect(prompt).not.toContain('短縮命名')
  })

  it('does not contain the removed correction-handling section header', () => {
    expect(prompt).not.toContain('訂正版の扱い')
  })

  it('does not instruct extraction of a participation fee', () => {
    expect(prompt).not.toContain('参加費')
  })

  // ── Few-shot examples updated to the new schema ──
  it('few-shot examples reference the new fields and not the removed ones', () => {
    expect(prompt).toContain('Example 1')
    expect(prompt).toContain('Example 2')
    expect(prompt).toContain('Example 3')
    expect(prompt).not.toContain('"is_tournament_announcement"')
    expect(prompt).not.toContain('"confidence"')
    expect(prompt).not.toContain('"is_correction"')
    expect(prompt).not.toContain('"references_subject"')
    expect(prompt).not.toContain('"short_name_stem"')
    expect(prompt).not.toContain('"fee_jpy"')
  })

  it('at least one few-shot example carries both payment_deadline_kind and capacity_total', () => {
    // A crude but effective check: both keys must co-occur inside at least
    // one `[正解の record_extraction 引数]` JSON block. Splitting on the
    // example separator and checking each block keeps this from passing on
    // a false positive where the two keys merely appear anywhere in the file.
    const blocks = prompt.split('[正解の record_extraction 引数]').slice(1)
    const hasCombinedExample = blocks.some(
      (block) => block.includes('"payment_deadline_kind"') && block.includes('"capacity_total"'),
    )
    expect(hasCombinedExample).toBe(true)
  })

  it('mentions record_extraction as the required tool call', () => {
    expect(prompt).toContain('record_extraction')
  })
})
