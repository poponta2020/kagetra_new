---
name: kagetra-design
description: Use this skill to generate well-branded interfaces and assets for Kagetra (かげとら), a competitive karuta club groupware — for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read `README.md` within this skill to absorb content and visual foundations, then explore other files as needed:

- `colors_and_type.css` — every token (CSS vars + semantic classes)
- `assets/` — wordmark SVG (Noto Serif JP in 藍), Lucide icon subset
- `preview/` — small HTML cards for each sub-concept
- `ui_kits/kagetra-mobile/` — 375×812 mobile recreation: dashboard, event detail, login, member list/detail, RSVP sheet, event form, admin tally. Primitives (`MobileFrame` `Card` `Btn` `Pill` `StatusPill` `GradePill` `Avatar` `AvatarStack` `DescList` `AttendanceCounts`) attach to `window`. Open `index.html` for the DesignCanvas demo.

**Design direction: 和紙 × 藍墨 (washi × sumi-indigo).** Warm washi-paper surfaces, 藍 (indigo `#2B4E8C`) as brand ink, 朱 (vermillion `#B33C2D`) reserved for refusal and warning. Serif display (Noto Serif JP) for identity moments; sans (Noto Sans JP) for interactive surfaces. The upstream codebase currently ships a LINE-green placeholder (`--color-brand: #00b900`); this system is the replacement direction and should govern all new work.

**Guardrails derived from the product:**
- Japanese only (です/ます), no emoji anywhere, no pronouns (no 私 / あなた except the onboarding prompt "あなたは誰ですか？").
- Mobile-first (375×812); desktop only for admin tables.
- **Brand = 藍** (`#2B4E8C`) for primary actions and wordmark. **Accent = 朱** (`#B33C2D`) for 不参加 / 締切 / エラー / required asterisk / destructive confirms — never decorative. **LINE green** (`#06c755`) only on LINE auth buttons.
- **Two-tone semantic palette only.** Success = 藍, danger = 朱, everything else sand-neutral. No purple for 会議, no orange for 懇親会, no blue for 級 — those all collapse to the sand-info / sand-neutral pair. Resist the rainbow.
- Surfaces = **warm washi** (`#F4EFE3` canvas, `#FBF7ED` cards, `#F0EADC` recessed). Never pure white. Ink = **warm near-black** (`#1E1B13`), never `#000`.
- **Serif** (Noto Serif JP) for wordmark, page titles, event names, section openers, large numerals in attendance counts. **Sans** (Noto Sans JP) for everything else. Switch happens around 18px.
- Radii `6px` buttons/inputs, `8px` cards, `12px` sheets, `9999px` pills. No larger radii — washi reads calmer with restrained rounding.
- Shadows are **warm-tinted** (`rgba(60,45,20, …)`), never black-neutral. No inner shadows, no coloured glows.
- Focus ring = 2px 藍-tinted halo (`0 0 0 2px #E6EDF7`) + `#2B4E8C` border.
- Every card gets a `1px solid #E6DDC4` border — without it cards disappear into the canvas.
- Status pill labels: 公開 / 中止 / 終了 / 下書き / 公認 / 非公認 / 練習 / 会議 / 懇親会 / その他. All paired to one of {success, danger, info, neutral}.
- No gradients, no dark mode, no animations beyond `150ms ease-out` on shadow/background. No icons in the upstream app (Lucide subset is a flagged substitution in this system).
- Time ranges use wave dash: `13:00〜17:00`. Dates `2025/10/05` (preferred) or `YYYY-MM-DD`.

If creating visual artifacts (slides, mocks, throwaway prototypes): copy assets out of this skill and create static HTML files. If working on production code: read the rules here to become an expert in designing with this brand.

If invoked without guidance, ask what the user wants to build (a new screen? a slide? an email template?), ask a few targeted questions (is this member-facing or admin-only? mobile or desktop? anything Phase 3/4 like AI or albums?), then output HTML artifacts or production-aligned code.
