import { z } from 'zod'
import {
  EMPTY_RENEWAL_SNAPSHOT,
  RENEWAL_SNAPSHOT_VERSION,
  ROSTER_FIELD_LABELS,
  type FacultyKind,
  type Gender,
  type Grade,
  type RenewalSnapshot,
} from '@kagetra/shared'

/**
 * `RenewalSnapshot` の組み立てと読み出し検証（DB 非依存）。
 *
 * `membership_renewal_members.snapshot` は jsonb 列で型情報を持たないため、
 * DB から読み出した値を信用せず zod で検証する（`packages/shared` は zod に
 * 依存しないため、この検証境界は `apps/web` 側＝ここに置く。
 * implementation-plan タスク1・2 の分担どおり）。
 */

/** `users` の該当列だけを持つ read-only な形（DB 行から取り出す入力）。 */
export type RenewalSnapshotSource = {
  familyName: string | null
  givenName: string | null
  familyKana: string | null
  givenKana: string | null
  birthDate: string | null
  gender: Gender | null
  dan: number | null
  grade: Grade | null
  postalCode: string | null
  address1: string | null
  address2: string | null
  phone: string | null
  facultyKind: FacultyKind | null
  faculty: string | null
  schoolYear: string | null
}

/**
 * `users` の現在値からスナップショットを組み立てる（年度確認の開始時に呼ぶ）。
 * `EMPTY_RENEWAL_SNAPSHOT` を土台に**全キーを明示**することで、将来キーが
 * 増えたときにここを直し忘れるとキー欠落ではなく型エラーで気づけるようにする。
 * `undefined`（呼び出し側の取りこぼし）は `null` へ寄せる。
 */
export function buildRenewalSnapshot(source: RenewalSnapshotSource): RenewalSnapshot {
  return {
    ...EMPTY_RENEWAL_SNAPSHOT,
    familyName: source.familyName ?? null,
    givenName: source.givenName ?? null,
    familyKana: source.familyKana ?? null,
    givenKana: source.givenKana ?? null,
    birthDate: source.birthDate ?? null,
    gender: source.gender ?? null,
    dan: source.dan ?? null,
    grade: source.grade ?? null,
    postalCode: source.postalCode ?? null,
    address1: source.address1 ?? null,
    address2: source.address2 ?? null,
    phone: source.phone ?? null,
    facultyKind: source.facultyKind ?? null,
    faculty: source.faculty ?? null,
    schoolYear: source.schoolYear ?? null,
  }
}

const nullableString = z.string().nullable()

/**
 * `RenewalSnapshot` の zod スキーマ。キーは固定（`.strict()` は使わないが、
 * `z.object` の既定動作＝未知キーは strip されるので、DB 側に将来キーが増えても
 * ここを直すまでは無視される。**キーが減る**（型不一致）方向の壊れ方は
 * 各フィールドの型チェックで弾かれる）。`v` は `RENEWAL_SNAPSHOT_VERSION` の
 * リテラルのみ受け入れる。
 */
export const renewalSnapshotSchema: z.ZodType<RenewalSnapshot> = z.object({
  v: z.literal(RENEWAL_SNAPSHOT_VERSION),
  familyName: nullableString,
  givenName: nullableString,
  familyKana: nullableString,
  givenKana: nullableString,
  birthDate: nullableString,
  gender: z.enum(['male', 'female']).nullable(),
  dan: z.number().nullable(),
  grade: z.enum(['A', 'B', 'C', 'D', 'E']).nullable(),
  postalCode: nullableString,
  address1: nullableString,
  address2: nullableString,
  phone: nullableString,
  facultyKind: z.enum(['undergraduate', 'graduate']).nullable(),
  faculty: nullableString,
  schoolYear: nullableString,
})

/** 検証して `RenewalSnapshot` を返す。不正なら throw（`ZodError`）。 */
export function parseRenewalSnapshot(value: unknown): RenewalSnapshot {
  return renewalSnapshotSchema.parse(value)
}

/** 検証して `RenewalSnapshot` を返す。不正なら `null`（throw しない）。 */
export function safeParseRenewalSnapshot(value: unknown): RenewalSnapshot | null {
  const result = renewalSnapshotSchema.safeParse(value)
  return result.success ? result.data : null
}

/** 「登録する」に必要な項目（R3）。段位は A 級のみ必須なので別扱い。 */
const REGISTER_REQUIRED_FIELDS = [
  'familyName',
  'givenName',
  'familyKana',
  'givenKana',
  'birthDate',
  'gender',
  'grade',
  'postalCode',
  'address1',
  'phone',
] as const

/**
 * 「登録する」の必須検証（AC-5）。欠けている項目のラベルを返す（空なら充足）。
 * 形式検証は `lib/member-profile-fields.ts` が済ませている前提で、ここは
 * **必須の有無だけ**を見る（管理者編集は同じ列を任意で扱うため、必須はこの
 * 経路だけの関心事）。
 *
 * DB に触れないのでここ（snapshot.ts）に置く。S2 の会員行（`MemberRow.tsx`）が
 * クライアントバンドルから呼ぶため、`store.ts`（`db` を import する）に置くと
 * `pg` がクライアント側に巻き込まれて `next build` が `Module not found: 'net'` で落ちる。
 */
export function findMissingRegisterFields(source: RenewalSnapshotSource): string[] {
  const missing: string[] = []
  for (const field of REGISTER_REQUIRED_FIELDS) {
    const value = source[field]
    if (value === null || value === '') missing.push(ROSTER_FIELD_LABELS[field])
  }
  // 段位は A 級のみ必須（既存の登録フローと同じ規則）。
  if (source.grade === 'A' && (source.dan === null || source.dan === 0)) {
    missing.push(ROSTER_FIELD_LABELS.dan)
  }
  return missing
}
