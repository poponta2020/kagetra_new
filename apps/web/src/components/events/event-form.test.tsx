import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EventForm } from './event-form'

const noop = () => {}
const groups = [
  { id: 1, name: 'グループA' },
  { id: 2, name: 'グループB' },
]

describe('EventForm', () => {
  it("mode='create' で「作成」ボタンが表示される", () => {
    render(
      <EventForm
        mode="create"
        action={noop}
        groups={groups}
        cancelHref="/events"
      />,
    )
    expect(screen.getByRole('button', { name: '作成' })).toBeTruthy()
  })

  it("mode='edit' で「更新」ボタンが表示され、defaultValues の title が input に入っている", () => {
    render(
      <EventForm
        mode="edit"
        action={noop}
        groups={groups}
        cancelHref="/events/1"
        defaultValues={{ title: '春の大会' }}
      />,
    )
    expect(screen.getByRole('button', { name: '更新' })).toBeTruthy()
    const titleInput = screen.getByDisplayValue('春の大会') as HTMLInputElement
    expect(titleInput.name).toBe('title')
  })

  it('groups が select option としてレンダリングされる', () => {
    render(
      <EventForm
        mode="create"
        action={noop}
        groups={groups}
        cancelHref="/events"
      />,
    )
    const optionA = screen.getByRole('option', {
      name: 'グループA',
    }) as HTMLOptionElement
    const optionB = screen.getByRole('option', {
      name: 'グループB',
    }) as HTMLOptionElement
    expect(optionA.value).toBe('1')
    expect(optionB.value).toBe('2')
  })
})
