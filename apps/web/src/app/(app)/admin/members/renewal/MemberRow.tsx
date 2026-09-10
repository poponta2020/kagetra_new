import { READER_CERTIFICATION_LABELS, READER_CERTIFICATION_NONE_LABEL, ROSTER_FIELD_LABELS } from '@kagetra/shared'
import { DisclosureRow, FlatTable, LinkAction, LinkActionLink } from '@/components/events/detail'
import type { FlatTableRow } from '@/components/events/detail'
import { cn } from '@/lib/utils'
import { formatRosterValue } from '@/lib/membership-renewal/diff'
import { findMissingRegisterFields } from '@/lib/membership-renewal/store'
import type { RenewalBoardRow } from '@/lib/membership-renewal/store'
import { MEMBERSHIP_KIND_LABELS } from '@/lib/membership-renewal/membership-kind'
import { formatDanKanji } from '@/lib/membership-renewal/dan-kanji'
import { formatJstMonthDay } from './format'
import { buildDisplayDiffRows, changedGroupLabels, combinedKanaValue, unchangedGroupSummary } from './roster-display'

/**
 * S2 会員行（design-mock `.mrow`）。開くと名簿の写し（未回答/変更なし/登録しない）
 * か差分（変更あり）を出す。開閉マーカーは `▸`/`▾`（`RosterSection.tsx` と同じ
 * ローカル実装 —— summary の並びが `DisclosureRow` 標準形と違うため既存
 * プリミティブをそのまま使えない）。
 */
const MARKER_BEFORE_CLASS =
  "before:content-['▸'] before:flex-none before:text-[10px] before:text-ink-meta"
const MARKER_OPEN_CLASS = "[&[open]>summary]:before:content-['▾']"

const MISSING_LABEL_CLASS = 'text-accent-fg'
const EMPTY_DASH = '—'

function StateLabel({ row }: { row: RenewalBoardRow }) {
  if (row.deactivated) {
    return <span className="flex-none text-xs text-ink-muted">退会</span>
  }
  switch (row.category) {
    case 'unanswered':
      return <span className="flex-none text-xs font-bold text-accent-fg">未回答</span>
    case 'changed':
      return (
        <span className="flex-none text-xs font-bold text-brand-fg">
          {changedGroupLabels(row.diff).join('・')}
        </span>
      )
    case 'not_register':
      return <span className="flex-none text-xs text-ink-meta">登録しない</span>
    case 'unchanged':
    default:
      return <span className="flex-none text-xs text-ink-meta">変更なし</span>
  }
}

function AnsweredMeta({ row }: { row: RenewalBoardRow }) {
  if (!row.answeredAt) return null
  const who = row.answeredByAdmin ? '管理者が代理回答' : '本人が回答'
  return (
    <div className="flex items-baseline gap-2 pb-1 text-xs text-ink-meta">
      <span>
        {formatJstMonthDay(row.answeredAt)} {who}
      </span>
      <LinkActionLink href={`/admin/members/${row.userId}/edit`} className="ml-auto">
        会員編集
      </LinkActionLink>
    </div>
  )
}

function UnansweredMeta({
  row,
  canProxyAnswer,
  onProxyAnswer,
}: {
  row: RenewalBoardRow
  canProxyAnswer: boolean
  onProxyAnswer?: () => void
}) {
  return (
    <div className="flex items-baseline gap-2 pb-1 text-xs text-ink-meta">
      <span>
        {row.lineLinked ? 'LINE 紐付け済み' : 'LINE 未紐付け'} ・ リマインド {row.reminderCount}回
      </span>
      {canProxyAnswer && (
        <LinkAction tone="brand" className="ml-auto" onClick={onProxyAnswer}>
          代理で回答する
        </LinkAction>
      )}
    </div>
  )
}

/** 未回答／変更なし／登録しない タブの展開: 名簿の写し（氏名・段位・級は summary 側にあるので含めない）。 */
function buildRosterFlatRows(row: RenewalBoardRow): FlatTableRow[] {
  const missing = new Set(findMissingRegisterFields(row.current))
  const current = row.current

  function textValue(field: 'gender' | 'birthDate' | 'postalCode' | 'address1' | 'phone'): FlatTableRow {
    const value = formatRosterValue(field, current)
    const isMissing = missing.has(ROSTER_FIELD_LABELS[field])
    return {
      key: field,
      label: ROSTER_FIELD_LABELS[field],
      value:
        value ?? (isMissing ? <span className={MISSING_LABEL_CLASS}>未入力</span> : EMPTY_DASH),
    }
  }

  const kana = combinedKanaValue(current)
  const kanaMissing = missing.has(ROSTER_FIELD_LABELS.familyKana) || missing.has(ROSTER_FIELD_LABELS.givenKana)

  const rows: FlatTableRow[] = [
    {
      key: 'kana',
      label: 'ふりがな',
      value: kana ?? (kanaMissing ? <span className={MISSING_LABEL_CLASS}>未入力</span> : EMPTY_DASH),
    },
    {
      key: 'birthDate',
      label: ROSTER_FIELD_LABELS.birthDate,
      value: (
        <>
          {formatRosterValue('birthDate', current) ??
            (missing.has(ROSTER_FIELD_LABELS.birthDate) ? (
              <span className={MISSING_LABEL_CLASS}>未入力</span>
            ) : (
              EMPTY_DASH
            ))}
          <span className="ml-1.5 text-xs text-accent-fg">{MEMBERSHIP_KIND_LABELS[row.membershipKind]}</span>
        </>
      ),
      variant: 'date',
    },
    textValue('gender'),
    textValue('postalCode'),
    textValue('address1'),
    {
      key: 'address2',
      label: ROSTER_FIELD_LABELS.address2,
      value: formatRosterValue('address2', current) ?? EMPTY_DASH,
    },
    textValue('phone'),
    {
      key: 'cert',
      label: '公認資格',
      value:
        (row.readerCertification ? READER_CERTIFICATION_LABELS[row.readerCertification] : READER_CERTIFICATION_NONE_LABEL) +
        (row.isAssociateReferee ? '・準公認審判員' : ''),
    },
  ]
  return rows
}

/** 変更ありタブの展開: 差分の項目だけを 前→後 で並べ、変更のない項目は畳む。 */
function buildDiffFlatRows(row: RenewalBoardRow): FlatTableRow[] {
  return buildDisplayDiffRows(row.diff, row.snapshot, row.current).map((entry) => ({
    key: entry.label,
    label: entry.label,
    value: (
      <>
        <span className="block text-xs text-ink-muted line-through decoration-border-strong">
          {entry.before ?? '（空欄）'}
        </span>
        <span className="block font-semibold text-accent-fg">{entry.after ?? '（空欄）'}</span>
      </>
    ),
  }))
}

export interface MemberRowProps {
  row: RenewalBoardRow
  mode: 'open' | 'completed'
  defaultOpen?: boolean
  onProxyAnswer?: (row: RenewalBoardRow) => void
}

export function MemberRow({ row, mode, defaultOpen = false, onProxyAnswer }: MemberRowProps) {
  const grade = row.current.grade
  const dan = formatDanKanji(row.current.dan)
  const canProxyAnswer = mode === 'open' && !row.deactivated && row.category === 'unanswered'
  const unchangedSummary = row.category === 'changed' ? unchangedGroupSummary(row.diff) : ''

  return (
    <details
      open={defaultOpen || undefined}
      className={cn('border-t border-border-soft first-of-type:border-t-0', MARKER_OPEN_CLASS, row.deactivated && 'opacity-[.55]')}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 py-[9px]',
          "[&::-webkit-details-marker]:hidden",
          MARKER_BEFORE_CLASS,
        )}
      >
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-ink">
          {row.displayName}
          {grade && <span className="ml-[5px] font-mono text-xs text-ink-meta">{grade}</span>}
          {dan && <span className="ml-[3px] text-xs text-ink-meta">{dan}</span>}
        </span>
        <StateLabel row={row} />
      </summary>
      <div className="pb-3 pl-2">
        {row.category === 'unanswered' ? (
          <UnansweredMeta
            row={row}
            canProxyAnswer={canProxyAnswer}
            onProxyAnswer={onProxyAnswer ? () => onProxyAnswer(row) : undefined}
          />
        ) : (
          <AnsweredMeta row={row} />
        )}
        {row.category === 'changed' ? (
          <>
            <FlatTable rows={buildDiffFlatRows(row)} />
            {unchangedSummary && (
              <DisclosureRow label="変更のない項目" value={unchangedSummary} nested />
            )}
          </>
        ) : (
          <FlatTable rows={buildRosterFlatRows(row)} />
        )}
      </div>
    </details>
  )
}
