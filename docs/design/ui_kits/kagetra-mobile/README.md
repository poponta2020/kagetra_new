# Kagetra — Mobile UI Kit

Finalized mobile-first recreation of the Kagetra会員管理 app. 375×700 artboards,
React/JSX primitives with inline styles so everything renders without a build step.

## Layout principles (決定事項)

- **375×700 モバイル縦長** — 下タブナビ4個 (ホーム/イベント/予定/会員)。
- **ダッシュボード** — 縦タイムライン。日付チップが左側、イベントカードが右側。参加者は**苗字チップを全員表示**（アバターではなく）、**級の若い順**でソート。
  - 公認/非公認バッジ、会場、時間は出さない（タイトルに情報過多を避ける）
  - 自分が参加なら `参加` ピル
  - 締切は「会内締切」ではなく「締切」と表記
  - 下書き・終了イベントは非表示
- **イベント詳細** — 単列縦スクロール。出欠バーは使わず、`参加 / 不参加 / 未回答` の3カード。
  - 参加者リストも**級の若い順**
  - RSVP は `参加する` ボタンのみ。押すと `参加をキャンセル` にトグル
- **出欠モーダル** — ボトムシート。`参加 / 不参加 / 未定` + 任意コメント。
- **管理者画面** — 級別集計テーブル + 未回答者リスト + リマインド送信。

## Files

| File | What it is |
|---|---|
| `index.html` | DesignCanvas with 2 sections × 8 artboards. |
| `palette.css` | Color / radius / spacing / shadow tokens (Palette A — 現行グリーン). |
| `data.jsx` | `MEMBERS` / `EVENTS` / `memberById()` seed data. |
| `primitives.jsx` | `MobileFrame` `AppBar` `Card` `Btn` `Pill` `StatusPill` `GradePill` `Avatar` `AvatarStack` `SectionLabel` `DescList` `AttendanceCounts`. |
| `screen-dashboard.jsx` | `<Dashboard />` — timeline home. |
| `screen-event-detail.jsx` | `<EventDetail />` — single-column event view with RSVP toggle. |
| `screen-extras.jsx` | `<LoginScreen />` `<MemberList />` `<MemberDetail />` `<RsvpModal />` `<EventForm />` `<AdminTally />`. |
| `design-canvas.jsx` | Local copy of the design-canvas starter (pan/zoom grid). |

## Using the kit in a new design

```html
<link rel="stylesheet" href="palette.css">
<script type="text/babel" src="data.jsx"></script>
<script type="text/babel" src="primitives.jsx"></script>
<!-- then your screen, which can reference MobileFrame / Card / Pill / etc. -->
```

All primitives attach to `window` so Babel scripts share them without bundling.
Reference colors as CSS vars (`var(--brand)`) or via the `C` helper object
(`C.brand`, `C.successBg`, …) exported from `primitives.jsx`.

## What's NOT in this kit

- 真のランディング/ダッシュボード以外の管理系画面（役員画面、請求系 etc）— 未要件。
- ソート/検索の挙動 — 見た目のみ。
- 実データ接続 — 全画面クリックスルーの張りぼて。
