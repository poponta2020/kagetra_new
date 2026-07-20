import { describe, expect, it, vi } from 'vitest'
import { fetchMails, LiveMailSource, type MailSource } from '../../src/fetch/fetcher.js'

describe('mailbox selection', () => {
  it('forwards an explicit mailbox through fetchMails', async () => {
    const fetch = vi.fn().mockResolvedValue({ parsed: [], errors: [] })
    const source: MailSource = { fetch, close: vi.fn().mockResolvedValue(undefined) }

    await fetchMails(source, undefined, '99_202510以前のメール')

    expect(fetch).toHaveBeenCalledWith(undefined, '99_202510以前のメール')
  })

  it('LiveMailSource defaults to INBOX and forwards an explicit archive mailbox', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      fetchSince: vi.fn().mockResolvedValue({ parsed: [], errors: [] }),
    }
    const source = new LiveMailSource(client)

    await source.fetch(undefined)
    await source.fetch(new Date('2025-01-01T00:00:00Z'), '99_202510以前のメール')

    expect(client.connect).toHaveBeenCalledTimes(1)
    expect(client.fetchSince).toHaveBeenNthCalledWith(1, undefined, 'INBOX')
    expect(client.fetchSince).toHaveBeenNthCalledWith(
      2,
      new Date('2025-01-01T00:00:00Z'),
      '99_202510以前のメール',
    )
  })
})
