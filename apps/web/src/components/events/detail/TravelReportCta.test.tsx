import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TravelReportCta } from './TravelReportCta'

// travel-report タスク7 (S7・AC-16): 日ページの「遠征届」セクション。表示専用コンポーネント。

describe('TravelReportCta', () => {
  it('data=null なら何も描かない（出すものが無い一般会員）', () => {
    const { container } = render(<TravelReportCta data={null} />)
    expect(container.textContent).toBe('')
  })

  it('cta と submitter がどちらも null なら何も描かない', () => {
    const { container } = render(
      <TravelReportCta data={{ cta: null, submitter: null }} />,
    )
    expect(container.textContent).toBe('')
  })

  it('対象者で未入力なら朱の CTA（accent 枠・accent-bg 地・タグ「未入力」）', () => {
    render(
      <TravelReportCta
        data={{
          cta: {
            entered: false,
            routeHref: '/events/10/travel-route',
            unitDatesLabel: '10/10(土)・10/11(日)',
          },
          submitter: null,
        }}
      />,
    )

    const link = screen.getByRole('link', { name: /遠征経路を入力する/ })
    expect(link.getAttribute('href')).toBe('/events/10/travel-route')
    expect(link.className).toContain('border-accent')
    expect(link.className).toContain('bg-accent-bg')
    expect(screen.getByText('未入力')).toBeTruthy()
    // 提出権限者向けの行は出ない
    expect(screen.queryByText('大学に出す様式（原本）')).toBeNull()
  })

  it('対象者で入力済みなら藤の行（border・surface 地・タグ「入力済み」、文言は確認・修正）', () => {
    render(
      <TravelReportCta
        data={{
          cta: {
            entered: true,
            routeHref: '/events/10/travel-route',
            unitDatesLabel: '10/10(土)・10/11(日)',
          },
          submitter: null,
        }}
      />,
    )

    const link = screen.getByRole('link', { name: /遠征経路を確認・修正する/ })
    expect(link.className).toContain('border-border')
    expect(link.className).toContain('bg-surface')
    expect(screen.getByText('入力済み')).toBeTruthy()
  })

  it('提出権限者には原本ダウンロードとグループページ導線が出る', () => {
    render(
      <TravelReportCta
        data={{
          cta: null,
          submitter: {
            templateHref: '/api/admin/travel-reports/template',
            groupHref: '/admin/entries/5',
          },
        }}
      />,
    )

    const dl = screen.getByRole('link', { name: '遠征届原本.dotx' })
    expect(dl.getAttribute('href')).toBe('/api/admin/travel-reports/template')

    const groupLink = screen.getByRole('link', {
      name: '申込グループページの遠征届へ ›',
    })
    expect(groupLink.getAttribute('href')).toBe('/admin/entries/5')

    // 対象者でない提出権限者には CTA 本体は出ない
    expect(screen.queryByText('未入力')).toBeNull()
    expect(screen.queryByText('入力済み')).toBeNull()
  })

  it('対象者かつ提出権限者なら CTA と提出権限者の行が両方出る', () => {
    render(
      <TravelReportCta
        data={{
          cta: {
            entered: false,
            routeHref: '/events/10/travel-route',
            unitDatesLabel: '10/10(土)',
          },
          submitter: {
            templateHref: '/api/admin/travel-reports/template',
            groupHref: '/admin/entries/5',
          },
        }}
      />,
    )

    expect(screen.getByRole('link', { name: /遠征経路を入力する/ })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: '遠征届原本.dotx' }),
    ).toBeTruthy()
  })
})
