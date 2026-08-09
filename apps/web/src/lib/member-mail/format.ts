/**
 * member-mail-search タスク2: 会員向けメール検索（`/mail`・`/mail/[id]`・添付ビューア）が
 * 共有する表示フォーマッタ（純関数のみ）。design-mock の実際の表記に合わせる
 * （list-normal.html / detail-a-timeline.html / edge.html）。
 *
 * 日時は JST 固定。本番ホストの TZ に依存しないよう `apps/web/src/lib/event-date.ts` と
 * 同じ `Intl.DateTimeFormat(..., { timeZone: 'Asia/Tokyo' }).formatToParts()` パターンを
 * 踏襲する（`toLocaleString` の既定書式には頼らない）。
 */

const TOKYO_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  weekday: 'short',
})

interface TokyoParts {
  year: string
  month: string
  day: string
  hour: string
  minute: string
}

function tokyoParts(d: Date): TokyoParts {
  const parts = TOKYO_PARTS_FORMATTER.formatToParts(d)
  const map: Partial<Record<string, string>> = {}
  for (const part of parts) map[part.type] = part.value
  return {
    year: map.year ?? '',
    month: map.month ?? '',
    day: map.day ?? '',
    hour: map.hour ?? '',
    minute: map.minute ?? '',
  }
}

/** JST の曜日（1文字・例 `土`）。 */
function weekdayJa(d: Date): string {
  return WEEKDAY_FORMATTER.format(d)
}

/** 一覧カードの受信日時。例 `8/8(土) 16:25`（JST 固定・月日はゼロ埋めなし・時分はゼロ埋め）。 */
export function formatMailListDateTime(d: Date): string {
  const { month, day, hour, minute } = tokyoParts(d)
  return `${Number(month)}/${Number(day)}(${weekdayJa(d)}) ${hour}:${minute}`
}

/** 詳細ヘッダの受信日時。例 `2026年8月1日(土) 21:07`（JST 固定）。 */
export function formatMailDetailDateTime(d: Date): string {
  const { year, month, day, hour, minute } = tokyoParts(d)
  return `${Number(year)}年${Number(month)}月${Number(day)}日(${weekdayJa(d)}) ${hour}:${minute}`
}

/** 履歴タイムラインの日付見出し。例 `2026年8月2日`（JST 固定・時刻無し）。 */
export function formatHistoryDate(d: Date): string {
  const { year, month, day } = tokyoParts(d)
  return `${Number(year)}年${Number(month)}月${Number(day)}日`
}

/** 一覧カード `↳` 行の日付。例 `8/4`（JST 固定・月日はゼロ埋めなし）。 */
export function formatHistorySummaryDate(d: Date): string {
  const { month, day } = tokyoParts(d)
  return `${Number(month)}/${Number(day)}`
}

/**
 * ファイルサイズ表記。1024 未満 = `N B`、1 MB 未満 = 整数 `N KB`、以上 = 小数第1位まで `N.N MB`。
 * 境界は生バイト数で判定する（KB への丸め後の値では判定しない）。
 */
function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 添付の種別ラベル。`content_type` 優先、判定できなければ拡張子で判定する。
 * 既存 `pickAttachmentIcon`（AttachmentList.tsx）と判定順は揃えるが、あちらは絵文字アイコン、
 * こちらは日本語ラベルで責務が違うため import せず独立して書く。
 */
export function attachmentTypeLabel(contentType: string, filename: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('pdf')) return 'PDF'
  if (ct.includes('wordprocessingml') || ct === 'application/msword') return 'Word'
  if (ct.includes('spreadsheetml') || ct === 'application/vnd.ms-excel') return 'Excel'
  if (ct.includes('presentationml') || ct === 'application/vnd.ms-powerpoint') return 'PowerPoint'
  if (ct.startsWith('image/')) return '画像'
  if (ct.includes('zip')) return 'ZIP'
  if (ct === 'text/plain' || ct === 'text/csv') return 'テキスト'

  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'PDF'
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'Word'
  if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) return 'Excel'
  if (lower.endsWith('.ppt') || lower.endsWith('.pptx')) return 'PowerPoint'
  if (/\.(jpe?g|png|gif|webp|bmp|heic)$/.test(lower)) return '画像'
  if (lower.endsWith('.zip')) return 'ZIP'
  if (lower.endsWith('.txt') || lower.endsWith('.csv')) return 'テキスト'
  return 'ファイル'
}

/**
 * 詳細の添付行メタ。例 `PDF · 1.2 MB` / `Excel · 84 KB` / `画像 · 2.1 MB` / `ZIP · 4.8 MB`。
 *
 * `filename` を受けるのは、送信者側のメーラーが `application/octet-stream` で
 * 送ってくる添付が実在するため（IMAP 由来の content_type は信用しきれない）。
 * 拡張子フォールバックまで通さないと、モックの `ZIP · 4.8 MB` が
 * `ファイル · 4.8 MB` に劣化する。
 */
export function formatAttachmentMeta(
  contentType: string,
  filename: string,
  sizeBytes: number,
): string {
  return `${attachmentTypeLabel(contentType, filename)} · ${formatFileSize(sizeBytes)}`
}
