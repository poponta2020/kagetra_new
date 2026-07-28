import { describe, it, expect } from 'vitest'
import * as serverModule from '@/lib/entry-form/mail-template'
import * as clientModule from './mail-template-client'

/**
 * mail-template-client.ts は lib/entry-form/mail-template.ts の複製（設計要求3・(a)案）。
 * `server-only` は vitest.config.mts のエイリアスで空実装に差し替わるため、この
 * テストファイル（node 実行）に限りサーバー専用モジュールを値 import できる——
 * それでも本番の client バンドルからは import しないこと（EntryFormWizard は
 * `mail-template-client` のみを使う）。
 *
 * ここでは両モジュールの出力が一致することだけを固定する。片方だけ文言を変えて
 * しまう事故を防ぐのが目的で、個々の文言の正しさは mail-template.test.ts が担う。
 */

describe('mail-template-client は lib/entry-form/mail-template と文言が一致する', () => {
  it('buildDefaultEntrySubject', () => {
    expect(clientModule.buildDefaultEntrySubject('第10回北海道地区高校選手権大会', '北海道大学かるた会')).toBe(
      serverModule.buildDefaultEntrySubject('第10回北海道地区高校選手権大会', '北海道大学かるた会'),
    )
  })

  it('buildAttachmentFilename（冪等ケース込み）', () => {
    expect(clientModule.buildAttachmentFilename('参加申込書.xlsx', '北海道大学かるた会')).toBe(
      serverModule.buildAttachmentFilename('参加申込書.xlsx', '北海道大学かるた会'),
    )
    const already = '【北海道大学かるた会】参加申込書.xlsx'
    expect(clientModule.buildAttachmentFilename(already, '北海道大学かるた会')).toBe(
      serverModule.buildAttachmentFilename(already, '北海道大学かるた会'),
    )
  })

  it('summarizeGradeCounts（級未設定込み）', () => {
    const grades = ['A', 'A', null, undefined, 'C'] as const
    expect(clientModule.summarizeGradeCounts(grades)).toEqual(serverModule.summarizeGradeCounts(grades))
  })

  it('buildEntryMailBody（organizer あり）', () => {
    const input = {
      organizer: '青森かるた会',
      clubName: '北海道大学かるた会',
      representativeName: '土居 悠太',
      grades: ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'D', 'E'] as const,
    }
    expect(clientModule.buildEntryMailBody(input)).toBe(serverModule.buildEntryMailBody(input))
  })

  it('buildEntryMailBody（organizer が null）', () => {
    const input = {
      organizer: null,
      clubName: '北海道大学かるた会',
      representativeName: '土居 悠太',
      grades: ['A'] as const,
    }
    expect(clientModule.buildEntryMailBody(input)).toBe(serverModule.buildEntryMailBody(input))
  })

  it('buildEntryMailBody（organizer が空白のみ）', () => {
    const input = {
      organizer: '   ',
      clubName: '北海道大学かるた会',
      representativeName: '土居 悠太',
      grades: ['A'] as const,
    }
    expect(clientModule.buildEntryMailBody(input)).toBe(serverModule.buildEntryMailBody(input))
  })

  it('buildEntryMailBody（級が全員未設定）', () => {
    const input = {
      organizer: '青森かるた会',
      clubName: '北海道大学かるた会',
      representativeName: '土居 悠太',
      grades: [null, undefined] as const,
    }
    expect(clientModule.buildEntryMailBody(input)).toBe(serverModule.buildEntryMailBody(input))
  })
})
