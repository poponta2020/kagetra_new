import { boolean, integer, pgTable, timestamp } from 'drizzle-orm/pg-core'

/**
 * entry_groups: 申込グループ。
 *
 * 大会は開催日ごとに別 events 行として登録されるが、実運用の申込・締切・名簿・
 * 抽選・LINE 連絡は「同じ案内メール × 同じ申込締切」のまとまり単位で行われる
 * （例: 多摩A/B〔締切 7/11〕と 多摩C/D/E〔締切 7/5〕は別グループ）。その単位を
 * 表す**薄い基盤**テーブル。
 *
 * 意図的に持たない列:
 * - **表示名は保存しない**。グループ内 events のタイトルから導出する
 *   （`deriveEntryGroupName`）。運用中に日が増減しても名前が stale にならない
 * - 締切・支払い系のカラムも持たない。会員向け一覧・編集フォーム・AI 抽出を
 *   ほぼ無傷に保つため events 側に残し、「同じ締切」は生成規則と伝播ダイアログで
 *   運用的に維持する（requirements §7）
 *
 * 例外として `confirmed_roster_override` だけをグループが持つ（confirmed-roster-signal）。
 * 「確定名簿あり」の判定材料——パース済み名簿・採用済み原本ファイル・確定名簿メール——は
 * **すべてグループスコープ**なので、手動フラグだけを events に置くと
 * 「グループ内のどの日から見ても同じ結果になる」という不変条件（entry-management AC-17）が
 * 壊れる。薄さより不変条件を優先してここに置く。
 *
 * `events.entry_group_id` は NOT NULL。単独イベント（会内行事・手動作成）にも
 * 必ずシングルトングループを作る — 「グループあり/なし」の分岐をコードから消し、
 * LINE 紐付け・名簿・リマインドを常にグループ単位で書けるようにするため。
 */
export const entryGroups = pgTable('entry_groups', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  /**
   * confirmed-roster-signal: 「確定名簿ありとして扱う」手動フラグ（管理者トグル）。
   * 名簿レコードも確定名簿メールも無いが、別経路（会場掲示・口頭・他会からの連絡）で
   * 確定を知ったときの逃げ道。`true` なら他の材料が無くても「確定名簿あり」になる
   * （判定の正典は `apps/web/src/lib/events/confirmed-roster.ts`）。
   *
   * 誰がいつ立てたかは**記録しない**（運用は1人。要件 §5 Non-goals）。
   * `undoTriage`（メールの未処理戻し）の対象外——人が明示的に立てたものは残す。
   */
  confirmedRosterOverride: boolean('confirmed_roster_override').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow(),
})
