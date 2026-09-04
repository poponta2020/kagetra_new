import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { entryGroupOpenChats, events } from '@kagetra/shared/schema'
import { db } from '@/lib/db'
import { deriveEntryGroupName } from '@/lib/entry-groups'

/**
 * オープンチャットの読み取りクエリ（openchat-broadcast）。
 *
 * ★**`'use server'` のファイルに置かない。** `'use server'` ファイルから export した
 * async 関数は**すべて公開 Server Action エンドポイントになる**ため、認可ガードの無い
 * 読み取り関数をそこに置くと、Action ID さえ分かれば未ログインでも任意の
 * `entryGroupId` の招待 URL・パスワードを引けてしまう（Action ID は認可境界ではない）。
 * 内部クエリは `server-only` の本モジュールに置き、認可は呼び出し側の Server Action /
 * ページが行う。
 */

/**
 * 保存済み行を表示順で引く。★**この `ORDER BY` が AC-52 の並び順の正**
 * （大会詳細の表示順と Flex のボタン順を一致させる契約）。読み手は取得順のまま
 * 消費し、ローカルで並べ替えないこと。
 */
export async function listOpenChatsForGroup(entryGroupId: number) {
  return db
    .select({
      id: entryGroupOpenChats.id,
      url: entryGroupOpenChats.url,
      grades: entryGroupOpenChats.grades,
      eventDate: entryGroupOpenChats.eventDate,
      label: entryGroupOpenChats.label,
      password: entryGroupOpenChats.password,
      source: entryGroupOpenChats.source,
      createdAt: entryGroupOpenChats.createdAt,
    })
    .from(entryGroupOpenChats)
    .where(eq(entryGroupOpenChats.entryGroupId, entryGroupId))
    .orderBy(asc(entryGroupOpenChats.sortOrder), asc(entryGroupOpenChats.id))
}

export type OpenChatRow = Awaited<ReturnType<typeof listOpenChatsForGroup>>[number]

/**
 * グループ内の開催日（YYYY-MM-DD 昇順）・導出表示名・イベント ID を引く。
 *
 * 保存経路（`open-chat-actions.ts`）と配信経路（`broadcast.ts`）の両方が使う。
 * `'use server'` ファイルに置くと公開エンドポイントになるため、ここに置く
 * （このモジュール冒頭の注意書きを参照）。
 */
export async function loadOpenChatGroupContext(entryGroupId: number) {
  const rows = await db
    .select({ id: events.id, title: events.title, eventDate: events.eventDate })
    .from(events)
    .where(eq(events.entryGroupId, entryGroupId))
    .orderBy(asc(events.eventDate), asc(events.id))

  const eventDates = [...new Set(rows.map((r) => r.eventDate))]
  const displayName = deriveEntryGroupName(rows.map((r) => r.title)) ?? rows[0]?.title ?? '大会'
  return { eventDates, displayName, eventIds: rows.map((r) => r.id) }
}
