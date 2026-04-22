# Kagetra Design System

かげとら — competitive karuta (競技かるた) club groupware.

This design system defines the visual and interaction vocabulary for the **kagetra_new mobile product** — a tournament-application and result-management app being built as a full rewrite of the original `kagetra` groupware.

**Design direction: 和紙 × 藍墨** (washi × sumi-indigo). Warm washi-paper surfaces, 藍 (indigo, `#2B4E8C`) as the brand ink, 朱 (vermillion, `#B33C2D`) reserved for refusal and warning. Serif display (Noto Serif JP) for identity moments; sans (Noto Sans JP) for everything interactive. The result is a quiet, slightly formal tone fitting for a 競技かるた club — not the generic SaaS-green the upstream repo starts with.

> **Upstream note.** The current `kagetra_new` codebase ships with a placeholder LINE-green theme (`--color-brand: #00b900` in `apps/web/src/app/globals.css`). This system is the proposed replacement and describes the direction all new work should follow; the green token will be swapped out when the redesign lands.

---

## Product context

**What it is.** An invite-only, mobile-first web app for a ~100-member competitive karuta club. Members use it to see upcoming tournaments (大会) and practices, RSVP to events, check who else is attending, and receive LINE notifications when important things happen.

**Who uses it.** About 100 members total; ~50/year receive LINE pushes. Three roles: `admin` (管理者), `vice_admin` (副管理者), `general` (一般会員).

**Key flows.**
- Sign in with LINE (no email/password; invite-only).
- First-time users pick their name from a roster to self-identify their LINE account to a member record.
- Members see upcoming events, mark 参加 / 不参加, and see the tally of attendees.
- Admins create events, edit members, assign grades (A–E級).
- Planned (later phases): tournament results & stats, AI-assisted tournament-flyer ingestion (PDF/Word), AI travel-expense estimates, albums, BBS, wiki, address book.

**Design posture.** The CLAUDE.md in the repo summarises it as "UI: モバイルファースト、シンプル（デザイン詳細は別途）、日本語のみ" — mobile-first, simple, Japanese only. The upstream codebase currently has no custom visual language: vanilla Tailwind, a single LINE-green placeholder brand token, and Noto Sans JP. This design system is the proposed replacement — it keeps the minimal, utilitarian posture but anchors it in a deliberate washi-and-indigo aesthetic that suits a 競技かるた club.

---

## Sources

- **Code repo** — `poponta2020/kagetra_new` on GitHub (default branch `main`). All rules, screens, and tokens in this system are derived from the repo's code. If you have access, the most useful files are:
  - `CLAUDE.md` — overall product & engineering brief (Japanese)
  - `CONTRIBUTING.md` — developer workflow (Japanese)
  - `apps/web/src/app/globals.css` — the entire theme source: `--color-brand: #00b900`, `--font-sans: "Noto Sans JP"`
  - `apps/web/src/app/(app)/layout.tsx` — app chrome (header, nav, main container)
  - `apps/web/src/app/(app)/events/...` — the richest set of components (list, detail, form)
  - `apps/web/src/app/auth/signin/page.tsx` + `self-identify/page.tsx` — unauthenticated screens
- **Legacy product** — `poponta2020/kagetra` (original Rails/… app this rewrite is replacing). Not consulted; the new app is intentionally a clean slate, visually.
- **No Figma, no slide deck, no brand guidelines were provided.** Everything here is reverse-engineered from the code.

Do not assume the reader has repo access — snippets and values referenced below are reproduced locally in this system.

---

## CONTENT FUNDAMENTALS

Copy is **Japanese only** (`<html lang="ja">`). The app's personality is that of a well-organised club secretary: polite, factual, never chatty.

**Voice & tone**
- **Polite neutral (です/ます).** Used for anything the app says to the member. Example: `"ようこそ、{name}さん"`, `"処理に失敗しました。"`, `"時間を置いて再度お試しください。"`.
- **Plain noun labels** for form fields, table headers, nav items — no verb, no punctuation. `タイトル`, `場所`, `定員`, `大会グループ`, `参加可能な級`, `ステータス`.
- **Imperative verbs on buttons**, single word where possible: `作成`, `保存`, `編集`, `キャンセル`, `参加`, `不参加`, `ログアウト`.
- **Light honorific suffix on people's names**: `{user.name}さん`. Used in greetings, not in tables.

**Addressing the user**
- The app does **not** use personal pronouns (no 私, no あなた) in UI chrome.
- Exception: onboarding uses `あなたは誰ですか？` as a playful, human-scale prompt on the self-identify screen. This is the single warm moment in the app.

**Domain vocabulary** (important — get these exactly right)
- 大会 — official tournament. Paired with `公認` (officially sanctioned) / `非公認` pills.
- イベント — generic event (tournaments + anything else on the calendar).
- スケジュール — non-tournament calendar items: `練習` (practice), `会議` (meeting), `懇親会` (social), `その他` (other).
- 級 — grade / rank. Values are `A`, `B`, `C`, `D`, `E` (always Latin letters, always followed by `級` in display: `A級`).
- 会員 — member. 会内 — "within the club" (as in 会内締切, the club's internal RSVP deadline).
- 出欠 — attendance. 参加 / 不参加 / 未回答 are the three states.
- 招待済み / 未招待 — invited / not invited.
- LINE is **always written as "LINE"** in Latin caps, never ライン.

**Error and empty states**
- Errors are full sentences with a period: `"退会済みの会員です。再入会を希望される方は管理者にご連絡ください。"`.
- Empty states are short fragments without a period: `"イベントはまだありません"`, `"スケジュールはまだありません"`.
- Deadline/eligibility rejections are terse: `"締切済み"`, `"対象外の級です"`.
- When the system can't help, it routes to a human: `"管理者にご連絡ください。"` / `"管理者にお問い合わせください。"`.

**Dates and times**
- Dates render as `YYYY-MM-DD` (raw `date` values from the DB) **or** `ja-JP` locale (`2025/10/05`) in the members table. Prefer the latter in new designs.
- Time ranges use a wave dash: `13:00〜17:00`. Never a hyphen.
- Relative phrasing is rare; the app prefers absolute dates.

**Status pills — canonical labels**
| state | label |
|---|---|
| `draft` | 下書き |
| `published` | 公開 |
| `done` | 終了 |
| `cancelled` | 中止 |
| `official=true` | 公認 |
| `official=false` | 非公認 |

**Emoji**
- **Not used.** There is not a single emoji anywhere in the codebase. Keep it that way.

**Examples pulled verbatim from the code**
- Sign-in screen: `"LINE アカウントでログインします。"`
- Self-identify intro: `"会員一覧から、ご自身のお名前を選んでください。一度選ぶと、この LINE アカウントと紐付きます。"`
- Empty search: `"一致する会員が見つかりません。"`
- Locked RSVP: `"級が未設定のため回答できません。管理者に級の設定を依頼してください。"`
- Line-link settings hint: `"機種変更などで LINE アカウントが変わった場合にご利用ください。"`

---

## VISUAL FOUNDATIONS

### Colour

The palette is built from **four hues** — 藍 (indigo), 朱 (vermillion), 和紙 (washi), 砂 (sand) — plus LINE's official green, which appears only on the auth button. Everything else is derived.

- **Brand — 藍墨 (sumi-indigo)** `#2B4E8C` (hover `#213C6D`). The wordmark, primary buttons, the active-tab underline, focus rings, and every confirming-state pill (公開・公認・参加). Its tinted washi is `#E6EDF7` with `#1E3A6B` foreground.
- **Accent — 朱 (vermillion)** `#B33C2D`. Reserved for refusal and warning: 不参加, 締切警告, 必須マーク, エラーバナー, destructive confirmations. Its tinted washi is `#F7E6E2` with `#8F2D20` foreground. **Never** used as a decorative colour.
- **LINE green** `#06c755` (hover `#05a648`). Used **only** on the "LINE でログイン" and "別の LINE に切り替える" buttons, to match LINE's official spec. Never a brand colour.
- **Canvas (和紙)** `#F4EFE3` for the page, `#FBF7ED` for cards and sheets (one shade lighter), `#F0EADC` for nested/recessed surfaces. Never pure white.
- **Borders (生成)** `#E6DDC4` (soft, most dividers), `#D8CDB3` (default, form inputs, card outlines), `#B8AA8A` (strong, rarely).
- **Ink (墨)** `#1E1B13` primary, `#3A342A` secondary, `#7A6E5A` meta / labels, `#A99C82` placeholders / deactivated. Ink is a warm near-black, not `#000`.
- **Semantic pills** — **only four tones**, 100-tint washi background + deeper-tint foreground:
  - **success · 藍** (`#E6EDF7` / `#1E3A6B`) — 公開, 公認, 参加, attending state
  - **danger · 朱** (`#F7E6E2` / `#8F2D20`) — 中止, 不参加, 締切, error banners, required asterisk
  - **info · 砂** (`#EAE4D1` / `#5B4F33`) — 級 chips, 練習
  - **neutral · 砂** (`#EBE3CE` / `#5B4F33`) — 下書き, 非公認, その他, 終了, 会議, 懇親会
- **No gradients, no dark mode, no rainbow pill palette.** Two hues do all the signalling work; sand neutrals carry everything else. Resist the urge to add purple for 会議 or orange for 懇親会 — they break the two-tone discipline.

### Typography

Two families. **Noto Serif JP** carries identity moments (the wordmark, page titles, event names, section headings, and the large numerals in the attendance counts). **Noto Sans JP** carries every interactive surface (cards, buttons, form labels, meta, pills, tables). The switch happens around 18px.

- **Families**
  - Display: `"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif`
  - Body: `"Noto Sans JP", ui-sans-serif, system-ui, "Hiragino Sans", "Yu Gothic", sans-serif`
- **Weights** — serif uses 500 (section headings) and 700 (wordmark, page titles, big numerals). Sans uses 400 (body), 500 (labels, list titles, pills), 600 (LINE button only), 700 (card headings like 出欠状況).
- **Sizes**
  - `28px / serif 700` — event-detail page title
  - `22px / serif 500` — section opener (今後の予定)
  - `20px / serif 700` — wordmark
  - `18px / sans 700` — card headings (出欠状況)
  - `16px / sans 500` — list titles (event name in a timeline row)
  - `15px / sans 400` — body, buttons, form inputs
  - `13px / sans 400` — meta, table headers, footnotes
  - `12px / sans 500` — pills
  - `10px` — the `退会` tag only
- **Letter-spacing** — `0.01em` on serif titles, `0.03em` on the wordmark, default elsewhere.
- **Leading** — 1.55 body, 1.25 for display.
- **`antialiased`** globally.

### Spacing & layout

- **Scale** — 4px step. Actual values in use: `4 · 8 · 12 · 16 · 20 · 24 · 32`. Stick to these; don't invent in-between values.
- **Viewport** — mobile-first on 375 × 812. Admin tables stretch to `max-w-5xl` (1024px) on desktop; nothing else expects width.
- **Page gutter** — `16px` on mobile, `24px` on desktop.
- **Vertical rhythm** — `24px` between major page sections, `16px` between list items, `12px` inside dense layouts (date block + title, pill rows).
- **Card padding** — `16px` for compact list cards, `20–24px` for detail cards, `28–32px` for sheets (auth, RSVP, event-create).
- **Grids** — two-column `gap 12px` for paired fields (開始時間 / 終了時間). Three-column `gap 10px` for the attendance-count tiles (参加 / 不参加 / 未回答). Never more than three columns on mobile.

### Cards & surfaces

- **Shape** — `8px` radius (`--kg-radius-lg`) for cards and sheets; `12px` (`--kg-radius-xl`) for the sign-in modal only. Deliberately small — washi UI reads calmer without the playful rounding of consumer-app plastic.
- **Fill** — `#FBF7ED` (surface). `#F0EADC` (surface-alt) for the header row of tables and nested/recessed panels.
- **Border** — every card takes a hairline `1px solid #E6DDC4`. This matters: without it, cards nearly disappear into the canvas. The border + warm shadow, not the fill, is what separates the card.
- **Elevation** — warm-tinted shadows (`rgba(60,45,20,…)`):
  - `sm · 0 1px 2px /06` — card at rest
  - `md · 0 4px 12px /10` — card hover
  - `lg · 0 10px 24px /14` — auth sheet, modals
  - `fab · 0 6px 16px /18` — floating action button
- **No inner shadows, no black-neutral shadows, no coloured glows.** Pure-black shadow on washi reads as dirt.

### Buttons

- Radius `6px`, font-size `15px`, weight `500`. Padding `10px 16px` default; `12px 16px` for full-width sheet buttons (LINE auth, RSVP confirm).
- **Primary** — `bg #2B4E8C` / `text #FBF7ED`; hover darkens to `#213C6D` (colour shift, not opacity). Used for 作成, 保存, 参加する, 編集, and every confirming action.
- **Secondary** — `bg #F0EADC` / `text #3A342A` / `border 1px solid #D8CDB3`; hover `bg #E6DDC4`. Used for キャンセル and back-actions.
- **Danger** — `bg #B33C2D` / `text #FBF7ED`. Only for destructive confirmation (退会, 削除, 不参加-confirm on the RSVP sheet).
- **LINE auth** — `bg #06c755` (hover `#05a648`), `font-weight 600`, `padding 12px 16px`, full-width. Only on the sign-in and LINE-relink sheets.
- **No opacity-hover.** All hovers are an explicit colour step.

### Forms

- Inputs, selects, textareas: `padding 10px 12px`, `border 1px solid #D8CDB3`, `radius 6px`, `font-size 15px`, `background #FBF7ED`, `color #1E1B13`.
- Focus: `border #2B4E8C` + `box-shadow 0 0 0 2px #E6EDF7` (藍-tinted halo). No default browser outline.
- Labels: `13px / 500 / #3A342A`, above the field, 6px gap. Required-field marker is a 朱 asterisk (`#B33C2D`, `margin-left 2px`), never red.
- Checkboxes and radios use native elements; apply `accent-color: #2B4E8C` so the check glyph adopts the brand.
- Never use floating labels, never an underline-only field. The bordered field reads correctly against washi.

### Pills / badges

- `radius 9999px`, `padding 3px 10px`, `font-size 12px`, `font-weight 500`. Always one of the four semantic pairs (藍 / 朱 / 砂-info / 砂-neutral). Grade chips use 砂-info.
- Smaller variant (2px 9px) for dense timeline chip rows (苗字 chips on the dashboard).

### Tables (admin, desktop only)

- Wrapper: `overflow-x-auto`, `radius 8px`, `background #FBF7ED`, `border 1px solid #E6DDC4`, `shadow-sm`.
- Header row on `#F0EADC`, cells `12px 16px`, `font-size 12px`, `weight 500`, `color #7A6E5A`, letter-spacing `0.04em`.
- Body cells `12px 16px`, `font-size 14px`, `color #1E1B13` (primary column) / `#3A342A` (secondary). Row dividers `1px solid #E6DDC4`.
- Deactivated rows: text shifts to `#A99C82`; append a tiny `退会` pill (`10px`, 砂-neutral).
- **Never stripe rows.**

### Motion

- **Very little.** `transition: box-shadow 150ms ease-out` on hoverable cards; `transition: background-color 150ms ease-out` on buttons. No entrance animations, no spring easing, no Framer Motion, no scroll effects.
- If you need more, use `transition: all 150ms ease-out` and stay on opacity, shadow, or colour.

### Hover / press

- Cards: shadow bump (`sm` → `md`).
- Primary buttons: `#2B4E8C` → `#213C6D` (darker 藍).
- Secondary buttons: `#F0EADC` → `#E6DDC4`.
- Nav / tab: inactive `#7A6E5A` → active `#2B4E8C` with a 2px 藍 underline.
- Text links: underline on hover, no colour shift.
- No dedicated `:active` / press state.

### Borders, radii, dividers

- Radii: `3px` (tiny tags), `5px` (sub-elements), `6px` (buttons, inputs), `8px` (cards, table wrapper), `12px` (auth / RSVP sheets), `9999px` (pills, grade chips).
- Dividers: `1px solid #E6DDC4` for most lists; `#D8CDB3` when you need a firmer break (section separators inside a card).
- Borders: `#D8CDB3` on form fields, `#E6DDC4` on cards and lists, `#B8AA8A` only for emphasised separators (very rare).

### Imagery, icons, illustration

- **No photography, no illustration, no avatars.** The app is text-first, list-first, form-first. Decorative imagery would fight the washi surface.
- **Avatar stand-in** — circular 苗字 chip (first kanji of the family name in `#5B4F33` on 砂) at 24–32px. This is the only "portrait" element anywhere in the product.
- **Icons** — Lucide subset, 24px, `stroke-width 1.5`. Colour with `#3A342A` in nav, `#7A6E5A` in meta, `#2B4E8C` on primary-interaction glyphs. This is a flagged substitution — the upstream app has no icon library yet.
- **Background** — always flat washi. No patterns, no gradients, no paper-texture overlays (it sounds tempting; it isn't).

### Transparency & blur

- Not used. No backdrop-filter, no translucent overlays. The closest thing is the 藍-tinted focus halo (`box-shadow 0 0 0 2px #E6EDF7`).

### Fixed / sticky elements

- Mobile: top header is sticky (wordmark + `{name}さん`). Bottom tab bar is sticky (ホーム / イベント / 予定 / 会員). Event-detail pages have a sticky primary action (参加する) pinned to the bottom of the viewport above the tab bar.
- Desktop (admin tables only): header scrolls with the page. No side nav.

### Mobile-first

- Target viewport 375 × 812. Touch targets ≥ 44px. Page gutter `16px`. Stack everything vertically; never reflow into columns on mobile. The desktop admin tables are the only surface that expects width, and they wrap in `overflow-x-auto`.

---

## ICONOGRAPHY

**State of the upstream codebase**: kagetra_new ships no icon system. No icon library installed, no SVGs in `apps/web/`, no icon font loaded, no emoji. The single glyph in the entire UI today is a plain `←` in the "back to list" link.

**This system's recommendation**: use **Lucide** via CDN (`https://unpkg.com/lucide@latest`). Thin strokes and rounded joints sit comfortably on washi; no fills keeps the UI calm. Use `stroke-width 1.5`, `24px` in the mobile tab bar and card headers, `20px` inside buttons, `16px` alongside body copy. Colour to match surrounding text (`#3A342A` nav, `#7A6E5A` meta, `#2B4E8C` primary-interaction). The `assets/icons/` folder has a small inlined set for offline use.

**Logo**: the wordmark is the whole brand. Set in `Noto Serif JP 700`, `20px` in the mobile header (larger for marketing), colour `#2B4E8C`, letter-spacing `0.03em`. Never sans, never green, never monochrome black. Specimen lives in `assets/wordmark.svg`.

---

## INDEX

Root files
- `README.md` — this file
- `colors_and_type.css` — all design tokens (CSS variables) + semantic class selectors
- `SKILL.md` — agent-skill manifest so this folder can be used as a Claude Code skill

Folders
- `assets/` — wordmark SVG (Noto Serif JP in 藍), Lucide icon subset
- `fonts/` — (empty; Noto Sans JP + Noto Serif JP are loaded from Google Fonts)
- `preview/` — the HTML cards that populate the Design System tab (one sub-concept per card)
- `ui_kits/kagetra-mobile/` — 375×812 mobile recreation of the full product: dashboard, event detail, login, member list/detail, RSVP sheet, event-create form, admin attendance tally. Primitives attach to `window`; open `index.html` for the DesignCanvas demo.

Products
- **Kagetra Mobile** (primary surface) — member-facing, mobile-first, serif-display + washi. Covered by the UI kit.
- **Kagetra Admin** (desktop-only) — admin tables (members, tournament results). Uses the same tokens but stays on wider layouts.
