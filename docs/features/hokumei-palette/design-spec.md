---
status: locked
slug: hokumei-palette
target: apps/web/src/app/globals.css（全画面に効くデザイントークン）
design_source: none      # 視覚の正は本ファイル §2〜§4 のトークン値そのもの（モックも patch も無い）
chosen_direction: A1 白波（round 4 で地と枠線の彩度を 0.375 倍へ）
round: 4
mock_dir: null
design_project: null
prototype_branch: null
prototype_base: null
---
# 北溟配色（白波 × 紺）design-spec

**状態**: round 4 確定（ユーザー承認済み 2026-09-22・実装未着手）。round 3 までは PR #648 で出荷済み
**種別**: UI リデザイン（design-spec が要件成果物。requirements.md と GitHub Issue は作らない。前例 = `lilac-palette`）
**検証スクリプト**: `docs/features/hokumei-palette/palette-check.mjs`（本 spec の全数値を再導出・再実測する。exit 0 が合格）

---

## 1. 背景と目的

アプリ名が「北溟（ほくめい）」に確定した（PR #639）。現行の「藤 × 墨」はアプリ名が「ライラック」になる前提で導出した配色であり、根拠が消えている。ユーザーの要望は次の 4 点。

- 北の海らしく、藍と白を基調にする
- 地（メイン）は水色でよい
- 藍は濃いものも使い、白はもっと白くする
- メリハリを付ける（のぺっとさせない）

### 名前の読み方（中心的な設計判断）

北溟は『荘子』逍遥遊の「北冥有魚」、北の果ての大海を指す。これを **白波・海面・深み** の 3 層として読み、面の 3 役にそのまま割り当てる。

| 層 | 役 | トークン |
|---|---|---|
| 白波 | カード・シート（手前に浮くもの） | `surface` 純白 |
| 海面 | ページの地 | `canvas` 水色鼠（ほんのり青み） |
| 深み | ブランド・主要操作・肯定 | `brand` 紺 |

百人一首 76 番（法性寺入道前関白太政大臣）の結句が「沖つ白波」であり、海の上の白波は題材の内側にある像である。`design.md` の「百人一首＝古典的な題材に古典のトーンを当てる」という論は、和紙 × 藍墨、藤 × 墨から変わっていない。色相を藤から藍へ戻し、面を和紙でも藤鼠でもなく白と水色にしただけである。

### 検討の経緯と不採用案

1. 初回 3 案: A 紺青 × 白磁 / B 藍染の色階（淡い面ほど青緑へ色相が流れる）/ C 藍 × 雪（無彩色の鼠と純白）。ユーザーは **A** を選んだが「コントラストが弱くのぺっとしている」と指摘した。
2. A の数値上の原因: カード↔地の ΔL が 0.046、地の彩度が 0.016（水色と呼べない）、brand の明度が初代の藍と同じ 0.42。
3. A を基準に 3 変種: **A1 白波**（採用）/ A2 濤 / A3 藍墨。

| 不採用案 | 理由 |
|---|---|
| B 藍染の色階 | brand が浅葱寄りになり穏やか。ユーザーが求めたメリハリと逆方向 |
| C 藍 × 雪 | 地が無彩色で「メインは水色」の要望に合わない |
| A2 濤 | brand を留紺（L 0.31）まで沈めると見出しの墨（ink-2）との明度差が 0.022 になり、ボタンと見出しの階層が色で読めなくなる。地の水色（彩度 0.045）も 375px 全面では強すぎる懸念 |
| A3 藍墨 | 文字色まで濃紺にする案。朱・山吹の文字だけが暖色として浮き、警告の強度が意図せず上がる |

A2 の地の水色 `#c6e8fc` を「A1 が物足りなかった場合の調整先」として残していたが、round 4 で逆方向（青みを減らす）に決まったので撤回する。

### round 4: 地の青みを落とす（2026-09-22）

PR #648 の出荷後、ユーザーが本番の実画面を見て「背景まで水色は少しやりすぎ」と判断した。§7 で「実画面でしか確認できない」としていた 1 番目の項目（地の水色の強さ）が、強すぎる側に振れた。

**明度は動かさず、彩度だけを落とす。** 背景を白へ寄せる（明るくする）と、純白カードとの ΔL が縮む。それは round 1 の「のぺっとしている」の原因そのものである。そこで面と枠線のラダー 5 トークン（`canvas`・`surface-alt`・`border-soft`・`border`・`border-strong`）の OKLCH 彩度を一律 0.375 倍にした。明度と色相は A1 のまま据え置く。canvas の彩度は 0.033 → **0.012** になる。

| 候補 | canvas | 彩度 | 結果 |
|---|---|---|---|
| A1（PR #648） | `#d3eafa` | 0.033 | 実画面で強すぎた |
| 案1 | `#dbe9f2` | 0.020 | 不採用 |
| 案2 | `#dde8f0` | 0.016 | 不採用。**round 4 が物足りなかった場合の調整先** |
| **案3** | **`#dfe8ed`** | **0.012** | **採用**。青みはごく淡く、明るく冷たい灰に近い |

ユーザーの最初の選択は「ほんのり水色を残す（彩度 0.015 前後）」だった。そのうえで同じ画面モックを 3 案並べて比較し、最も淡い案3を選んだ。

これにより次の 2 つの記述は失効する。

- round 1〜3 の要望「地（メイン）は水色でよい」と、それに基づく「canvas の彩度は 0.033。これを下回ると水色と読めない」という主張。地は「はっきり水色」から「ほんのり青みの水色鼠」へ変わる。北溟の 3 層の読み（白波・海面・深み）はそのまま使う。海面の色が淡くなるだけである
- C 藍 × 雪の不採用理由（地が無彩色で「メインは水色」の要望に合わない）。ただし案3は彩度 0.012 で無彩色ではない。C を採用したわけではない

---

## 2. 配色（A1 白波・round 4）

すべて OKLCH で導出し、全ペアのコントラストを実測済み。**WCAG AA 未達 0 件**。導出式と実測は `palette-check.mjs` にある。

### 2.1 面と枠線（色相 238〜248°）

| トークン | round 4 | A1（PR #648） | 藤 × 墨（参考） | L |
|---|---|---|---|---|
| `surface` | `#ffffff` | `#ffffff` | `#f7f5fe` | 1.000 |
| `canvas` | `#dfe8ed` | `#d3eafa` | `#e8e6f2` | 0.926 |
| `surface-alt` | `#d1dbe2` | `#c3ddf0` | `#dedcea` | 0.886 |
| `border-soft` | `#cad2d9` | `#bdd5e6` | `#d7d4e3` | 0.860 |
| `border` | `#b6bfc7` | `#a8c2d6` | `#c7c3d4` | 0.800 |
| `border-strong` | `#9099a2` | `#839bb3` | `#a4a0b5` | 0.679 |

**明度ラダーは A1 のまま保つ**: surface→canvas ΔL **0.074**（下限 0.07）、canvas→surface-alt ΔL **0.040**（下限 0.035）。メリハリの本体はここである。藤 × 墨の頃は 0.044 / 0.030 だった。round 4 は彩度だけを 0.375 倍にしたので、ΔL は丸め誤差の範囲（0.001）しか動かない。canvas の彩度は **0.012**（A1 は 0.033）。導出は `palette-check.mjs` の `LADDER_CHROMA` にある。

**`neutral-bg`・`info-bg` と `surface-alt` がほぼ同色になる。** どちらもコントラスト 1.03・ΔL 0.009 である。OKLab の色差は、neutral が 0.031 → 0.011、info が 0.021 → 0.011 に縮む（知覚できる差の目安は 0.02 前後）。A1 では `surface-alt` の彩度が 0.038 あり、ピル地（0.009・0.020）と彩度の差で分かれていた。round 4 で `surface-alt` の彩度が 0.015 まで下がったため、その差が消える。`brand-bg`（彩度 0.058）は逆に A1 より `surface-alt` から離れる。朱・山吹は色相で分かれる。

影響が見えるのは、`surface-alt` の上に neutral / info の地を置いている箇所である（いずれも管理者画面）。

- `admin/mail-inbox/components/DraftCard.tsx`: `bg-surface-alt` の箱の中に、下書き状態の `Pill`（`tone="info"`・`tone="neutral"`）を置いている。`admin/mail-inbox/page.tsx` にも同じ形の箱がある
- `admin/members/page.tsx`: 種別バッジとして `bg-neutral-bg` 1 個と `bg-surface-alt` 3 個が並ぶ

ピルの輪郭は溶けるが、文字（`neutral-fg`・`info-fg`・`ink-2`）と文言で読めるので、今回は直さない（§10）。藤 × 墨の頃も色差は neutral 0.011・info 0.001 で、同じかそれ以上に同色だった。A1 で分かれていたのは副次的な効果で、意図した仕様ではない。

**`surface` を純白にする**。`design.md` の視覚原則「純白 `#FFF` は使わない」は本変更で撤回する（§5）。初代は和紙、前回は藤鼠という「紙の色」が面の個性を担っていたが、今回は白波＝純白そのものが個性であり、色を混ぜると要望の「もっと白く」に反する。

### 2.2 墨（色相 252〜264°・近無彩色）

| トークン | 新 | 現行 | L |
|---|---|---|---|
| `ink` | `#121824` | `#1c1a21` | 0.209 |
| `ink-2` | `#283040` | `#35333d` | 0.309 |
| `ink-meta` | `#515c6c` | `#625f6e` | 0.471 |
| `ink-muted` | `#8594a5` | `#9995a7` | 0.660 |
| `ink-on-brand` | `#ffffff` | `#f7f5fe` | 1.000 |

文字は墨のまま（彩度 0.03 以下）。藍を帯びさせない。朱・山吹の文字と同じ強度で並ぶためである（A3 を採らなかった理由）。

`ink-meta` は 3 面すべてで AA を満たす（surface 6.78 / canvas 5.46 / surface-alt 4.82）。「surface-alt の上では neutral-fg を使う」制約は引き続き不要。`ink-muted` は surface 上 3.10 で、退会行など装飾的に落とす用途に限る（現行と同じ扱い）。

### 2.3 ブランド（紺 / 色相 262°）

| トークン | 新 | 現行 | 初代（参考） |
|---|---|---|---|
| `brand` | `#15387d` | `#534286` | `#2b4e8c` |
| `brand-hover` | `#092563` | `#402f6e` | `#213c6d` |
| `brand-fg` | `#0e2c67` | `#3e3067` | `#1e3a6b` |
| `brand-bg` | `#bdddff` | `#e0d7fd` | `#e6edf7` |

色相は初代の藍（261°）と同じ軸。明度を 0.43 → **0.36** へ沈め、彩度を 0.111 → 0.124 へ上げた。白の上のコントラストは 7.8 → **11.1**。「初代に戻す」のではない。初代より一段深い紺である。

`brand-bg` は彩度 0.058 で、この明度（0.885）・色相（250°）での sRGB ガマット上限に当たる。これ以上鮮やかにはできない。

### 2.4 success は brand に追随（維持）

`success == brand` / `success-bg == brand-bg` / `success-fg == brand-fg` の三者同一を維持する。**参加 = 紺**。

`brand-bg` は「ブランドの淡色面」と「参加ピルの地」を兼ねる。`neutral-bg`（彩度 0.009）とは色相が 2° しか違わず、**彩度で弁別している**。片方だけ動かすと両方壊れるので、変更するときは必ず対で行う（現行と同じ制約）。

### 2.5 朱と山吹（6 トークンとも据え置き）

| トークン | 値 |
|---|---|
| `accent` / `danger` | `#b33c2d` |
| `accent-fg` / `danger-fg` | `#8f2d20` |
| `accent-bg` / `danger-bg` | `#f4d5cf` |
| `warn` | `#b17915` |
| `warn-fg` | `#785214` |
| `warn-bg` | `#f5ddb8` |

値は変えない。根拠の説明だけ差し替える。

- **朱**: 藍 × 朱は初代と同じ、和の定番の取り合わせ。`accent == danger` の同値も維持。
- **山吹**: 紺のほぼ補色（ピル地どうしの色相差 171°）で、画面の中で最も遠い色になる。前回の根拠「捨てた和紙ベージュの記憶」は失効するが、役割（danger と分離された注意色）は変わらない。

朱の文字は canvas の上でも AA を満たす（round 4 で 4.69。A1 は 4.70）。ピル地は白カード上で ΔL 0.09〜0.10 離れ、現行（0.07〜0.08）より浮く。canvas 直上でも色相差（朱 141°・山吹 171°）で弁別できる。

### 2.6 補足・中立

| トークン | 新 | 現行 |
|---|---|---|
| `neutral-bg` | `#d8dde2` | `#dcdae2` |
| `neutral-fg` | `#3d4958` | `#4f4b5f` |
| `info-bg` | `#d2dee9` | `#dfdcea` |
| `info-fg` | `#3d4958` | `#4f4b5f` |

`info-fg == neutral-fg` の同値を維持。

### 2.7 据え置くもの

- LINE 緑 `#06c755` / `#05a648`
- `--kg-nonattend` `#f3b4b4`（`:root` 側のみの意図的な非対称も維持。紺との比 6.34:1）
- 純白 `white` の例外 6 箇所（LINE ボタンの `text-white` 3 箇所・トグルつまみ `bg-white`・文書プレビュー `bg-white` ×2）。**`surface` と同値になるが `bg-surface` へ置換しない**。これらは「surface がどう変わっても白」であるべき箇所で、意味が違う。トグルつまみ 1.37:1・文書プレビュー 1.24:1 は現行と同水準
- モーダル背景 `bg-black/40`（12 ファイル）
- `manifest.webmanifest` の `theme_color` / `background_color`（どちらも `#ffffff`。前回も据え置き。白いスプラッシュは新配色と矛盾しない）
- `components/ui/avatar-colors.ts` の 8 色（テーマと独立したアバター用パレット）
- LINE Flex の中立色（`#111111` `#6E7B8A` `#999999` ほか。LINE のトーク画面に合わせた値でアプリの墨ではない）

---

## 3. 影とテクスチャ（構造は不変・影の色相だけ替える）

3 段の高度（段1 Card＝`--shadow-sm` / 段2 ボトムナビ上向き＝`--shadow-nav` / 段3 シート・モーダル＝`--shadow-lg`）、2 層で書く規約、`--kg-*` ミラーを持たない非対称、`--kg-texture` の 2 箇所敷き、いずれも変えない。`Card`・`bottom-nav` のクラスも触らない。

影の基色だけ藤み `rgba(45, 38, 70, α)` から藍み **`rgba(23, 43, 73, α)`** へ替える（OKLCH L 0.29 / C 0.06 を保ち色相を 290° → 258° へ回した値）。

```css
--shadow-sm: 0 1px 2px rgba(23, 43, 73, 0.1), 0 3px 8px rgba(23, 43, 73, 0.07);
--shadow-nav: 0 -1px 3px rgba(23, 43, 73, 0.06), 0 -4px 14px rgba(23, 43, 73, 0.08);
--shadow-lg: 0 8px 28px rgba(23, 43, 73, 0.2), 0 2px 6px rgba(23, 43, 73, 0.1);
```

alpha は据え置く。影が落ちる先の canvas は L 0.930 → 0.925 でほぼ同じだからである（前回 alpha を上げたのは canvas が 0.953 → 0.930 と暗くなったため。今回その事情は無い）。ただしカードが純白になり輪郭が明度差だけで立つようになるので、影が過剰に見える可能性はある。実画面確認項目（§7）。

round 4 でも影は変えない。canvas の明度は動いておらず、ユーザーは実画面を見たうえで影に指摘を出していない。影の基色は色相 258° の藍みで、青みが淡くなった canvas の上ではやや冷たい影になる。これも §7 の確認項目に含める。

---

## 4. コード内リテラルの追随

CSS 変数を使えずリテラルで色を持つ箇所。トークンを替えただけでは追随しない。

**round 4 で動くのは `themeColor` だけである。** ほかのリテラル（Flex の紺・級トーン）は brand 系なので round 4 の対象外。級トーンの E `#9bb9ce` は白カードの上に描くので、canvas の青みとは関係しない。

| 箇所 | 現状 | 新 | 備考 |
|---|---|---|---|
| `apps/web/src/app/layout.tsx` `themeColor` | `#e8e6f2` | `#d3eafa` → round 4 で **`#dfe8ed`** | canvas と同値。`<meta>` 出力のためリテラル必須。コメントの「canvas 水色」も「水色鼠」へ直す |
| `lib/line-flex-mail-body.ts` `BADGE_COLOR` | `#534286` | `#15387d` | brand と同値。Flex JSON はリテラルのみ。テストが hex を固定している |
| `lib/open-chat/flex.ts` `FLEX_BTN_BG` | `#2B4E8C` | `#15387d` | **初代の藍のまま取り残されていた**。brand へ揃える。白文字との比 11.09 |
| `lib/stats/grade-tones.ts` | 藍→砂 | 紺→水色鼠 | 下記 |
| `events/EventListClient.tsx` トグルのコメント | hex と比率が現行値 | 新値へ | `bg-white` 自体は残す（§2.7） |

### 統計の級トーン

現行の `GRADE_TONES` は「藍（初代 brand）→ 砂（初代 border-strong 近似）」のランプで、前回の刷新でも取り残されていた。白いカードと水色の地の上に和紙の砂色だけが残るのは不整合なので、**紺 → 水色鼠** へ引き直す。虹色にしない（色相をほぼ固定し、明度と彩度だけで順序を読ませる）という元の設計は維持する。

| 級 | 新 | 現行 | L |
|---|---|---|---|
| A | `#15387d`（= brand） | `#2b4e8c` | 0.360 |
| B | `#305892` | `#4e658b` | 0.461 |
| C | `#5079a7` | `#727c8b` | 0.566 |
| D | `#749abb` | `#95938a` | 0.670 |
| E | `#9bb9ce` | `#b8aa8a` | 0.770 |
| 全級 `ALL_SERIES_TONE` | `#3d4958`（= neutral-fg） | `#5b4f33` | 0.401 |

明度は単調増加、隣接比 1.44〜1.58。E は白カード上で 2.05:1（現行の E は和紙 surface 上で 2.2:1 相当。同水準）。

---

## 5. `design.md` の改訂

### round 4 で直す箇所

round 1〜3 の改訂（下の 1〜7）は PR #648 で反映済み。round 4 では、地の色を書いた箇所だけを直す。

- 「なぜこの方向か」の 3 層の説明: 海面 = `canvas`（ページの地）を「水色」から「水色鼠（ほんのり青み）」へ
- 視覚原則「White-crest surfaces」: 「地は水色 `#D3EAFA`」を「地は水色鼠 `#DFE8ED`」へ。ΔL 0.07 の下限の記述はそのまま残す。**明度を上げて青みを消そうとすると下限を割る**、という一文を足す（次の変更者が白へ寄せないため）
- 基調カラー節: `canvas` `#DFE8ED` / `recessed` `#D1DBE2`
- コンポーネント表の `Card`: 枠 `1px #CAD2D9`
- §6 トークン抜粋: `--kg-canvas` / `--kg-surface-alt` / `--kg-border-soft` / `--kg-border` / `--kg-border-strong` を §2.1 の round 4 値へ。`--kg-canvas` のコメント「水色（海面）」は「水色鼠（海面）」へ
- AI 要項取り込みの行: upload ゾーンの破線 `#A8C2D6` → `#B6BFC7`
- 最終更新行と経緯: round 4 を追記する

### round 1〜3 の改訂（PR #648 で反映済み）

1. **§2 の表題と導入**: 「藤 × 墨」→「白波 × 紺」。経緯の引用に本 spec を追加する（和紙 × 藍墨 → 藤 × 墨 → 白波 × 紺）。「なぜこの方向か」は §1 の読み方へ差し替える。
2. **視覚原則「Fuji-nezu surfaces」**: 「純白 `#FFF` は使わない」を**撤回**し、「カードは純白、地は水色。surface ↔ canvas は ΔL 0.07 が下限」へ書き換える。例外 6 箇所の記述は「`bg-surface` へ置換しない」旨に改める。
3. **視覚原則「Violet-tinted shadows」**: 基色を `rgba(23,43,73, ...)` へ。2 層の規約は維持。
4. **視覚原則「Role-bound semantic palette」**: 肯定 = 紺、それ以外は水色鼠ニュートラル。
5. **視覚原則「No decoration」**: テクスチャ例外の理由文「和紙の粒子感を継承」を「紙の粒子感」へ。例外そのものは維持。
6. **基調カラー節・§6 トークン抜粋・§8 決定事項・最終更新行**: 全値を §2 へ。§6 の影の抜粋は初代の 1 層影のまま腐っているので現行の 3 本へ直す。§8 の「2 トーン semantic (藍=肯定 / 朱=否定 / 砂=その他)」は 3 色（紺・朱・山吹）＋水色鼠へ。
7. 本文中の「藍塗りつぶし」「ワードマーク … / 藍」「単色 (藍) の棒」「藍帯」は初代の記述が残ったもので、今回たまたま再び正しくなる。表記を「紺」に揃えるかは実装時の判断でよい（値は `var(--color-brand)` 参照で正しい）。

---

## 6. 影響範囲

### round 4

| ファイル | 内容 |
|---|---|
| `apps/web/src/app/globals.css` | **正典**。`@theme` の `--color-canvas` / `--color-surface-alt` / `--color-border-soft` / `--color-border` / `--color-border-strong` と、`:root` の `--kg-bg` / `--kg-surface-alt` / `--kg-border-soft` / `--kg-border` / `--kg-border-strong`（2 系統で計 10 行）。ヘッダコメントの「海面 canvas 水色」、Surfaces 節のコメント（ΔL 0.075 / 0.041 → 0.074 / 0.040、「canvas の彩度は 0.033。これを下回ると水色と読めない」の撤回と round 4 の理由）、各行末の L・ΔL の注記 |
| `apps/web/src/app/globals-tokens.test.ts` | spec 値の 5 トークンを round 4 値へ。2 系統の同値の検証はそのまま効く |
| `apps/web/src/app/layout.tsx` | `themeColor` `#dfe8ed` とコメント |
| `docs/design/colors_and_type.css` | globals.css の第 2 コピー。同じ 5 値と ΔL のコメント |
| `docs/design/ui_kits/kagetra-mobile/palette.css` | 同じ 5 値 |
| `docs/design/design.md` | §5 の round 4 の箇所 |
| `.claude/memory/project_kagetra_color_tokens.md` | 「canvas 水色 `#d3eafa`」の記述を round 4 値へ（出荷時） |

brand 系・朱・山吹・墨・ピル地・影・テクスチャ・LINE Flex・級トーンは触らない。コンポーネントの className も変えない。

### round 1〜3（PR #648 で反映済み）

| ファイル | 内容 |
|---|---|
| `apps/web/src/app/globals.css` | **正典**。ヘッダコメント・`@theme --color-*`・`:root --kg-*` の 2 系統・影 3 本・Ink 節の実測コントラスト値コメント・`--kg-nonattend` のコメント（「藤との比 4.82」→「紺との比 6.34」）・Surfaces 節の ΔL コメント |
| `apps/web/src/app/globals-tokens.test.ts`（新設） | §8 のチェック 1〜3 を機械化する。globals.css を読み、2 系統の同値・spec 値との一致・同値関係を検証 |
| `apps/web/src/app/layout.tsx` | `themeColor` とコメント |
| `apps/web/src/lib/line-flex-mail-body.ts` + `.test.ts` | `BADGE_COLOR`・doc コメント・テストの hex とコメント |
| `apps/web/src/lib/open-chat/flex.ts` | `FLEX_BTN_BG` |
| `apps/web/src/lib/stats/grade-tones.ts` + `.test.ts` | ランプ 5 色・`ALL_SERIES_TONE`・doc コメント（「藍→砂」→「紺→水色鼠」） |
| `apps/web/src/app/(app)/events/EventListClient.tsx` | トグルのコメントのみ |
| `apps/web/src/components/events/detail/TravelReportCta.test.tsx` | テスト名の「藤の行」の表記のみ |
| `docs/design/colors_and_type.css` | globals.css の第 2 コピー。同時更新 |
| `docs/design/design.md` | §5 |
| `docs/spec/notifications.md`・`docs/spec/events-attendance.md` | 「藤バッジ」「藤（…）」の色名表記 各 1 箇所 |
| `docs/design/ui_kits/kagetra-mobile/palette.css` | **初代の値のまま 2 世代腐っている**。機械的に新値へ |
| `docs/design/design-system-readme.md`・`docs/design/SKILL.md` | 同じく初代の記述のまま。全面改稿はせず、冒頭に「配色の記述は初代のもの。正典は globals.css と design.md」の注記を 1 つ置く |
| `.claude/memory/project_kagetra_color_tokens.md` | 「参加/成功 = 藤」「純白 6 箇所」ほかが偽になる。同時更新 |

`tailwind.config.js` は存在しない（Tailwind v4 は CSS が設定を兼ねる）。コンポーネントの className は 1 つも変えない。

---

## 7. 検証方法

### round 4 の実画面確認（未確認として報告し、出荷後に本番で確認）

- 地の青みが淡くなりすぎていないか。375px の全面で「冷たい灰」に見えて寂しい場合の調整先は案2 `#dde8f0`（`LADDER_CHROMA` を 0.5 へ）。逆に、まだ青いなら彩度をさらに落とす。**どちらの場合も明度は動かさない**
- 背景テクスチャ（opacity 0.05）が、青みの淡い canvas の上で汚れて見えないか
- 藍みの影が、青みの淡い canvas の上で浮いて見えないか
- `surface-alt` の上の neutral / info の地（§2.1: メール取込の下書きカードの状態ピル、`admin/members` の種別バッジ）が読めるか。輪郭が溶けるのは想定内で、文字と文言で読めれば今回は直さない
- PWA のステータスバー色（`themeColor`）が地と揃っているか。反映には PWA の再追加が要ることがある

round 1〜3 の実画面確認のうち、「地の水色の強さ」は round 4 の起点になった。そのほかの項目（影の alpha・テクスチャ・`--kg-nonattend`・LINE Flex の紺）について、ユーザーは実画面を見たうえで指摘を出していない（2026-09-22 のヒアリングでは「特になし」）。

### 静的に検証できるもの

- `node docs/features/hokumei-palette/palette-check.mjs` が exit 0（OKLCH 導出値 = spec 値、ラダー下限、コントラスト全ペア）
- 新設の `globals-tokens.test.ts`（2 系統の同値・spec 値との一致・同値関係）
- 生成 CSS の実コンパイル照合。**Tailwind v4 は未定義トークンを無言で握り潰す**ため、typecheck・lint・vitest だけでは足りない。トークン名は 1 つも増減させないので、照合は「全 `--color-*` が出力され、値が §2 と一致する」ことの確認になる
- 照合は `var(--color-*)` の**参照名**で行う。**hex 照合は無効**（`success == brand`、`danger == accent`、今回からは `surface == ink-on-brand == white` も衝突する）
- 既存テスト・lint・typecheck は CI で green を確認する（ローカル全実行を要求しない）

### round 1〜3 の実画面確認項目（記録）

- 地の水色が 375px 全面で強すぎないか・物足りなくないか → **強すぎた。round 4 で対応**
- 純白カードの上で影が過剰に見えないか（alpha の再調整）
- テクスチャ（opacity 0.05）が彩度の上がった canvas の上でどう見えるか
- `--kg-nonattend`（暖色ピンク）が水色の面の上で意図的に見えるか
- LINE トーク上での Flex バッジ・ボタンの紺の見え方

---

## 8. 忠実度チェックリスト ★実装の完了ゲート

### round 4（今回の完了ゲート）

- [ ] `node docs/features/hokumei-palette/palette-check.mjs` が exit 0（round 4 の `PINNED` と導出値が一致し、ラダー下限とコントラストが全て合格）
- [ ] `globals.css` の `@theme` の 5 トークンが §2.1 の round 4 値と一致する: `canvas #dfe8ed`・`surface-alt #d1dbe2`・`border-soft #cad2d9`・`border #b6bfc7`・`border-strong #9099a2`
- [ ] `:root` のミラー（`--kg-bg`・`--kg-surface-alt`・`--kg-border-soft`・`--kg-border`・`--kg-border-strong`）が `@theme` 側と同値
- [ ] 上の 5 トークン以外の値が 1 つも変わっていない（`git diff` で `globals.css` の値の変更がちょうど 10 行。brand・朱・山吹・墨・ピル地・影・テクスチャ・`--kg-nonattend` は不変）
- [ ] トークン名の増減が 0。コンポーネントの className に差分が無い
- [ ] `globals-tokens.test.ts` の spec 値が round 4 値へ更新され、green
- [ ] `layout.tsx` の `themeColor` == canvas `#dfe8ed`
- [ ] `docs/design/colors_and_type.css`・`docs/design/ui_kits/kagetra-mobile/palette.css`・`docs/design/design.md` から A1 のラダー値（`#d3eafa` `#c3ddf0` `#bdd5e6` `#a8c2d6` `#839bb3`。大文字小文字を問わない）が消えている。`docs/features/hokumei-palette/` の経緯の記述と `docs/worklog.md` は除く
- [ ] `globals.css` と `colors_and_type.css` のコメントから「canvas の彩度は 0.033。これを下回ると水色と読めない」が消え、ΔL の注記が 0.074 / 0.040 になっている
- [ ] 生成 CSS の実コンパイル照合で、5 トークンの `--color-*` が round 4 値で出力されている（Tailwind v4 は未定義トークンを無言で握り潰すため）

### round 1〜3（PR #648 でクリア済み。同値関係・据え置き・名前の不変などの条件は round 4 でも有効。canvas 系の hex と `themeColor` の値は round 4 の表が優先する）

- [x] `globals.css` の `@theme --color-*` 全トークンが §2 の表と一致する（`palette-check.mjs` の `PINNED` と同値）
- [x] `:root --kg-*` のミラーが `@theme` 側と全て同値である（`canvas`↔`bg`、`ink*`↔`fg*`、`line*`↔`line-green*` の名前対応を含む）
- [x] 同値関係が保たれている: `success*` == `brand*`（3 本）、`danger*` == `accent*`（3 本）、`info-fg` == `neutral-fg`、`ink-on-brand` == `surface`
- [x] 朱・山吹の 6 トークンと LINE 緑・`--kg-nonattend` の値が**変わっていない**
- [x] トークン名の増減が 0（新設も削除もしない）。`bg-white` / `text-white` の例外 6 箇所を置換していない。コンポーネントの className に差分が無い
- [x] 影 3 本が 2 層のまま、基色 `rgba(23, 43, 73, α)`、alpha は現行と同じ。`--kg-texture` と段の割り当ては不変
- `themeColor` == canvas（値は round 4 の `#dfe8ed` が正。A1 の `#d3eafa` は PR #648 時点の値）
- [x] LINE Flex の `BADGE_COLOR` と `FLEX_BTN_BG` がどちらも brand `#15387d`
- [x] `GRADE_TONES.A` == brand、A→E で明度が単調増加、`ALL_SERIES_TONE` == neutral-fg
- [x] `docs/design/colors_and_type.css` が globals.css と同値。`design.md` に「純白は使わない」が残っていない
- [x] `globals.css` のコメント内の実測値（Ink 節のコントラスト・Surfaces 節の ΔL・nonattend の比）が新値に書き換わっている（古い数値が残ると次の変更者を誤らせる）
- [x] `palette-check.mjs` が exit 0

---

## 9. 実装プロセス上の注意

### round 4

- `docs/features/hokumei-palette/` の 3 ファイルは tracked である。ただし round 4 の改訂は **main の作業ディレクトリで未コミットの変更**（`git status` で ` M`）として置かれている。`/implement` の worktree は origin/main から作るので、**worktree には round 3 の古い版が存在する**。「ファイルが無ければ cp」では素通りしてしまう。**worktree 作成直後に 3 ファイル（`design-spec.md`・`implementation-plan.md`・`palette-check.mjs`）をメイン作業ツリーの版と diff し、cp で上書きして最初にコミットする**こと
- `globals.css` は全画面に効く単一ファイルである。着手前に、他ブランチが UI トークンを触っていないか確認する
- 地の強さ・テクスチャ・影の見え方は jsdom で検証できない。確認済みと偽らず、§7 の round 4 実画面確認項目として「未確認」で報告する

### round 1〜3

- 本ディレクトリは **main の作業ディレクトリに untracked で置かれている**。`/implement` の worktree には存在しないので、**worktree 作成直後に `docs/features/hokumei-palette/` を cp して最初にコミットする**こと（`palette-check.mjs` を含む 3 ファイル）。
- `globals.css` は全画面に効く単一ファイルである。着手前に他ブランチが UI トークンを触っていないか確認する。2026-09-21 時点で開いている worktree（`design/travel-report`・`feature/import-past-results`・`feature/remove-schedule`）は `globals.css`・`docs/design`・上表のリテラル箇所のいずれも触っていない。
- 影・テクスチャ・水色の強さは jsdom で検証できない。確認済みと偽らず §7 の未確認項目として報告する。

---

## 10. Non-goals

### round 4 で追加

- brand 系（紺）・`brand-bg`・`success*` の変更。ユーザーは「背景以外に気になる点は特になし」と回答した
- `info-bg`・`neutral-bg` の変更。`surface-alt` との同色化（§2.1）も直さない
- 影の alpha・基色、テクスチャの opacity の変更（§7 の実画面確認で問題が出たら別途）
- 明度ラダー（ΔL）の変更
- `design.md` の round 4 の箇所（§5）以外の書き換え

### round 1〜3 から継続

- ダークモードの追加
- タイポグラフィ・角丸・余白・レイアウトの変更。コンポーネントの className 変更
- トークンの新設・削除（名前は 1 つも変えない）
- 影の段の追加、sticky 要素への影付与、`shadow-sm` 手書き 13 箇所の `Card` への集約（前回の Non-goals を継承）
- `accent` と `danger` の hex 共有の解消
- アプリアイコン（「か」一文字の PNG）の差し替え。別タスクとして起票済み。差し替え時の地色は本 spec の brand `#15387d` を使う
- 会員向けガイド PDF（`docs/materials/member-guide-2026-08/`）の紫配色の差し替え。別作業。色は本 spec の brand 系へ寄せればよい
- `design-system-readme.md`・`SKILL.md` の全面改稿（注記 1 つに留める）
- `avatar-colors.ts`・LINE Flex の中立色・添付バッジ色（Excel 緑ほか）の変更

---

## 11. 要件への宿題（→ /define-feature hokumei-palette）

なし（新ロジック・新データなし）。round 4 も同じく、色の値の変更だけで完結する。

---

## 12. 変更履歴

- 2026-09-21: round 1〜3。藤 × 墨から白波 × 紺（A1）へ刷新。PR #648 で出荷
- 2026-09-22: round 4。面と枠線のラダー 5 トークンの彩度を 0.375 倍にした（canvas `#d3eafa` → `#dfe8ed`、彩度 0.033 → 0.012）。明度・色相とそれ以外の全トークンは据え置き（理由: 本番の実画面で「背景まで水色は少しやりすぎ」。明度を上げるとカードとの ΔL が縮み「のぺっと」が再発するため、彩度だけを動かした）
