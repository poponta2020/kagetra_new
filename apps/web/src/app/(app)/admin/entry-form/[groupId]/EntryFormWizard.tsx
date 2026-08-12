'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import type { Grade } from '@kagetra/shared/types'
import type { CellMap, MemberField } from '@/lib/entry-form/cell-map'
import type { EntryFormMember } from '@/lib/entry-form/fill'
import {
  analyzeTemplateAction,
  createEntryFormDraftAction,
  listAddableMembersAction,
  saveMemberNamesAction,
  type CreateEntryFormDraftResult,
  type CreateEntryFormDraftInput,
  type EntryFormContext,
  type EntryFormMemberRow,
  type TemplateAnalysis,
} from './actions'
import { formatDateTimeShort, formatFlowDate } from '@/lib/event-date'
import { formatEventDateRange } from './entry-form-format'
import {
  applyColumnChange,
  applyStartRowChange,
  applyTargetGradesChange,
  createManualSheet,
  removeSheet,
} from './cell-map-view'
import { buildAttachmentFilename, buildDefaultEntrySubject, buildEntryMailBody } from './mail-template-client'
import { WizardSteps } from './WizardSteps'
import { Step1Template } from './Step1Template'
import { Step2Members } from './Step2Members'
import { MemberEditSheet } from './MemberEditSheet'
import { Step3Mail } from './Step3Mail'
import { DoneStep } from './DoneStep'
import { ErrorStep } from './ErrorStep'
import type { MailDraftState, TemplateSelection, WizardMember } from './wizard-types'

/**
 * entry-form-autofill タスク7 (UI): S2 プレビュー画面のオーケストレーター。
 * 状態はすべてここに集約し（設計要求4）、各ステップは props を受け取るだけの
 * 表示コンポーネントに切る。
 *
 * `@/lib/entry-form/*` は型のみ import（server-only ガードを実行時に踏まないため）。
 * `./actions` の Server Action は値 import（Next が RPC 化する）。
 */
export interface EntryFormWizardProps {
  context: EntryFormContext
  currentUserName: string | null
}

type Step = 1 | 2 | 3 | 'done' | 'error'

export function EntryFormWizard({ context, currentUserName }: EntryFormWizardProps) {
  const [step, setStep] = useState<Step>(1)

  // --- ステップ1: テンプレート ---
  const [selection, setSelection] = useState<TemplateSelection | null>(null)
  const [analysis, setAnalysis] = useState<TemplateAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [cellMap, setCellMap] = useState<CellMap | null>(null)
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)

  // 解析要求の連番。候補Aの解析中に候補Bを選ぶと、遅れて届いたAの結果で
  // 「選択中はB・列対応はA」という食い違いが起きる（誤ったセルへの記入・誤送付先）。
  // 最新の要求と一致する応答だけを反映する。
  const analyzeSeqRef = useRef(0)

  const runAnalyze = async (sel: TemplateSelection) => {
    const seq = ++analyzeSeqRef.current
    setSelection(sel)
    setAnalyzing(true)
    setAnalyzeError(null)
    setAnalysis(null)
    setCellMap(null)
    setActiveSheetIndex(0)
    // テンプレを変えたら添付ファイル名・宛先(申込書からの抽出)の前提が変わるため、
    // 既に組み立て済みのステップ3下書きは作り直す(下の goToStep3 は mail が
    // null のときだけ組み立てるため、ここで無効化しないと古いテンプレ由来の
    // 値が残ってしまう)。
    setMail(null)
    setBodyEdited(false)
    setBodyStale(false)
    setBodyMembersKey(null)
    try {
      const input =
        sel.kind === 'candidate'
          ? { groupId: context.groupId, attachmentId: sel.attachmentId }
          : { groupId: context.groupId, uploaded: sel.file }
      const result = await analyzeTemplateAction(input)
      if (seq !== analyzeSeqRef.current) return
      setAnalysis(result)
      setCellMap(result.cellMap)
    } catch (err) {
      if (seq !== analyzeSeqRef.current) return
      setAnalyzeError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === analyzeSeqRef.current) setAnalyzing(false)
    }
  }

  const handleColumnChange = (sheetIndex: number, field: MemberField, value: string | null) => {
    setCellMap((prev) => (prev ? applyColumnChange(prev, sheetIndex, field, value) : prev))
  }

  // 自動推定が1シートも返せなかったときの手動マッピング（AC-7 の続行経路）。
  const handleAddManualSheet = (sheetName: string) => {
    setCellMap((prev) => {
      const sheets = prev?.sheets ?? []
      if (sheets.some((s) => s.sheetName === sheetName)) return prev
      return { sheets: [...sheets, createManualSheet(sheetName)] }
    })
    setActiveSheetIndex((prev) => (cellMap?.sheets.length ?? 0) > 0 ? prev : 0)
  }

  const handleStartRowChange = (sheetIndex: number, startRow: number) => {
    setCellMap((prev) => (prev ? applyStartRowChange(prev, sheetIndex, startRow) : prev))
  }

  const handleTargetGradesChange = (sheetIndex: number, grades: Grade[]) => {
    setCellMap((prev) => (prev ? applyTargetGradesChange(prev, sheetIndex, grades) : prev))
  }

  const handleRemoveSheet = (sheetIndex: number) => {
    setCellMap((prev) => (prev ? removeSheet(prev, sheetIndex) : prev))
    setActiveSheetIndex(0)
  }

  // --- ステップ2: 会員 ---
  // 「＋ 会員を追加」は全会員検索の Server Action が本タスクの契約に無いため、
  // 初期対象（attend=true の和集合）から除外した行の再追加に限定する（報告参照）。
  const [members, setMembers] = useState<WizardMember[]>(() =>
    context.members.map((m) => ({ ...m, excluded: false })),
  )
  const [touchedNameUserIds, setTouchedNameUserIds] = useState<Set<string>>(new Set())
  // 会員一覧からの追加候補（AC-5）。「＋ 会員を追加」を開いたときに1度だけ取る。
  const [addableMembers, setAddableMembers] = useState<EntryFormMemberRow[] | null>(null)
  const [addableLoading, setAddableLoading] = useState(false)
  const [addableError, setAddableError] = useState<string | null>(null)
  // 初期対象0名のグループでは context 側の完全性が常に complete になる（照会対象が
  // 空だったため）。候補取得時に分かった欠落状況で上書きし、追加した会員にも
  // 出場回数の警告が出るようにする。
  const [appearance, setAppearance] = useState({
    completeness: context.appearanceCompleteness,
    incompleteGrades: context.appearanceIncompleteGrades,
  })

  const requestAddable = () => {
    if (addableLoading) return
    setAddableLoading(true)
    setAddableError(null)
    void listAddableMembersAction(members.map((m) => m.userId))
      .then((result) => {
        setAddableMembers(result.members)
        if (result.appearanceCompleteness === 'incomplete') {
          setAppearance({
            completeness: 'incomplete',
            incompleteGrades: result.appearanceIncompleteGrades,
          })
        }
      })
      .catch((err) => {
        // 空一覧に倒すと「追加できる会員はいません」と誤表示になり、しかも
        // addableMembers が非 null になるので二度と再取得されない（対象0名の
        // グループでは作成を続行できなくなる）。エラーとして残し再試行させる。
        setAddableError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setAddableLoading(false))
  }

  const addMember = (userId: string) => {
    const found = addableMembers?.find((m) => m.userId === userId)
    if (!found) return
    setMembers((prev) => [...prev, { ...found, excluded: false }])
    setAddableMembers((prev) => prev?.filter((m) => m.userId !== userId) ?? null)
  }
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const activeMembers = members.filter((m) => !m.excluded)

  // --- ステップ3: メール ---
  const [mail, setMail] = useState<MailDraftState | null>(null)

  // 本文を手で直したかどうか。手入力済みなら会員構成が変わっても勝手に上書き
  // しない（代わりに再確認を促す）。未編集なら人数・級別内訳を作り直す——
  // ステップ3へ進んだ後に会員を足し引きすると、xlsx は新しい構成なのに本文だけ
  // 古い人数のまま送られてしまうため。
  const [bodyEdited, setBodyEdited] = useState(false)
  const [bodyStale, setBodyStale] = useState(false)
  // 本文を作った/確認した時点の会員構成。本文の文字列比較で判定すると、手編集
  // しただけで「構成が変わった」と誤警告する（会員を触っていなくても不一致になる）。
  const [bodyMembersKey, setBodyMembersKey] = useState<string | null>(null)

  /** 本文の内容を決める会員構成の指紋（誰が・どの級で入っているか）。 */
  const membersFingerprint = (rows: WizardMember[]) =>
    rows.map((m) => `${m.userId}:${m.grade ?? ''}`).join('|')

  const composeBody = (rows: WizardMember[]) =>
    buildEntryMailBody({
      organizer: context.organizer,
      clubName: context.settings.clubName ?? '所属会未設定',
      representativeName: context.settings.managerName ?? '(申込責任者未設定)',
      grades: rows.map((m) => m.grade),
    })

  // ステップ2⇔3 を行き来しても手入力済みの本文・件名・宛先を失わないよう、
  // mail が未生成のとき（初回到達・テンプレ変更直後）だけ組み立て直す。
  const goToStep3 = () => {
    if (mail != null) {
      // 会員構成が変わっている場合だけ、未編集の本文は作り直し、編集済みなら
      // 「内容が古い」ことを知らせる（勝手に消さない）。
      const key = membersFingerprint(activeMembers)
      if (key !== bodyMembersKey) {
        if (bodyEdited) {
          setBodyStale(true)
        } else {
          setMail({ ...mail, body: composeBody(activeMembers) })
          setBodyMembersKey(key)
        }
      }
      setStep(3)
      return
    }
    if (mail == null) {
      const grades = activeMembers.map((m) => m.grade)
      const clubName = context.settings.clubName ?? '所属会未設定'
      const managerName = context.settings.managerName ?? '(申込責任者未設定)'
      const tournamentName = context.groupName ?? '大会'

      // 宛先のプレフィル優先順（requirements §3.2.6）:
      // ①申込書内の申込先 → ②AI 抽出 → ③案内メールの差出人 → ④空欄。
      const instructions = analysis?.organizerInstructions ?? null
      let toEmail = ''
      let toSource: MailDraftState['toSource'] = null
      if (analysis?.organizerEmail) {
        toEmail = analysis.organizerEmail
        toSource = 'template'
      } else if (instructions?.toEmail) {
        toEmail = instructions.toEmail
        toSource = 'ai'
      } else if (analysis?.sourceMailFrom ?? context.sourceMailFrom) {
        // 選んだ添付が付いていたメールの差出人を優先する（グループに案内メールが
        // 複数あるとき、最新メールの差出人だと別大会宛てになり得る）。
        toEmail = analysis?.sourceMailFrom ?? context.sourceMailFrom ?? ''
        toSource = 'sourceMail'
      }

      // 件名・添付ファイル名は主催者指定（AI 抽出）があればそれに従い、
      // 無ければ定型（AC-13）。
      setMail({
        toEmail,
        toSource,
        subject: instructions?.subject ?? buildDefaultEntrySubject(tournamentName, clubName),
        subjectSource: instructions?.subject ? 'organizer' : 'default',
        attachmentFilename:
          instructions?.attachmentFilename ??
          buildAttachmentFilename(analysis?.templateFilename ?? '申込書.xlsx', clubName),
        attachmentFilenameSource: instructions?.attachmentFilename ? 'organizer' : 'default',
        body: buildEntryMailBody({
          organizer: context.organizer,
          clubName,
          representativeName: managerName,
          grades,
        }),
      })
      setBodyMembersKey(membersFingerprint(activeMembers))
    }
    setStep(3)
  }

  // --- 作成 ---
  const [submitting, setSubmitting] = useState(false)
  const [createResult, setCreateResult] = useState<CreateEntryFormDraftResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  /**
   * 未確定の作成（前回のリロード前に APPEND が確定しなかった行）。ここへ載せた
   * 行は同じ Message-ID で再試行できる。画面を再読み込みしても失わないよう
   * サーバーから渡る `latestDraft` を初期値にする——失うと新しい Message-ID で
   * 作り直すことになり、1通目が成功していた場合に下書きが重複する。
   */
  const [retryDraftId, setRetryDraftId] = useState<number | null>(
    context.latestDraft && context.latestDraft.status !== 'created'
      ? context.latestDraft.id
      : null,
  )

  const handleCreate = async () => {
    if (!cellMap || !mail) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      // かなの書き戻しは下書き作成の直前にまとめて行う（設計要求11）。
      const nameEntries = activeMembers
        .filter((m) => touchedNameUserIds.has(m.userId))
        .map((m) => ({
          userId: m.userId,
          familyName: m.familyName,
          givenName: m.givenName,
          familyKana: m.familyKana,
          givenKana: m.givenKana,
        }))
      if (nameEntries.length > 0) await saveMemberNamesAction(nameEntries)

      const payload: CreateEntryFormDraftInput = {
        groupId: context.groupId,
        attachmentId: selection?.kind === 'candidate' ? selection.attachmentId : null,
        uploaded: selection?.kind === 'upload' ? selection.file : null,
        cellMap,
        // EntryFormMemberRow は EntryFormMember を拡張するが、userId/displayName/
        // needsNameInput を xlsx 記入用の平たい型へ持ち込まないよう明示的に8項目だけ組む。
        members: activeMembers.map(
          (m): EntryFormMember => ({
            grade: m.grade,
            dan: m.dan,
            familyName: m.familyName,
            givenName: m.givenName,
            familyKana: m.familyKana,
            givenKana: m.givenKana,
            appearanceCount: m.appearanceCount,
            note: m.note,
          }),
        ),
        // guest-role: 記入用の平たい型には userId を持ち込まないが、確定 Action が
        // ロールを引き直すために id だけ別配列で渡す（members と同じ順序・長さ）。
        memberUserIds: activeMembers.map((m) => m.userId),
        toEmail: mail.toEmail,
        subject: mail.subject,
        body: mail.body,
        attachmentFilename: mail.attachmentFilename,
        // やり直しは同じ履歴行・同じ Message-ID を使う（下書きの重複防止）。
        retryDraftId,
      }
      const result = await createEntryFormDraftAction(payload)
      setCreateResult(result)
      // 成功したらこの行はもう再試行対象ではない。失敗なら次のやり直しで
      // 同じ行・同じ Message-ID を使えるよう覚えておく。
      setRetryDraftId(result.status === 'created' ? null : result.draftId)
      setStep(result.status === 'created' ? 'done' : 'error')
    } catch (err) {
      // ここへ来るのは履歴を作る前に弾かれた場合（宛先の形式ミス・列指定の不正・
      // DB 障害など）。ErrorStep は「Yahoo への書き込みに失敗したが xlsx は残って
      // いる」ための画面なので、そちらへ送ると直す導線が無くなる。ステップ3に
      // 留めてフォーム上にエラーを出す。
      // createResult は消すが retryDraftId は保持する（履歴行が既にある場合、
      // 次の試行でも同じ Message-ID を使い続ける必要がある）。
      setCreateResult(null)
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const editingMember = editingUserId ? (members.find((m) => m.userId === editingUserId) ?? null) : null

  const subtitle = `${formatEventDateRange(context.eventDates)}・大会申込締切 ${formatFlowDate(context.entryDeadline)}`

  return (
    <div className="flex min-h-full flex-col gap-5 p-4">
      <div>
        <p className="text-[11px] text-ink-meta">
          <Link href="/admin/entries" className="text-ink-2">
            申込管理
          </Link>{' '}
          › <b className="text-ink-2">申込書作成</b>
        </p>
        {step !== 'done' && step !== 'error' && (
          <>
            <h1 className="font-display text-xl font-bold text-ink">申込書を作成</h1>
            <p className="mt-0.5 text-xs text-ink-meta">
              {context.groupName ?? '大会'}（{subtitle}）
            </p>
          </>
        )}
      </div>

      {typeof step === 'number' && <WizardSteps current={step} />}

      {step === 1 && (
        <Step1Template
          candidates={context.templateCandidates}
          memberCount={activeMembers.length}
          selection={selection}
          onSelectionChange={(sel) => void runAnalyze(sel)}
          analysis={analysis}
          analyzing={analyzing}
          analyzeError={analyzeError}
          cellMap={cellMap}
          activeSheetIndex={activeSheetIndex}
          onActiveSheetChange={setActiveSheetIndex}
          onColumnChange={handleColumnChange}
          onAddManualSheet={handleAddManualSheet}
          onStartRowChange={handleStartRowChange}
          onTargetGradesChange={handleTargetGradesChange}
          onRemoveSheet={handleRemoveSheet}
          members={activeMembers}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <Step2Members
          members={members}
          appearanceCompleteness={appearance.completeness}
          appearanceIncompleteGrades={appearance.incompleteGrades}
          onExclude={(userId) =>
            setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, excluded: true } : m)))
          }
          onInclude={(userId) =>
            setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, excluded: false } : m)))
          }
          onEditRequest={setEditingUserId}
          onAddMember={addMember}
          addableMembers={addableMembers}
          onRequestAddable={requestAddable}
          addableLoading={addableLoading}
          addableError={addableError}
          onBack={() => setStep(1)}
          onNext={goToStep3}
        />
      )}

      {step === 3 && mail && (
        <Step3Mail
          attachmentFilename={mail.attachmentFilename}
          memberCount={activeMembers.length}
          toEmail={mail.toEmail}
          toSource={mail.toSource}
          subject={mail.subject}
          subjectSource={mail.subjectSource}
          attachmentFilenameSource={mail.attachmentFilenameSource}
          bodyStale={bodyStale}
          onRegenerateBody={() => {
            setMail((prev) => (prev ? { ...prev, body: composeBody(activeMembers) } : prev))
            setBodyMembersKey(membersFingerprint(activeMembers))
            setBodyEdited(false)
            setBodyStale(false)
          }}
          body={mail.body}
          onChange={(patch) =>
            setMail((prev) => {
              if (!prev) return prev
              const next = { ...prev, ...patch }
              // 手入力で上書きしたら出所バッジは消す(抽出結果ではなくなるため)。
              if (patch.toEmail !== undefined) next.toSource = null
              if (patch.subject !== undefined) next.subjectSource = 'default'
              if (patch.attachmentFilename !== undefined) next.attachmentFilenameSource = 'default'
              if (patch.body !== undefined) {
                setBodyEdited(true)
                setBodyStale(false)
              }
              return next
            })
          }
          onBack={() => setStep(2)}
          onSubmit={() => void handleCreate()}
          submitting={submitting}
          submitError={submitError}
        />
      )}

      {step === 'done' && createResult && mail && (
        <DoneStep
          toEmail={mail.toEmail}
          subject={mail.subject}
          attachmentFilename={mail.attachmentFilename}
          memberCount={activeMembers.length}
          createdAt={formatDateTimeShort(new Date())}
          createdByName={currentUserName}
          unassignedCount={createResult.unassignedCount}
          overflowCount={createResult.overflowCount}
          downloadUrl={`/api/admin/entry-form/drafts/${createResult.draftId}`}
        />
      )}

      {step === 'error' && (
        <ErrorStep
          message={createResult?.imapError ?? submitError ?? '不明なエラーが発生しました'}
          draftId={createResult?.draftId ?? null}
          downloadUrl={
            createResult?.draftId != null ? `/api/admin/entry-form/drafts/${createResult.draftId}` : null
          }
          unassignedCount={createResult?.unassignedCount ?? 0}
          overflowCount={createResult?.overflowCount ?? 0}
          onRetry={() => void handleCreate()}
          retrying={submitting}
        />
      )}

      {editingMember && (
        <MemberEditSheet
          member={editingMember}
          onClose={() => setEditingUserId(null)}
          onSave={(values) => {
            setMembers((prev) =>
              prev.map((m) => (m.userId === editingMember.userId ? { ...m, ...values } : m)),
            )
            setTouchedNameUserIds((prev) => new Set(prev).add(editingMember.userId))
            setEditingUserId(null)
          }}
          onExclude={() =>
            setMembers((prev) =>
              prev.map((m) => (m.userId === editingMember.userId ? { ...m, excluded: true } : m)),
            )
          }
        />
      )}
    </div>
  )
}
