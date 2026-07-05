import { describe, expect, it } from 'vitest'
import { formatTournamentLabel, stripKai } from './tournamentLabel'

describe('stripKai', () => {
  it('半角数字の「第N回」接頭を除去する', () => {
    expect(stripKai('第40回高松宮記念杯近江神宮全国大会')).toBe('高松宮記念杯近江神宮全国大会')
  })

  it('全角数字の「第N回」接頭を除去する', () => {
    expect(stripKai('第４０回高松宮記念杯近江神宮全国大会')).toBe('高松宮記念杯近江神宮全国大会')
  })

  it('「第N回」が無ければそのまま返す', () => {
    expect(stripKai('北海道選手権')).toBe('北海道選手権')
  })
})

describe('formatTournamentLabel', () => {
  it('shortName ありのとき shortName + grade を返す', () => {
    expect(
      formatTournamentLabel({ name: '第40回高松宮記念杯近江神宮全国大会', shortName: '高松宮', grade: 'A' }),
    ).toBe('高松宮A')
  })

  it('shortName あり + grade null のとき shortName のみ返す', () => {
    expect(
      formatTournamentLabel({ name: '第40回高松宮記念杯近江神宮全国大会', shortName: '高松宮', grade: null }),
    ).toBe('高松宮')
  })

  it('shortName null のとき「第N回」除去した正式名称 + grade にフォールバックする', () => {
    expect(
      formatTournamentLabel({ name: '第40回高松宮記念杯近江神宮全国大会', shortName: null, grade: 'B' }),
    ).toBe('高松宮記念杯近江神宮全国大会B')
  })

  it('shortName null + grade null のとき「第N回」除去した正式名称のみ返す', () => {
    expect(
      formatTournamentLabel({ name: '第40回高松宮記念杯近江神宮全国大会', shortName: null, grade: null }),
    ).toBe('高松宮記念杯近江神宮全国大会')
  })

  it('全角数字の「第N回」を含む正式名称でも除去してフォールバックする', () => {
    expect(
      formatTournamentLabel({ name: '第４０回高松宮記念杯近江神宮全国大会', shortName: null, grade: 'C' }),
    ).toBe('高松宮記念杯近江神宮全国大会C')
  })
})
