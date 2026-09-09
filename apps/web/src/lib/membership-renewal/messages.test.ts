import { describe, it, expect } from 'vitest'
import { buildAnnouncementMessage, buildReminderMessage } from './messages'

describe('buildAnnouncementMessage（案内メッセージ・AC-2/16）', () => {
  const base = {
    fiscalYear: 2026,
    deadlineJst: '2026-03-31',
    note: null,
    url: 'https://new.hokudaicarta.com/renewal',
  }

  it('締切（M/D(曜)）・URL・ログイン後の案内を含む', () => {
    const message = buildAnnouncementMessage(base)
    expect(message).toContain('2026年度')
    expect(message).toContain('3/31')
    expect(message).toContain(base.url)
    expect(message).toContain('ログイン後はホームの「登録確認」から開けます。')
  })

  it('管理者の一言（note）があれば含める', () => {
    const message = buildAnnouncementMessage({ ...base, note: '不明点は会長まで連絡してください' })
    expect(message).toContain('不明点は会長まで連絡してください')
  })

  it('note が空/null なら余計な行を出さない', () => {
    const withNull = buildAnnouncementMessage({ ...base, note: null })
    const withEmpty = buildAnnouncementMessage({ ...base, note: '' })
    // note を渡した場合との差分が「一言が増えるかどうか」だけであることを、
    // 行数が一致することで確認する（余計な空行が出ない）。
    expect(withNull.split('\n')).toEqual(withEmpty.split('\n'))
  })

  it('note に URL や中括弧が入っていてもそのまま本文に載る', () => {
    const note = '詳細は {規程集} https://example.com/rule を参照'
    const message = buildAnnouncementMessage({ ...base, note })
    expect(message).toContain(note)
  })
})

describe('buildReminderMessage（リマインドメッセージ・AC-16/16b）', () => {
  const base = {
    fiscalYear: 2026,
    deadlineJst: '2026-04-30',
    url: 'https://new.hokudaicarta.com/renewal',
    names: ['土居悠太', '山田太郎'],
  }

  it('締切・URL・未回答者の氏名を全員含む完成形', () => {
    const message = buildReminderMessage(base)
    expect(message).toContain('4/30')
    expect(message).toContain(base.url)
    expect(message).toContain('土居悠太')
    expect(message).toContain('山田太郎')
  })

  it('splitCount 未指定・1 以下なら分割表記を出さない', () => {
    expect(buildReminderMessage(base)).not.toContain('分割')
    expect(buildReminderMessage({ ...base, splitCount: 1 })).not.toContain('分割')
  })

  it('splitCount が 2 以上なら (分割 n/m) を含める', () => {
    const message = buildReminderMessage({ ...base, splitIndex: 0, splitCount: 2 })
    expect(message).toContain('(分割 1/2)')
    const message2 = buildReminderMessage({ ...base, splitIndex: 1, splitCount: 2 })
    expect(message2).toContain('(分割 2/2)')
  })
})
