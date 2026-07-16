import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InviteCodeModal, type InviteCodePayload } from './InviteCodeModal'
import type { GuidelineCandidateMail } from '@/lib/event-related-mails'

const basePayload = (
  over: Partial<InviteCodePayload> = {},
): InviteCodePayload => ({
  inviteCode: '123456',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  botId: '@bot-a',
  botLabel: 'かるた通知Bot A',
  addFriendUrl: 'https://line.me/R/ti/p/%40bot-a',
  guidelineCandidates: [],
  selectedGuidelineAttachmentIds: [],
  ...over,
})

const candidateMail = (
  over: Partial<GuidelineCandidateMail> = {},
): GuidelineCandidateMail => ({
  mailId: 1,
  subject: '第1回大会要綱のご案内',
  receivedAt: new Date('2026-07-01T09:00:00+09:00'),
  attachments: [
    { id: 10, filename: '要綱.pdf', sizeBytes: 12345, contentType: 'application/pdf' },
  ],
  ...over,
})

describe('InviteCodeModal — 要綱として送信するファイル', () => {
  it('guidelineCandidates をメール別に添付列挙する（件名・ファイル名が出る）', () => {
    const payload = basePayload({
      guidelineCandidates: [
        candidateMail({
          mailId: 1,
          subject: '第1回大会要綱のご案内',
          attachments: [
            { id: 10, filename: '要綱.pdf', sizeBytes: 12345, contentType: 'application/pdf' },
          ],
        }),
        candidateMail({
          mailId: 2,
          subject: '訂正版のお知らせ',
          attachments: [
            { id: 20, filename: '訂正要綱.pdf', sizeBytes: 2000, contentType: 'application/pdf' },
          ],
        }),
      ],
    })

    render(
      <InviteCodeModal
        eventId={1}
        eventTitle="第1回大会"
        payload={payload}
        onClose={vi.fn()}
        setGuidelineAttachmentsAction={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByText('第1回大会要綱のご案内')).toBeTruthy()
    expect(screen.getByText('訂正版のお知らせ')).toBeTruthy()
    expect(screen.getByText('要綱.pdf')).toBeTruthy()
    expect(screen.getByText('訂正要綱.pdf')).toBeTruthy()
  })

  it('チェックボックスをクリックすると setGuidelineAttachmentsAction が (eventId, [選択id...]) で呼ばれる', async () => {
    const setGuidelineAttachmentsAction = vi.fn().mockResolvedValue(undefined)
    const payload = basePayload({
      guidelineCandidates: [
        candidateMail({
          mailId: 1,
          attachments: [
            { id: 10, filename: '要綱.pdf', sizeBytes: 12345, contentType: 'application/pdf' },
          ],
        }),
      ],
      selectedGuidelineAttachmentIds: [],
    })

    render(
      <InviteCodeModal
        eventId={42}
        eventTitle="第1回大会"
        payload={payload}
        onClose={vi.fn()}
        setGuidelineAttachmentsAction={setGuidelineAttachmentsAction}
      />,
    )

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(setGuidelineAttachmentsAction).toHaveBeenCalledWith(42, [10])
    })
  })

  it('guidelineCandidates: [] で空状態文言が出る', () => {
    const payload = basePayload({ guidelineCandidates: [] })

    render(
      <InviteCodeModal
        eventId={1}
        eventTitle="第1回大会"
        payload={payload}
        onClose={vi.fn()}
        setGuidelineAttachmentsAction={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByText('送信できる添付ファイルがありません')).toBeTruthy()
  })
})
