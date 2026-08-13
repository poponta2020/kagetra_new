import { NextResponse } from 'next/server'
import type { Grade } from '@kagetra/shared/types'
import { verifyExternalApiKey } from '@/lib/external-api-key'
import { todayInJst } from '@/lib/jst-date'
import { getUpcomingEntrants } from '@/lib/upcoming-entrants'
// 表示名（通称 + 対象級）はホーム・申込ボードと同じ唯一の実装を再利用する
// （再実装禁止 — requirements §6）。
import { displayName } from '@/app/(app)/admin/entries/entry-board-utils'

// GET のみの route handler は静的最適化の対象になり、ビルド時に DB へ接続しに
// 行ってしまうため、明示的に動的へ固定する。
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 公開契約の 1 出場予定（docs/spec/external-api.md が正典）。 */
interface ExternalEntry {
  eventId: number
  /** `YYYY-MM-DD` */
  eventDate: string
  /** ホーム・申込ボードと同じ導出（通称 + 級） */
  displayName: string
  /** その人の掲載根拠。名簿由来 = confirmed / 出欠回答由来 = hoped */
  confidence: 'confirmed' | 'hoped'
}

/** 公開契約の 1 人（PII は name / kana / grade / isGuest / userId に限定）。 */
interface ExternalPerson {
  userId: string
  name: string | null
  familyKana: string | null
  givenKana: string | null
  /** 現在の `users.grade`（名簿行の級ではない）。 */
  grade: Grade | null
  isGuest: boolean
  entries: ExternalEntry[]
}

/** `sv-SE` は `YYYY-MM-DD HH:mm:ss`。Asia/Tokyo 固定なのでオフセットは常に +09:00。 */
function nowInJstIso(now: Date = new Date()): string {
  return `${now.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace(' ', 'T')}+09:00`
}

/**
 * GET /api/external/tournament-entrants — 大会出場予定者（match-tracker 連携）。
 *
 * kagetra は「事実」（誰が・いつ・どの大会に出る予定か）だけを返す。優先枠
 * ウィンドウ判定（n月+翌月15日ルール）・名寄せ・デフォルト選択 UI は消費側
 * （match-tracker）の責務 — ここにポリシーを持たせない（requirements §1）。
 *
 * - 認証: 静的 API キー（`Authorization: Bearer`・fail-closed）。セッション
 *   認証とは独立の経路で、middleware の matcher から除外されている。
 * - 母集団: ホーム出場タイムラインと同一の導出（`getUpcomingEntrants`）。
 *   期間は当月1日（JST）以降・終点なし — 月中の抽選やり直しでも月初の大会
 *   参加者が欠落しない（requirements §7）。
 * - レスポンス: 人単位。persons は name の ja ロケール昇順、entries は
 *   eventDate 昇順。出場予定が 1 件以上ある人だけを載せる。
 */
export async function GET(request: Request) {
  if (!verifyExternalApiKey(request.headers.get('authorization'))) {
    // 401 の本文にヒントを含めない（AC-2）。
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const monthStart = `${todayInJst().slice(0, 8)}01`
  const events = await getUpcomingEntrants({ since: monthStart })

  // イベント単位 → 人単位へ束ねる。同一人物×同一イベントの dedupe は
  // getUpcomingEntrants がイベント内で保証済み（AC-7）なので、ここでは
  // event × entrant を素直に積むだけでよい。
  const byUserId = new Map<string, ExternalPerson>()
  for (const e of events) {
    for (const entrant of e.entrants) {
      let person = byUserId.get(entrant.userId)
      if (!person) {
        person = {
          userId: entrant.userId,
          name: entrant.name,
          familyKana: entrant.familyKana,
          givenKana: entrant.givenKana,
          // 契約の grade は「現在の級」。名簿行の級（entryGrade）と混ぜない
          // （実装手順書「導出共通化」— 混ぜると契約が壊れる）。
          grade: entrant.userGrade,
          isGuest: entrant.isGuest,
          entries: [],
        }
        byUserId.set(entrant.userId, person)
      }
      person.entries.push({
        eventId: e.id,
        eventDate: e.eventDate,
        displayName: displayName(e),
        confidence: entrant.basis === 'roster' ? 'confirmed' : 'hoped',
      })
    }
  }

  const persons = [...byUserId.values()].sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? '', 'ja'),
  )
  for (const p of persons) {
    p.entries.sort(
      (a, b) =>
        (a.eventDate < b.eventDate ? -1 : a.eventDate > b.eventDate ? 1 : 0) ||
        a.eventId - b.eventId,
    )
  }

  return NextResponse.json(
    { generatedAt: nowInJstIso(), persons },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
