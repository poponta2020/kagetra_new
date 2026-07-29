import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tournamentEntryRosterFiles } from '@kagetra/shared/schema'

/**
 * roster-file-adoption タスク3: 会員向け名簿ファイルビューア
 * （`/roster-files/[id]` ページと `/api/roster-files/[id]{,/preview/[page]}`）
 * が共有する認可ヘルパー。
 *
 * 判定は「採用済みかどうか」だけ（fail-closed）。`tournament_entry_roster_files`
 * に行が無ければ — 未採用、解除済み（採用 Server Action が行を削除する想定）、
 * あるいは大元の mail_attachments が削除されて ON DELETE CASCADE で道連れに
 * なった場合のいずれでも — null を返し、3経路とも例外なく 404 になる。
 * 管理者向け `/admin/mail-inbox/attachments/[id]` 系はこのヘルパーを経由しない
 * （role ベースの別経路のまま・一切変更しない）。
 *
 * bytea（`mail_attachments.data`）はここでは取得しない。ページ表示に要るのは
 * ファイル名・採用種別・発表日だけでここで完結し、バイナリ配信・プレビュー
 * 生成が要る2つの route だけが `attachment.id` を使って追加で全体行
 * （data 込み）を引き直す — admin 側ビューアページの「軽い投影→必要な時だけ
 * 全体行を引き直す」パターンを踏襲。取込元メール ID・採用者・メモ列は
 * そもそも select しない（RSC payload への内部情報漏洩を構造的に防ぐ・
 * roster-file-access.test.ts で select 列を固定）。
 */
export interface AdoptedRosterFile {
  id: number
  rosterType: 'applicant' | 'confirmed'
  publishedAt: string | null
  attachment: {
    id: number
    filename: string
    contentType: string
  }
}

export async function loadAdoptedRosterFile(
  rosterFileId: number,
): Promise<AdoptedRosterFile | null> {
  const row = await db.query.tournamentEntryRosterFiles.findFirst({
    where: eq(tournamentEntryRosterFiles.id, rosterFileId),
    columns: {
      id: true,
      rosterType: true,
      publishedAt: true,
    },
    with: {
      sourceAttachment: {
        columns: {
          id: true,
          filename: true,
          contentType: true,
        },
      },
    },
  })
  if (!row?.sourceAttachment) return null

  return {
    id: row.id,
    rosterType: row.rosterType,
    publishedAt: row.publishedAt,
    attachment: {
      id: row.sourceAttachment.id,
      filename: row.sourceAttachment.filename,
      contentType: row.sourceAttachment.contentType,
    },
  }
}

/** `mail_attachments.id` / `tournament_entry_roster_files.id` は postgres int4。 */
const INT4_MAX = 2147483647

/**
 * 正準な正の整数文字列のみ許可する（admin route と同じ規約）。
 * `Number.parseInt('01', 10)` や `Number.parseInt('1e5', 10)` はどちらも
 * 数値としては通ってしまうが、無関係な URL を同じ行へサイレントに写像するため
 * 弾く。int4 の範囲を超える値も、DB へ渡すと pg が範囲外エラーで 500 化する
 * ので、ここで 400 相当として弾く。
 */
export function parseCanonicalRosterFileId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null
  const id = Number.parseInt(raw, 10)
  if (id > INT4_MAX) return null
  return id
}
