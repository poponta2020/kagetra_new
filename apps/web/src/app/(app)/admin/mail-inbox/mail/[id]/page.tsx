import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { loadCostGuardConfig } from '@kagetra/mail-worker/config'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { mailMessages } from '@kagetra/shared/schema'
import { todayInJst } from '@/lib/jst-date'
import { Card, Pill, type PillTone } from '@/components/ui'
import { AttachmentList } from '../../components/AttachmentList'
import { type TriageStatus } from '../../components/TriageActions'
import { ExtractionInProgressCard } from '../../components/ExtractionInProgressCard'
import { DraftCard } from '../../components/DraftCard'
import { UndoTriageButton } from '../../components/UndoTriageButton'
import { AIExtractConfirmDialog } from '../../components/AIExtractConfirmDialog'
import {
  MailProcessForm,
  type MailProcessAttachment,
} from '../../components/MailProcessForm'
import { linkableEventCutoffStr } from '../../linkable-events'
import { loadProcessCandidateGroups } from '../../process-candidates'
import {
  ResultParseButton,
  type ResultAttachment,
} from '../../components/ResultParseButton'
import { isResultImportAttachment } from '@/lib/result-import/attachment'

/**
 * /admin/mail-inbox/mail/[id] — mail-inbox-mailer 「メーラー詳細」画面。
 *
 * 2026-08-02 改修: 処理エリアを**統合処理フォーム**（MailProcessForm）に置き換えた。
 * 旧「会で流す / 既存イベントに紐付ける / 対応不要」の 3 ボタンと、添付ごとの
 * 「名簿ファイルとして採用」シートは廃止（種別 → 対象 → 実行の 1 フォームに集約）。
 *
 * 処理エリアの分岐は triage 状態と AI ドラフトの有無で 3 つ（要件 §3.1.3）:
 *   未処理 かつ draft なし          → MailProcessForm（統合フォーム）
 *   draft.status='ai_processing'    → ExtractionInProgressCard (polling)
 *   draft.status='ai_failed'        → 再試行
 *   draft.status='pending_review'   → DraftCard + 承認動線リンク
 *   draft.status='approved'/'rejected'/'superseded' → 状態表示
 *   処理済み                        → 「処理済み」カード + 未処理に戻す
 */
export const dynamic = 'force-dynamic'

// mail-inbox-mailer 2026-08-02 改修 (AC-26): 区分ピルは AI 由来の classification
// ではなく管理者が手で選んだ mail_kind。未選択のメールにはピルを出さない。
const MAIL_KIND_LABEL: Record<string, { label: string; tone: PillTone }> = {
  tournament_notice: { label: '大会案内', tone: 'brand' },
  applicant_roster: { label: '申込名簿', tone: 'brand' },
  confirmed_roster: { label: '確定名簿', tone: 'brand' },
}

// mail-inbox-mailer: triage 2 状態化（unprocessed / processed）。「保留」廃止。
const TRIAGE_LABEL: Record<TriageStatus, { label: string; tone: PillTone }> = {
  unprocessed: { label: '未処理', tone: 'warn' },
  processed: { label: '処理済み', tone: 'success' },
}

function formatJst(date: Date): string {
  return date.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function MailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const mailId = Number(id)
  if (!Number.isInteger(mailId) || mailId <= 0) notFound()

  const session = await auth()
  if (
    !session ||
    (session.user?.role !== 'admin' && session.user?.role !== 'vice_admin')
  ) {
    redirect('/403')
  }

  // bytea attachment `data` は projection から除外（一覧と同じく一覧/詳細では
  // バイナリを載せない）。本文は bodyText / bodyHtml を両方使う（プレーンテキスト
  // を優先し、無ければ HTML を pre 表示）。
  const mail = await db.query.mailMessages.findFirst({
    where: eq(mailMessages.id, mailId),
    with: {
      attachments: {
        columns: {
          id: true,
          filename: true,
          contentType: true,
          extractionStatus: true,
          // mail-ai-extract-refinements タスク8: 添付選択ダイアログでサイズを
          // 表示するために追加（AC-26）。
          sizeBytes: true,
        },
        // roster-file-adoption タスク2: 添付ごとの採用状態（種別・対象大会名）を
        // 詳細画面に出すため、採用レコード + 帰属 entry_group の events を辿る。
        with: {
          rosterFileAdoption: {
            columns: {
              id: true,
              rosterType: true,
              // 2026-08-01 改修 (AC-18): 採用済み表示に取込単位（級ラベル）を出す。
              grades: true,
            },
            with: {
              entryGroup: {
                with: {
                  events: {
                    columns: { id: true, title: true },
                  },
                },
              },
            },
          },
        },
      },
      // 1:0..1。draft の状態によってアクションエリアを切替。
      draft: {
        columns: {
          id: true,
          status: true,
          confidence: true,
          isCorrection: true,
          referencesSubject: true,
          extractedPayload: true,
          // mail-ai-extract-refinements AC-31: 「AI 抽出を再試行」でも前回の
          // 添付選択を初期値として復元する。
          selectedAttachmentIds: true,
        },
      },
      // tournament-results: 結果取込ドラフト（message_id UNIQUE = 0..1）。
      resultDraft: {
        columns: {
          id: true,
          status: true,
          parseError: true,
        },
      },
    },
  })
  if (!mail) notFound()

  // tournament-results: .xls/.xlsx/.pdf 添付のみ「結果として取り込む」対象。
  const resultAttachments: ResultAttachment[] = mail.attachments
    .filter((a) => isResultImportAttachment(a.filename))
    .map((a) => ({ id: a.id, filename: a.filename }))

  const triage = TRIAGE_LABEL[mail.triageStatus] ?? {
    label: mail.triageStatus,
    tone: 'neutral' as const,
  }
  const mailKind = mail.mailKind ? MAIL_KIND_LABEL[mail.mailKind] : null

  // mail-ai-extract-refinements タスク8: 添付選択ダイアログに渡す一覧とサイズ上限。
  // 上限はサーバー側 (mail-worker) の設定を Server Component で読んで prop で
  // 渡す（クライアントで env を読まない）。
  const aiExtractAttachments = mail.attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
  }))
  const pdfSizeLimitKb = loadCostGuardConfig().MAIL_WORKER_PDF_SIZE_LIMIT_KB

  // 統合フォームを出すときだけ候補を引く（処理済み・draft 進行中は使わない）。
  const showProcessForm = !mail.draft && mail.triageStatus === 'unprocessed'
  const candidateGroups = showProcessForm ? await loadProcessCandidateGroups() : []
  const cutoffStr = linkableEventCutoffStr()

  // 添付ごとの採用状態は統合フォーム内の「採用する名簿ファイル」欄に出す
  // （AC-13: 採用済みは選択肢に出さず、採用状態と解除ボタンにする）。
  const processAttachments: MailProcessAttachment[] = mail.attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    sizeBytes: a.sizeBytes,
    adoption: a.rosterFileAdoption
      ? {
          id: a.rosterFileAdoption.id,
          rosterType: a.rosterFileAdoption.rosterType,
          grades: a.rosterFileAdoption.grades,
          eventTitles:
            a.rosterFileAdoption.entryGroup?.events.map((e) => e.title) ?? [],
        }
      : null,
  }))

  // ★senseki-boundary: 配布版から丸ごと物理削除するブロック。表示条件も JSX も
  // ここ 1 箇所に閉じておく（統合フォームへは prop で渡すだけ）。
  {/* tournament-results Task3/4: 結果 Excel/PDF 取込エリア。
          AI 取込フロー（tournament_drafts）とは独立した別セクション。
          .xls/.xlsx/.pdf 添付があるときだけ表示する。 */}
  const resultImportSection =
    resultAttachments.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-ink">
            試合結果の取込
          </h2>
          {mail.resultDraft == null ? (
            <Card>
              <div className="flex flex-col gap-3">
                <p className="text-xs text-ink-meta">
                  Excel または PDF から試合結果を取り込みます。PDF は AI が全文を
                  抽出するため、取込後にレビュー・承認画面でより丁寧に内容を
                  確認してから確定してください。
                </p>
                <ResultParseButton
                  mailId={mail.id}
                  attachments={resultAttachments}
                />
              </div>
            </Card>
          ) : mail.resultDraft.status === 'pending_review' ? (
            <Card className="border-info-fg/30 bg-info-bg">
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-semibold text-info-fg">取込完了 — 承認待ち</span>
                <Link
                  href={`/admin/mail-inbox/result-drafts/${mail.resultDraft.id}`}
                  className="text-brand-fg underline"
                >
                  結果ドラフト #{mail.resultDraft.id} を確認 →
                </Link>
              </div>
            </Card>
          ) : mail.resultDraft.status === 'approved' ? (
            <Card className="border-success-fg/30 bg-success-bg">
              <span className="text-sm font-semibold text-success-fg">
                試合結果 承認済み
              </span>
            </Card>
          ) : mail.resultDraft.status === 'parse_failed' ? (
            <Card className="border-danger-fg/30 bg-danger-bg">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold text-danger-fg">
                  取込に失敗しました
                </span>
                {mail.resultDraft.parseError && (
                  <p className="text-xs text-danger-fg opacity-80">
                    {mail.resultDraft.parseError}
                  </p>
                )}
                <ResultParseButton
                  mailId={mail.id}
                  attachments={resultAttachments}
                />
              </div>
            </Card>
          ) : (
            <Card>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="text-ink-2">
                  結果ドラフト #{mail.resultDraft.id}（{mail.resultDraft.status}）
                </span>
                <ResultParseButton
                  mailId={mail.id}
                  attachments={resultAttachments}
                />
              </div>
            </Card>
          )}
        </section>
    ) : null

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Link href="/admin/mail-inbox" className="text-sm text-brand-fg underline">
          ← メール受信箱
        </Link>
      </div>

      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-meta">{formatJst(mail.receivedAt)}</span>
            <div className="flex items-center gap-1.5">
              {mailKind && (
                <Pill tone={mailKind.tone} size="sm">
                  {mailKind.label}
                </Pill>
              )}
              <Pill tone={triage.tone} size="sm">
                {triage.label}
              </Pill>
            </div>
          </div>
          <h1 className="font-display text-lg font-bold text-ink">
            {mail.subject || '(件名なし)'}
          </h1>
          <div className="text-xs text-ink-meta">
            {mail.fromName
              ? `${mail.fromName} <${mail.fromAddress}>`
              : mail.fromAddress}
          </div>
          <AttachmentList
            items={mail.attachments}
            from={`/admin/mail-inbox/mail/${mailId}`}
          />

          {/* mail-inbox-mailer: 本文は details トグルではなく即時表示。
              Codex r1 blocker: bodyText のみだと HTML-only メール (text/plain
              代替を持たない) の本文が表示されない。bodyText が無ければ bodyHtml
              にフォールバックする。HTML は dangerouslySetInnerHTML せず、
              <pre> 内に生テキストとして見せる（タグも一緒に見えるが、
              本文を取りこぼさない方が要件「全件確認」上は重要）。 */}
          {(() => {
            const body = mail.bodyText ?? mail.bodyHtml
            if (!body) return null
            return (
              <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border-soft bg-surface-alt p-2 text-xs text-ink">
                {body}
              </pre>
            )
          })()}
        </div>
      </Card>

      {/* アクションエリアは triage_status + draft.status の組み合わせで分岐。 */}
      {mail.triageStatus === 'processed' ? (
        <Card>
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-sm font-semibold text-ink-2">処理済み</h2>
            <p className="text-xs text-ink-meta">
              {/* AC-25: undo で戻るもの／戻らないものを明示する。 */}
              このメールは処理済みです。誤って処理した場合は未処理に戻せます。
              未処理に戻すと、種別・大会の紐付け・このメールから採用した名簿ファイルは
              まとめて取り消されます。ただし
              <strong className="font-semibold">
                LINE に配信済みのメッセージは取り消せません
              </strong>
              。
            </p>
            <UndoTriageButton mailId={mail.id} />
          </div>
        </Card>
      ) : !mail.draft ? (
        <MailProcessForm
          mailId={mail.id}
          attachments={processAttachments}
          candidateGroups={candidateGroups}
          cutoffStr={cutoffStr}
          receivedDateStr={todayInJst(mail.receivedAt)}
          aiExtractAttachments={aiExtractAttachments}
          pdfSizeLimitKb={pdfSizeLimitKb}
          resultImportSection={resultImportSection}
        />
      ) : mail.draft.status === 'ai_processing' ? (
        <ExtractionInProgressCard mailId={mail.id} />
      ) : mail.draft.status === 'ai_failed' ? (
        <Card>
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-sm font-semibold text-ink-2">
              AI 抽出に失敗しました
            </h2>
            <p className="text-xs text-ink-meta">
              再試行してください。手動でイベント作成する場合は
              この画面から AI 抽出を諦めた上で、メニューから新規イベント作成へ
              進んでください（mail との自動紐付けは将来対応）。
            </p>
            <div className="flex flex-col gap-2">
              <AIExtractConfirmDialog
                mailId={mail.id}
                attachments={aiExtractAttachments}
                pdfSizeLimitKb={pdfSizeLimitKb}
                initialSelectedAttachmentIds={
                  mail.draft.selectedAttachmentIds ?? undefined
                }
                buttonLabel="AI 抽出を再試行"
                buttonKind="primary"
              />
              {/* mail-inbox-mailer (Codex r6 blocker): /admin/events/new は実在
                  しないため 404 を回避するためリンクを撤去。要件 §3.1.5 の
                  「手動でイベント作成」フロー (空 EventForm を mail 詳細に展開
                  + draft.status='approved' で締める) は専用 Server Action +
                  画面を別 PR で実装してから再度有効化する想定。 */}
            </div>
          </div>
        </Card>
      ) : mail.draft.status === 'pending_review' ? (
        <Card>
          <div className="flex flex-col gap-2">
            <DraftCard draft={mail.draft} />
            <Link
              href={`/admin/mail-inbox/${mail.draft.id}`}
              className="text-sm text-brand-fg underline"
            >
              承認 / 却下 / 紐付けへ →
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-2">
            <DraftCard draft={mail.draft} />
            <Link
              href={`/admin/mail-inbox/${mail.draft.id}`}
              className="text-sm text-brand-fg underline"
            >
              draft 詳細を開く →
            </Link>
          </div>
        </Card>
      )}

      {/* AC-20: 統合フォームを出さない状態（処理済み / draft 進行中）でも、
          種別が未選択なら結果取込は従来どおり使える。フォーム内の表示は
          MailProcessForm が種別 = 未選択 のときだけ描画する。 */}
      {!showProcessForm && mail.mailKind == null && resultImportSection}
    </div>
  )
}
