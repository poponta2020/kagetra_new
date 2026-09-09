import { z } from 'zod'

/**
 * 会員プロフィール（全日協の名簿に載る列）の**形式検証**の正典。
 *
 * 同じ列へ書く経路が 3 つある——管理者の会員編集（`admin/members/[id]/edit`）、
 * 招待リンクの自己登録（`register/[token]`）、年度確認の行内修正（`/renewal`）——
 * ので、形式規則をここ 1 箇所に集める（annual-registration-renewal の
 * 実装手順書「必須検証は既存の zod を流用する。二重定義しない」）。
 *
 * ★**必須／任意はここで決めない。** 各フィールドは `.nullable()`（値が来たときだけ
 * 形式を見る）で、必須の強制は呼び出し側の関心事:
 *   - 管理者編集: 全項目が任意（後から直せる画面という性質）
 *   - 自己登録・年度確認の「登録する」: 呼び出し側が `superRefine` で必須を足す
 * ここを必須寄りに変えると管理者編集の既存挙動が壊れる。
 */

export const MEMBER_GRADES = ['A', 'B', 'C', 'D', 'E'] as const
export const MEMBER_GENDERS = ['male', 'female'] as const

/** invite-register-redesign: ひらがな（小書き含む）＋長音記号 ー のみ。 */
const HIRAGANA_RE = /^[ぁ-ゖー]+$/
const PHONE_RE = /^[0-9-]+$/

/**
 * FormData の値を strict な zod へ渡せる形に正規化する。
 * 未入力・空文字は `null`（nullable が受ける）、それ以外は trim した文字列。
 */
export function formEntryOrNull(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return s.length === 0 ? null : s
}

/**
 * `YYYY-MM-DD` が実在する暦日で、1900 年以降・未来でないこと。
 * 登録フローの `validateBirthDate` と同じ規則（同じ列へ書く経路が同じ値を拒否する）。
 */
export function isRealYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d ||
    y < 1900
  ) {
    return false
  }
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return dt.getTime() <= todayUtc
}

/**
 * 名簿の列（`ROSTER_FIELDS`）の形式スキーマ。エラーメッセージは会員編集の既存文言を
 * そのまま引き継ぐ（同じ入力に同じ日本語が返る）。
 */
export const memberProfileFieldSchemas = {
  familyName: z.string().trim().max(20, '姓は20文字以内で入力してください').nullable(),
  givenName: z.string().trim().max(20, '名は20文字以内で入力してください').nullable(),
  familyKana: z
    .string()
    .trim()
    .max(30, 'せいは30文字以内で入力してください')
    .regex(HIRAGANA_RE, 'せい（ふりがな）はひらがなで入力してください')
    .nullable(),
  givenKana: z
    .string()
    .trim()
    .max(30, 'めいは30文字以内で入力してください')
    .regex(HIRAGANA_RE, 'めい（ふりがな）はひらがなで入力してください')
    .nullable(),
  birthDate: z.union([
    z.string().refine(isRealYmd, '生年月日が正しくありません'),
    z.null(),
  ]),
  gender: z.enum(MEMBER_GENDERS).nullable(),
  // 段位は厳密に 0〜9 の整数。'3abc' / '3.5' / 負数は拒否する
  // （空文字は null、非数値は NaN にして zod の int() に落とさせる）。
  dan: z.preprocess((v) => {
    if (v === null) return null
    if (typeof v !== 'string') return v
    const s = v.trim()
    if (s.length === 0) return null
    if (!/^\d+$/.test(s)) return Number.NaN
    return Number.parseInt(s, 10)
  }, z.union([z.number().int().min(0).max(9), z.null()])),
  grade: z.enum(MEMBER_GRADES).nullable(),
  // 郵便番号はハイフン/空白を除いた 7 桁へ正規化して保存する。
  postalCode: z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : v),
    z.union([z.string().regex(/^\d{7}$/, '郵便番号は7桁で入力してください'), z.null()]),
  ),
  address1: z.string().trim().max(100, '住所は100文字以内で入力してください').nullable(),
  address2: z
    .string()
    .trim()
    .max(100, '建物名・部屋番号は100文字以内で入力してください')
    .nullable(),
  phone: z
    .string()
    .trim()
    .regex(PHONE_RE, '電話番号は数字とハイフンで入力してください')
    .refine((s) => {
      const d = s.replace(/-/g, '')
      return d.length >= 10 && d.length <= 13
    }, '電話番号の桁数が不正です（10〜13桁）')
    .nullable(),
} as const
