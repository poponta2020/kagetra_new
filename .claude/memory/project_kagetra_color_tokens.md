---
name: project-kagetra-color-tokens
description: kagetra の配色の正典は apps/web/src/app/globals.css の @theme と :root(--kg-*) の2系統。2026-09 に藤×墨から白波×紺へ刷新(和紙×藍墨→藤×墨→白波×紺)。surface は純白になったが bg-white 6箇所は置換しない・hex照合はさらに無効
metadata: 
  node_type: memory
  type: project
  originSessionId: 3ba2bc9c-b3d7-4e8d-a920-508b71dc8f82
  modified: 2026-09-21T13:29:12.732Z
---

配色の正典は `apps/web/src/app/globals.css` の1ファイル（PR #333 で一元化、2026-07-26 出荷）。2系統が併存する:

- `@theme { --color-* }` — Tailwind v4 のテーマ。`bg-surface` `text-ink-meta` 等のユーティリティが生成される。**Tailwind v4 なので `tailwind.config.js` は存在しない**（CSS が設定ファイルを兼ねる）
- `:root { --kg-* }` — 同じ値のミラー。inline `style` から `var()` で参照する用（チャートの SVG fill 等、ユーティリティにできない箇所）。名前対応は `canvas`↔`bg`・`ink*`↔`fg*`（`ink-meta`↔`fg-3`）・`line*`↔`line-green*`、ほかは同名

**Why:** 「配色を変えたい」時に globals.css の1箇所を直せば全体に効く。ただし下記の例外は追随しない。

★**2 系統の同値と spec 値は `apps/web/src/app/globals-tokens.test.ts` が固定している**（hokumei-palette で新設）。片方だけ直すと落ちる。配色を変えるときはこのテストの SPEC を先に直す。

## 変遷

和紙 × 藍墨（初代）→ 藤 × 墨（2026-08・lilac-palette）→ **白波 × 紺（2026-09・hokumei-palette）**。正典は `docs/features/hokumei-palette/design-spec.md`、導出と全コントラストの再現は同ディレクトリの `palette-check.mjs`（依存なし・exit 0 が合格）。詳細は [[feature-def-hokumei-palette]]。

アプリ名「北溟」（北の大海）を **白波・海面・深み** の3層として読み、`surface` 純白 `#ffffff` / `canvas` 水色鼠 `#dfe8ed` / `brand` 紺 `#15387d` に割り当てた。**メリハリの本体は明度ラダー**（surface→canvas ΔL 0.074・下限 0.07、canvas→surface-alt 0.040・下限 0.035）。**round 4（PR #661）で面と枠線のラダー 5 トークン（canvas・surface-alt・border-soft・border・border-strong）の彩度だけを 0.375 倍へ落とした**（canvas は `#d3eafa` → `#dfe8ed`、彩度 0.033 → 0.012）。明度と色相は据え置き — 地の青みを弱めたくても**明度を上げてはいけない**（白へ寄せると surface との ΔL が下限 0.07 を割り「のぺっと」が再発する）。

セマンティクス: **参加/成功 = 紺**（brand・success `#15387d`）、不参加/危険 = 朱（accent・danger `#b33c2d`・据置）、注意 = 山吹（warn `#b17915`・据置）、補足 = 水色鼠（info・neutral `#3d4958` 系）。文字（ink）は墨のまま藍を帯びさせない。

`success == brand` と `danger == accent` の同値関係は意図的に維持している。**`ink-on-brand == surface`（どちらも純白）** も同値。

★**`brand-bg` は「ブランドの淡色面」と「参加ピルの地」を兼ねる**。`neutral-bg` を彩度 0.009 の無彩色寄りに落としてあるのは brand-bg（彩度 0.058・sRGB ガマット上限）と色相が 2° しか違わないため。**片方だけ動かすと両方壊れる**。

★トークンを新設するときは、裸の参照（`bg-warn` 等）が既存コードに 0 件であることを先に確認する（`warn` 新設時に確認した。`text-ink-1` 事案の逆パターン）。

## 影（elevation）

3 段。**2 層で書く**（接地の鋭い影 + 環境光の柔らかい影）。1 層だと「にじみ」に見える。

- 段1 `--shadow-sm` = `Card`・警告ボックス
- 段2 `--shadow-nav` = ボトムナビ（**上向き**）
- 段3 `--shadow-lg` = ボトムシート・モーダル

基色は `rgba(23, 43, 73, α)`（藍み・OKLCH L 0.29 / C 0.06 / 258°）。★**影の alpha は canvas の明度に連動させる**。藤 × 墨の刷新では canvas が L 0.953 → 0.930 と暗くなったので alpha を上げた。白波 × 紺では canvas が 0.930 → 0.925 とほぼ同じなので据え置いた（色相だけ回した）。純白カード上で影が過剰に見えないかは実画面で要確認のまま。

段2 の「下向き」は作っていない（シェルに sticky ヘッダが無い）。**影の `--kg-*` ミラーは存在しない**（意図的な非対称）。

`--kg-nonattend`（不参加バー `#f3b4b4`）も **`:root` 側のみで `@theme` に対を作っていない**。意図的な非対称で漏れではない。`docs/design/colors_and_type.css` にも載っていない。

## 背景テクスチャ

`--kg-texture`（SVG `feTurbulence` の data URI・opacity 0.05）を `body` と `.mobile-shell-h` の 2 箇所に敷いている。紙の粒子感を色ではなくテクスチャで与える意図。`stitchTiles='stitch'` はタイル境界の継ぎ目を消すために必須。実際に canvas を塗っているのは `MobileShell` のルート div（`bg-canvas`）。

## 触らない例外

**How to apply:** 純白 `white` を意図的に使っている箇所が6つある。**`surface` も純白になり同値になったが、`bg-surface` / `text-surface` へ置換しないこと**。「surface がどう変わっても白」であるべき箇所で意味が違う:

- LINE ログイン/連携ボタンの `text-white` 3箇所（`auth/signin`, `settings/line-link`, `register/[token]`）— LINE 緑の上は純白が正
- `events/EventListClient.tsx` トグルのつまみ `bg-white` — OFF 時トラック `neutral-bg` とのコントラスト 1.37:1
- `admin/mail-inbox/attachments/[id]` の文書プレビュー背景 `bg-white` ×2 — 白い紙面（canvas に対し 1.24:1）

モーダル背景 `bg-black/40`（12ファイル）も対象外。

CSS 変数を使えずリテラルで色を持つ箇所（**トークンを変えても追随しない**。変えたら同時に直す）:

- `apps/web/src/app/layout.tsx` の `themeColor`（= canvas `#dfe8ed`。`<meta>` 出力のため）
- `lib/line-flex-mail-body.ts` の `BADGE_COLOR` と `lib/open-chat/flex.ts` の `FLEX_BTN_BG`（= brand `#15387d`。Flex JSON はリテラルのみ。★オープンチャットのボタンは藤 × 墨の刷新で初代の藍のまま取り残されていた）
- `lib/stats/grade-tones.ts`（紺→水色鼠ランプ。A = brand・全級 = neutral-fg。★これも藤 × 墨の刷新で「藍→砂」のまま取り残されていた）

## 検証のしかた

★**hex 照合は無効**。`success == brand`、`danger == accent`、さらに `surface == ink-on-brand == white` が衝突する。**`var(--color-*)` の参照名で判定すること**。

★Tailwind v4 は未定義トークンを無言で握り潰すため、**build / lint / typecheck / vitest はこの種のバグに診断能力がない**（[[feedback-tailwind-v4-undefined-token-silent]]）。生成 CSS の実コンパイル照合が要る（`@tailwindcss/postcss` で globals.css を直接コンパイルすれば数秒で `--color-*` と影の出力を確認できる）。

コントラストは全ペア実測済みで **AA 未達 0 件**。`ink-meta` は 3 面すべてで AA（6.78 / 5.46 / 4.82）。**「surface-alt の上では neutral-fg を使う」という旧制約は不要**。

配色のコピーが docs に3つある: `docs/design/colors_and_type.css`（globals.css がヘッダで `Source:` として参照）・`docs/design/ui_kits/kagetra-mobile/palette.css`（変数名が短い別名）・`docs/design/design.md` の §2 と §6 抜粋。**放置すると腐る**（palette.css は初代の値のまま 2 世代放置されていた）ので同時に更新すること。`design-system-readme.md` と `SKILL.md` の色の記述は初代のままで、冒頭の注記で正典へ誘導している。
