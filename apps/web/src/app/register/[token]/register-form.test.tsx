import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RegisterViaInviteState } from './actions'

const registerMock = vi.fn<
  (token: string, prev: RegisterViaInviteState, fd: FormData) => Promise<RegisterViaInviteState>
>()

vi.mock('./actions', () => ({
  registerViaInvite: (token: string, prev: RegisterViaInviteState, fd: FormData) =>
    registerMock(token, prev, fd),
}))

const { RegisterForm } = await import('./register-form')

function lastFormData(): FormData {
  const call = registerMock.mock.calls.at(-1)
  if (!call) throw new Error('registerViaInvite was not called')
  return call[2]
}

function fillNames() {
  fireEvent.change(screen.getByLabelText('姓（漢字）'), { target: { value: '山田' } })
  fireEvent.change(screen.getByLabelText('名（漢字）'), { target: { value: '太郎' } })
  fireEvent.change(screen.getByLabelText('せい（ふりがな）'), { target: { value: 'やまだ' } })
  fireEvent.change(screen.getByLabelText('めい（ふりがな）'), { target: { value: 'たろう' } })
}

function selectGrade(g: string) {
  fireEvent.click(screen.getByRole('radio', { name: `${g}級` }))
}

function submit(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
}

describe('RegisterForm', () => {
  beforeEach(() => {
    registerMock.mockReset()
    registerMock.mockResolvedValue({})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('初期表示: 氏名4項目＋級セグメントのみ。段位・全日協・PII は非表示', () => {
    render(<RegisterForm token="t" />)
    expect(screen.getByLabelText('姓（漢字）')).toBeTruthy()
    expect(screen.getByLabelText('めい（ふりがな）')).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '級' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: '段位' })).toBeNull()
    expect(screen.queryByText('全日本かるた協会（全日協）に登録済み')).toBeNull()
    expect(screen.queryByText('全日協登録情報')).toBeNull()
  })

  it('級A: 段位セグメントと全日協チェックが表示される', () => {
    render(<RegisterForm token="t" />)
    selectGrade('A')
    expect(screen.getByRole('radiogroup', { name: '段位' })).toBeTruthy()
    expect(screen.getByText('全日本かるた協会（全日協）に登録済み')).toBeTruthy()
  })

  it('級B/C: 全日協チェックは出るが段位は出ない', () => {
    render(<RegisterForm token="t" />)
    selectGrade('B')
    expect(screen.queryByRole('radiogroup', { name: '段位' })).toBeNull()
    expect(screen.getByText('全日本かるた協会（全日協）に登録済み')).toBeTruthy()
  })

  it('級D/E: 段位・全日協・PII すべて非表示', () => {
    render(<RegisterForm token="t" />)
    selectGrade('D')
    expect(screen.queryByRole('radiogroup', { name: '段位' })).toBeNull()
    expect(screen.queryByText('全日本かるた協会（全日協）に登録済み')).toBeNull()
    expect(screen.queryByText('全日協登録情報')).toBeNull()
  })

  it('全日協チェック ON で PII が開き、OFF で閉じる（既定 ON）', () => {
    render(<RegisterForm token="t" />)
    selectGrade('B')
    // default ON → PII visible
    expect(screen.getByText('全日協登録情報')).toBeTruthy()
    expect(screen.getByLabelText('生年月日')).toBeTruthy()
    // toggle OFF → PII hidden
    fireEvent.click(screen.getByRole('checkbox', { name: '全日本かるた協会（全日協）に登録済み' }))
    expect(screen.queryByText('全日協登録情報')).toBeNull()
  })

  it('送信FormData に構造化氏名と級が渡る（D級・PII なし）', async () => {
    const { container } = render(<RegisterForm token="t" />)
    fillNames()
    selectGrade('D')
    submit(container)

    await waitFor(() => expect(registerMock).toHaveBeenCalled())
    const fd = lastFormData()
    expect(fd.get('familyName')).toBe('山田')
    expect(fd.get('givenName')).toBe('太郎')
    expect(fd.get('familyKana')).toBe('やまだ')
    expect(fd.get('givenKana')).toBe('たろう')
    expect(fd.get('grade')).toBe('D')
    // D級は段位・全日協・PII を提出しない
    expect(fd.get('dan')).toBeNull()
    expect(fd.get('zenNichikyo')).toBeNull()
    expect(fd.get('gender')).toBeNull()
  })

  it('A級＋全日協ON: 段位・性別・全PII が FormData に渡る', async () => {
    const { container } = render(<RegisterForm token="t" />)
    fillNames()
    selectGrade('A')
    fireEvent.click(screen.getByRole('radio', { name: '六段' }))
    fireEvent.click(screen.getByRole('radio', { name: '女性' }))
    fireEvent.change(screen.getByLabelText('生年月日'), { target: { value: '1990-04-01' } })
    fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '090-1234-5678' } })
    fireEvent.change(screen.getByLabelText('郵便番号'), { target: { value: '001-0010' } })
    fireEvent.change(screen.getByLabelText('住所1（丁目・番地まで）'), { target: { value: '札幌市北区北十条西1-1' } })
    submit(container)

    await waitFor(() => expect(registerMock).toHaveBeenCalled())
    const fd = lastFormData()
    expect(fd.get('grade')).toBe('A')
    expect(fd.get('dan')).toBe('6')
    expect(fd.get('zenNichikyo')).toBe('on')
    expect(fd.get('gender')).toBe('female')
    expect(fd.get('birthDate')).toBe('1990-04-01')
    expect(fd.get('phone')).toBe('090-1234-5678')
    expect(fd.get('postalCode')).toBe('001-0010')
    expect(fd.get('address1')).toBe('札幌市北区北十条西1-1')
  })

  it('郵便番号検索: /api/zip 成功で住所1 を補完する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ address: '北海道札幌市北区北十条西' }) }),
    )
    render(<RegisterForm token="t" />)
    selectGrade('B')
    fireEvent.change(screen.getByLabelText('郵便番号'), { target: { value: '0010010' } })
    fireEvent.click(screen.getByRole('button', { name: '住所を検索' }))

    await waitFor(() =>
      expect((screen.getByLabelText('住所1（丁目・番地まで）') as HTMLInputElement).value).toBe('北海道札幌市北区北十条西'),
    )
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('zipcode=0010010'))
  })

  it('郵便番号検索: 該当なしは手入力フォールバックのメッセージ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '該当する住所が見つかりませんでした。住所を手入力してください。' }) }),
    )
    render(<RegisterForm token="t" />)
    selectGrade('B')
    fireEvent.change(screen.getByLabelText('郵便番号'), { target: { value: '9999999' } })
    fireEvent.click(screen.getByRole('button', { name: '住所を検索' }))

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('手入力')
  })

  it('戸建てチェックで住所2 を無効化・クリアする', () => {
    render(<RegisterForm token="t" />)
    selectGrade('B')
    const addr2 = screen.getByLabelText('住所2（建物名・部屋番号）') as HTMLInputElement
    fireEvent.change(addr2, { target: { value: 'マンション101' } })
    expect(addr2.value).toBe('マンション101')
    fireEvent.click(screen.getByRole('checkbox', { name: '集合住宅ではない（一軒家）のため未入力' }))
    expect(addr2.disabled).toBe(true)
    expect(addr2.value).toBe('')
  })

  it('降級→再昇級で全日協PIIがリセットされる（旧入力が復活しない）', () => {
    render(<RegisterForm token="t" />)
    selectGrade('B')
    // PII を入力（全日協は既定 ON）
    fireEvent.click(screen.getByRole('radio', { name: '男性' }))
    fireEvent.change(screen.getByLabelText('生年月日'), { target: { value: '1990-04-01' } })
    fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '090-1234-5678' } })
    fireEvent.change(screen.getByLabelText('住所1（丁目・番地まで）'), {
      target: { value: '札幌市北区北十条西1-1' },
    })
    // D級へ降級（PII 非表示）→ 再び B級（全日協は changeGrade で ON に戻る）
    selectGrade('D')
    selectGrade('B')
    // 旧 PII が復活していない
    expect((screen.getByLabelText('生年月日') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('電話番号') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('住所1（丁目・番地まで）') as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('radio', { name: '男性' }) as HTMLInputElement).checked).toBe(false)
  })

  it('action エラーは role=alert で表示され、入力は保持される', async () => {
    registerMock.mockResolvedValue({ error: '同名の会員が既に存在します。管理者にご連絡ください。' })
    const { container } = render(<RegisterForm token="t" />)
    fillNames()
    selectGrade('D')
    submit(container)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('同名の会員が既に存在します')
    expect((screen.getByLabelText('姓（漢字）') as HTMLInputElement).value).toBe('山田')
  })
})

// travel-report design-spec §8「S1 のサークル所属ブロックは級の直後・全日協の前」。
describe('RegisterForm サークル所属ブロック（会員用）', () => {
  beforeEach(() => {
    registerMock.mockReset()
    registerMock.mockResolvedValue({})
  })

  it('既定 OFF: 所属・学部等名・学年は表示されない', () => {
    render(<RegisterForm token="t" />)
    expect(
      screen.getByText('北海道大学のサークル「北大かるた会」に所属している'),
    ).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: '所属' })).toBeNull()
    expect(screen.queryByLabelText('学部等名')).toBeNull()
    expect(screen.queryByLabelText('学年')).toBeNull()
  })

  it('ON にすると 所属セグメント・学部等名・学年 が開く', () => {
    render(<RegisterForm token="t" />)
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '北海道大学のサークル「北大かるた会」に所属している',
      }),
    )
    expect(screen.getByRole('radiogroup', { name: '所属' })).toBeTruthy()
    expect(screen.getByLabelText('学部等名')).toBeTruthy()
    expect(screen.getByLabelText('学年')).toBeTruthy()
  })

  it('D級（全日協ブロック無し）でも ON にすると電話・生年月日欄が1つだけ開く', () => {
    render(<RegisterForm token="t" />)
    selectGrade('D')
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '北海道大学のサークル「北大かるた会」に所属している',
      }),
    )
    expect(screen.getAllByLabelText('電話番号')).toHaveLength(1)
    expect(screen.getAllByLabelText('生年月日')).toHaveLength(1)
  })

  it('B級＋全日協ON＋サークル所属ONでも電話・生年月日欄は1つだけ（共通表記が付く）', () => {
    render(<RegisterForm token="t" />)
    selectGrade('B')
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '北海道大学のサークル「北大かるた会」に所属している',
      }),
    )
    expect(screen.getAllByLabelText(/電話番号/)).toHaveLength(1)
    expect(screen.getAllByLabelText(/生年月日/)).toHaveLength(1)
    expect(screen.getByText('電話番号（サークル所属・全日協 共通）')).toBeTruthy()
  })

  it('送信FormDataにサークル所属・学部区分・学部等名・学年・電話・生年月日が渡る（D級）', async () => {
    const { container } = render(<RegisterForm token="t" />)
    fillNames()
    selectGrade('D')
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '北海道大学のサークル「北大かるた会」に所属している',
      }),
    )
    fireEvent.click(screen.getByRole('radio', { name: '大学院' }))
    fireEvent.change(screen.getByLabelText('学部等名'), { target: { value: '情報科学院' } })
    fireEvent.change(screen.getByLabelText('学年'), { target: { value: '修士1年' } })
    fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '090-0000-0000' } })
    fireEvent.change(screen.getByLabelText('生年月日'), { target: { value: '2003-01-01' } })
    submit(container)

    await waitFor(() => expect(registerMock).toHaveBeenCalled())
    const fd = lastFormData()
    expect(fd.get('isCircleMember')).toBe('on')
    expect(fd.get('facultyKind')).toBe('graduate')
    expect(fd.get('faculty')).toBe('情報科学院')
    expect(fd.get('schoolYear')).toBe('修士1年')
    expect(fd.get('phone')).toBe('090-0000-0000')
    expect(fd.get('birthDate')).toBe('2003-01-01')
  })
})

describe('RegisterForm サークル所属ブロック（ゲスト用）', () => {
  beforeEach(() => {
    registerMock.mockReset()
    registerMock.mockResolvedValue({})
  })

  it('既定 OFF: 姓・名・学部等名・学年・電話・生年月日は表示されない', () => {
    render(<RegisterForm token="t" kind="guest" />)
    expect(screen.queryByLabelText('姓（漢字）')).toBeNull()
    expect(screen.queryByLabelText('学部等名')).toBeNull()
    expect(screen.queryByLabelText('電話番号')).toBeNull()
  })

  it('ON にすると 姓・名・所属・学部等名・学年・電話・生年月日 が開き、FormData に渡る', async () => {
    const { container } = render(<RegisterForm token="t" kind="guest" />)
    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: '函館 大地' } })
    fireEvent.click(screen.getByRole('radio', { name: 'B級' }))
    fireEvent.change(screen.getByLabelText('所属会'), { target: { value: '帯広かるた会' } })
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '北海道大学のサークル「北大かるた会」に所属している',
      }),
    )
    fireEvent.change(screen.getByLabelText('姓（漢字）'), { target: { value: '函館' } })
    fireEvent.change(screen.getByLabelText('名（漢字）'), { target: { value: '大地' } })
    fireEvent.change(screen.getByLabelText('学部等名'), { target: { value: '経済学部' } })
    fireEvent.change(screen.getByLabelText('学年'), { target: { value: '2年' } })
    fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '080-0000-0010' } })
    fireEvent.change(screen.getByLabelText('生年月日'), { target: { value: '2005-08-08' } })
    submit(container)

    await waitFor(() => expect(registerMock).toHaveBeenCalled())
    const fd = lastFormData()
    expect(fd.get('isCircleMember')).toBe('on')
    expect(fd.get('familyName')).toBe('函館')
    expect(fd.get('givenName')).toBe('大地')
    expect(fd.get('facultyKind')).toBe('undergraduate')
    expect(fd.get('faculty')).toBe('経済学部')
    expect(fd.get('schoolYear')).toBe('2年')
    expect(fd.get('phone')).toBe('080-0000-0010')
    expect(fd.get('birthDate')).toBe('2005-08-08')
  })
})

describe('RegisterForm (kind=guest)', () => {
  beforeEach(() => {
    registerMock.mockReset()
    registerMock.mockResolvedValue({})
  })

  it('表示名・級・所属会の3項目だけが描画され、PII 入力欄は無い', () => {
    render(<RegisterForm token="t" kind="guest" />)
    expect(screen.getByLabelText('表示名')).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '級' })).toBeTruthy()
    expect(screen.getByLabelText('所属会')).toBeTruthy()

    // 会員用フォームの入力欄が一切無いこと。
    expect(screen.queryByLabelText('姓（漢字）')).toBeNull()
    expect(screen.queryByLabelText('名（漢字）')).toBeNull()
    expect(screen.queryByLabelText('せい（ふりがな）')).toBeNull()
    expect(screen.queryByLabelText('めい（ふりがな）')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: '段位' })).toBeNull()
    expect(screen.queryByText('全日本かるた協会（全日協）に登録済み')).toBeNull()
    expect(screen.queryByText('全日協登録情報')).toBeNull()
    expect(screen.queryByLabelText('生年月日')).toBeNull()
    expect(screen.queryByLabelText('電話番号')).toBeNull()
    expect(screen.queryByLabelText('郵便番号')).toBeNull()
  })

  it('送信FormDataに表示名・級・所属会が渡る', async () => {
    const { container } = render(<RegisterForm token="t" kind="guest" />)
    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: '山田 太郎' } })
    fireEvent.click(screen.getByRole('radio', { name: 'C級' }))
    fireEvent.change(screen.getByLabelText('所属会'), { target: { value: 'よその会' } })
    submit(container)

    await waitFor(() => expect(registerMock).toHaveBeenCalled())
    const fd = lastFormData()
    expect(fd.get('name')).toBe('山田 太郎')
    expect(fd.get('grade')).toBe('C')
    expect(fd.get('affiliation')).toBe('よその会')
    // 会員用フィールドは提出されない。
    expect(fd.get('familyName')).toBeNull()
    expect(fd.get('dan')).toBeNull()
  })

  it('action エラーは role=alert で表示される', async () => {
    registerMock.mockResolvedValue({ error: '同名の会員が既に存在します。管理者にご連絡ください。' })
    const { container } = render(<RegisterForm token="t" kind="guest" />)
    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: '山田 太郎' } })
    fireEvent.click(screen.getByRole('radio', { name: 'C級' }))
    fireEvent.change(screen.getByLabelText('所属会'), { target: { value: 'よその会' } })
    submit(container)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('同名の会員が既に存在します')
  })
})
