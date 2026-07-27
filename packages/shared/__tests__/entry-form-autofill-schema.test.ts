import { describe, it, expect } from 'vitest'
import { appSettings, entryFormDrafts, entryFormDraftStatusEnum } from '../src/schema'

describe('entry-form-autofill schema', () => {
  it('declares entry_form_draft_status with the exact spec values (order is persisted)', () => {
    expect(entryFormDraftStatusEnum.enumValues).toEqual(['created', 'imap_failed'])
  })

  it('defines app_settings as a plain key-value store with audit columns', () => {
    expect(appSettings.key.primary).toBe(true)
    expect(appSettings.value.notNull).toBe(true)
    expect(appSettings.updatedAt.name).toBe('updated_at')
    expect(appSettings.updatedAt.notNull).toBe(true)
    // ユーザー削除で設定値まで消えないよう nullable (SET NULL)。
    expect(appSettings.updatedBy.name).toBe('updated_by')
    expect(appSettings.updatedBy.notNull).toBe(false)
  })

  it('defines entry_form_drafts with the draft snapshot columns', () => {
    expect(entryFormDrafts.entryGroupId.name).toBe('entry_group_id')
    expect(entryFormDrafts.entryGroupId.notNull).toBe(true)
    // 作成者は消えても履歴は残す (SET NULL)。
    expect(entryFormDrafts.createdBy.notNull).toBe(false)
    expect(entryFormDrafts.toEmail.notNull).toBe(true)
    expect(entryFormDrafts.subject.notNull).toBe(true)
    expect(entryFormDrafts.body.notNull).toBe(true)
    expect(entryFormDrafts.attachmentFilename.name).toBe('attachment_filename')
    expect(entryFormDrafts.attachmentFilename.notNull).toBe(true)
    expect(entryFormDrafts.xlsx.notNull).toBe(true)
    expect(entryFormDrafts.memberCount.name).toBe('member_count')
    expect(entryFormDrafts.memberCount.notNull).toBe(true)
    expect(entryFormDrafts.status.notNull).toBe(true)
    expect(entryFormDrafts.status.default).toBe('created')
    expect(entryFormDrafts.imapError.notNull).toBe(false)
  })
})
