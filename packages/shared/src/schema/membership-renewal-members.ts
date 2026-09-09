import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { facultyKindEnum, renewalAnswerEnum, renewalSchoolYearKindEnum } from './enums'
import { membershipRenewals } from './membership-renewals'
import { users } from './auth'
import type { RenewalSnapshot } from '../types'

/**
 * membership_renewal_members: 年度確認の対象者 1 人分（開始時に確定・R1）。
 *
 * 対象集合を開始時点で固定するためのテーブル。開始後に `users` のフラグが動いても
 * 行は増減しない（「該当する前年度登録会員の全員が終わったか」の母数が動かない
 * ことが集計の前提）。全日協セクションと学年セクションはフラグ 2 本で表し、
 * 両方 false の行は作らない。
 *
 * `user_id` は **CASCADE**。誤登録リカバリの `deleteMember`（参照ゼロのときだけ
 * 会員行を物理削除する）を、年度確認の行が塞がないようにする意図的な選択で、
 * 「参照があれば拒否」の既存リストにもこのテーブルを足さない（implementation-plan
 * の技術設計で確定）。
 */
export const membershipRenewalMembers = pgTable(
  'membership_renewal_members',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    renewalId: integer('renewal_id')
      .notNull()
      .references(() => membershipRenewals.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 全日協セクションの対象（開始時に `zen_nichikyo` だった）。 */
    isZennichikyoTarget: boolean('is_zennichikyo_target').notNull().default(false),
    /** 学年セクションの対象（開始時に `is_circle_member` だった）。 */
    isCircleTarget: boolean('is_circle_target').notNull().default(false),
    /**
     * 開始時点の名簿の列＋学年（差分表示の基準）。キーは固定で、値が無い項目も
     * `null` を明示的に持つ（`EMPTY_RENEWAL_SNAPSHOT` が土台）。
     * 住所・電話・生年月日を含む **PII** なので `users` と同じ扱いにする
     * ——本人と admin/vice_admin 以外の RSC payload へ渡さない・ログに出さない。
     * 読み出し時の検証は `apps/web/src/lib/membership-renewal/snapshot.ts` の zod。
     */
    snapshot: jsonb('snapshot').$type<RenewalSnapshot>().notNull(),

    // ── 全日協セクションの回答 ──────────────────────────────────────
    /** 未回答は NULL。登録完了まで何度でも上書きできる（R3）。 */
    answer: renewalAnswerEnum('answer'),
    answeredAt: timestamp('answered_at', { mode: 'date', withTimezone: true }),
    /** 実際に操作した人（本人 or 代理の管理者）。会員削除で SET NULL。 */
    answeredByUserId: text('answered_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** 管理者の代理回答なら true（R6。`answered_by_user_id` とは別に残す）。 */
    answeredByAdmin: boolean('answered_by_admin').notNull().default(false),

    // ── 学年セクションの回答（R4）────────────────────────────────────
    schoolYearKind: renewalSchoolYearKindEnum('school_year_kind'),
    /**
     * 反映する学年・学部は**絶対値**で保存する。3 月の回答を 4/1 に反映する
     * までの間に基準値が動いても、本人が答えた値がそのまま入る（種別からの
     * 再計算をしない）。`leave`（卒業）のときは 3 列とも NULL。
     */
    nextFacultyKind: facultyKindEnum('next_faculty_kind'),
    nextFaculty: text('next_faculty'),
    nextSchoolYear: text('next_school_year'),
    schoolYearAnsweredAt: timestamp('school_year_answered_at', {
      mode: 'date',
      withTimezone: true,
    }),
    /**
     * `users` へ反映した日時。NULL＝未反映。4/1 以降の日次バッチと、4/1 以降の
     * 回答の即時反映が、この列の NULL を条件にした CAS で二重反映を防ぐ。
     */
    schoolYearAppliedAt: timestamp('school_year_applied_at', {
      mode: 'date',
      withTimezone: true,
    }),

    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('membership_renewal_members_renewal_user_unique').on(t.renewalId, t.userId)],
)
