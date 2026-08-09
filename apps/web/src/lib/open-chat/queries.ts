import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { entryGroupOpenChats } from '@kagetra/shared/schema'
import { db } from '@/lib/db'

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
