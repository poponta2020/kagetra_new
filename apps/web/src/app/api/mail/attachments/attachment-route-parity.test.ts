import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockAuthModule, setAuthSession } from '@/test-utils/auth-mock'

/**
 * Drift guard for the member/admin attachment binary routes.
 *
 * `/api/mail/attachments/[id]/route.ts` is a deliberate copy of
 * `/api/admin/mail/attachments/[id]/route.ts` (member-mail-search
 * requirements §6: the admin route must not change, so a shared helper was
 * rejected). A copy can silently drift from its original, so this test
 * feeds identical inputs to both GET handlers and asserts the response
 * headers are byte-for-byte identical. It does not modify the admin route —
 * it only imports and calls it.
 *
 * Both routes are exercised with a `role='admin'` session. The admin route
 * 403s for `role='member'`, so comparing under a member session would fail
 * on the authorization difference (which is the intended, documented
 * divergence) rather than on drift. `role='admin'` satisfies both routes'
 * authorization checks (admin route: role-gated; member route:
 * `session.user.id` presence only), isolating the comparison to the
 * response-header logic that must stay identical.
 */

vi.mock('@/auth', () => mockAuthModule())

const mockFindFirst = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    query: {
      mailAttachments: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}))

const { GET: memberGet } = await import('./[id]/route')
const { GET: adminGet } = await import('../../admin/mail/attachments/[id]/route')

function makeRequest(path: string): Request {
  return new Request(`http://localhost:3000${path}`)
}

const mkParams = (id: string) => ({ params: Promise.resolve({ id }) })

const HEADER_NAMES = [
  'content-type',
  'content-disposition',
  'x-content-type-options',
  'cache-control',
  'content-length',
] as const

type Case = {
  label: string
  filename: string
  contentType: string
}

const CASES: Case[] = [
  { label: 'PDF (allowlisted)', filename: 'a.pdf', contentType: 'application/pdf' },
  {
    label: 'DOCX (allowlisted)',
    filename: 'a.docx',
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  { label: 'PNG (allowlisted)', filename: 'a.png', contentType: 'image/png' },
  { label: 'plain text (allowlisted)', filename: 'a.txt', contentType: 'text/plain' },
  { label: 'SVG (outside allowlist, active content)', filename: 'a.svg', contentType: 'image/svg+xml' },
  { label: 'HTML (outside allowlist, active content)', filename: 'a.html', contentType: 'text/html' },
  { label: 'bogus non-MIME string', filename: 'a.bin', contentType: 'javascript' },
  { label: 'empty stored Content-Type', filename: 'a.bin', contentType: '' },
  {
    label: 'malformed stored Content-Type with quotes/backslash/semicolon',
    filename: 'a.bin',
    contentType: 'not/a real; type"with\\quotes',
  },
  {
    label: 'non-ASCII filename',
    filename: '大会要項.pdf',
    contentType: 'application/pdf',
  },
]

describe('member vs admin attachment binary route parity', () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(CASES)(
    'produces identical headers for $label',
    async ({ filename, contentType }) => {
      await setAuthSession({ id: 'u1', role: 'admin' })
      const data = Buffer.from('payload bytes')
      mockFindFirst.mockResolvedValue({ data, filename, contentType })

      const memberRes = await memberGet(
        makeRequest('/api/mail/attachments/1'),
        mkParams('1'),
      )
      const adminRes = await adminGet(
        makeRequest('/api/admin/mail/attachments/1'),
        mkParams('1'),
      )

      expect(memberRes.status).toBe(adminRes.status)
      for (const name of HEADER_NAMES) {
        expect(memberRes.headers.get(name)).toBe(adminRes.headers.get(name))
      }
    },
  )
})
