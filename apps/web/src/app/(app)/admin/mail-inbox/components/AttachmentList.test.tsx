import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AttachmentList, type AttachmentChip } from './AttachmentList'

const PDF: AttachmentChip = {
  id: 1,
  filename: '大会要項.pdf',
  contentType: 'application/pdf',
  extractionStatus: 'extracted',
}

const BROKEN: AttachmentChip = {
  id: 2,
  filename: 'broken.pdf',
  contentType: 'application/pdf',
  extractionStatus: 'failed',
}

describe('AttachmentList', () => {
  it('renders nothing when there are no attachments', () => {
    const { container } = render(<AttachmentList items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a chip per attachment with a download link to the binary route', () => {
    render(<AttachmentList items={[PDF]} />)
    // The chip splits "📄" + filename across two spans, so we anchor on the
    // filename text and walk up to the wrapping <a>.
    const filenameSpan = screen.getByText('大会要項.pdf')
    const link = filenameSpan.closest('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/api/admin/mail/attachments/1')
    expect(link!.getAttribute('target')).toBe('_blank')
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('uses danger tone for extraction_status=failed (operator can spot bad files)', () => {
    render(<AttachmentList items={[BROKEN]} />)
    // Pill renders the outer <span> with bg-{tone}-bg; it's the link's first
    // span descendant. closest('span') from the inner filename returns the
    // INNER filename span, so use a child selector instead.
    const link = screen.getByText('broken.pdf').closest('a')
    const pill = link?.querySelector('span')
    expect(pill?.className ?? '').toContain('bg-danger-bg')
  })
})
