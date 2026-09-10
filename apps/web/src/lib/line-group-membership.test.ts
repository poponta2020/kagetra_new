import { describe, expect, it, vi } from 'vitest'
import { fetchGroupMemberDisplayName } from './line-group-membership'

/**
 * line-group-membership: `fetchGroupMemberDisplayName` のテスト
 * （annual-registration-renewal タスク8・R7・AC-16・AC-16c）。
 *
 * 既存の `isMember`/`filterToGroupMembers` はこのタスクでは変更していない
 * ので、ここでは新規関数だけを見る。`fetchImpl` を差し替えて、実際の
 * fetch は一切呼ばない。
 */

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status })
}

describe('fetchGroupMemberDisplayName', () => {
  it('200 のレスポンスから displayName を取り出す', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { displayName: '北海太郎' }))

    const result = await fetchGroupMemberDisplayName(
      { groupId: 'Cgroup', userId: 'Uuser', channelAccessToken: 'token' },
      { fetchImpl },
    )

    expect(result).toBe('北海太郎')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/group/Cgroup/member/Uuser',
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
    )
  })

  it('displayName が文字列でない・空文字なら null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { displayName: '' }))
    const result = await fetchGroupMemberDisplayName(
      { groupId: 'Cgroup', userId: 'Uuser', channelAccessToken: 'token' },
      { fetchImpl },
    )
    expect(result).toBeNull()
  })

  it('404（未在籍）は null（throw しない）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404))
    const result = await fetchGroupMemberDisplayName(
      { groupId: 'Cgroup', userId: 'Uuser', channelAccessToken: 'token' },
      { fetchImpl },
    )
    expect(result).toBeNull()
  })

  it('200/404 以外の HTTP ステータスは throw する（API 失敗と未在籍を区別する）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500))
    await expect(
      fetchGroupMemberDisplayName(
        { groupId: 'Cgroup', userId: 'Uuser', channelAccessToken: 'token' },
        { fetchImpl },
      ),
    ).rejects.toThrow('LINE group member profile fetch failed: 500')
  })

  it('タイムアウト（AbortError）は throw する', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    })
    await expect(
      fetchGroupMemberDisplayName(
        { groupId: 'Cgroup', userId: 'Uuser', channelAccessToken: 'token' },
        { fetchImpl },
      ),
    ).rejects.toThrow('LINE group member profile fetch timed out after 30s')
  })

  it('既定は process.env に依存せずグローバル fetch を呼ぶ（fetchImpl 未指定時の配線確認）', async () => {
    const originalFetch = globalThis.fetch
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { displayName: '既定fetch' }))
    globalThis.fetch = fetchImpl as unknown as typeof fetch
    try {
      const result = await fetchGroupMemberDisplayName({
        groupId: 'Cgroup',
        userId: 'Uuser',
        channelAccessToken: 'token',
      })
      expect(result).toBe('既定fetch')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
