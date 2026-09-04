'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Btn } from '@/components/ui'
import { formatEventDate } from '@/lib/event-date'
import {
  buildAutoOpenChatLabel,
  findDuplicateOpenChatLabelIds,
  resolveOpenChatLabel,
  type OpenChatGrade,
} from '@/lib/open-chat/label'
import {
  extractOpenChatCandidatesFromMail,
  loadOpenChatBroadcastSummary,
  saveOpenChats,
  type OpenChatSaveInput,
} from '../open-chat-actions'

/**
 * openchat-broadcast タスク9: メール詳細の抽出候補シート
 * （design-mock/sheet-normal.html ②③・design-mock/sheet-hard.html Ａ〜Ｃ）。
 *
 * `MailProcessForm` の「オープンチャットを抽出」ボタンから開く。開くたびに
 * `extractOpenChatCandidatesFromMail` を呼び、本文・添付・QR から集めた候補を
 * 一覧表示する（決定的抽出。AI は使わない — requirements §1 / §3.2.2）。
 * 候補は**自動確定しない**。級・開催日・ラベル・パスワードは人が確認・修正してから
 * 「保存する」で保存する。
 *
 * ★2026-09-04 改修: **このシートは保存だけを行い、LINE へは送らない。** 配信は
 * メール詳細の「LINE 配信」に相乗りし、メール本文・添付と同じタイミングで送る
 * （抽出直後と実行時の2回に分かれて届いていたのを1回にまとめる）。
 *
 * ★design-spec で確定済みの逸脱禁止事項:
 * - 候補行は既定で折りたたみ。展開して初めて編集欄が出る
 * - 自動生成ラベルは medium/fg-2、手入力ラベルは bold/fg
 * - 「未検証」（短縮 URL）に警告色を使わない。朱を使うのはラベル重複エラーだけ
 * - 出典バッジは QR だけ塗り、本文・添付は輪郭のみ、手入力は surface-alt
 * - CTA はシート下端に固定フッター
 * - 候補ゼロのときは手入力行が最初から1つ展開された状態で出る（AC-20）
 * - 最終ラベルが重複する行があると CTA を無効化する（AC-47。判定はクライアント側で即時）
 */

type OpenChatSource = 'body' | 'attachment_text' | 'qr' | 'manual'

const GRADE_ORDER: readonly OpenChatGrade[] = ['A', 'B', 'C', 'D', 'E']

const SOURCE_LABEL: Record<OpenChatSource, string> = {
  body: '本文',
  attachment_text: '添付',
  qr: 'QR',
  manual: '手入力',
}

interface OpenChatRow {
  id: number
  url: string
  grades: OpenChatGrade[] | null
  eventDate: string | null
  /** 自由入力のラベル。空文字は「未入力＝自動生成に任せる」。 */
  label: string
  password: string
  sources: OpenChatSource[]
  unverified: boolean
  /** 抽出時にパスワードを検出していたら true（`.ocaux` の「パスワードを検出しました」表示用）。 */
  passwordDetected: boolean
  expanded: boolean
}

/**
 * 既にこのグループへ保存済みの行。**シートからは編集しない**（編集導線は持たない）。
 * 抽出候補から同一 URL を除くためと、保存済み件数の表示に使う。
 */
interface SavedOpenChatRow {
  id: number
  url: string
  label: string
}

let nextRowId = 1

function createManualRow(expanded: boolean): OpenChatRow {
  return {
    id: nextRowId++,
    url: '',
    grades: null,
    eventDate: null,
    label: '',
    password: '',
    sources: ['manual'],
    unverified: false,
    passwordDetected: false,
    expanded,
  }
}

/** AC-26: https:// 以外は保存できない。保存前にクライアント側でも弾く。 */
function isValidHttpsUrl(url: string): boolean {
  return url.trim().startsWith('https://') && url.trim().length > 'https://'.length
}

/** 保存 1 行あたりの出典は単一値。複数出典が併記されている場合は先頭を代表値にする。 */
function primarySource(sources: OpenChatSource[]): OpenChatSource {
  return sources[0] ?? 'manual'
}

/** 級の選択をトグルする。全て外れたら「全級（未指定）」に戻す。 */
function toggleGradeInRow(
  current: OpenChatGrade[] | null,
  grade: OpenChatGrade,
): OpenChatGrade[] | null {
  const set = new Set(current ?? [])
  if (set.has(grade)) set.delete(grade)
  else set.add(grade)
  const next = GRADE_ORDER.filter((g) => set.has(g))
  return next.length > 0 ? next : null
}

export function OpenChatExtractSheet({
  open,
  onClose,
  mailMessageId,
  entryGroupId,
  entryGroupDisplayName,
  groupEventDates,
}: {
  open: boolean
  onClose: () => void
  mailMessageId: number
  entryGroupId: number
  entryGroupDisplayName: string
  /** グループ内の開催日（YYYY-MM-DD）。開催日セレクトの選択肢になる。 */
  groupEventDates: string[]
}) {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<OpenChatRow[]>([])
  const [extractedCount, setExtractedCount] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** このグループに既に保存済みの行（配信対象。シートからは編集しない）。 */
  const [savedRows, setSavedRows] = useState<SavedOpenChatRow[]>([])
  const [broadcastCount, setBroadcastCount] = useState(0)
  /** サーバーが返した重複行（保存済みとの衝突はクライアント判定では出せないため）。 */
  const [serverDuplicateRowIds, setServerDuplicateRowIds] = useState<Set<number>>(new Set())
  /** QR を走査したが読めなかった添付名（requirements §3.2.3）。 */
  const [qrUnread, setQrUnread] = useState<string[]>([])
  const [pending, startTransition] = useTransition()

  // 開くたびに抽出をやり直す（メールと大会の組が変わっていても常に最新の状態から始める）。
  useEffect(() => {
    if (!open) return
    // ★読み込み開始時に**前回の状態を全て捨てる**。同じコンポーネントが再利用される
    // ため、大会Aを開いた後にBへ切り替えると、Bの読み込みが失敗した場合にAの
    // 保存済みラベル・配信回数がBのシートに残り、ラベルの重複判定に混入する。
    setSaveError(null)
    setRows([])
    setSavedRows([])
    setBroadcastCount(0)
    setExtractedCount(0)
    setQrUnread([])
    setServerDuplicateRowIds(new Set())
    setLoading(true)
    let cancelled = false

    // ★保存済み一覧を先に引き、**既に保存済みの URL は候補から除く**。
    // 除かないと同じ URL を再 INSERT して `UNIQUE(entry_group_id, url)` 違反になり、
    // 保存自体がエラーになる。除いた結果 新規行がゼロなら保存するものが無いので
    // CTA は無効のままにする（配信はこのシートの責務ではない）。
    Promise.all([
      loadOpenChatBroadcastSummary(entryGroupId),
      extractOpenChatCandidatesFromMail({ mailMessageId, entryGroupId }),
    ])
      .then(([summary, extracted]) => {
        if (cancelled) return
        setSavedRows(summary.rows.map((r) => ({ id: r.id, url: r.url, label: r.label })))
        setBroadcastCount(summary.broadcastCount)
        setQrUnread(extracted.qrUnreadAttachments)

        const savedUrls = new Set(summary.rows.map((r) => r.url))
        const fresh = extracted.candidates.filter((c) => !savedUrls.has(c.url))
        setExtractedCount(fresh.length)

        if (fresh.length === 0) {
          // AC-20: 候補ゼロでも手入力行を最初から1つ展開した状態で出す。
          // ただし保存済みが既にあるなら「追加するものが無い」状態なので手入力行は
          // 出さない（「＋ 手入力で追加」から明示的に追加できる）。
          setRows(summary.rows.length > 0 ? [] : [createManualRow(true)])
          return
        }
        setRows(
          fresh.map((c) => ({
            id: nextRowId++,
            url: c.url,
            grades: c.grades,
            eventDate: c.eventDate,
            label: '',
            password: c.password ?? '',
            sources: c.sources,
            unverified: c.unverified,
            passwordDetected: c.password != null && c.password.trim() !== '',
            expanded: false,
          })),
        )
      })
      .catch(() => {
        if (cancelled) return
        setSaveError('抽出に失敗しました。手入力で追加してください')
        setExtractedCount(0)
        setQrUnread([])
        // ★失敗時も保存済み状態は空のままにする（前のグループの値を見せない）。
        setSavedRows([])
        setBroadcastCount(0)
        setRows([createManualRow(true)])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, mailMessageId, entryGroupId])

  if (!open) return null

  // ★保存済み行の最終ラベルも判定に含める。入力行どうしだけを見ていると、
  // 「既に C級 が保存済みのグループへ最終ラベル C級 の行を足す」ケースで
  // CTA が有効なまま押せてしまい、サーバーに弾かれて初めて分かる（AC-47 の
  // 行単位エラーが成立しない）。保存済みには負の ID を振り、返るのは入力行だけ。
  const clientDuplicateIds = findDuplicateOpenChatLabelIds([
    ...savedRows.map((r, i) => ({
      id: -(i + 1),
      grades: null,
      eventDate: null,
      // 保存済みは解決済みのラベル文字列なので freeLabel として渡せばそのまま最終ラベルになる。
      freeLabel: r.label,
    })),
    ...rows.map((r) => ({
      id: r.id,
      grades: r.grades,
      eventDate: r.eventDate,
      freeLabel: r.label,
    })),
  ])
  const duplicateIds = new Set<number>(
    [...clientDuplicateIds].filter((id) => id >= 0).concat([...serverDuplicateRowIds]),
  )
  const hasInvalidUrl = rows.some((r) => !isValidHttpsUrl(r.url))
  const hasDuplicates = duplicateIds.size > 0
  const ctaDisabled = rows.length === 0 || hasInvalidUrl || hasDuplicates || loading || pending

  const ctaLabel = `保存する（${rows.length}件）`

  const footNote = hasInvalidUrl
    ? 'URL を入力すると押せます'
    : hasDuplicates
      ? `ラベルが重複している ${duplicateIds.size} 件を直すと押せます`
      : rows.length === 0
        ? '追加するオープンチャットがありません'
        : 'ここでは保存だけ行います。LINE へはメール本文・添付と一緒に送ります'

  function updateRow(id: number, patch: Partial<OpenChatRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function toggleExpanded(id: number) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, expanded: !r.expanded } : r)))
  }

  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  function addManualRow() {
    setRows((prev) => [...prev, createManualRow(true)])
  }

  function buildSaveInput(): OpenChatSaveInput {
    return {
      entryGroupId,
      mailMessageId,
      rows: rows.map((r) => ({
        url: r.url.trim(),
        grades: r.grades,
        eventDate: r.eventDate,
        label: r.label.trim() === '' ? null : r.label.trim(),
        password: r.password.trim() === '' ? null : r.password.trim(),
        source: primarySource(r.sources),
      })),
    }
  }

  async function performSave() {
    setSaveError(null)
    setServerDuplicateRowIds(new Set())
    const result = await saveOpenChats(buildSaveInput())
    if (!result.ok) {
      setSaveError(result.error)
      // AC-47: サーバーが返した重複行の index を行 ID へ対応付けて、該当行だけを
      // 展開・エラー表示する。既存の保存済み行とラベルが衝突したケースは
      // クライアント側の重複判定では出せない（保存済みを知らない）ので、
      // ここで拾わないと「どれを直せばいいか分からない全体エラー」で終わる。
      if (result.duplicateLabelIndexes) {
        const ids = new Set<number>()
        for (const index of result.duplicateLabelIndexes) {
          const target = rows[index]
          if (target) ids.add(target.id)
        }
        setServerDuplicateRowIds(ids)
        setRows((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, expanded: true } : r)))
      }
      return
    }

    // 保存だけが済んだ状態。配信は呼び出し元の「LINE 配信」に相乗りするので、
    // ここでは閉じて呼び出し元へ制御を返す（onClose 側で保存済み件数を引き直す）。
    setRows([])
    setExtractedCount(0)
    onClose()
  }

  function onCtaClick() {
    if (ctaDisabled) return
    startTransition(performSave)
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-chat-sheet-title"
      className="modal-overlay-h fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      // ★処理中は背景クリックで閉じさせない。保存の実行中に閉じても Server Action
      // は走り続ける一方、失敗の結果はアンマウント済みのシートへ setSaveError する
      // だけになり管理者へ届かない。
      // 既存の AIExtractConfirmDialog も同じ方式で閉じる操作を抑止している。
      onClick={pending ? undefined : onClose}
    >
      <div
        className="flex max-h-[88vh] w-full flex-col rounded-t-lg bg-surface p-4 shadow-lg sm:max-w-md sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2">
          <span
            id="open-chat-sheet-title"
            className="min-w-0 flex-1 font-display text-base font-bold text-ink"
          >
            オープンチャット
          </span>
          <button
            type="button"
            className="flex-none text-sm text-ink-meta disabled:opacity-50"
            disabled={pending}
            onClick={onClose}
          >
            閉じる
          </button>
        </div>

        <div className="mt-2 flex items-baseline gap-1.5 border-l-2 border-brand pl-2">
          <span className="text-sm font-bold text-brand-fg">{entryGroupDisplayName}</span>
          {groupEventDates.length > 0 && (
            <span className="text-[10px] text-ink-meta">
              {groupEventDates.map((d) => formatEventDate(d)).join('・')}
            </span>
          )}
        </div>

        {loading ? (
          <p className="mt-3 text-xs text-ink-meta">抽出中…</p>
        ) : extractedCount > 0 ? (
          <p className="mt-2.5 text-[10px] text-ink-meta">{extractedCount} 件見つかりました</p>
        ) : savedRows.length > 0 ? (
          // 新しい候補は無いが保存済みがある。「見つかりませんでした」を出すと
          // 運営が保存済みの存在を見失うので、こちらを優先して出す。
          <p className="mt-2.5 text-[10px] text-ink-meta">
            新しい候補はありません（保存済み {savedRows.length} 件を配信できます）
          </p>
        ) : (
          <div className="mt-3 rounded-md border border-border-soft bg-surface-alt p-4 text-center">
            <div className="text-sm font-bold text-ink-2">URL が見つかりませんでした</div>
            <div className="mt-1.5 text-[10px] leading-relaxed text-ink-meta">
              本文・添付テキスト・QR コードのいずれにも招待 URL がありませんでした。
              <br />
              「大会用 LINE アカウント内でご案内」のように、メールの外にしか URL が
              無い場合があります。
            </div>
          </div>
        )}

        {!loading && qrUnread.length > 0 && (
          // requirements §3.2.3: デコードできなくても機能は失敗しないが、
          // **黙ってもいけない**。QR にしか URL が無い大会（実測で招待メールの30%）で
          // 「見つかりませんでした」だけを出すと、管理者は取りこぼしに気づけない。
          // 警告色は使わない（エラーではなく確度の情報。design-spec の方針）。
          <div className="mt-2.5 rounded-md border border-border-soft bg-surface-alt px-2.5 py-2">
            <div className="text-[10px] font-bold text-ink-2">
              QR コードを読み取れませんでした
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-ink-meta">
              {qrUnread.join('・')}
              <br />
              添付を開いて QR を確認し、URL は手入力で追加してください。
            </div>
          </div>
        )}

        {!loading && savedRows.length > 0 && (
          // 保存済み行は**表示のみ**（編集はしない）。配信で何が送られるかを
          // 追加する前に見せる。broadcastCount は「配信済み回数」で、0 なら未配信。
          <div className="mt-2.5 rounded-md border border-border-soft bg-surface-alt px-2.5 py-2">
            <div className="text-[10px] font-bold text-ink-2">
              保存済み {savedRows.length} 件
              {broadcastCount > 0 ? `（配信済み ${broadcastCount} 回）` : '（未配信）'}
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {savedRows.map((r) => (
                <li key={r.id} className="truncate text-[10px] text-ink-meta">
                  {r.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {rows.map((row) => (
            <OpenChatRowItem
              key={row.id}
              row={row}
              duplicate={duplicateIds.has(row.id)}
              groupEventDates={groupEventDates}
              disabled={pending}
              onToggle={() => toggleExpanded(row.id)}
              onChange={(patch) => updateRow(row.id, patch)}
              onRemove={() => removeRow(row.id)}
            />
          ))}
          <button
            type="button"
            disabled={pending}
            onClick={addManualRow}
            className="mt-1 w-full rounded-md border border-dashed border-border-strong bg-transparent py-2 text-sm text-ink-2 disabled:opacity-50"
          >
            ＋ 手入力で追加
          </button>
        </div>

        {saveError && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {saveError}
          </p>
        )}

        <div className="mt-2.5 flex-none border-t border-border-soft pt-2.5">
          <Btn kind="primary" size="lg" block disabled={ctaDisabled} onClick={onCtaClick}>
            {pending ? '処理中…' : ctaLabel}
          </Btn>
          <p className="mt-1.5 text-center text-[10px] text-ink-meta">{footNote}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function OpenChatRowItem({
  row,
  duplicate,
  groupEventDates,
  disabled,
  onToggle,
  onChange,
  onRemove,
}: {
  row: OpenChatRow
  duplicate: boolean
  groupEventDates: string[]
  disabled: boolean
  onToggle: () => void
  onChange: (patch: Partial<OpenChatRow>) => void
  onRemove: () => void
}) {
  const isManual = row.sources.includes('manual')
  const isQr = row.sources.includes('qr')
  // extract.ts の正規表現は http:// も拾い得る（実例は無いが排除していない）。
  // 抽出候補でも URL が https:// でなければ、手入力行と同じく URL を直せないと
  // CTA が永久に無効のまま詰む（削除以外に逃げ場が無くなる）。
  const urlEditable = isManual || !isValidHttpsUrl(row.url)
  const resolved = resolveOpenChatLabel({
    grades: row.grades,
    eventDate: row.eventDate,
    freeLabel: row.label,
  })
  const autoLabel = buildAutoOpenChatLabel(row.grades, row.eventDate)
  const sourceText = row.sources.map((s) => SOURCE_LABEL[s]).join('・')

  return (
    <div
      className={`rounded-md border bg-surface ${
        duplicate ? 'border-accent' : row.expanded ? 'border-brand' : 'border-border-soft'
      }`}
    >
      <div className="flex items-start gap-2 px-2.5 py-2">
        <button
          type="button"
          aria-label={row.expanded ? '折りたたむ' : '展開する'}
          disabled={disabled}
          onClick={onToggle}
          className="flex-none pt-0.5 text-[10px] leading-relaxed text-ink-meta disabled:opacity-50"
        >
          {row.expanded ? '▾' : '▸'}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                resolved.isAuto ? 'font-medium text-ink-2' : 'font-bold text-ink'
              }`}
            >
              {resolved.label}
            </span>
            {row.unverified && (
              <span className="flex-none border-b border-dashed border-border-strong text-[10px] whitespace-nowrap text-ink-meta">
                未検証
              </span>
            )}
            <span
              className={`flex-none rounded-sm border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${
                isManual
                  ? 'border-border-strong bg-surface-alt text-ink-2'
                  : isQr
                    ? 'border-brand bg-brand-bg text-brand-fg'
                    : 'border-border bg-surface text-ink-meta'
              }`}
            >
              {sourceText}
            </span>
          </div>
          <span
            className={`mt-0.5 block truncate font-mono text-[10px] ${
              row.url ? 'text-ink-meta' : 'text-ink-muted'
            }`}
          >
            {row.url || 'https://…'}
          </span>
          {row.passwordDetected && (
            <span className="mt-0.5 block text-[10px] text-ink-meta">
              パスワードを検出しました
            </span>
          )}
        </div>
      </div>

      {duplicate && (
        <div className="mx-2.5 mb-2.5 rounded-sm bg-danger-bg px-2 py-1.5 text-[10px] leading-relaxed text-danger-fg">
          同じラベルの行が複数あります。Flex のボタンが同じ名前になり区別できません。
          <b>ラベルを入力してください</b>。
        </div>
      )}

      {row.expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border-soft p-2.5">
          {urlEditable && (
            <FieldRow label="URL">
              <input
                type="text"
                value={row.url}
                disabled={disabled}
                onChange={(e) => onChange({ url: e.target.value })}
                placeholder="https://line.me/ti/g2/…"
                className="block w-full rounded-md border border-border-soft bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted"
              />
            </FieldRow>
          )}

          <FieldRow label="対象級">
            <div className="flex gap-1">
              {GRADE_ORDER.map((grade) => {
                const on = row.grades?.includes(grade) ?? false
                return (
                  <button
                    key={grade}
                    type="button"
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() => onChange({ grades: toggleGradeInRow(row.grades, grade) })}
                    className={`w-6 rounded-full border py-0.5 text-center text-[11px] disabled:opacity-50 ${
                      on
                        ? 'border-brand bg-brand font-bold text-ink-on-brand'
                        : 'border-border bg-surface text-ink-2'
                    }`}
                  >
                    {grade}
                  </button>
                )
              })}
              <button
                type="button"
                aria-pressed={row.grades == null}
                disabled={disabled}
                onClick={() => onChange({ grades: null })}
                className={`rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-50 ${
                  row.grades == null
                    ? 'border-brand bg-brand font-bold text-ink-on-brand'
                    : 'border-border bg-surface text-ink-2'
                }`}
              >
                全級
              </button>
            </div>
          </FieldRow>

          <FieldRow label="開催日">
            <select
              value={row.eventDate ?? ''}
              disabled={disabled}
              onChange={(e) => onChange({ eventDate: e.target.value === '' ? null : e.target.value })}
              className="block w-full rounded-md border border-border-soft bg-surface px-2.5 py-1.5 text-sm text-ink"
            >
              <option value="">全日共通</option>
              {groupEventDates.map((d) => (
                <option key={d} value={d}>
                  {formatEventDate(d)}
                </option>
              ))}
            </select>
          </FieldRow>

          <FieldRow label="ラベル">
            <input
              type="text"
              value={row.label}
              disabled={disabled}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder={`${autoLabel}（自動）`}
              className="block w-full rounded-md border border-border-soft bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted"
            />
          </FieldRow>

          <FieldRow label="パスワード">
            <input
              type="text"
              value={row.password}
              disabled={disabled}
              onChange={(e) => onChange({ password: e.target.value })}
              placeholder="なし"
              className="block w-full rounded-md border border-border-soft bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted"
            />
          </FieldRow>

          <div className="flex items-center justify-between">
            {isManual ? (
              <span />
            ) : (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-brand-fg underline"
              >
                URL を開いて確かめる ↗
              </a>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={onRemove}
              className="text-[10px] text-accent-fg disabled:opacity-50"
            >
              {isManual ? 'この行を削除' : 'この候補を外す'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** モックの `.fl`（項目名 + 値）。 */
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 flex-none text-[10px] text-ink-meta">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
