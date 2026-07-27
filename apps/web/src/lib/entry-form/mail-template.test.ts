// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildDefaultEntrySubject,
  buildAttachmentFilename,
  summarizeGradeCounts,
  buildEntryMailBody,
} from './mail-template'

describe('buildDefaultEntrySubject (AC-13: 主催者指定が無い場合の定型件名)', () => {
  it('「<大会名>申込み（<所属会名>）」を返す', () => {
    expect(buildDefaultEntrySubject('第10回北海道地区高校選手権大会', '北海道大学かるた会')).toBe(
      '第10回北海道地区高校選手権大会申込み（北海道大学かるた会）',
    )
  })
})

describe('buildAttachmentFilename (AC-13: 主催者指定が無い場合の定型ファイル名)', () => {
  it('プレフィックス「【<所属会名>】」を付与する', () => {
    expect(buildAttachmentFilename('参加申込書.xlsx', '北海道大学かるた会')).toBe(
      '【北海道大学かるた会】参加申込書.xlsx',
    )
  })

  it('既にプレフィックスが付いている場合は二重に付けない（冪等性）', () => {
    const already = '【北海道大学かるた会】参加申込書.xlsx'
    expect(buildAttachmentFilename(already, '北海道大学かるた会')).toBe(already)
  })
})

describe('summarizeGradeCounts', () => {
  it('級ごとの人数を A→E の順で集計する', () => {
    const grades = ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'D', 'E'] as const
    expect(summarizeGradeCounts(grades)).toEqual({
      total: 15,
      breakdown: 'A級5名、B級5名、C級3名、D級1名、E級1名',
    })
  })

  it('0名の級は内訳から除外する', () => {
    expect(summarizeGradeCounts(['A', 'A', 'C'])).toEqual({
      total: 3,
      breakdown: 'A級2名、C級1名',
    })
  })

  it('級未設定（null/undefined）の会員は総数には含めるが内訳には出さない', () => {
    expect(summarizeGradeCounts(['A', null, undefined])).toEqual({
      total: 3,
      breakdown: 'A級1名',
    })
  })

  it('全員が級未設定なら内訳は空文字（総数のみ）', () => {
    expect(summarizeGradeCounts([null, null, undefined])).toEqual({
      total: 3,
      breakdown: '',
    })
  })
})

describe('buildEntryMailBody (AC-14: 本文が定型テンプレート＋級別人数の自動集計で生成される)', () => {
  const grades = ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'D', 'E'] as const

  it('宛名＋挨拶＋定型の一文（級別内訳込み）＋結び＋署名を生成する', () => {
    const body = buildEntryMailBody({
      organizer: '青森かるた会',
      clubName: '北海道大学かるた会',
      representativeSurname: '土居',
      grades,
    })
    expect(body).toBe(
      [
        '青森かるた会　ご担当者様',
        '',
        'いつもお世話になっております。',
        '北海道大学かるた会連絡責任者の土居と申します。',
        '',
        '弊会所属15名（A級5名、B級5名、C級3名、D級1名、E級1名）分の参加申込書を添付ファイルにてお送りいたします。',
        'お手数おかけしますが、ご確認のほどよろしくお願いします。',
        '',
        '土居',
      ].join('\n'),
    )
  })

  it('AC-14 の定型文言「弊会所属N名（A級x名…）分の参加申込書を添付ファイルにてお送りいたします」がそのまま含まれる', () => {
    const body = buildEntryMailBody({
      organizer: '青森かるた会',
      clubName: '北海道大学かるた会',
      representativeSurname: '土居',
      grades,
    })
    expect(body).toContain('弊会所属15名（A級5名、B級5名、C級3名、D級1名、E級1名）分の参加申込書を添付ファイルにてお送りいたします。')
  })

  it('organizer が未設定（null）なら宛名は「ご担当者様」のみになる', () => {
    const body = buildEntryMailBody({
      organizer: null,
      clubName: '北海道大学かるた会',
      representativeSurname: '土居',
      grades: ['A'],
    })
    expect(body.startsWith('ご担当者様\n')).toBe(true)
  })

  it('organizer が空文字（trim後も空）でも「ご担当者様」のみになる', () => {
    const body = buildEntryMailBody({
      organizer: '   ',
      clubName: '北海道大学かるた会',
      representativeSurname: '土居',
      grades: ['A'],
    })
    expect(body.startsWith('ご担当者様\n')).toBe(true)
  })

  it('級未設定の会員がいる場合、内訳の括弧が省略され「弊会所属N名分の」になる', () => {
    const body = buildEntryMailBody({
      organizer: '青森かるた会',
      clubName: '北海道大学かるた会',
      representativeSurname: '土居',
      grades: [null, undefined],
    })
    expect(body).toContain('弊会所属2名分の参加申込書を添付ファイルにてお送りいたします。')
  })
})
