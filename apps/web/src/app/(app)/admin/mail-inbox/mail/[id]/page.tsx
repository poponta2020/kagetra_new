import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { and, desc, eq, gte, inArray, ne } from 'drizzle-orm'
import { loadCostGuardConfig } from '@kagetra/mail-worker/config'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import {
  events,
  mailMessages,
  tournamentEntryRosterFiles,
  tournamentSeries,
  tournamentSeriesEditions,
} from '@kagetra/shared/schema'
import { deriveEntryGroupName, selectRepresentativeEvent } from '@/lib/entry-groups'
import { displayName } from '../../../entries/entry-board-utils'
import { todayInJst } from '@/lib/jst-date'
import { Card, Pill, type PillTone } from '@/components/ui'
import { AttachmentList } from '../../components/AttachmentList'
import { type TriageStatus } from '../../components/TriageActions'
import { MailDetailActions } from '../../components/MailDetailActions'
import { ExtractionInProgressCard } from '../../components/ExtractionInProgressCard'
import { DraftCard } from '../../components/DraftCard'
import { UndoTriageButton } from '../../components/UndoTriageButton'
import { AIExtractConfirmDialog } from '../../components/AIExtractConfirmDialog'
import type { LinkableEventOption } from '../../components/ExistingEventLinkSheet'
import { linkableEventCutoffStr } from '../../linkable-events'
import {
  ResultParseButton,
  type ExcelAttachment,
} from '../../components/ResultParseButton'
import {
  RosterFileAdoptSheet,
  type RosterFileAdoptionInfo,
} from '../../components/RosterFileAdoptSheet'
import type { RosterAdoptGroup } from '../../roster-adopt-utils'

/**
 * /admin/mail-inbox/mail/[id] — mail-inbox-mailer タスク4: 「メーラー詳細」画面。
 *
 * 旧仕様（mail-triage-badge）から大きく変更:
 *   - 本文は details トグル → **即時表示**（要件 §3.1.2）
 *   - 「保留」アクション廃止
 *   - draft の状態に応じてアクションエリアを切り替え:
 *       draft なし                  → MailDetailActions (3 ボタン)
 *       draft.status='ai_processing' → ExtractionInProgressCard (polling)
 *       draft.status='ai_failed'     → 再試行 + 「手動でイベント作成」
 *       draft.status='pending_review' → DraftCard + 承認動線リンク
 *       draft.status='approved'/'rejected'/'superseded' → 状態表示 + undo
 */
export const dynamic = 'force-dynamic'

const CLASSIFICATION_LABEL: Record<string, { label: string; tone: PillTone }> = {
  tournament: { label: '大会案内', tone: 'brand' },
  noise: { label: 'ノイズ', tone: 'neutral' },
  unknown: { label: '不明', tone: 'neutral' },
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

/**
 * 既存イベント結びつけシートの候補。
 *
 * 要件 §3.1.6: 「未開催（=今日以降）+ 過去 30 日以内」を受信日降順ではなく
 * 開催日降順で表示（候補一覧としては開催日順の方が直感的、シート内検索で
 * タイトル絞り込みも可能）。
 *
 * Codex r1 should-fix: 旧実装は「過去 30 日側を status='done' に限定」して
 * いたが、開催日が過ぎても status が published のままの大会は運用上ありえる
 * ので領収書/事後連絡が拾えなくなっていた。status は cancelled だけ除外して
 * 残りは全部候補に出す（並び順も降順に修正）。
 */
async function loadLinkableEvents(): Promise<LinkableEventOption[]> {
  // mail-inbox-mailer (Codex r5 should-fix): cutoff 算出は linkable-events.ts
  // に集約し、Server Action 側 (linkMailToEvent) と完全同期させる。
  const cutoffStr = linkableEventCutoffStr()

  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      eventDate: events.eventDate,
      status: events.status,
    })
    .from(events)
    .where(
      and(
        gte(events.eventDate, cutoffStr),
        ne(events.status, 'cancelled'),
      ),
    )
    .orderBy(desc(events.eventDate))
  return rows
}

/**
 * 名簿ファイル採用シートの候補グループ（roster-file-adoption 2026-08-01 改修 §3.2.7）。
 *
 * 採用の帰属は entry_group なので、候補もイベントではなく**グループ**で出す。
 * ここが返すのは「基本条件を満たすグループ」の平ら DTO だけで、4象限の既定
 * フィルタ（申込済み × 未取込）と「すべて表示」トグルの計算は client 側の純関数
 * （`roster-adopt-utils.ts`）が行う。`/admin/entries` と同型の分担
 * （page がグループ表示名等を1回計算して平らな値で渡し、純関数が仕分ける）。
 *
 * **基本条件**: 「個人戦 ∧ cancelled でない ∧ 開催日が cutoff 以降」を**同一の
 * event 行が同時に満たす**日を 1 つ以上持つこと。★3条件を別々の存在判定に
 * 分けてはならない（「団体戦だけが cutoff 内で個人戦は 30 日より古い」グループが
 * 通る穴になる）。名簿は個人戦のみの仕様（`RosterSection` は団体戦で常に非表示・
 * 申込管理ボードの母集団も `kind='individual'`）なので、団体戦だけのグループを
 * 選べると「採用は成功したのにどこにも表示されずフェーズも動かない」行き止まりに
 * なる。`adoptRosterFile` 側でも同じ条件を再検証する（UI 表示後の変化・直接叩き対策）。
 *
 * ★`days` に渡すのは「個人戦 ∧ 非 cancelled」の**全日**で、cutoff は掛けない。
 * 純関数側の級集合 G(g) は Server Action の検証（cutoff を掛けない独立条件）と
 * 同じ母集団でなければならず、ここで cutoff を掛けると「選べる級」と
 * 「サーバーが受け付ける級」がずれる。
 *
 * 既存の「既存イベントに紐付ける」導線は団体戦も候補に出したままにする
 * （メールの紐付け自体は個人戦に限る理由がない）。
 */
async function loadRosterAdoptableGroups(): Promise<RosterAdoptGroup[]> {
  const cutoffStr = linkableEventCutoffStr()
  const todayStr = todayInJst()

  const qualifyingRows = await db
    .select({ entryGroupId: events.entryGroupId })
    .from(events)
    .where(
      and(
        gte(events.eventDate, cutoffStr),
        ne(events.status, 'cancelled'),
        eq(events.kind, 'individual'),
      ),
    )
  const groupIds = [...new Set(qualifyingRows.map((r) => r.entryGroupId))]
  if (groupIds.length === 0) return []

  // グループの**全イベント**を引く（cancelled・団体戦・過去日も含む）。表示名の
  // 導出母集団を申込管理ボードと揃えるため（表示対象で絞ると、過去の多摩A＋未来の
  // 多摩B のグループがここだけ「多摩B」になって他画面と食い違う）。通称ベースの
  // 表示名を組むので edition → series を 2 段 leftJoin する（edition_id は nullable）。
  const memberRows = await db
    .select({
      id: events.id,
      entryGroupId: events.entryGroupId,
      title: events.title,
      shortName: tournamentSeries.shortName,
      eventDate: events.eventDate,
      status: events.status,
      kind: events.kind,
      entryStatus: events.entryStatus,
      eligibleGrades: events.eligibleGrades,
    })
    .from(events)
    .leftJoin(tournamentSeriesEditions, eq(tournamentSeriesEditions.id, events.editionId))
    .leftJoin(tournamentSeries, eq(tournamentSeries.id, tournamentSeriesEditions.seriesId))
    .where(inArray(events.entryGroupId, groupIds))
    .orderBy(events.eventDate)

  const adoptedRows = await db
    .select({
      entryGroupId: tournamentEntryRosterFiles.entryGroupId,
      rosterType: tournamentEntryRosterFiles.rosterType,
      grades: tournamentEntryRosterFiles.grades,
    })
    .from(tournamentEntryRosterFiles)
    .where(inArray(tournamentEntryRosterFiles.entryGroupId, groupIds))

  const membersByGroup = new Map<number, typeof memberRows>()
  for (const row of memberRows) {
    const arr = membersByGroup.get(row.entryGroupId)
    if (arr) arr.push(row)
    else membersByGroup.set(row.entryGroupId, [row])
  }

  const groups: (RosterAdoptGroup & { sortDate: string })[] = []
  for (const groupId of groupIds) {
    const members = membersByGroup.get(groupId)
    if (!members || members.length === 0) continue

    // 表示名は申込管理ボードと同じ規約（要件 §3.2.7）: 全イベントを「通称+級」に
    // 変換 → deriveEntryGroupName で畳む → 畳めなければ title 由来の名前 →
    // それも導出できなければ代表イベントの title。導出の正典は `@/lib/entry-groups`。
    const representative = selectRepresentativeEvent(members, todayStr)!
    const titleName = deriveEntryGroupName(members.map((m) => m.title)) ?? representative.title
    const groupDisplayName =
      deriveEntryGroupName(
        members.map((m) =>
          displayName({
            title: m.title,
            shortName: m.shortName,
            eligibleGrades: m.eligibleGrades,
          }),
        ),
      ) ?? titleName

    groups.push({
      groupId,
      displayName: groupDisplayName,
      days: members
        .filter((m) => m.kind === 'individual' && m.status !== 'cancelled')
        .map((m) => ({
          eventDate: m.eventDate,
          entryStatus: m.entryStatus,
          eligibleGrades: m.eligibleGrades,
        })),
      files: adoptedRows
        .filter((f) => f.entryGroupId === groupId)
        .map((f) => ({ rosterType: f.rosterType, grades: f.grades })),
      sortDate: representative.eventDate,
    })
  }

  // 代表イベントの開催日で時系列に並べる（「いま取り込むべき対象」が上から順に
  // 読める。既定フィルタが効いている限り候補は数件なので、これで十分）。
  groups.sort((a, b) =>
    a.sortDate === b.sortDate ? a.groupId - b.groupId : a.sortDate < b.sortDate ? -1 : 1,
  )
  return groups.map(({ sortDate: _sortDate, ...g }) => g)
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

  // tournament-results: .xls/.xlsx 添付のみ「結果として取り込む」対象。
  const excelAttachments: ExcelAttachment[] = mail.attachments
    .filter((a) => {
      const lower = a.filename.toLowerCase()
      return lower.endsWith('.xls') || lower.endsWith('.xlsx')
    })
    .map((a) => ({ id: a.id, filename: a.filename }))

  const triage = TRIAGE_LABEL[mail.triageStatus] ?? {
    label: mail.triageStatus,
    tone: 'neutral' as const,
  }
  const classification = mail.classification
    ? CLASSIFICATION_LABEL[mail.classification]
    : null

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

  const linkableEvents =
    !mail.draft && mail.triageStatus === 'unprocessed' ? await loadLinkableEvents() : []
  // roster-file-adoption タスク2: 名簿ファイル採用の候補は、既存の AI 抽出/紐付け
  // フロー（draft の有無・triage 状態）とは独立して提示する（要件: 名簿ドラフトと
  // 独立・ドラフトの有無で採用を妨げない）ため、上の `linkableEvents` は流用せず
  // 別に引く。添付が 1 件も無ければセクション自体を出さないのでクエリも投げない。
  const rosterAdoptableGroups =
    mail.attachments.length > 0 ? await loadRosterAdoptableGroups() : []

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
              {classification && (
                <Pill tone={classification.tone} size="sm">
                  {classification.label}
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
              このメールは処理済みです。誤って処理した場合は未処理に戻せます。
              {mail.linkedEventId != null &&
                ' 紐付け済みイベントの解除も同時に行われます（LINE 配信済みメッセージの取り消しはできません）。'}
            </p>
            <UndoTriageButton
              mailId={mail.id}
              hasLinkedEvent={mail.linkedEventId != null}
            />
          </div>
        </Card>
      ) : !mail.draft ? (
        <Card>
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-sm font-semibold text-ink-2">処理</h2>
            <MailDetailActions
              mailId={mail.id}
              linkableEvents={linkableEvents}
              attachments={aiExtractAttachments}
              pdfSizeLimitKb={pdfSizeLimitKb}
            />
            <p className="text-xs text-ink-meta">
              「会で流す」は AI 抽出を実行。「既存イベントに紐付ける」は組合せ表
              などの補足情報を既存大会に紐付けて LINE で配信。「対応不要」は未処理
              バッジから外すだけ。
            </p>
          </div>
        </Card>
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

      {/* tournament-results Task3: 結果 Excel 取込エリア。
          AI 取込フロー（tournament_drafts）とは独立した別セクション。
          .xls/.xlsx 添付があるときだけ表示する。 */}
      {excelAttachments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-ink">
            試合結果の取込
          </h2>
          {mail.resultDraft == null ? (
            <Card>
              <div className="flex flex-col gap-3">
                <p className="text-xs text-ink-meta">
                  Excel から試合結果を取り込みます。取込後にレビュー・承認画面で
                  内容を確認してから確定できます。
                </p>
                <ResultParseButton
                  mailId={mail.id}
                  excelAttachments={excelAttachments}
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
                  excelAttachments={excelAttachments}
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
                  excelAttachments={excelAttachments}
                />
              </div>
            </Card>
          )}
        </section>
      )}

      {/* roster-file-adoption: パースせず原本のまま採用する名簿ファイル。
          決定論パース（`tournament_roster_import_drafts`）とは完全に独立で、
          ドラフトの状態を読まない・変更しない。

          ★2026-08-01 改修 (AC-20): かつてここより上にあった「大会名簿の取込」
          セクション（`RosterParseButton`・名簿ドラフトカード・roster-drafts 確認
          画面へのリンク）は**表示しない**。決定論パーサは本番の実名簿 3 件すべてで
          採用不能で、ファイル採用が事実上の唯一の取込経路になった。導線が並ぶと
          迷いを生むだけなので UI から退役させる。**コードは温存**する
          （パーサ・Server Action・roster-drafts ページ・テーブル・既存テストは
          一切触っていない。直 URL では従来どおり動く）。将来の AI 名簿取込が
          承認 UI と materialize を土台に使うため削除はしない。 */}
      {mail.attachments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-base font-bold text-ink">名簿ファイルの採用</h2>
          <p className="text-xs text-ink-meta">
            様式が多様で解析できない名簿は、原本ファイルのまま対象大会に採用できます。
          </p>
          <div className="flex flex-col gap-2">
            {mail.attachments.map((attachment) => {
              const adoption: RosterFileAdoptionInfo | null = attachment.rosterFileAdoption
                ? {
                    id: attachment.rosterFileAdoption.id,
                    rosterType: attachment.rosterFileAdoption.rosterType,
                    grades: attachment.rosterFileAdoption.grades,
                    eventTitles:
                      attachment.rosterFileAdoption.entryGroup?.events.map((e) => e.title) ?? [],
                  }
                : null
              return (
                <RosterFileAdoptSheet
                  key={attachment.id}
                  attachmentId={attachment.id}
                  attachmentFilename={attachment.filename}
                  groups={rosterAdoptableGroups}
                  adoption={adoption}
                />
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
