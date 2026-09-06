import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import {
  TravelReportSection,
  type TravelReportSectionProps,
} from './TravelReportSection'

/**
 * S5「遠征届」セクションの作成履歴表示。
 *
 * ここが守るのは、永続化した通知失敗（`notify_error`）が履歴行に**成功表示より
 * 優先して**出ること（requirements R13・Codex R1 #10）。
 */

const baseProps = (
  over: Partial<TravelReportSectionProps> = {},
): TravelReportSectionProps => ({
  entryGroupId: 1,
  required: true,
  submitterNames: [],
  destination: { label: null, prefecture: null, city: null, source: null },
  routeInputOpen: true,
  units: [],
  history: [],
  actions: {
    setRequired: vi.fn(),
    startRouteInput: vi.fn(),
    updateDestination: vi.fn(),
  },
  ...over,
})

describe('TravelReportSection の作成履歴', () => {
  it('notify_error のある batch は失敗表示が出る（Codex R1 #10）', () => {
    const { container } = render(
      <TravelReportSection
        {...baseProps({
          history: [
            {
              id: 1,
              filename: '2026.11.7 帯広新人戦 遠征届.docx',
              createdAtLabel: '9/6 15:02',
              createdByName: null,
              notifyError: 'LINE がエラーを返しました',
              notifiedAt: null,
            },
          ],
        })}
      />,
    )

    const failure = container.querySelector('.text-accent-fg')
    expect(failure).not.toBeNull()
    expect(failure?.textContent).toContain('LINE がエラーを返しました')
  })

  it('notify_error が無ければ失敗表示は出ない', () => {
    const { container } = render(
      <TravelReportSection
        {...baseProps({
          history: [
            {
              id: 1,
              filename: '2026.11.7 帯広新人戦 遠征届.docx',
              createdAtLabel: '9/6 15:02',
              createdByName: null,
              notifyError: null,
              notifiedAt: '9/6 15:02',
            },
          ],
        })}
      />,
    )

    expect(container.querySelector('.text-accent-fg')).toBeNull()
    expect(container.textContent).not.toContain('通知に失敗')
  })

  it('同じ batch の複数ファイルには同じ失敗表示が付く', () => {
    const { container } = render(
      <TravelReportSection
        {...baseProps({
          history: [
            {
              id: 1,
              filename: 'a.docx',
              createdAtLabel: '9/6 15:02',
              createdByName: null,
              notifyError: '通知エラー',
              notifiedAt: null,
            },
            {
              id: 2,
              filename: 'b.docx',
              createdAtLabel: '9/6 15:02',
              createdByName: null,
              notifyError: '通知エラー',
              notifiedAt: null,
            },
          ],
        })}
      />,
    )

    const failures = container.querySelectorAll('.text-accent-fg')
    const messages = [...failures].map((el) => el.textContent).filter((t) => t?.includes('通知エラー'))
    expect(messages).toHaveLength(2)
  })
})
