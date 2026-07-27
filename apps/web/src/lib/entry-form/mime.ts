import 'server-only'
import { randomBytes } from 'node:crypto'

/**
 * entry-form-autofill タスク3: 下書きメールの自前 MIME 組立。
 *
 * SMTP・送信系 API 依存を一切禁止しているため（送信は構造的に不可能にする、
 * requirements 大原則）、nodemailer 等のメール組立ライブラリも使わず、
 * multipart/mixed のテキストを自前で生成する。IMAP APPEND（imap-draft.ts）が
 * この関数の戻り値（RFC 5322 メッセージ全文）をそのまま Yahoo の Draft
 * フォルダへ書き込む。
 *
 * 改行は全て CRLF（`\r\n`）で統一する — ヘッダ間・ヘッダ/ボディ境界・
 * multipart 境界の前後すべて。本文/添付は base64 化するため、デコード後の
 * バイト列に何が含まれていても外側の MIME テキスト自体には裸の `\n` が
 * 出現しない（境界の折返しは wrapBase64 が CRLF のみで行う）。
 */

export interface DraftMimeAttachment {
  /** 添付ファイル名（既に「【北海道大学かるた会】」等のプレフィックス付与済み想定。RFC2231 でエンコードする）。 */
  filename: string
  contentType: string
  data: Buffer
}

export interface DraftMimeInput {
  /** From ヘッダ（会の連絡先メールアドレス）。Message-ID のドメイン導出にも使う。 */
  from: string
  to: string
  /** プレーンな件名文字列（未エンコード）。RFC2047 エンコードはこの関数が行う。 */
  subject: string
  /** プレーンな本文文字列。改行は `\n` でよい（内部で CRLF に正規化する）。 */
  bodyText: string
  attachment: DraftMimeAttachment
}

/**
 * boundary / date / messageId をテストから注入できるようにするための
 * override。省略時はランダム値・現在時刻から生成する（実装手順書の
 * 「決定的にテストできる形にする」要求）。
 */
export interface DraftMimeOverrides {
  boundary?: string
  date?: Date
  messageId?: string
}

const ENCODED_WORD_PREFIX = '=?UTF-8?B?'
const ENCODED_WORD_SUFFIX = '?='
// prefix(10) + suffix(2) = 12 文字。encoded-word 全体を 75 文字以内に収める
// ため、base64 本体は 63 文字以内。63 を超えない最大の 4 の倍数は 60 で、
// 60 / 4 * 3 = 45 バイト。45 は 3 の倍数なので base64 にパディング（`=`）が
// 出ず、チャンク境界の計算が単純になる。
const MAX_ENCODED_CHUNK_BYTES = 45

const BASE64_LINE_LENGTH = 76

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * `\n` / `\r` / `\r\n` が混在していても必ず `\r\n` 1種類に正規化する
 * （単純な `\n` → `\r\n` 置換だと元々 `\r\n` だった箇所が `\r\r\n` に
 * 壊れるバグを避けるため、置換ではなく正規化として書く）。
 */
function normalizeToCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\r\n')
}

/**
 * UTF-8 のバイト列で `maxBytes` 以下になるよう文字列を分割する。
 * `for...of` はコードポイント単位（サロゲートペアも1単位）で回るため、
 * マルチバイト文字の途中で割れることはない。
 */
function splitByUtf8Bytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const ch of value) {
    const chBytes = Buffer.byteLength(ch, 'utf8')
    if (currentBytes + chBytes > maxBytes && current.length > 0) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += ch
    currentBytes += chBytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * Subject を RFC2047 の複数 encoded-word に分割し、`CRLF + 半角スペース1個`
 * で folding して1本の文字列にする（`Subject: ` の後にそのまま挿入できる形）。
 * 各 encoded-word は 75 文字以内（`=?UTF-8?B?` + base64 60文字 + `?=` = 72文字）。
 */
function encodeRfc2047Subject(subject: string): string {
  const chunks = splitByUtf8Bytes(subject, MAX_ENCODED_CHUNK_BYTES)
  if (chunks.length === 0) return `${ENCODED_WORD_PREFIX}${ENCODED_WORD_SUFFIX}`
  return chunks
    .map((chunk) => `${ENCODED_WORD_PREFIX}${Buffer.from(chunk, 'utf8').toString('base64')}${ENCODED_WORD_SUFFIX}`)
    .join('\r\n ')
}

/**
 * RFC 2231 の attr-char セット（ALPHA / DIGIT / `!#$&+-.^_`|~`）以外の
 * バイトをすべて `%XX` にパーセントエンコードする。RFC2047 の
 * encoded-word をパラメータ値に使うのは仕様違反なのでここでは使わない。
 */
function encodeRfc2231Value(value: string): string {
  const bytes = Buffer.from(value, 'utf8')
  let result = ''
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte)
    if (/^[A-Za-z0-9!#$&+\-.^_`|~]$/.test(ch)) {
      result += ch
    } else {
      result += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return result
}

/**
 * 非 ASCII を含むファイル名の互換 (`filename="..."`) 用フォールバック。
 * ASCII のみならそのまま（`"`/`\` だけエスケープ）、そうでなければ
 * 拡張子を保ったまま汎用名に置き換える。
 */
function toAsciiFallbackFilename(filename: string): string {
  if (/^[\x20-\x7e]+$/.test(filename)) {
    return filename.replace(/["\\]/g, '_')
  }
  const dotIndex = filename.lastIndexOf('.')
  const ext = dotIndex >= 0 ? filename.slice(dotIndex) : ''
  const safeExt = ext.length > 0 && /^[\x20-\x7e]+$/.test(ext) ? ext : '.xlsx'
  return `attachment${safeExt}`
}

/** RFC2231 の `filename*` と互換 `filename` を両方持つ Content-Disposition 値。 */
function buildContentDisposition(filename: string): string {
  const asciiFallback = toAsciiFallbackFilename(filename)
  const encoded = encodeRfc2231Value(filename)
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

/** base64 文字列を76文字ごとに CRLF で折り返す。 */
function wrapBase64(base64: string, lineLength = BASE64_LINE_LENGTH): string {
  const lines: string[] = []
  for (let i = 0; i < base64.length; i += lineLength) {
    lines.push(base64.slice(i, i + lineLength))
  }
  return lines.join('\r\n')
}

/**
 * RFC 5322 の Date ヘッダ形式。`Date.prototype.toUTCString()` は
 * `GMT` 表記（RFC 1123 由来）で RFC 5322 のゾーン表現ではないため使わず、
 * UTC 基準で `+0000` を明示して組み立てる。
 */
function formatRfc5322Date(date: Date): string {
  const day = DAY_NAMES[date.getUTCDay()]
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const month = MONTH_NAMES[date.getUTCMonth()]
  const yyyy = date.getUTCFullYear()
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mi = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  return `${day}, ${dd} ${month} ${yyyy} ${hh}:${mi}:${ss} +0000`
}

function domainFromEmail(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1) : 'localhost'
}

function buildMessageId(domain: string): string {
  const random = randomBytes(16).toString('hex')
  return `<${Date.now()}.${random}@${domain}>`
}

/**
 * RFC 5322 のヘッダ値に置けない制御文字を含まないアドレスかを検査する。
 *
 * From / To はプレビューで編集された値がそのままヘッダ行になるため、改行を
 * 通すと任意のヘッダを差し込める（Bcc を足す等）。クライアントの input 要素は
 * Server Action 境界の防御にならないので、組み立ての手前で弾く。
 */
const CONTROL_CHAR_RE = new RegExp('[\\u0000-\\u001f\\u007f]')

function assertHeaderSafeAddress(value: string, headerName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${headerName} のメールアドレスが設定されていません`)
  }
  // 制御文字（C0 全域と DEL）を拒否する。CR/LF だけでなく NUL や垂直タブも、
  // 中継側の実装差でヘッダ境界として解釈され得るため一律で通さない。
  if (CONTROL_CHAR_RE.test(value)) {
    throw new Error(`${headerName} のメールアドレスに改行や制御文字を含めることはできません`)
  }
}

/**
 * 下書きメール本文の RFC 5322 メッセージ全文（ヘッダ + multipart/mixed
 * ボディ）を組み立てる。戻り値は imap-draft.ts の `appendDraftToYahoo` に
 * そのまま渡す。
 *
 * 本文パートの Content-Transfer-Encoding は base64 を選ぶ: 日本語本文は
 * quoted-printable にするとほぼ全バイトが `=XX` に展開され、ソフト改行の
 * 管理コストだけ増えて可読性の利点も消えるため。
 */
export function buildDraftMime(input: DraftMimeInput, overrides: DraftMimeOverrides = {}): string {
  assertHeaderSafeAddress(input.from, 'From')
  assertHeaderSafeAddress(input.to, 'To')

  const boundary = overrides.boundary ?? `----=_KagetraEntryForm_${randomBytes(12).toString('hex')}`
  const date = overrides.date ?? new Date()
  const messageId = overrides.messageId ?? buildMessageId(domainFromEmail(input.from))

  const encodedSubject = encodeRfc2047Subject(input.subject)
  const contentDisposition = buildContentDisposition(input.attachment.filename)
  const attachmentAsciiName = toAsciiFallbackFilename(input.attachment.filename)

  const bodyBase64 = wrapBase64(Buffer.from(normalizeToCrlf(input.bodyText), 'utf8').toString('base64'))
  const attachmentBase64 = wrapBase64(input.attachment.data.toString('base64'))

  const lines: string[] = [
    'MIME-Version: 1.0',
    `Date: ${formatRfc5322Date(date)}`,
    `Message-ID: ${messageId}`,
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodedSubject}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    bodyBase64,
    `--${boundary}`,
    `Content-Type: ${input.attachment.contentType}; name="${attachmentAsciiName}"`,
    `Content-Disposition: ${contentDisposition}`,
    'Content-Transfer-Encoding: base64',
    '',
    attachmentBase64,
    `--${boundary}--`,
    '',
  ]
  return lines.join('\r\n')
}
