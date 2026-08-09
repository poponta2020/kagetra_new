import { resolveOpenChatLabel, type OpenChatGrade } from '@/lib/open-chat/label'
import { SectionRule } from '@/components/events/detail'

/**
 * openchat-broadcast タスク10: 大会詳細の保存済みオープンチャット行
 * （requirements §3.2.1・§3.2.6）の会員向け DTO。表示に使う列だけを持つ——
 * `source` / `sourceMailMessageId`（取込元メールの監査用）は会員向け表示に
 * 出さない列なので、この型にも含めない（`entry-group-open-chats.ts` のコメント）。
 *
 * ★`sortOrder` を意図的に含めない。並び順は呼び出し側（page.tsx）の
 * `ORDER BY sort_order, id` が唯一の正で、このコンポーネントは受け取った
 * 配列順のまま描画し一切 sort しない（AC-52 の契約）。sortOrder が無ければ
 * ここで並べ替えようにも並べ替えられない、という形で契約を強制する。
 */
export interface OpenChatLinkView {
  id: number
  url: string
  /** 未指定 = 全級共通。 */
  grades: OpenChatGrade[] | null
  /** 未指定 = 全日共通。 */
  eventDate: string | null
  /** 人が入力した自由ラベル。空なら resolveOpenChatLabel が自動生成する。 */
  label: string | null
  password: string | null
}

/**
 * openchat-broadcast タスク10: 大会詳細の保存済みオープンチャット欄
 * （requirements §3.2.6・AC-42/AC-43/AC-45/AC-51/AC-52。視覚の正 =
 * design-mock/event-detail.html）。
 *
 * - **表示のみ**。追加・編集・削除の導線は置かない（AC-43。編集はメール詳細の
 *   抽出フローからのみ）
 * - **閲覧はログイン済みの全会員**（AC-42）。境界は `/events/[id]` を包む
 *   `(app)` レイアウトの認証必須ガードのみで、ここで role 判定を足さない
 *   （requirements §3.2.7）
 * - **開催日で絞らない**（AC-29）。呼び出し側が申込グループ全行を渡す
 * - **1件も無いときは見出しごと出さない**（AC-51。「未設定」は「運営が忘れて
 *   いる」と読ませる ── design-spec の不採用理由）
 * - **DB 非依存**。フックも状態も持たない Server Component（`'use client'` を
 *   付けない）ので RSC payload にも props 以上のものは載らない
 */
export function OpenChatSection({ rows }: { rows: OpenChatLinkView[] }) {
  if (rows.length === 0) return null

  return (
    <SectionRule title="オープンチャット" aux={`${rows.length}件`}>
      <ul>
        {rows.map((row) => {
          const { label } = resolveOpenChatLabel({
            grades: row.grades,
            eventDate: row.eventDate,
            freeLabel: row.label,
          })
          return (
            <li
              key={row.id}
              className="border-t border-border-soft first-of-type:border-t-0"
            >
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 py-[11px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-brand-fg">
                    {label}
                  </span>
                  {row.password && (
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-meta">
                      {`パスワード ${row.password}`}
                    </span>
                  )}
                </span>
                <span className="flex-none text-[10px] text-ink-meta">開く ↗</span>
              </a>
            </li>
          )
        })}
      </ul>
      <p className="mt-[9px] text-[10px] leading-[1.7] text-ink-meta">
        申込グループ全体のオープンチャットを表示しています。
      </p>
    </SectionRule>
  )
}
