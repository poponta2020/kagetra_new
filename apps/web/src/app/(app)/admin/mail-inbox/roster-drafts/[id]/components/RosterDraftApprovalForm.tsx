'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/components/ui'
import { approveRosterImportDraft, rejectRosterImportDraft } from '../../../actions'

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
type SelectionStatus = 'lottery' | 'under_capacity' | 'no_capacity' | 'unknown'
type CompetitionCategory = 'official' | 'new_year' | 'hosted' | 'supported' | 'other' | 'unknown'

interface GradeConfig {
  grade: Grade
  selectionStatus: SelectionStatus
  capacity: string
  applicationStartDate: string
  publishAsConfirmed: boolean
  exemptionClassificationVerified: boolean
}

export interface EditionOption {
  id: number
  label: string
  competitionCategory?: CompetitionCategory
  competitionCategoryNote?: string | null
}

export interface EventOption {
  id: number
  entryGroupId: number
  editionId: number
  label: string
}

export interface RosterOption {
  id: number
  entryGroupId: number
  rosterType: 'applicant' | 'confirmed'
  label: string
}

export interface FactOption {
  editionId: number
  grade: Grade
  selectionStatus: SelectionStatus
  capacity: number | null
  applicationStartDate: string | null
}

function configsForEdition(grades: Grade[], editionId: number, facts: FactOption[]): GradeConfig[] {
  return (grades.length > 0 ? grades : (['A'] as Grade[])).map((grade) => {
    const fact = facts.find((candidate) => candidate.editionId === editionId && candidate.grade === grade)
    return {
      grade,
      selectionStatus: fact?.selectionStatus ?? 'unknown',
      capacity: fact?.capacity == null ? '' : String(fact.capacity),
      applicationStartDate: fact?.applicationStartDate ?? '',
      publishAsConfirmed: false,
      exemptionClassificationVerified: false,
    }
  })
}

export function RosterDraftApprovalForm({
  draftId,
  mailId,
  initialEditionId,
  initialPurpose,
  initialGrades,
  publishedAt,
  editions,
  events,
  rosters,
  facts,
}: {
  draftId: number
  mailId: number | null
  initialEditionId: number | null
  initialPurpose: 'applicant' | 'confirmed' | null
  initialGrades: Grade[]
  publishedAt: string
  editions: EditionOption[]
  events: EventOption[]
  rosters: RosterOption[]
  facts: FactOption[]
}) {
  const [editionSearch, setEditionSearch] = useState('')
  const defaultEditionId = initialEditionId ?? editions[0]?.id ?? 0
  const [editionId, setEditionId] = useState(defaultEditionId)
  const defaultEdition = editions.find((edition) => edition.id === defaultEditionId)
  const [competitionCategory, setCompetitionCategory] = useState<CompetitionCategory>(
    defaultEdition?.competitionCategory ?? 'unknown',
  )
  const [competitionCategoryNote, setCompetitionCategoryNote] = useState(
    defaultEdition?.competitionCategoryNote ?? '',
  )
  const [eventId, setEventId] = useState(
    events.find((event) => event.editionId === defaultEditionId)?.id ?? 0,
  )
  const [purpose, setPurpose] = useState<
    'applicant' | 'selection_result' | 'confirmed_publication'
  >(initialPurpose === 'confirmed' ? 'selection_result' : 'applicant')
  const [revisionKind, setRevisionKind] = useState<'initial' | 'correction' | 'additional'>('initial')
  const [targetRosterId, setTargetRosterId] = useState(0)
  const [configs, setConfigs] = useState<GradeConfig[]>(
    configsForEdition(initialGrades, defaultEditionId, facts),
  )
  const [error, setError] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const visibleEditions = useMemo(() => {
    const query = editionSearch.normalize('NFKC').toLowerCase().trim()
    return query ? editions.filter((option) => option.label.normalize('NFKC').toLowerCase().includes(query)) : editions
  }, [editionSearch, editions])
  const visibleEvents = events.filter((event) => event.editionId === editionId)
  const rosterType = purpose === 'applicant' ? 'applicant' : 'confirmed'
  // entry-groups タスク8: 名簿の帰属は event → entry_group へ移った。訂正対象の
  // 候補は「選択中イベントと同じ申込グループ」の名簿に絞る（グループ内のどの日
  // からも同一の名簿が見えるのと対称の設計）。
  const selectedEntryGroupId = events.find((event) => event.id === eventId)?.entryGroupId ?? null
  const visibleRosters = rosters.filter(
    (roster) => roster.entryGroupId === selectedEntryGroupId && roster.rosterType === rosterType,
  )

  const updateConfig = (index: number, patch: Partial<GradeConfig>) => {
    setConfigs((current) => current.map((config, i) => i === index ? { ...config, ...patch } : config))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    form.set('editionId', String(editionId))
    form.set('eventId', String(eventId || visibleEvents[0]?.id || 0))
    form.set('purpose', purpose)
    form.set('competitionCategory', competitionCategory)
    form.set('competitionCategoryNote', competitionCategoryNote)
    form.set('revisionKind', revisionKind)
    if (revisionKind === 'correction') form.set('correctionTargetRosterId', String(targetRosterId))
    form.set('gradeConfigs', JSON.stringify(configs.map((config) => ({
      grade: config.grade,
      selectionStatus: config.selectionStatus,
      capacity: config.capacity === '' ? null : Number(config.capacity),
      applicationStartDate: config.applicationStartDate || null,
      publishAsConfirmed: purpose === 'applicant' && config.publishAsConfirmed,
      exemptionClassificationVerified: config.exemptionClassificationVerified,
    }))))

    startTransition(async () => {
      const result = await approveRosterImportDraft(draftId, form)
      if (result.ok) router.push(mailId == null ? '/admin/mail-inbox' : `/admin/mail-inbox/mail/${mailId}`)
      else setError(result.error)
    })
  }

  const reject = () => {
    setError(null)
    startTransition(async () => {
      const result = await rejectRosterImportDraft(draftId, rejectReason)
      if (result.ok) router.push(mailId == null ? '/admin/mail-inbox' : `/admin/mail-inbox/mail/${mailId}`)
      else setError(result.error)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="edition-search" className="text-xs font-semibold text-ink-2">開催回を検索</label>
          <input
            id="edition-search"
            type="search"
            value={editionSearch}
            onChange={(event) => setEditionSearch(event.target.value)}
            placeholder="大会名・回次・年"
            className="rounded border border-border bg-surface p-2 text-sm text-ink"
          />
          <select
            aria-label="開催回"
            value={editionId}
            onChange={(event) => {
              const nextEditionId = Number(event.target.value)
              setEditionId(nextEditionId)
              const nextEdition = editions.find((candidate) => candidate.id === nextEditionId)
              setCompetitionCategory(nextEdition?.competitionCategory ?? 'unknown')
              setCompetitionCategoryNote(nextEdition?.competitionCategoryNote ?? '')
              setEventId(events.find((candidate) => candidate.editionId === nextEditionId)?.id ?? 0)
              setTargetRosterId(0)
              setConfigs(configsForEdition(initialGrades, nextEditionId, facts))
            }}
            required
            className="rounded border border-border bg-surface p-2 text-sm text-ink"
          >
            <option value={0}>開催回を選択</option>
            {visibleEditions.map((edition) => <option key={edition.id} value={edition.id}>{edition.label}</option>)}
          </select>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
          対象イベント
          <select
            value={eventId || visibleEvents[0]?.id || 0}
            onChange={(event) => {
              setEventId(Number(event.target.value))
              setTargetRosterId(0)
            }}
            required
            className="rounded border border-border bg-surface p-2 text-sm font-normal text-ink"
          >
            <option value={0}>イベントを選択</option>
            {visibleEvents.map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            大会区分
            <select
              value={competitionCategory}
              onChange={(event) => setCompetitionCategory(event.target.value as CompetitionCategory)}
              className="rounded border border-border bg-surface p-2 text-sm font-normal text-ink"
            >
              <option value="unknown">未確認</option>
              <option value="official">公認大会</option>
              <option value="new_year">新春大会</option>
              <option value="hosted">主催大会</option>
              <option value="supported">後援大会</option>
              <option value="other">その他</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            大会区分の確認メモ
            <input
              value={competitionCategoryNote}
              onChange={(event) => setCompetitionCategoryNote(event.target.value)}
              maxLength={500}
              placeholder="原本の記載箇所など"
              className="rounded border border-border bg-surface p-2 text-sm font-normal text-ink"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            原本用途
            <select
              name="purpose"
              value={purpose}
              onChange={(event) => {
                setPurpose(event.target.value as typeof purpose)
                setRevisionKind('initial')
                setTargetRosterId(0)
              }}
              className="rounded border border-border bg-surface p-2 text-sm font-normal text-ink"
            >
              <option value="applicant">申込名簿</option>
              <option value="selection_result">抽選結果発表</option>
              <option value="confirmed_publication">後日の確定名簿発表</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            発表日
            <input name="publishedAt" type="date" required defaultValue={publishedAt} className="rounded border border-border bg-surface p-2 text-sm font-normal text-ink" />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-ink-2">版の扱い</span>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-sm text-ink"><input type="radio" checked={revisionKind === 'initial'} onChange={() => setRevisionKind('initial')} /> 初回</label>
            <label className="text-sm text-ink"><input type="radio" checked={revisionKind === 'correction'} onChange={() => setRevisionKind('correction')} /> 訂正（旧版を指定）</label>
            <label className="text-sm text-ink"><input type="radio" disabled={purpose !== 'confirmed_publication'} checked={revisionKind === 'additional'} onChange={() => setRevisionKind('additional')} /> 追加発表</label>
          </div>
          {revisionKind === 'correction' && (
            <select
              aria-label="訂正対象名簿"
              value={targetRosterId}
              onChange={(event) => setTargetRosterId(Number(event.target.value))}
              required
              className="rounded border border-border bg-surface p-2 text-sm text-ink"
            >
              <option value={0}>訂正する有効版を選択</option>
              {visibleRosters.map((roster) => <option key={roster.id} value={roster.id}>{roster.label}</option>)}
            </select>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="font-display text-sm font-semibold text-ink-2">級別の公開設定</h3>
          {configs.map((config, index) => (
            <div key={index} className="grid gap-2 rounded border border-border-soft p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                級
                <select value={config.grade} onChange={(event) => updateConfig(index, { grade: event.target.value as Grade })} className="rounded border border-border bg-surface p-2 text-sm font-normal text-ink">
                  {(['A', 'B', 'C', 'D', 'E'] as const).map((grade) => <option key={grade} value={grade}>{grade}級</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                抽選状態
                <select value={config.selectionStatus} onChange={(event) => {
                  const selectionStatus = event.target.value as SelectionStatus
                  updateConfig(index, {
                    selectionStatus,
                    ...(selectionStatus === 'no_capacity' ? { capacity: '' } : {}),
                  })
                }} className="rounded border border-border bg-surface p-2 text-sm font-normal text-ink">
                  <option value="unknown">未確定（原本だけ採用）</option>
                  <option value="lottery">抽選あり</option>
                  <option value="under_capacity">定員未満・抽選なし</option>
                  <option value="no_capacity">定員なし・抽選なし</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                級別定員
                <input type="number" min={1} value={config.capacity} disabled={config.selectionStatus === 'no_capacity'} onChange={(event) => updateConfig(index, { capacity: event.target.value })} className="rounded border border-border bg-surface p-2 text-sm font-normal text-ink disabled:opacity-50" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                申込開始日
                <input type="date" required={config.grade === 'A' && config.selectionStatus !== 'unknown'} value={config.applicationStartDate} onChange={(event) => updateConfig(index, { applicationStartDate: event.target.value })} className="rounded border border-border bg-surface p-2 text-sm font-normal text-ink" />
              </label>
              {purpose === 'applicant' && (
                <label className="flex items-center gap-2 text-xs text-ink sm:col-span-2">
                  <input type="checkbox" checked={config.publishAsConfirmed} onChange={(event) => updateConfig(index, { publishAsConfirmed: event.target.checked })} />
                  原本に「この申込名簿を確定名簿とする」と明記されている
                </label>
              )}
              {config.grade === 'A' && config.selectionStatus === 'lottery' && (
                <label className="flex items-center gap-2 text-xs text-ink sm:col-span-2">
                  <input
                    type="checkbox"
                    required
                    checked={config.exemptionClassificationVerified}
                    onChange={(event) => updateConfig(index, {
                      exemptionClassificationVerified: event.target.checked,
                    })}
                  />
                  主催者枠・抽選除外の該当者（該当なしを含む）を原本で確認した
                </label>
              )}
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-danger-fg">{error}</p>}
        <Btn kind="primary" size="md" type="submit" disabled={pending || editionId === 0}>
          {pending ? '採用中…' : '確認済み原本として採用'}
        </Btn>
      </form>

      <div className="flex flex-col gap-2 border-t border-border-soft pt-4">
        <label className="text-xs font-semibold text-ink-2" htmlFor="roster-reject-reason">却下理由</label>
        <textarea id="roster-reject-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="min-h-20 rounded border border-border bg-surface p-2 text-sm text-ink" />
        <Btn kind="danger" size="md" type="button" onClick={reject} disabled={pending || !rejectReason.trim()}>
          このドラフトを却下
        </Btn>
      </div>
    </div>
  )
}
