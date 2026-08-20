import Link from 'next/link'

export interface GroupBackLinkProps {
  entryGroupId: number
  /** 複数日のときだけ添えるグループ名。1日だけなら null を渡す（＝添え字なし）。 */
  groupName: string | null
}

/**
 * entry-group-page タスク4 (AC-29): 日ページからグループページへの戻り導線。
 * ラベルは**固定文言**（大会名を繰り返さない）で、**シングルトングループでも
 * 常に表示する**——ボードは常にグループページへ着地するので、出さないと
 * group → day の戻り導線が消える（requirements §3.2.7）。
 *
 * 複数日のグループのときだけ、右にグループ名を薄く添える。置き場所は
 * sticky ヘッダーの**外**（呼び出し側の責務。ここでは sticky を持たない）。
 */
export function GroupBackLink({ entryGroupId, groupName }: GroupBackLinkProps) {
  return (
    <div className="flex items-baseline gap-[5px] pt-[10px] text-xs">
      <Link href={`/admin/entries/${entryGroupId}`} className="text-brand hover:underline">
        ‹ 大会全体（申込・名簿）
      </Link>
      {groupName != null && <span className="text-ink-meta">{groupName}</span>}
    </div>
  )
}
