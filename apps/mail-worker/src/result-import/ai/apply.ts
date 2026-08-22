import type { ParsedClass, ParsedResultPayload } from '../schema.js'
import type { ClassMapEntry } from './routing-schema.js'

/**
 * ルーティング AI が返した classMap を、決定的パーサの payload へ適用する
 * 純関数(AC-1)。
 *
 * - classMap は `className` で `payload.classes` と完全一致で突合する。
 *   一致しないエントリ(payload に存在しない className)は無視する。
 * - 一致したクラス: `rawClassName` に元の className を保持したうえで、
 *   `className` を `normalizedClassName` に差し替え、`grade` を classMap の
 *   grade に差し替える。
 * - `exclude: true` のクラスは結果配列から除外する。
 * - classMap に載っていないクラスはそのまま(rawClassName も付けない)。
 * - 入力(`payload`)を破壊しない。
 */
export function applyClassMap(
  payload: ParsedResultPayload,
  classMap: ClassMapEntry[],
): ParsedResultPayload {
  const entryByClassName = new Map<string, ClassMapEntry>()
  for (const entry of classMap) {
    entryByClassName.set(entry.className, entry)
  }

  const classes: ParsedClass[] = []
  for (const cls of payload.classes) {
    const entry = entryByClassName.get(cls.className)
    if (!entry) {
      classes.push(cls)
      continue
    }
    if (entry.exclude) {
      continue
    }
    classes.push({
      ...cls,
      className: entry.normalizedClassName,
      grade: entry.grade,
      rawClassName: cls.className,
    })
  }

  return {
    ...payload,
    classes,
  }
}
