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
): Promise<void> {
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
    await flow.append(mailbox, mimeContent, ['\\Draft'], new Date())
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Yahoo メールへの下書き作成に失敗しました: ${reason}`)
  } finally {
    // APPEND の成否によらず接続は畳む。ここで例外を投げると、成功した APPEND を
    // 失敗として返してしまい、利用者の再試行で下書きが重複する。
    await flow.logout().catch(() => undefined)
  }
}
