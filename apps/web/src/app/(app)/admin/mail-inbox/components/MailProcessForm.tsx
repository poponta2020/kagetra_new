'use client'

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Btn, Card, Pill } from '@/components/ui'
import { BROADCAST_LEAD_PRESETS, LEAD_TEXT_MAX_LENGTH } from '@/lib/broadcast-lead-presets'
import { dismissMail, processMail, releaseRosterFile } from '../actions'
import { loadOpenChatBroadcastSummary } from '../open-chat-actions'
import {
  formatGroupDayRange,
  formatGroupEntryStatus,
  listProcessCandidates,
  selectableGradesForGroup,
  type ProcessCandidateGroup,
  type ProcessCandidateKind,
} from '../process-candidate-utils'
import {
  formatGradeLabel,
  ROSTER_ADOPT_GRADE_ORDER,
  type RosterAdoptGrade,
} from '../roster-adopt-utils'
import { AIExtractConfirmDialog, type AIExtractAttachment } from './AIExtractConfirmDialog'
import { GroupPickerSheet } from './GroupPickerSheet'
import { OpenChatExtractSheet } from './OpenChatExtractSheet'

/**
 * mail-inbox-mailer 2026-08-02 改修: メール詳細の**統合処理フォーム**
 * （design-mock/a-*.html の A案 = 1画面の縦フロー）。
 *
 * 種別 → 対象の大会 → 採用する名簿ファイル → 発表日 → LINE 配信 → 実行 を
 * 1 フォームに畳み、選んだ種別に応じて必要な入力欄だけを生やす（要件 §3.1.3）。
 * 旧「会で流す / 既存イベントに紐付ける / 対応不要」の 3 ボタン
 * （MailDetailActions）と、添付ごとの採用シート（RosterFileAdoptSheet）を置き換える。
 *
 * ★種別・大会・級はここでは保存しない。**「実行」または「AI 抽出」の実行時だけ**
 * サーバーへ送る（要件 §3.2.1 / AC-2）。フォームを閉じれば選択は消える。
 */

type Kind = 'none' | 'tournament_notice' | 'applicant_roster' | 'confirmed_roster'

const KIND_SEGMENTS: { value: Kind; label: string }[] = [
  { value: 'none', label: '未選択' },
  { value: 'tournament_notice', label: '大会案内' },
  { value: 'applicant_roster', label: '申込名簿' },
  { value: 'confirmed_roster', label: '確定名簿' },
]

const ROSTER_TYPE_LABEL: Record<'applicant' | 'confirmed', string> = {
  applicant: '申込者名簿',
  confirmed: '確定名簿',
}

/** 添付ごとの採用済み情報（RosterFileAdoptSheet から移設）。 */
export interface MailProcessAdoption {
  id: number
  rosterType: 'applicant' | 'confirmed'
  grades: RosterAdoptGrade[] | null
  eventTitles: string[]
}

export interface MailProcessAttachment {
  id: number
  filename: string
  sizeBytes: number
  /** 既に名簿ファイルとして採用済みなら、その情報。未採用は null。 */
  adoption: MailProcessAdoption | null
}

/** 保存済みオープンチャットの件数と配信状況（`loadOpenChatBroadcastSummary` の要約）。 */
interface OpenChatSummaryState {
  savedCount: number
  /** うち、前回配信より後に保存された（まだ届いていない）行数。 */
  unsentCount: number
  broadcastCount: number
  /** 直近の配信試行が sent でなかった（failed / skipped）。 */
  lastFailed: boolean
}

/** 1024 進数の概算表示（モックの「42 KB」「1.2 MB」に合わせる）。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export function MailProcessForm({
  mailId,
  attachments,
  candidateGroups,
  cutoffStr,
  receivedDateStr,
  aiExtractAttachments,
  pdfSizeLimitKb,
  resultImportSection,
}: {
  mailId: number
  attachments: MailProcessAttachment[]
  /** 基本条件を満たす候補グループ（サーバーが絞った母集団）。 */
  candidateGroups: ProcessCandidateGroup[]
  cutoffStr: string
  /** 発表日プレースホルダに出すメール受信日（JST・YYYY-MM-DD）。 */
  receivedDateStr: string
  aiExtractAttachments: AIExtractAttachment[]
  pdfSizeLimitKb: number
  /**
   * 「試合結果の取込」ブロック（Server Component から渡す）。**種別 = 未選択の
   * ときだけ**描画する。★senseki-boundary の監査で配布版から丸ごと物理削除する
   * と決まっているブロックなので、条件も描画も 1 箇所に閉じておく。
   */
  resultImportSection?: ReactNode
}) {
  const [kind, setKind] = useState<Kind>('none')
  const [groupId, setGroupId] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [openChatSheetOpen, setOpenChatSheetOpen] = useState(false)
  const [openChatSummary, setOpenChatSummary] = useState<OpenChatSummaryState | null>(null)
  /** シートを閉じた直後にサマリーを引き直すためのキー（保存件数がすぐ反映される）。 */
  const [openChatReloadKey, setOpenChatReloadKey] = useState(0)
  const [includeOpenChat, setIncludeOpenChat] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Map<number, RosterAdoptGrade[]>>(
    new Map(),
  )
  const [publishedAt, setPublishedAt] = useState('')
  const [broadcast, setBroadcast] = useState(false)
  const [includeBody, setIncludeBody] = useState(true)
  const [leadText, setLeadText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const isNotice = kind === 'tournament_notice'
  const isRoster = kind === 'applicant_roster' || kind === 'confirmed_roster'
  const pickerKind: ProcessCandidateKind = isRoster ? kind : 'none'

  const selectedGroup = useMemo(
    () => candidateGroups.find((g) => g.groupId === groupId) ?? null,
    [candidateGroups, groupId],
  )
  const groupGrades = useMemo(
    () => (selectedGroup ? selectableGradesForGroup(selectedGroup) : []),
    [selectedGroup],
  )

  // openchat-broadcast 2026-09-04 改修: 保存済みオープンチャットの件数・配信状況を引く。
  // 大会を選び直したときと、抽出シートを閉じた直後（保存で件数が変わる）に取り直す。
  useEffect(() => {
    if (groupId == null) {
      setOpenChatSummary(null)
      setIncludeOpenChat(false)
      return
    }
    let cancelled = false
    loadOpenChatBroadcastSummary(groupId)
      .then((summary) => {
        if (cancelled) return
        // 前回配信より後に保存された行（`isNew`）＝**まだ一度も届いていない行**。
        const unsentCount = summary.rows.filter((r) => r.isNew).length
        setOpenChatSummary({
          savedCount: summary.rows.length,
          unsentCount,
          broadcastCount: summary.broadcastCount,
          lastFailed:
            summary.lastAttempt != null && summary.lastAttempt.status !== 'sent',
        })
        // ★AC-35（再配信確認）の代替。既に配信済みのグループでは既定 OFF にして、
        // 「実行する」のついでに全件が再送されるのを防ぐ（毎回全件送る仕様なので、
        // 意図しない再送は同じ Flex がもう一度届くことを意味する）。
        // ★ただし**前回配信より後に増えた行があるなら既定 ON**。級別・部門別の URL は
        // 別のメールで後から届くのが普通で、そこで OFF のままだと「たった今保存した
        // リンクが黙って送られない」——止めたかったのは同じ内容の再送であって、
        // 新しく増えた内容の抑止ではない。
        setIncludeOpenChat(
          summary.rows.length > 0 && (summary.broadcastCount === 0 || unsentCount > 0),
        )
      })
      .catch(() => {
        if (cancelled) return
        // 引けなかったときは「送らない」に倒す（数が分からないまま送らせない）。
        setOpenChatSummary(null)
        setIncludeOpenChat(false)
      })
    return () => {
      cancelled = true
    }
  }, [groupId, openChatReloadKey])

  // 採用済みの添付は選択肢に出さず、採用状態の行として出す（AC-13）。
  const adoptableAttachments = attachments.filter((a) => a.adoption == null)
  const adoptedAttachments = attachments.filter((a) => a.adoption != null)

  const lineLinked = selectedGroup?.lineLinked ?? false
  const canBroadcast = selectedGroup != null && lineLinked
  const broadcastOn = broadcast && canBroadcast
  const openChatSavedCount = openChatSummary?.savedCount ?? 0
  /** 実際にオープンチャット Flex を送るか。保存済みゼロなら送りようがない。 */
  const openChatOn = broadcastOn && includeOpenChat && openChatSavedCount > 0

  // 本文を送らず、冒頭メッセージも添付もオープンチャットも無いと LINE に何も届かない。
  // サーバーまで運ばずここで止める（サーバー側も空配信を skipped で弾く）。
  const emptyBroadcast =
    broadcastOn &&
    !includeBody &&
    attachments.length === 0 &&
    leadText.trim() === '' &&
    !openChatOn
  // 名簿種別で採用できる添付があるのに 1 つも選んでいない状態は、
  // 「採用したつもりで何も採用されていない」実行になるので止める。
  const rosterNeedsFile =
    isRoster && adoptableAttachments.length > 0 && selectedFiles.size === 0

  const canSubmit =
    !isNotice && groupId != null && !emptyBroadcast && !rosterNeedsFile && !pending

  const toggleFile = (attachmentId: number) => {
    setSelectedFiles((prev) => {
      const next = new Map(prev)
      if (next.has(attachmentId)) next.delete(attachmentId)
      else next.set(attachmentId, [])
      return next
    })
  }

  const toggleGrade = (attachmentId: number, grade: RosterAdoptGrade) => {
    setSelectedFiles((prev) => {
      const next = new Map(prev)
      const current = next.get(attachmentId) ?? []
      next.set(
        attachmentId,
        current.includes(grade)
          ? current.filter((g) => g !== grade)
          : [...current, grade],
      )
      return next
    })
  }

  const onKindChange = (value: Kind) => {
    setKind(value)
    setError(null)
    // 種別を変えると候補母集団も採用対象も変わるので選択を落とす
    // （名簿→未選択で「採用するつもりの添付」が残ると事故になる）。
    setSelectedFiles(new Map())
    if (value === 'tournament_notice') {
      setGroupId(null)
      setBroadcast(false)
      return
    }
    // ★選択済みの大会が新しい種別の母集団に無ければ落とす。未選択で選べた
    // 団体戦のみのグループを名簿種別へ持ち越すと、UI は選べたままなのに
    // サーバーの採用検証で必ず失敗する（既定フィルタで落ちるだけのグループは
    // 「すべて表示」から選び直せるので、showAll=true の母集団で判定する）。
    if (groupId != null) {
      const nextKind: ProcessCandidateKind =
        value === 'none' ? 'none' : value
      const stillSelectable = listProcessCandidates(candidateGroups, {
        kind: nextKind,
        cutoffStr,
        showAll: true,
      }).some((g) => g.groupId === groupId)
      if (!stillSelectable) {
        setGroupId(null)
        setBroadcast(false)
      }
    }
  }

  const onSubmit = () => {
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      const result = await processMail(mailId, {
        mailKind: isRoster ? kind : null,
        entryGroupId: groupId,
        rosterFiles: isRoster
          ? [...selectedFiles.entries()].map(([attachmentId, grades]) => ({
              attachmentId,
              // ★級ゼロ選択は `null`（グループ統一名簿）として送る。空配列を
              // 送ってはならない — サーバーは「級別を選んだのに級が無い入力ミス」
              // として弾く既存契約（要件 §3.2.4）。
              grades: grades.length > 0 ? [...grades] : null,
            }))
          : [],
        publishedAt: publishedAt || null,
        broadcast: broadcastOn,
        includeBody,
        includeOpenChat: openChatOn,
        leadText: leadText.trim() || null,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push('/admin/mail-inbox')
    })
  }

  const onDismiss = () => {
    setError(null)
    startTransition(async () => {
      await dismissMail(mailId)
      router.push('/admin/mail-inbox')
    })
  }

  const onRelease = (rosterFileId: number) => {
    setError(null)
    startTransition(async () => {
      const result = await releaseRosterFile(rosterFileId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <>
      <Card>
        <div className="flex flex-col">
          <h2 className="font-display text-base font-bold text-ink">処理</h2>

          <SectionHeading label="種別" className="mt-3" />
          <div className="mt-1.5 flex gap-1">
            {KIND_SEGMENTS.map((seg) => (
              <button
                key={seg.value}
                type="button"
                aria-pressed={kind === seg.value}
                disabled={pending}
                onClick={() => onKindChange(seg.value)}
                className={`min-w-0 flex-1 whitespace-nowrap rounded-md border py-1.5 text-xs disabled:opacity-50 ${
                  kind === seg.value
                    ? 'border-brand bg-brand font-bold text-ink-on-brand'
                    : 'border-border bg-surface text-ink-2'
                }`}
              >
                {seg.label}
              </button>
            ))}
          </div>
          {kind === 'none' && groupId == null && (
            <p className="mt-1 text-[10px] leading-relaxed text-ink-meta">
              件名から種別を選ぶと、必要な入力だけが下に出ます。組合せ表・会場案内・
              領収書などは「未選択」のまま大会に紐付けられます。
            </p>
          )}

          {isNotice ? (
            <>
              <p className="mt-3 text-[10px] leading-relaxed text-ink-meta">
                選んだ添付と本文を AI に読み取らせて大会の下書きを作ります。できあがったら
                通知します。LINE 配信は大会の登録後、大会詳細から行います。
              </p>
              <div className="mt-3">
                <AIExtractConfirmDialog
                  mailId={mailId}
                  attachments={aiExtractAttachments}
                  pdfSizeLimitKb={pdfSizeLimitKb}
                  buttonLabel="AI で大会を読み取る"
                />
              </div>
            </>
          ) : (
            <>
              <SectionHeading label="対象の大会" className="mt-3.5" />
              {selectedGroup ? (
                <div className="mt-1.5 flex items-center gap-2 rounded-md border border-brand bg-brand-bg px-2.5 py-2">
                  <span className="min-w-0 flex-1 text-sm font-bold text-brand-fg">
                    {selectedGroup.displayName}
                    {/* design-spec: 選択済みチップの 2 行目は開催日レンジ + 申込状態
                        （同名グループの取り違え防止の識別子を兼ねる）。 */}
                    <span className="block text-[10px] font-normal text-ink-meta">
                      {formatGroupDayRange(selectedGroup.days)} ・{' '}
                      {formatGroupEntryStatus(selectedGroup)}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setPickerOpen(true)}
                    className="flex-none text-[10px] text-brand-fg underline disabled:opacity-50"
                  >
                    変更
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setPickerOpen(true)}
                  className="mt-1.5 w-full rounded-md border border-border bg-surface py-2.5 text-sm text-ink-2 disabled:opacity-50"
                >
                  大会を選ぶ
                </button>
              )}

              {isRoster && (
                <>
                  <SectionHeading label="採用する名簿ファイル" className="mt-3.5" />
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    {adoptableAttachments.length === 0 && adoptedAttachments.length === 0 && (
                      <p className="text-xs text-ink-meta">添付ファイルがありません。</p>
                    )}
                    {adoptableAttachments.map((attachment) => {
                      const checked = selectedFiles.has(attachment.id)
                      const grades = selectedFiles.get(attachment.id) ?? []
                      return (
                        <div
                          key={attachment.id}
                          className={`rounded-md border px-2.5 py-2 ${
                            checked
                              ? 'border-brand bg-brand-bg'
                              : 'border-border-soft bg-surface-alt'
                          }`}
                        >
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={pending}
                              onChange={() => toggleFile(attachment.id)}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-ink">
                              {attachment.filename}
                            </span>
                            <span className="flex-none text-[10px] text-ink-meta">
                              {formatSize(attachment.sizeBytes)}
                            </span>
                          </label>
                          {checked && (
                            <div className="mt-1.5 flex items-center gap-1 pl-6">
                              <span className="mr-0.5 text-[10px] text-ink-meta">級</span>
                              {ROSTER_ADOPT_GRADE_ORDER.map((grade) => {
                                const selectable = groupGrades.includes(grade)
                                const on = grades.includes(grade)
                                return (
                                  <button
                                    key={grade}
                                    type="button"
                                    aria-pressed={on}
                                    // グループの対象級に無い級はサーバーが弾くので
                                    // 押させない（押せると必ず実行が失敗する）。
                                    disabled={pending || !selectable}
                                    onClick={() => toggleGrade(attachment.id, grade)}
                                    className={`w-7 rounded-full border py-0.5 text-center text-xs disabled:opacity-40 ${
                                      on
                                        ? 'border-brand bg-brand font-bold text-ink-on-brand'
                                        : 'border-border bg-surface text-ink-2'
                                    }`}
                                  >
                                    {grade}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {/* AC-13: 採用済みの添付は選択肢に出さず、採用状態と解除ボタンを出す
                        （RosterFileAdoptSheet の採用済みカードの意匠を移設）。 */}
                    {adoptedAttachments.map((attachment) => {
                      const adoption = attachment.adoption!
                      const gradeLabel = adoption.grades
                        ? formatGradeLabel(adoption.grades)
                        : ''
                      return (
                        <div
                          key={attachment.id}
                          className="flex flex-col gap-1 rounded-md border border-border-soft bg-surface px-2.5 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="max-w-[60%] truncate text-sm text-ink-2">
                              {attachment.filename}
                            </span>
                            <div className="flex flex-none items-center gap-1">
                              <Pill tone="success" size="sm">
                                {ROSTER_TYPE_LABEL[adoption.rosterType]}
                              </Pill>
                              {gradeLabel && (
                                <Pill tone="neutral" size="sm">
                                  {gradeLabel}
                                </Pill>
                              )}
                            </div>
                          </div>
                          <span className="text-[10px] text-ink-meta">
                            対象大会:{' '}
                            {adoption.eventTitles.length > 0
                              ? adoption.eventTitles.join('・')
                              : '(不明)'}
                          </span>
                          <div>
                            <Btn
                              kind="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => onRelease(adoption.id)}
                            >
                              採用を解除
                            </Btn>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-meta">
                    級を選ばなければ、そのファイルはグループ全体の名簿として採用します。
                  </p>

                  <SectionHeading label="発表日" className="mt-3.5" />
                  <input
                    type="date"
                    value={publishedAt}
                    disabled={pending}
                    onChange={(e) => setPublishedAt(e.target.value)}
                    aria-label="発表日"
                    className="mt-1.5 w-full rounded-md border border-border-soft bg-surface px-2.5 py-2 text-sm text-ink"
                  />
                  <p className="mt-1 text-[10px] text-ink-meta">
                    未入力ならメール受信日（{receivedDateStr}）
                  </p>
                </>
              )}

              {/* openchat-broadcast タスク9: 抽出候補シートの起点ボタン（要件 §3.1 / §3.2.8）。
                  対象の大会（申込グループ）が未選択のときは押せない
                  （どのグループへ保存するか決まらないため）。 */}
              <SectionHeading label="オープンチャット" className="mt-3.5" />
              <Btn
                kind="ghost"
                size="md"
                block
                disabled={pending || selectedGroup == null}
                onClick={() => setOpenChatSheetOpen(true)}
              >
                オープンチャットを抽出
              </Btn>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-meta">
                本文・添付・QR コードから招待 URL を探します。見つかった候補を確認して
                保存すると、下の「LINE 配信」でメール本文・添付と一緒に送れます。
                {openChatSavedCount > 0 && `（保存済み ${openChatSavedCount} 件）`}
              </p>

              {selectedGroup && (
                <>
                  <SectionHeading label="LINE 配信" className="mt-3.5" />
                  <label
                    className={`mt-2 flex items-start gap-2 ${
                      canBroadcast ? 'cursor-pointer' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={broadcastOn}
                      disabled={pending || !canBroadcast}
                      onChange={(e) => setBroadcast(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span
                      className={`min-w-0 flex-1 text-sm ${
                        canBroadcast ? 'text-ink' : 'text-ink-muted'
                      }`}
                    >
                      LINE で配信する
                      {canBroadcast && (
                        <span className="block text-[10px] font-normal text-ink-meta">
                          配信先: {selectedGroup.displayName} のグループ
                        </span>
                      )}
                    </span>
                  </label>
                  {/* AC-18: 未紐付けは選ばせず、理由と行き先を出す。 */}
                  {!lineLinked && (
                    <div className="mt-1.5 rounded-md border border-border bg-neutral-bg px-2.5 py-2 text-xs leading-relaxed text-neutral-fg">
                      {selectedGroup.displayName} には LINE グループがまだ紐付いていません。
                      <Link
                        href={`/events/${selectedGroup.representativeEventId}`}
                        className="text-brand-fg underline"
                      >
                        大会詳細
                      </Link>
                      から Bot を招待すると配信できるようになります。
                    </div>
                  )}

                  {broadcastOn && (
                    <div className="pl-6">
                      <label className="mt-2 flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={includeBody}
                          disabled={pending}
                          onChange={(e) => setIncludeBody(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1 text-sm text-ink">
                          メール本文を添付する
                          <span className="block text-[10px] font-normal text-ink-meta">
                            {includeBody
                              ? '本文を画像にして送ります'
                              : '外すと、冒頭メッセージと添付ファイルのリンクだけを送ります'}
                          </span>
                        </span>
                      </label>
                      {openChatSavedCount > 0 && (
                        // openchat-broadcast 2026-09-04 改修: オープンチャットの Flex は
                        // ここで本文・添付と同じ配信に相乗りする（抽出直後には送らない）。
                        // ★既に配信済みなら既定 OFF（配信は毎回全件送るため、意図しない
                        //   チェックは同じ Flex の再送になる）。
                        <label className="mt-2 flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            checked={includeOpenChat}
                            disabled={pending}
                            onChange={(e) => setIncludeOpenChat(e.target.checked)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1 text-sm text-ink">
                            オープンチャットの招待リンクも送る（{openChatSavedCount}件）
                            <span className="block text-[10px] font-normal text-ink-meta">
                              {openChatSummary == null || openChatSummary.broadcastCount === 0
                                ? '未配信。保存済みの全件を Flex 1通で送ります'
                                : openChatSummary.unsentCount > 0
                                  ? `配信済み ${openChatSummary.broadcastCount} 回。前回以降に ${openChatSummary.unsentCount} 件増えたので、全 ${openChatSavedCount} 件をまとめて送ります`
                                  : `配信済み ${openChatSummary.broadcastCount} 回。入れると保存済み全 ${openChatSavedCount} 件をもう一度送ります`}
                            </span>
                            {openChatSummary?.lastFailed && (
                              <span className="block text-[10px] font-normal text-danger">
                                前回の配信は届いていません（失敗または中止）
                              </span>
                            )}
                          </span>
                        </label>
                      )}
                      <div className="mt-1.5">
                        <div className="flex flex-wrap gap-1">
                          {BROADCAST_LEAD_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              disabled={pending}
                              onClick={() => setLeadText(preset)}
                              className="rounded-full border border-border-soft bg-surface px-2 py-0.5 text-[10px] text-ink-meta hover:bg-brand-bg hover:text-ink disabled:opacity-50"
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={leadText}
                          onChange={(e) => setLeadText(e.target.value)}
                          maxLength={LEAD_TEXT_MAX_LENGTH}
                          rows={2}
                          disabled={pending}
                          aria-label="冒頭メッセージ"
                          placeholder="例: 確定名簿が出ました！"
                          className="mt-1.5 w-full resize-none rounded-md border border-border-soft bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-ink-muted"
                        />
                      </div>
                      {emptyBroadcast && (
                        <p className="mt-1 text-[10px] text-danger" role="alert">
                          本文を添付せず添付ファイルも無いので、冒頭メッセージを入力してください。
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {rosterNeedsFile && (
                <p className="mt-2 text-[10px] text-ink-meta">
                  採用する名簿ファイルを 1 つ以上選んでください。
                </p>
              )}

              {error && (
                <p className="mt-2 text-xs text-danger" role="alert">
                  {error}
                </p>
              )}

              <Btn
                kind="primary"
                size="lg"
                block
                className="mt-3"
                disabled={!canSubmit}
                onClick={onSubmit}
              >
                {pending ? '処理中…' : '実行する'}
              </Btn>
            </>
          )}

          {isNotice && error && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </Card>

      {/* 「対応不要」は処理カードの外側に ghost で置く（誤タップ防止・design-spec）。 */}
      <Btn kind="ghost" size="lg" block disabled={pending} onClick={onDismiss}>
        対応不要
      </Btn>

      {/* 種別 = 未選択 のときだけ出す（AC-20）。 */}
      {kind === 'none' && resultImportSection}

      <GroupPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={(id) => {
          setGroupId(id)
          setPickerOpen(false)
          // グループを変えると選べる級が変わるので、級選択だけリセットする。
          setSelectedFiles((prev) => new Map([...prev.keys()].map((k) => [k, []])))
        }}
        groups={candidateGroups}
        kind={pickerKind}
        cutoffStr={cutoffStr}
        selectedGroupId={groupId}
      />

      {selectedGroup && (
        <OpenChatExtractSheet
          open={openChatSheetOpen}
          onClose={() => {
            setOpenChatSheetOpen(false)
            // 保存済み件数はクライアントの Server Action 呼び出しで持っているので、
            // router.refresh() では更新されない。キーを進めて引き直す。
            setOpenChatReloadKey((k) => k + 1)
            router.refresh()
          }}
          mailMessageId={mailId}
          entryGroupId={selectedGroup.groupId}
          entryGroupDisplayName={selectedGroup.displayName}
          groupEventDates={[...new Set(selectedGroup.days.map((d) => d.eventDate))].sort()}
        />
      )}
    </>
  )
}

/** モックの `.sect`（ラベル + 罫線）。 */
function SectionHeading({ label, className }: { label: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span className="flex-none text-xs font-bold text-ink-2">{label}</span>
      <span className="h-px flex-1 bg-border-soft" />
    </div>
  )
}
