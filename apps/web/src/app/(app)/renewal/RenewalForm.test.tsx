import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { RenewalAnswerState } from './actions'
import type { RenewalFormView } from './RenewalForm'

/**
 * S1 `/renewal` フォームの単体テスト（DB 非依存）。`./actions` はモックし、
 * `submitRenewalAnswer` の実処理（store・DB）はここでは検証しない
 * （store.test.ts / page.test.tsx の担当）。
 */

const submitRenewalAnswerMock =
  vi.fn<(prev: RenewalAnswerState, fd: FormData) => Promise<RenewalAnswerState>>()

vi.mock('./actions', () => ({
  submitRenewalAnswer: (prev: RenewalAnswerState, fd: FormData) =>
    submitRenewalAnswerMock(prev, fd),
}))

const { RenewalForm } = await import('./RenewalForm')

beforeEach(() => {
  submitRenewalAnswerMock.mockReset()
  submitRenewalAnswerMock.mockResolvedValue({})
})

const BASE_CURRENT: RenewalFormView['current'] = {
  familyName: '北海',
  givenName: '太郎',
  familyKana: 'ほっかい',
  givenKana: 'たろう',
  birthDate: '2004-06-12',
  gender: 'male',
  dan: 3,
  grade: 'B',
  postalCode: '0010017',
  address1: '札幌市北区北17条西3-1-38',
  address2: 'ボストンハウス501',
  phone: '090-0000-0000',
  facultyKind: 'undergraduate',
  faculty: '工学部',
  schoolYear: '2年',
}

function baseView(overrides: Partial<RenewalFormView> = {}): RenewalFormView {
  return {
    renewalId: 1,
    fiscalYear: 2027,
    deadline: '2027-03-25',
    status: 'open',
    isZennichikyoTarget: true,
    isCircleTarget: true,
    current: BASE_CURRENT,
    membershipKind: 'regular',
    readerCertification: null,
    isAssociateReferee: false,
    answer: null,
    answeredAtIso: null,
    schoolYearKind: null,
    nextFacultyKind: null,
    nextFaculty: null,
    nextSchoolYear: null,
    schoolYearAnsweredAtIso: null,
    diff: [],
    ...overrides,
  }
}

describe('対象外（view === null）', () => {
  it('「対象ではありません」の一文だけを表示する', () => {
    render(<RenewalForm view={null} />)
    expect(screen.getByText('年度確認の対象ではありません。')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('両セクション対象／片方だけ対象', () => {
  it('両方が対象なら全日協・学年の両方の見出しが出る', () => {
    render(<RenewalForm view={baseView()} />)
    expect(screen.getByRole('heading', { name: '全日協の登録' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '4月からの学年' })).toBeTruthy()
  })

  it('全日協のみ対象なら学年セクションが出ない', () => {
    render(<RenewalForm view={baseView({ isCircleTarget: false })} />)
    expect(screen.getByRole('heading', { name: '全日協の登録' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '4月からの学年' })).toBeNull()
  })

  it('学年のみ対象なら全日協セクションが出ず、対象外の一文が添えられる', () => {
    render(<RenewalForm view={baseView({ isZennichikyoTarget: false })} />)
    expect(screen.queryByRole('heading', { name: '全日協の登録' })).toBeNull()
    expect(screen.getByRole('heading', { name: '4月からの学年' })).toBeTruthy()
    expect(
      screen.getByText('全日本かるた協会の登録確認は対象外です（登録者ではありません）。'),
    ).toBeTruthy()
  })
})

describe('行内修正の状態遷移', () => {
  it('埋まっている行は値表示＋「修正」で始まり、押すと入力欄に切り替わる', () => {
    render(<RenewalForm view={baseView()} />)

    expect(screen.getByText('北海 太郎')).toBeTruthy()
    expect(screen.queryByLabelText('姓')).toBeNull()

    const editLinks = screen.getAllByRole('button', { name: '修正' })
    fireEvent.click(editLinks[0]!)

    const familyInput = screen.getByLabelText('姓') as HTMLInputElement
    expect(familyInput.value).toBe('北海')
    expect((screen.getByLabelText('名') as HTMLInputElement).value).toBe('太郎')
  })

  it('入力欄で編集した値が反映される', () => {
    render(<RenewalForm view={baseView()} />)

    const editLinks = screen.getAllByRole('button', { name: '修正' })
    // ROW_ORDER: name, kana, birthDate, gender, dan, grade, postalCode, address1, address2, phone
    fireEvent.click(editLinks[7]!) // 住所1
    const address1Input = screen.getByLabelText('住所1') as HTMLInputElement
    fireEvent.change(address1Input, { target: { value: '東京都府中市小柳町1-20-6' } })
    expect(address1Input.value).toBe('東京都府中市小柳町1-20-6')
  })
})

describe('必須欠落でボタン無効（AC-5）', () => {
  it('電話番号が未入力なら最初から入力欄＋朱の注意文が出て、回答ボタンが無効になる', () => {
    render(<RenewalForm view={baseView({ current: { ...BASE_CURRENT, phone: null } })} />)

    expect(screen.getByLabelText('電話番号')).toBeTruthy()
    expect(
      screen.getByText('未入力です。登録するには入力が必要です'),
    ).toBeTruthy()

    const btn = screen.getByRole('button', { name: '未入力の項目があります' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('段位は級が A のときだけ必須になる', () => {
    render(
      <RenewalForm
        view={baseView({ current: { ...BASE_CURRENT, grade: 'A', dan: null } })}
      />,
    )
    expect(screen.getByLabelText('段位')).toBeTruthy()
    const btn = screen.getByRole('button', { name: '未入力の項目があります' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('「今年度は登録しない」を選ぶと必須欠落があってもボタンは有効になる', () => {
    render(<RenewalForm view={baseView({ current: { ...BASE_CURRENT, phone: null } })} />)

    fireEvent.click(screen.getByRole('radio', { name: /今年度は登録しない/ }))

    const btn = screen.getByRole('button', { name: 'この内容で回答する' }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })
})

describe('最終学年で3択（AC-11）', () => {
  it('現在の学年が最終学年なら進学／卒業／留年の3択になる', () => {
    render(
      <RenewalForm
        view={baseView({
          current: {
            ...BASE_CURRENT,
            facultyKind: 'undergraduate',
            faculty: '工学部',
            schoolYear: '4年',
          },
        })}
      />,
    )

    expect(screen.getByRole('radio', { name: /進学する/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /卒業する/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /留年/ })).toBeTruthy()
  })

  it('最終学年でなければ「現在 → 4月から（既定 +1）」の1行表示になる（3択にならない）', () => {
    render(<RenewalForm view={baseView()} />)

    // 2年 → 既定は 3年。既定表示のうちは例外のラジオを出さない（design-spec §3）。
    expect(screen.getByText('4月から')).toBeTruthy()
    expect(screen.getByText('3年')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /進学する/ })).toBeNull()
    expect(screen.queryByText('3年に進む')).toBeNull()
  })

  it('非最終学年でも「学部等名を変える」を開くと 既定／自分で選ぶ／離れる の3択になる', () => {
    render(<RenewalForm view={baseView()} />)

    fireEvent.click(screen.getByRole('button', { name: '学部等名を変える' }))

    expect(screen.getByText('3年に進む')).toBeTruthy()
    expect(screen.getByText('学年を自分で選ぶ')).toBeTruthy()
    expect(screen.getByText('サークルを離れる')).toBeTruthy()
    // 最終学年ではないので「進学する」は出ない。
    expect(screen.queryByRole('radio', { name: /進学する/ })).toBeNull()
  })
})

describe('回答済み表示', () => {
  it('回答済みは状態バーが「回答済み」になり、差分のある行は前→後で表示される', () => {
    render(
      <RenewalForm
        view={baseView({
          isCircleTarget: false,
          answer: 'register',
          answeredAtIso: '2027-03-12T03:00:00.000Z',
          diff: [
            {
              field: 'address1',
              label: '住所1',
              before: '北海道札幌市北区北17条西3-1-38',
              after: '東京都葛飾区亀有5丁目38-6',
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('回答済み')).toBeTruthy()
    expect(screen.getByText('北海道札幌市北区北17条西3-1-38')).toBeTruthy()
    expect(screen.getByText('東京都葛飾区亀有5丁目38-6')).toBeTruthy()
    // 回答済みは表示専用（状態バーの「修正」だけがあり、行内の「修正」は出ない）。
    expect(screen.getAllByRole('button', { name: '修正' })).toHaveLength(1)
  })

  it('完了後（status=completed）は修正リンクも出ず閲覧専用になる', () => {
    render(
      <RenewalForm
        view={baseView({
          isCircleTarget: false,
          status: 'completed',
          answer: 'register',
          answeredAtIso: '2027-03-12T03:00:00.000Z',
        })}
      />,
    )

    expect(screen.queryByRole('button', { name: '修正' })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
