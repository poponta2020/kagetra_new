import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LifecycleStatusBadge } from './LifecycleStatusBadge'

describe('LifecycleStatusBadge', () => {
  it('not_applied: 「未申込」ピル（tone neutral 相当のテキストのみ確認）', () => {
    render(
      <LifecycleStatusBadge
        entryStatus="not_applied"
        paymentType={null}
        paymentStatus="unpaid"
      />,
    )
    expect(screen.getByText('未申込')).toBeTruthy()
    expect(screen.queryByText('申込済')).toBeNull()
    expect(screen.queryByText('申込なし')).toBeNull()
  })

  it('applied: 「申込済」ピル', () => {
    render(
      <LifecycleStatusBadge
        entryStatus="applied"
        paymentType={null}
        paymentStatus="unpaid"
      />,
    )
    expect(screen.getByText('申込済')).toBeTruthy()
  })

  it('not_applying: 「申込なし」ピルが出て、支払いピル（advance）が描画されない（AC-20）', () => {
    render(
      <LifecycleStatusBadge
        entryStatus="not_applying"
        paymentType="advance"
        paymentStatus="unpaid"
      />,
    )
    expect(screen.getByText('申込なし')).toBeTruthy()
    expect(screen.queryByText('未払')).toBeNull()
    expect(screen.queryByText('支払済')).toBeNull()
  })

  it('not_applying: 支払いピル（onsite=現地払い）も描画されない', () => {
    render(
      <LifecycleStatusBadge
        entryStatus="not_applying"
        paymentType="onsite"
        paymentStatus="unpaid"
      />,
    )
    expect(screen.getByText('申込なし')).toBeTruthy()
    expect(screen.queryByText('現地払い')).toBeNull()
  })

  it('applied + advance + unpaid: 「未払」ピルが出る（回帰）', () => {
    render(
      <LifecycleStatusBadge
        entryStatus="applied"
        paymentType="advance"
        paymentStatus="unpaid"
      />,
    )
    expect(screen.getByText('未払')).toBeTruthy()
  })

  it('applied + advance + paid: 「支払済」ピルが出る（回帰）', () => {
    render(
      <LifecycleStatusBadge
        entryStatus="applied"
        paymentType="advance"
        paymentStatus="paid"
      />,
    )
    expect(screen.getByText('支払済')).toBeTruthy()
  })

  it('applied + onsite: 「現地払い」ピルが出る（回帰）', () => {
    render(
      <LifecycleStatusBadge
        entryStatus="applied"
        paymentType="onsite"
        paymentStatus="unpaid"
      />,
    )
    expect(screen.getByText('現地払い')).toBeTruthy()
  })
})
