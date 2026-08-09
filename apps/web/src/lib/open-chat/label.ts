/**
 * openchat-broadcast: 表示ラベルの自動生成・最終ラベルの解決・重複判定を行う純関数群
 * （requirements.md §3.2.1・AC-21〜AC-24・AC-47〜AC-49）。
 *
 * ★このファイルは `'use client'` の抽出候補シートから import される
 * **DB 非依存の leaf** でなければならない。共有スキーマパッケージや ORM、DB クライアント
 * モジュールへの値 import（型 import も含む）を書くと、client バンドルへ DB 依存が漏れる。
 * これは eslint / vitest / check-types のどれでも検知できず `next build` で初めて壊れる
 * （既知の罠。`apps/web/src/app/(app)/admin/mail-inbox/roster-adopt-utils.ts` 冒頭の
 * コメント参照）。そのため級の型も共有パッケージから取らず、このファイル内で自前定義する。
 *
 * 実装手順書には「roster-adopt-utils.ts の `RosterAdoptGrade` を再利用する」とあるが、
 * それは `app/` 配下のファイルで `lib/` → `app/` の逆方向 import になるため、
 * main の判断でローカル定義に変更した。
 *
 * `Date.now()` / 引数無し `new Date()` も読まない（日付文字列はサーバーが注入する
 * 既存規約。roster-adopt-utils.ts と同じ方針）。`formatEventDate`（`@/lib/event-date`）は
 * 外部依存の無い純関数で、既に多数の client コンポーネントから import されている
 * leaf 実績があるため再利用する（`M/D(曜)` の重複実装を避ける）。
 */

import { formatEventDate } from '@/lib/event-date'

export type OpenChatGrade = 'A' | 'B' | 'C' | 'D' | 'E'

const OPEN_CHAT_GRADE_ORDER: readonly OpenChatGrade[] = ['A', 'B', 'C', 'D', 'E']
const GRADE_SET: ReadonlySet<string> = new Set(OPEN_CHAT_GRADE_ORDER)

/** dedupe + A→E 昇順に正規化する。未知の値は落とす（roster-adopt-utils.ts の normalizeGrades と同じ手口）。 */
function normalizeGrades(grades: readonly string[]): OpenChatGrade[] {
  const set = new Set(grades.filter((g): g is OpenChatGrade => GRADE_SET.has(g)))
  return OPEN_CHAT_GRADE_ORDER.filter((g) => set.has(g))
}

/** 級ラベル。['D'] → 'D級' / ['A','B'] → 'A・B級' / 空配列 → ''。 */
export function formatOpenChatGradeLabel(grades: readonly OpenChatGrade[]): string {
  const normalized = normalizeGrades(grades)
  if (normalized.length === 0) return ''
  return `${normalized.join('・')}級`
}

/**
 * 級・開催日ともに未指定のときに使う既定ラベル（requirements.md §3.2.1）。
 * 「団体戦 / 1年 / 選抜の部」等の部門別の分かれ方はこの値になり、そのまま複数行
 * 並ぶと全行同一になる — それを検出するのが {@link findDuplicateOpenChatLabelIds}。
 */
export const OPEN_CHAT_DEFAULT_LABEL = 'オープンチャットに参加'

/**
 * 級・開催日から自動ラベルを組み立てる（AC-21・AC-22・AC-24）。
 * - 両方あり → `6/20(土) C級`
 * - 級のみ → `C級`
 * - 日付のみ → `6/20(土)`
 * - どちらも無し → `オープンチャットに参加`（全級・全日共通の意味）
 */
export function buildAutoOpenChatLabel(
  grades: readonly OpenChatGrade[] | null | undefined,
  eventDate: string | null | undefined,
): string {
  const gradeLabel = grades && grades.length > 0 ? formatOpenChatGradeLabel(grades) : ''
  const dateLabel = eventDate ? formatEventDate(eventDate) : ''
  if (dateLabel && gradeLabel) return `${dateLabel} ${gradeLabel}`
  if (gradeLabel) return gradeLabel
  if (dateLabel) return dateLabel
  return OPEN_CHAT_DEFAULT_LABEL
}

/** 1行分の入力（級・開催日・自由ラベル）。保存前の候補行・保存済み行の両方に使う共通形。 */
export interface OpenChatLabelInput {
  /** 未指定 = 全級共通。 */
  grades: readonly OpenChatGrade[] | null
  /** 未指定 = 全日共通。 */
  eventDate: string | null
  /** 人が入力した表示ラベル。空文字・空白のみは未入力扱い。 */
  freeLabel: string | null
}

export interface ResolvedOpenChatLabel {
  /** 最終的に Flex のボタン名になる値。 */
  label: string
  /**
   * true なら freeLabel が未入力で自動生成した値。design-spec の忠実度チェックリスト
   * 「自動生成ラベルは手入力ラベルより細く・淡い」の判定に UI が使う。
   */
  isAuto: boolean
}

/**
 * 最終ラベルを解決する（AC-23）。自由ラベルが空でなければそれを使い、空なら
 * 自動生成値を使う。呼び出し側が「自動生成だったか」を区別できるよう isAuto を返す。
 */
export function resolveOpenChatLabel(input: OpenChatLabelInput): ResolvedOpenChatLabel {
  const trimmed = input.freeLabel?.trim() ?? ''
  if (trimmed) return { label: trimmed, isAuto: false }
  return { label: buildAutoOpenChatLabel(input.grades, input.eventDate), isAuto: true }
}

/** 重複判定の対象行。`id` は UI 側で行を一意に識別するキー（配列 index で十分な場合はそれを渡す）。 */
export type OpenChatDuplicateCheckRow<Id extends string | number> = OpenChatLabelInput & { id: Id }

/**
 * 行の配列から、最終ラベル（＝自動生成後の値。AC-23 の解決を経た値）が重複している
 * 行の id 集合を返す（AC-47・AC-48）。級でも開催日でもない分かれ方（部門別）では
 * 自動ラベルが全行 `オープンチャットに参加` になり、そのまま配信すると同じ名前の
 * ボタンが並ぶ Flex が届く — それを保存前に弾くのがこの関数の存在理由。
 * 自由ラベルを入れて最終ラベルが変われば重複は解消する（AC-49）。
 */
export function findDuplicateOpenChatLabelIds<Id extends string | number>(
  rows: readonly OpenChatDuplicateCheckRow<Id>[],
): Set<Id> {
  const idsByLabel = new Map<string, Id[]>()
  for (const row of rows) {
    const { label } = resolveOpenChatLabel(row)
    const ids = idsByLabel.get(label)
    if (ids) ids.push(row.id)
    else idsByLabel.set(label, [row.id])
  }

  const duplicated = new Set<Id>()
  for (const ids of idsByLabel.values()) {
    if (ids.length < 2) continue
    for (const id of ids) duplicated.add(id)
  }
  return duplicated
}
