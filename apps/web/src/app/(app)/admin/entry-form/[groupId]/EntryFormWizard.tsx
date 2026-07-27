'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { CellMap, MemberField } from '@/lib/entry-form/cell-map'
import type { EntryFormMember } from '@/lib/entry-form/fill'
import {
  analyzeTemplateAction,
  createEntryFormDraftAction,
  saveMemberNamesAction,
  type CreateEntryFormDraftResult,
  type CreateEntryFormDraftInput,
  type EntryFormContext,
  type TemplateAnalysis,
} from './actions'
import { formatDateTimeShort, formatFlowDate } from '@/lib/event-date'
import { formatEventDateRange } from './entry-form-format'
import { applyColumnChange } from './cell-map-view'
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

  const runAnalyze = async (sel: TemplateSelection) => {
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
    try {
      const input =
        sel.kind === 'candidate'
          ? { groupId: context.groupId, attachmentId: sel.attachmentId }
          : { groupId: context.groupId, uploaded: sel.file }
      const result = await analyzeTemplateAction(input)
      setAnalysis(result)
      setCellMap(result.cellMap)
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnalyzing(false)
    }
  }

  const handleColumnChange = (sheetIndex: number, field: MemberField, value: string | null) => {
    setCellMap((prev) => (prev ? applyColumnChange(prev, sheetIndex, field, value) : prev))
  }

  // --- ステップ2: 会員 ---
  // 「＋ 会員を追加」は全会員検索の Server Action が本タスクの契約に無いため、
  // 初期対象（attend=true の和集合）から除外した行の再追加に限定する（報告参照）。
  const [members, setMembers] = useState<WizardMember[]>(() =>
    context.members.map((m) => ({ ...m, excluded: false })),
  )
  const [touchedNameUserIds, setTouchedNameUserIds] = useState<Set<string>>(new Set())
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const activeMembers = members.filter((m) => !m.excluded)

  // --- ステップ3: メール ---
  const [mail, setMail] = useState<MailDraftState | null>(null)

  // ステップ2⇔3 を行き来しても手入力済みの本文・件名・宛先を失わないよう、
  // mail が未生成のとき（初回到達・テンプレ変更直後）だけ組み立て直す。
  const goToStep3 = () => {
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
      } else if (context.sourceMailFrom) {
        toEmail = context.sourceMailFrom
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
    }
    setStep(3)
  }

  // --- 作成 ---
  const [submitting, setSubmitting] = useState(false)
  const [createResult, setCreateResult] = useState<CreateEntryFormDraftResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

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
        toEmail: mail.toEmail,
        subject: mail.subject,
        body: mail.body,
        attachmentFilename: mail.attachmentFilename,
      }
      const result = await createEntryFormDraftAction(payload)
      setCreateResult(result)
      setStep(result.status === 'created' ? 'done' : 'error')
    } catch (err) {
      setCreateResult(null)
      setSubmitError(err instanceof Error ? err.message : String(err))
      setStep('error')
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
          memberCount={members.length}
          selection={selection}
          onSelectionChange={(sel) => void runAnalyze(sel)}
          analysis={analysis}
          analyzing={analyzing}
          analyzeError={analyzeError}
          cellMap={cellMap}
          activeSheetIndex={activeSheetIndex}
          onActiveSheetChange={setActiveSheetIndex}
          onColumnChange={handleColumnChange}
          members={context.members}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <Step2Members
          members={members}
          appearanceCompleteness={context.appearanceCompleteness}
          onExclude={(userId) =>
            setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, excluded: true } : m)))
          }
          onInclude={(userId) =>
            setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, excluded: false } : m)))
          }
          onEditRequest={setEditingUserId}
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
          body={mail.body}
          onChange={(patch) =>
            setMail((prev) => {
              if (!prev) return prev
              const next = { ...prev, ...patch }
              // 手入力で上書きしたら出所バッジは消す(抽出結果ではなくなるため)。
              if (patch.toEmail !== undefined) next.toSource = null
              if (patch.subject !== undefined) next.subjectSource = 'default'
              if (patch.attachmentFilename !== undefined) next.attachmentFilenameSource = 'default'
              return next
            })
          }
          onBack={() => setStep(2)}
          onSubmit={() => void handleCreate()}
          submitting={submitting}
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
