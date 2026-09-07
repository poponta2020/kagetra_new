import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { UNDERGRADUATE_FACULTIES, GRADUATE_SCHOOLS } from '@kagetra/shared'
import { FacultyCombobox } from './FacultyCombobox'

// travel-report AC-4: 区分に応じた候補（学部13・大学院21）が提示され、
// 候補外の文字列も保存できる（自由入力）。
describe('FacultyCombobox', () => {
  it('区分が学部のとき学部13件を候補として提示する', () => {
    render(
      <FacultyCombobox
        id="f"
        name="faculty"
        kind="undergraduate"
        value=""
        onChange={() => {}}
        className="x"
      />,
    )
    const input = screen.getByRole('combobox') as HTMLInputElement
    const listId = input.getAttribute('list')
    const datalist = document.getElementById(listId!) as HTMLDataListElement
    const optionValues = [...datalist.options].map((o) => o.value)
    expect(optionValues).toEqual(UNDERGRADUATE_FACULTIES.slice())
    expect(optionValues).toHaveLength(13)
  })

  it('区分が大学院のとき大学院22件を候補として提示する', () => {
    render(
      <FacultyCombobox
        id="f"
        name="faculty"
        kind="graduate"
        value=""
        onChange={() => {}}
        className="x"
      />,
    )
    const input = screen.getByRole('combobox') as HTMLInputElement
    const listId = input.getAttribute('list')
    const datalist = document.getElementById(listId!) as HTMLDataListElement
    const optionValues = [...datalist.options].map((o) => o.value)
    expect(optionValues).toEqual(GRADUATE_SCHOOLS.slice())
    expect(optionValues).toHaveLength(22)
  })

  it('候補外の文字列も入力でき onChange に渡される（自由入力）', () => {
    const onChange = vi.fn()
    render(
      <FacultyCombobox
        id="f"
        name="faculty"
        kind="undergraduate"
        value=""
        onChange={onChange}
        className="x"
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '候補外学部' } })
    expect(onChange).toHaveBeenCalledWith('候補外学部')
  })

  it('required を渡すと入力要素へ反映される', () => {
    render(
      <FacultyCombobox
        id="f"
        name="faculty"
        kind="undergraduate"
        value=""
        onChange={() => {}}
        required
        className="x"
      />,
    )
    expect(screen.getByRole('combobox').hasAttribute('required')).toBe(true)
  })
})
