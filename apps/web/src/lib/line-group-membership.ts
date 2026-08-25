/**
 * line-group-membership: LINE グループの在籍確認（bug #542）。
 *
 * LINE の textV2 メンションは**グループ未在籍ユーザーを含むとメッセージ全体が
 * 400 で拒否される**（"The mentioned user is not found in the group."）。
 * reply は1リクエスト複数通なので、1人でも未在籍者が混ざると案内が全滅する。
 * メンション対象を組み立てる前に、このモジュールで在籍者だけへ絞り込む。
 *
 * 判定は `GET /v2/bot/group/{groupId}/member/{userId}`（グループメンバーの
 * プロフィール取得）を流用する: 200 = 在籍、404 = 未在籍。members/ids 一覧
 * API と違い認証済みアカウント限定ではなく、全 Bot で使えることを本番で
 * 実測済み（Issue #542 の復旧作業）。
 *
 * `line-mention.ts`（pure）とは分離してある — こちらは LINE API への fetch を
 * 持つため。テストは `LineGroupMembershipClient` を差し替えて行う。
 */

export interface LineGroupMembershipClient {
  /**
   * userId がグループ groupId に在籍しているかを返す。
   * 判定不能（LINE API エラー等）は throw してよい — 呼び出し側
   * （filterToGroupMembers）が安全側（メンションしない）へ倒す。
   */
  isMember(args: {
    groupId: string
    userId: string
    channelAccessToken: string
  }): Promise<boolean>
}

export const defaultLineGroupMembershipClient: LineGroupMembershipClient = {
  async isMember({ groupId, userId, channelAccessToken }) {
    const res = await fetch(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${channelAccessToken}` } },
    )
    if (res.status === 200) return true
    if (res.status === 404) return false
    throw new Error(`LINE group membership probe failed: ${res.status}`)
  },
}

/**
 * userIds のうちグループ在籍者だけを**元の順序を保って**返す。
 * プローブが throw したユーザーは安全側（除外）に倒し、`membership_probe_failed`
 * を log へ記録して続行する — 1人の判定失敗で案内全体を止めない。
 */
export async function filterToGroupMembers(
  userIds: readonly string[],
  args: { groupId: string; channelAccessToken: string },
  client: LineGroupMembershipClient,
  log: (event: string, ctx: Record<string, unknown>) => void,
): Promise<string[]> {
  if (userIds.length === 0) return []
  const results = await Promise.all(
    userIds.map(async (userId) => {
      try {
        const member = await client.isMember({
          groupId: args.groupId,
          userId,
          channelAccessToken: args.channelAccessToken,
        })
        return member ? userId : null
      } catch (err) {
        log('membership_probe_failed', {
          userId,
          message: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    }),
  )
  return results.filter((id): id is string => id != null)
}
