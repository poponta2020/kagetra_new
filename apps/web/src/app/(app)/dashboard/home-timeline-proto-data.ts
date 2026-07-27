// DESIGN-PROTO: このファイルまるごとがプロトタイプ用のダミーデータ源。
// 実装時は削除し、page.tsx の `loadHomeTimeline()` 呼び出しを実クエリへ置換する
// （母集団・絞り込みの規約は home-timeline-types.ts の doc コメントに書いてある）。
// 会員名・大会名・会場はすべて**架空**（実在の会員・大会を混ぜない）。
import type { Grade } from '@kagetra/shared/types'
import type {
  HomeEntrant,
  HomeTimelineData,
  HomeTimelineEvent,
} from './home-timeline-types'

// DESIGN-PROTO: プロトタイプの閲覧者。実装時は `session.user.id`。
const VIEWER_ID = 'proto-viewer'

// DESIGN-PROTO: 架空の会員（姓のみ = `surname()` 適用後の形）。
function m(surname: string, grade: Grade | null): HomeEntrant {
  return { userId: `proto-${surname}`, surname, grade }
}
const VIEWER: HomeEntrant = { userId: VIEWER_ID, surname: '宮下', grade: 'C' }

// DESIGN-PROTO: 架空の大会・会場・日付（今日 = 2026-07-28 前提で組んである）。
const TODAY_EVENT: HomeTimelineEvent = {
  eventId: 901,
  displayName: '北光AB',
  eventDate: '2026-07-28',
  venue: '市民体育センター 第2競技場',
  confidence: 'confirmed',
  entrants: [
    m('佐々木', 'A'),
    m('白石', 'A'),
    m('長谷川', 'B'),
    m('岡田', 'B'),
    m('工藤', 'B'),
  ],
}

const UPCOMING: HomeTimelineEvent[] = [
  {
    eventId: 902,
    displayName: '石狩CD',
    eventDate: '2026-08-02',
    venue: '石狩市民会館',
    confidence: 'confirmed',
    entrants: [
      m('井上', 'C'),
      VIEWER,
      m('森本', 'C'),
      m('小野寺', 'D'),
      m('三浦', 'D'),
      m('及川', 'D'),
      m('荒井', 'D'),
    ],
  },
  {
    eventId: 903,
    displayName: '大通杯A',
    eventDate: '2026-08-09',
    venue: '中央区民センター',
    confidence: 'confirmed',
    entrants: [m('佐々木', 'A'), m('白石', 'A'), m('藤原', 'A')],
  },
  {
    eventId: 904,
    displayName: 'みやこ選手権BC',
    eventDate: '2026-08-23',
    venue: '総合体育館',
    confidence: 'hoped',
    entrants: [
      m('長谷川', 'B'),
      m('岡田', 'B'),
      m('工藤', 'B'),
      m('大橋', 'B'),
      m('井上', 'C'),
      VIEWER,
      m('森本', 'C'),
      m('桜庭', 'C'),
      m('上村', 'C'),
    ],
  },
  {
    eventId: 905,
    displayName: '雪嶺E',
    eventDate: '2026-09-06',
    venue: 'north区民センター',
    confidence: 'hoped',
    entrants: [m('渡辺', 'E'), m('宮川', 'E')],
  },
  {
    eventId: 906,
    displayName: '藻岩CD',
    eventDate: '2026-09-13',
    venue: '南区スポーツセンター',
    confidence: 'hoped',
    entrants: [m('井上', 'C'), VIEWER, m('小野寺', 'D'), m('及川', 'D')],
  },
  {
    eventId: 907,
    displayName: '道央オープンAB',
    eventDate: '2026-09-27',
    venue: '道央総合体育館',
    confidence: 'hoped',
    entrants: [m('佐々木', 'A'), m('藤原', 'A'), m('大橋', 'B'), m('工藤', 'B')],
  },
]

// DESIGN-PROTO: つらいケース再現用。長い大会名 + 大人数 + 3〜4文字姓を多めに。
const LONG_EVENT: HomeTimelineEvent = {
  eventId: 950,
  displayName: '全道かるた選手権大会ABCDE',
  eventDate: '2026-08-02',
  venue: '道立総合スポーツセンター 第1〜第4競技場',
  confidence: 'confirmed',
  entrants: [
    m('佐々木', 'A'),
    m('白石', 'A'),
    m('藤原', 'A'),
    m('長谷川', 'B'),
    m('岡田', 'B'),
    m('工藤', 'B'),
    m('大橋', 'B'),
    m('五十嵐', 'B'),
    m('井上', 'C'),
    VIEWER,
    m('森本', 'C'),
    m('桜庭', 'C'),
    m('上村', 'C'),
    m('小野寺', 'D'),
    m('三浦', 'D'),
    m('及川', 'D'),
    m('荒井', 'D'),
    m('渡辺', 'D'),
    m('宮川', 'E'),
    m('東', 'E'),
    m('九十九', 'E'),
    m('神谷', null),
  ],
}

/** プロトタイプで切り替える表示状態。 */
export type ProtoState = 'normal' | 'today' | 'empty' | 'long' | 'no-alert'

export const PROTO_STATES: ReadonlyArray<{ id: ProtoState; label: string }> = [
  { id: 'normal', label: '通常' },
  { id: 'today', label: '大会当日' },
  { id: 'long', label: '大人数・長い名前' },
  { id: 'no-alert', label: 'アラートなし' },
  { id: 'empty', label: '空' },
]

/**
 * DESIGN-PROTO: ハードコードした {@link HomeTimelineData} を返す唯一のスタブ。
 * 実装時はこの関数を消し、page.tsx で実クエリから同じ形を組む。
 */
export function loadHomeTimeline(state: ProtoState): HomeTimelineData {
  const base = {
    todayStr: '2026-07-28',
    viewerUserId: VIEWER_ID,
    alerts: [
      {
        eventId: 902,
        displayName: '石狩CD',
        baseDeadline: '2026-07-31',
        daysLeft: 3,
      },
    ],
  }

  switch (state) {
    case 'today':
      return { ...base, today: [TODAY_EVENT], upcoming: UPCOMING }
    case 'long':
      return { ...base, today: [], upcoming: [LONG_EVENT, ...UPCOMING] }
    case 'no-alert':
      return { ...base, alerts: [], today: [], upcoming: UPCOMING }
    case 'empty':
      return { ...base, alerts: [], today: [], upcoming: [] }
    default:
      return { ...base, today: [], upcoming: UPCOMING }
  }
}
