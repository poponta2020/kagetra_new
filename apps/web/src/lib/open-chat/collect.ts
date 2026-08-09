/**
 * 大会オープンチャットの招待 URL 候補を、メール本文＋添付から一括収集する
 * オーケストレータ（openchat-broadcast §3.2.2〜§3.2.3）。
 *
 * extract.ts（テキスト → 候補）と qr.ts（画像バイト列 → QR 文字列）を束ね、
 * 添付の種類ごとに走査経路を振り分ける:
 *   - 本文テキスト・添付の抽出済みテキスト → extractOpenChatCandidates（Tier1/2）
 *   - image/jpeg・image/png 添付           → decodeQrFromImage（Tier3。AC-11）
 *   - PDF・Word 添付                        → renderPdfToJpegs 経由のページ画像を
 *                                             decodeQrFromImages（Tier3。AC-12）
 *
 * ★このモジュールは**サーバー専用**（qr.ts 経由で sharp を使う）。client から
 * import しないこと（extract.ts / label.ts のような client-safe leaf 制約は無い）。
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RENDER_PAGE_LIMIT,
  renderPdfToJpegs,
  runLibreofficeConvertToPdf,
} from '@/lib/attachment-image-render'
import { detectPreviewKind, normalizeContentType } from '@/lib/attachment-preview'
import { extractOpenChatCandidates, type OpenChatCandidate, type OpenChatGrade } from './extract'
import { decodeQrFromImage, decodeQrFromImages } from './qr'

/**
 * DB の `open_chat_source` enum（packages/shared/src/schema/enums.ts）と同じ4値。
 * extract.ts の `OpenChatCandidateSource` は body/attachment_text の2値しか
 * 知らない（qr/manual は集約側＝このファイルの責務）ため、ここで広い型を定義する。
 */
export type OpenChatCollectSource = 'body' | 'attachment_text' | 'qr' | 'manual'

/** collect.ts が返す候補1件。extract.ts の `OpenChatCandidate` と属性は同じで、sources だけ広い。 */
export interface OpenChatCollectedCandidate {
  url: string
  sources: OpenChatCollectSource[]
  unverified: boolean
  grades: OpenChatGrade[] | null
  eventDate: string | null
  password: string | null
}

/** 走査対象の添付1件。`mail_attachments` の列のうち抽出に必要な分だけを受け取る。 */
export interface OpenChatCollectAttachment {
  filename: string
  contentType: string | null
  data: Buffer
  extractedText: string | null
}

export interface CollectOpenChatCandidatesInput {
  bodyText: string
  attachments: readonly OpenChatCollectAttachment[]
  /** 申込グループ内の開催日（YYYY-MM-DD）。extract.ts の groupEventDates にそのまま渡す。 */
  groupEventDates: string[]
}

export interface CollectOpenChatCandidatesResult {
  candidates: OpenChatCollectedCandidate[]
  /**
   * QR 走査を試みたが1件も読み取れなかった添付のファイル名（requirements §3.2.3）。
   *
   * ★これを返さないと「読めなかった」が「QR が無かった」と区別できない。招待を運ぶ
   * メールの30%は**テキストに URL が無く QR だけ**なので、デコード失敗を黙って捨てると
   * 画面は「いずれにも招待 URL がありませんでした」と**断定**し、管理者は取りこぼしに
   * 気づけないまま処理を完了してしまう。
   */
  qrUnreadAttachments: string[]
}

/**
 * QR デコード対象を jpeg/png に限定する（requirements §3.2.3）。
 * `detectPreviewKind` の `image` 判定は gif/webp/heic も含むため使わず、ここで直接絞る。
 */
const QR_IMAGE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png'])

const PDF_CONTENT_TYPES = new Set(['application/pdf', 'application/x-pdf'])

/**
 * MIME → libreoffice 変換用の拡張子。`attachment-preview.ts` の同名マップと同じ値だが、
 * 同ファイルが export していないため（leaf 制約でこのタスクの担当範囲外）
 * PDF 判定とこの表のみ最小限に複製する。
 */
const OFFICE_EXTENSION_BY_TYPE: Record<string, string> = {
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}

function fileExtension(filename: string): string {
  const m = /\.([a-z0-9]{1,10})$/i.exec(filename)
  return m?.[1]?.toLowerCase() ?? ''
}

function isPdfAttachment(attachment: OpenChatCollectAttachment): boolean {
  const ct = normalizeContentType(attachment.contentType)
  return PDF_CONTENT_TYPES.has(ct) || fileExtension(attachment.filename) === 'pdf'
}

/** Office 変換用の入力拡張子を決める。filename の拡張子を優先し、無ければ MIME から引く。 */
function officeConversionExtension(attachment: OpenChatCollectAttachment): string | null {
  const ext = fileExtension(attachment.filename)
  if (ext && ext !== 'pdf') return ext
  return OFFICE_EXTENSION_BY_TYPE[normalizeContentType(attachment.contentType)] ?? null
}

/**
 * Office 添付を libreoffice で PDF に変換する（`attachment-preview.ts` の
 * `convertToPdf` と同じ手順。同ファイルが非 export のためここで複製する）。
 */
async function convertOfficeToPdf(attachment: OpenChatCollectAttachment): Promise<Buffer> {
  const ext = officeConversionExtension(attachment)
  if (!ext) {
    throw new Error(
      `openchat collect: cannot determine conversion extension for ${attachment.filename}`,
    )
  }
  const workDir = await mkdtemp(join(tmpdir(), 'kagetra-openchat-'))
  try {
    const inputPath = join(workDir, `input.${ext}`)
    await writeFile(inputPath, attachment.data)
    // forceWriter: false — Office 添付は自身のモジュール（Calc/Impress 等）で開く。
    // --writer は HTML 本文専用（attachment-image-render.ts のコメント参照）。
    await runLibreofficeConvertToPdf(inputPath, workDir, { forceWriter: false })
    return await readFile(join(workDir, 'input.pdf'))
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {
      // ベストエフォート。掃除に失敗しても機能は継続する（tmp reaper に任せる）。
    })
  }
}

/** QR 走査の結果。`scanned` が true なら「走査対象だった」＝読めなければ警告に出す。 */
interface QrScanOutcome {
  scanned: boolean
  texts: string[]
}

/**
 * 添付1件から QR 文字列を集める。image/jpeg・image/png は直接デコード、
 * PDF・Word はページ画像化してから各ページをデコードする（AC-11, AC-12）。
 */
async function collectQrTextsFromAttachment(
  attachment: OpenChatCollectAttachment,
): Promise<QrScanOutcome> {
  const ct = normalizeContentType(attachment.contentType)
  if (QR_IMAGE_CONTENT_TYPES.has(ct)) {
    const text = await decodeQrFromImage(attachment.data)
    return { scanned: true, texts: text ? [text] : [] }
  }

  // ★QR 走査の対象は **PDF と Word だけ**（requirements §3.2.3）。
  // `detectPreviewKind` の 'document' は xlsx / pptx も含むため使えない —
  // 名簿の xlsx にまで libreoffice 変換を掛けることになり、時間を捨てるうえ
  // 「読めなかった添付」の警告に名簿が並んで実際の取りこぼしが埋もれる
  // （XLSX からの抽出は Non-goals で unsupported と決めてある）。
  if (!isQrDocumentTarget(attachment)) {
    return { scanned: false, texts: [] }
  }

  const pdfBuffer = isPdfAttachment(attachment)
    ? attachment.data
    : await convertOfficeToPdf(attachment)
  const { pages } = await renderPdfToJpegs(pdfBuffer, { maxPages: RENDER_PAGE_LIMIT })
  // AC-14: renderPdfToJpegs 自体も走査ページ数の上限を持つが、テストの mock は
  // それを無視して多く返せてしまうため、ここでも明示的に切ってからデコーダへ渡す。
  const cappedPages = pages.slice(0, RENDER_PAGE_LIMIT)
  return { scanned: true, texts: await decodeQrFromImages(cappedPages) }
}

/** extract.ts の候補（sources: body/attachment_text）を広い型へ持ち上げる。 */
function widenSources(candidates: OpenChatCandidate[]): OpenChatCollectedCandidate[] {
  return candidates.map((c) => ({ ...c, sources: [...c.sources] as OpenChatCollectSource[] }))
}

/**
 * 複数の候補リストを1つにマージする（extract.ts の `mergeOpenChatCandidateLists` と
 * 同じ規則）。sources が広い型（qr/manual を含む）を持つため、狭い型を前提にした
 * `mergeOpenChatCandidateLists` はそのまま流用できず、ここで同じロジックを複製する。
 */
function mergeCollectedCandidates(
  lists: OpenChatCollectedCandidate[][],
): OpenChatCollectedCandidate[] {
  const order: string[] = []
  const map = new Map<string, OpenChatCollectedCandidate>()

  for (const list of lists) {
    for (const candidate of list) {
      const existing = map.get(candidate.url)
      if (!existing) {
        order.push(candidate.url)
        map.set(candidate.url, { ...candidate, sources: [...new Set(candidate.sources)] })
        continue
      }
      existing.sources = [...new Set([...existing.sources, ...candidate.sources])]
      existing.unverified = existing.unverified || candidate.unverified
      existing.grades = existing.grades ?? candidate.grades
      existing.eventDate = existing.eventDate ?? candidate.eventDate
      existing.password = existing.password ?? candidate.password
    }
  }

  // order は map.set 直後にしか push しないため、対応する値は必ず存在する
  // （extract.ts の mergeOpenChatCandidateLists と同じ非 null アサーション）。
  return order.map((url) => map.get(url)!)
}

/**
 * メール1通ぶん（本文＋添付）からオープンチャット候補一覧を作る（AC-6, AC-11, AC-12, AC-20）。
 *
 * 添付1件が壊れていても（QR 走査で例外が出ても）他の候補は返す
 * （requirements §3.2.8「その添付だけスキップし、他の候補で続行する」。AC-13 の一般化）。
 * 候補ゼロのときは単に空配列を返す（「見つかりませんでした」の表示は呼び出し側 UI の責務）。
 */
export async function collectOpenChatCandidates(
  input: CollectOpenChatCandidatesInput,
): Promise<CollectOpenChatCandidatesResult> {
  const { bodyText, attachments, groupEventDates } = input

  const bodyCandidates = widenSources(
    extractOpenChatCandidates(bodyText, { source: 'body', groupEventDates }),
  )

  const attachmentTextCandidates: OpenChatCollectedCandidate[] = []
  const qrCandidates: OpenChatCollectedCandidate[] = []
  const qrUnreadAttachments: string[] = []

  for (const attachment of attachments) {
    // 走査に着手したかを try の外で持つ。ページ画像化の途中で例外が出た場合も
    // 「走査したが読めなかった」として警告に載せるため（黙って捨てない）。
    let scanned = false
    try {
      if (attachment.extractedText) {
        // QR 走査より先に積む: QR 側が例外を投げても、この添付のテキスト由来候補は失わない
        // （push は同期処理で完了するため、この後の await が失敗しても取り消されない）。
        attachmentTextCandidates.push(
          ...widenSources(
            extractOpenChatCandidates(attachment.extractedText, {
              source: 'attachment_text',
              groupEventDates,
            }),
          ),
        )
      }

      const qrOutcome = await collectQrTextsFromAttachment(attachment)
      scanned = qrOutcome.scanned
      if (qrOutcome.scanned && qrOutcome.texts.length === 0) {
        qrUnreadAttachments.push(attachment.filename)
      }
      for (const qrText of qrOutcome.texts) {
        // extract.ts の source は body/attachment_text の2値のみ。QR から得た URL も
        // Tier1/2 と同じ検証（line.me 形式か・短縮 URL か）を通すため
        // extractOpenChatCandidates に食わせ、出典だけ 'qr' に差し替える
        // （requirements §3.2.3 末尾。extract.ts 自体は書き換えない）。
        const fromQr = extractOpenChatCandidates(qrText, { source: 'body', groupEventDates })
        qrCandidates.push(
          ...fromQr.map((c): OpenChatCollectedCandidate => ({ ...c, sources: ['qr'] })),
        )
      }
    } catch {
      // requirements §3.2.8: 添付が破損して抽出に失敗 → その添付だけスキップし、
      // 他の候補で続行する（AC-13）。★ただし黙ってはいない — 走査に着手していた
      // 添付は「読めなかった」として警告に載せる（PDF 変換の失敗もここに来る）。
      if (!scanned && isQrScanTarget(attachment)) qrUnreadAttachments.push(attachment.filename)
      continue
    }
  }

  return {
    candidates: mergeCollectedCandidates([
      bodyCandidates,
      attachmentTextCandidates,
      qrCandidates,
    ]),
    qrUnreadAttachments,
  }
}

/** Word の MIME（PDF は `isPdfAttachment` が見る）。 */
const WORD_CONTENT_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

/** ページ画像化して QR を探す対象か（PDF・Word のみ。xlsx / pptx は対象外）。 */
function isQrDocumentTarget(attachment: OpenChatCollectAttachment): boolean {
  if (isPdfAttachment(attachment)) return true
  if (WORD_CONTENT_TYPES.has(normalizeContentType(attachment.contentType))) return true
  return ['doc', 'docx'].includes(fileExtension(attachment.filename))
}

/** QR 走査の対象になる添付か（画像 or PDF/Word）。警告に載せるかの判定に使う。 */
function isQrScanTarget(attachment: OpenChatCollectAttachment): boolean {
  if (QR_IMAGE_CONTENT_TYPES.has(normalizeContentType(attachment.contentType))) return true
  return isQrDocumentTarget(attachment)
}
