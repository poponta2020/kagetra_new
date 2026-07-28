import 'server-only'
import { ImapFlow } from 'imapflow'
import { loadImapConfig } from '@kagetra/mail-worker/config'

/**
 * entry-form-autofill タスク3: IMAP APPEND で Yahoo の下書きフォルダへ
 * メッセージを直接書き込む薄いラッパー。
 *
 * requirements 大原則「送信は構造的に不可能にする」を実装する箇所——SMTP・
 * 送信系 API は一切使わず、Yahoo への書き込みはこの APPEND だけ。
 *
 * `loadImapConfig` は `@kagetra/mail-worker/config` から import する
 * （`apps/web/src/app/(app)/admin/mail-inbox/actions.ts` の
 * `loadLlmConfig` import が先例）。mail-worker の `imap-client.ts` は
 * fetch専用で `mailparser` を引き込むため、web バンドルには持ち込まない。
 */

export interface AppendDraftOptions {
  /**
   * 下書きフォルダ名。既定は `'Draft'`。Yahoo!メールは通常このフォルダ名だが、
   * アカウント設定によっては `'Drafts'` になる場合があるため上書きできるようにする。
   */
  mailbox?: string
  /**
   * 冪等キー。APPEND の前に同じ Message-ID の下書きが既にあるか照合し、あれば
   * 追加しない。「APPEND は成功したが応答が返らなかった」あとの再試行で下書きが
   * 重複するのを防ぐ（`entry_form_drafts.message_id` を渡す）。
   */
  messageId?: string
}

export interface AppendDraftResult {
  /** 実際に APPEND したか。`false` は同じ Message-ID の下書きが既にあった場合。 */
  appended: boolean
}

const DEFAULT_DRAFT_MAILBOX = 'Draft'

/**
 * MIME メッセージ全文（`mime.ts` の `buildDraftMime` の戻り値）を Yahoo の
 * 下書きフォルダへ APPEND する。`\Draft` フラグを付与する。
 *
 * 成功/失敗は例外で表現する（呼び出し側が選べる設計だが、こちらを選択）。
 * 呼び出し側（タスク7 の Server Action）は catch して
 * `entry_form_drafts.status = 'imap_failed'` ・ `imapError` にメッセージを
 * 保存し、生成済み xlsx をその場でダウンロード可能にする（成果物を失わない）。
 * エラーメッセージは DB に保存されユーザーにも表示されるため日本語にする。
 *
 * `logout()` は必ず試みるが、**APPEND が成功した後の logout 失敗で作成を失敗に
 * 落とさない**。Yahoo 側には下書きが既に存在するため、失敗として返すと利用者が
 * 再試行して下書きが重複する。接続の後始末は best-effort に留める。
 */
export async function appendDraftToYahoo(
  mimeContent: string,
  options: AppendDraftOptions = {},
): Promise<AppendDraftResult> {
  const config = loadImapConfig()
  if (!config.YAHOO_IMAP_USER || !config.YAHOO_IMAP_APP_PASSWORD) {
    throw new Error(
      'YAHOO_IMAP_USER / YAHOO_IMAP_APP_PASSWORD が設定されていません。下書き作成には IMAP 資格情報が必要です。',
    )
  }
  const mailbox = options.mailbox ?? DEFAULT_DRAFT_MAILBOX

  const flow = new ImapFlow({
    host: config.YAHOO_IMAP_HOST,
    port: config.YAHOO_IMAP_PORT,
    secure: true,
    auth: {
      user: config.YAHOO_IMAP_USER,
      pass: config.YAHOO_IMAP_APP_PASSWORD,
    },
    logger: false,
  })

  try {
    await flow.connect()

    // 同じ Message-ID の下書きが既にあれば追加しない（再試行の冪等化）。
    // 照合できない環境では通常の APPEND に倒す（照合の失敗で作成を止めない）。
    if (options.messageId) {
      const already = await findDraftByMessageId(flow, mailbox, options.messageId)
      if (already) return { appended: false }
    }

    await flow.append(mailbox, mimeContent, ['\\Draft'], new Date())
    return { appended: true }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Yahoo メールへの下書き作成に失敗しました: ${reason}`)
  } finally {
    // APPEND の成否によらず接続は畳む。ここで例外を投げると、成功した APPEND を
    // 失敗として返してしまい、利用者の再試行で下書きが重複する。
    await flow.logout().catch(() => undefined)
  }
}

/**
 * 下書きフォルダに同じ Message-ID のメッセージがあるか。
 * 照合できない（SEARCH 非対応・権限不足等）ときは `false` を返して通常の APPEND に倒す
 * ——照合の失敗で作成そのものを止める方が害が大きい。
 */
async function findDraftByMessageId(
  flow: ImapFlow,
  mailbox: string,
  messageId: string,
): Promise<boolean> {
  try {
    const lock = await flow.getMailboxLock(mailbox)
    try {
      const found = await flow.search({ header: { 'message-id': messageId } })
      return Array.isArray(found) && found.length > 0
    } finally {
      lock.release()
    }
  } catch {
    return false
  }
}
