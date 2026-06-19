import { describe, it, expect } from 'vitest'
import {
  resultDraftStatusEnum,
  matchResultEnum,
  matchStatusEnum,
  mailWorkerJobKindEnum,
  players,
  tournaments,
  tournamentClasses,
  tournamentParticipants,
  matches,
  resultDrafts,
} from '../src/schema'

describe('tournament-results schema', () => {
  it('declares the new enums with the exact spec values (order is persisted)', () => {
    expect(resultDraftStatusEnum.enumValues).toEqual([
      'pending_review',
      'approved',
      'rejected',
      'parse_failed',
      'superseded',
    ])
    expect(matchResultEnum.enumValues).toEqual(['win', 'lose'])
    expect(matchStatusEnum.enumValues).toEqual(['normal', 'walkover', 'forfeit'])
  })

  it('extends mail_worker_job_kind with result_parse (appended, existing values intact)', () => {
    expect(mailWorkerJobKindEnum.enumValues).toEqual(['fetch', 'manual_extract', 'result_parse'])
  })

  it('defines players with a normalized_name key and nullable user_id', () => {
    expect(players.displayName.name).toBe('display_name')
    expect(players.normalizedName.name).toBe('normalized_name')
    expect(players.displayName.notNull).toBe(true)
    expect(players.normalizedName.notNull).toBe(true)
    // user_id (会員同定) is後続/null in v1.
    expect(players.userId.name).toBe('user_id')
    expect(players.userId.notNull).toBe(false)
    expect(players.affiliation.notNull).toBe(false)
  })

  it('defines tournaments with nullable date/venue and a plain provenance pointer', () => {
    expect(tournaments.name.notNull).toBe(true)
    expect(tournaments.eventDate.name).toBe('event_date')
    expect(tournaments.eventDate.notNull).toBe(false)
    expect(tournaments.venue.notNull).toBe(false)
    // 循環 FK 回避のため plain integer 列（FK は migration の raw ALTER）。
    expect(tournaments.sourceResultDraftId.name).toBe('source_result_draft_id')
  })

  it('defines tournament_classes with a free-text class_name and best-effort grade', () => {
    expect(tournamentClasses.tournamentId.name).toBe('tournament_id')
    expect(tournamentClasses.tournamentId.notNull).toBe(true)
    expect(tournamentClasses.className.name).toBe('class_name')
    expect(tournamentClasses.className.notNull).toBe(true)
    expect(tournamentClasses.grade.notNull).toBe(false)
  })

  it('defines participants as a raw snapshot (dan/member_no nullable, player_id nullable)', () => {
    expect(tournamentParticipants.classId.notNull).toBe(true)
    expect(tournamentParticipants.name.notNull).toBe(true)
    expect(tournamentParticipants.playerId.name).toBe('player_id')
    expect(tournamentParticipants.playerId.notNull).toBe(false)
    // 生スナップショットのため text 列（非数値 dan の受理は DB-backed テストで検証）。
    expect(tournamentParticipants.dan.dataType).toBe('string')
    expect(tournamentParticipants.memberNo.dataType).toBe('string')
    expect(tournamentParticipants.finalRank.name).toBe('final_rank')
  })

  it('defines matches with notNull result and status defaulting to normal', () => {
    expect(matches.round.notNull).toBe(true)
    expect(matches.participantId.notNull).toBe(true)
    // 相手は解決できなければ null（opponent_name の生テキストを保持）。
    expect(matches.opponentParticipantId.notNull).toBe(false)
    expect(matches.result.notNull).toBe(true)
    expect(matches.scoreDiff.notNull).toBe(false)
    expect(matches.status.notNull).toBe(true)
    expect(matches.status.hasDefault).toBe(true)
  })

  it('defines result_drafts mirroring tournament_drafts (notNull message_id, default status/payload)', () => {
    expect(resultDrafts.messageId.name).toBe('message_id')
    expect(resultDrafts.messageId.notNull).toBe(true)
    // message_id UNIQUE は DB-backed テストで重複 insert が弾かれることで検証。
    expect(resultDrafts.status.hasDefault).toBe(true)
    expect(resultDrafts.extractedPayload.hasDefault).toBe(true)
    expect(resultDrafts.parserVersion.notNull).toBe(true)
    // 自己 FK は plain integer（FK は migration の raw ALTER）。
    expect(resultDrafts.supersededByDraftId.name).toBe('superseded_by_draft_id')
    expect(resultDrafts.tournamentId.name).toBe('tournament_id')
  })
})
