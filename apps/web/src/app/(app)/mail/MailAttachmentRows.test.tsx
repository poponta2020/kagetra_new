import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MailAttachmentRows } from './MailAttachmentRows'
import { formatAttachmentMeta } from '@/lib/member-mail/format'

describe('MailAttachmentRows', () => {
  it('各行が /mail/attachments/<id>?from=/mail/<mailId> にリンクする', () => {
    render(
      <MailAttachmentRows
        mailId={42}
        items={[
          { id: 1, filename: '要項.pdf', contentType: 'application/pdf', sizeBytes: 1024 },
          {
            id: 2,
            filename: '申込書.docx',
            contentType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: 2048,
          },
        ]}
      />,
    )

    const first = screen.getByText('要項.pdf').closest('a')
    expect(first).not.toBeNull()
    expect(first!.getAttribute('href')).toBe(
      `/mail/attachments/1?from=${encodeURIComponent('/mail/42')}`,
    )

    const second = screen.getByText('申込書.docx').closest('a')
    expect(second!.getAttribute('href')).toBe(
      `/mail/attachments/2?from=${encodeURIComponent('/mail/42')}`,
    )
  })

  it('メタ表記が formatAttachmentMeta の出力と一致する', () => {
    render(
      <MailAttachmentRows
        mailId={1}
        items={[
          {
            id: 10,
            filename: '確定名簿.xlsx',
            contentType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeBytes: 86016,
          },
        ]}
      />,
    )

    const expected = formatAttachmentMeta(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '確定名簿.xlsx',
      86016,
    )
    expect(screen.getByText(expected)).toBeTruthy()
  })
})
