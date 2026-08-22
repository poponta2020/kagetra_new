---
name: feedback-tailwind-v4-undefined-token-silent
description: Tailwind v4 は未定義トークン参照のクラスに CSS を出力せずエラーも出さない。配色変更は生成CSSの機械照合とコントラスト比検算の2段で検証する
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3ba2bc9c-b3d7-4e8d-a920-508b71dc8f82
  modified: 2026-08-22T13:07:05.121Z
---

Tailwind v4 は**未定義トークンを参照するユーティリティクラスに対して CSS を一切出力せず、エラーも警告も出さない**。`text-ink-meta` を `text-ink-metal` とタイポしても、build / `pnpm lint` / `pnpm check-types` / vitest はすべて green のまま、その要素だけ色が消える。

**Why:** 既存のどのゲートもこの失敗モードを検出できない。jsdom ベースの vitest は CSS を適用しないので、コンポーネントをレンダリングするテストがあっても素通りする。配色をトークン化する変更は「置換したつもりで無色化していた」が本番で初めて分かる形になりやすい。

**How to apply:** 配色まわりの変更では検証を2段に分ける。「出力されるか」と「読めるか」は別問題で、片方だけでは不十分。

1. **生成CSSの機械照合** — postcss + `@tailwindcss/postcss` で実スタイルシートをコンパイルし、(a) 導入した全ユーティリティが CSS を出力する (b) 期待どおり `var(--color-*)` を参照する (c) 参照先トークンが期待 hex で出力される (d) 撤去したクラスが消えている、を突き合わせる。`node_modules/.bin` に Tailwind CLI は無く `@tailwindcss/postcss` だけがあるので、15行程度の mjs を書いて postcss を直接叩く。
2. **コントラスト比の検算** — 1 はコントラストを見ない。トークンを置き換えたら相対輝度から `(L1+0.05)/(L2+0.05)` を計算し、置換前後を比較する。目視や推測で判断しない。

PR #333 では 1 を通した後で 2 の回帰が残っていた（`ink-meta`#7a6e5a on `surface-alt`#f0eadc = 4.16:1 < AA 4.5、置換前の `gray-500` on `gray-50` は 4.63:1）。Codex レビューが検出。

kagetra の実測値は `apps/web/src/app/globals.css` の Ink セクションにコメントで記載済み（`ink-meta` は surface 上のみ OK、surface-alt / canvas 上は NG、代替は `neutral-fg` 6.71:1。`ink-muted` は本文に使わない = surface 上 2.53:1）。

## 全ツリー掃討（PR #531 で確立・再利用可）

個別の差分検証だけでなく「**ソースに literal で書かれているのに生成CSSにセレクタが出てこない = Tailwind が握り潰した**」を全 `.tsx` に対して総当たりできる。Tailwind のスキャナは生テキストを読むので、ソースにある literal は必ずコンパイラへ渡っている。出てこないなら棄却された、と言い切れる。

実装時に踏んだ罠が4つある。どれも「異常なし」と誤読する方向に効くので、必ず対策する。

1. **生成CSSのセレクタはCSSエスケープされている** — `.hover\:text-ink` / `.tracking-\[0\.4em\]`。素の grep は必ず「無い」と誤答する。セレクタを取り出してアンエスケープしてから集合比較すること。実際 `grep 'tracking-\[0\.4em\]'` が 0 を返して「走査漏れか」と誤診しかけた。
2. **部分文字列の罠** — `text-ink` は `text-ink-2` / `-meta` / `-muted` / `-on-brand` の部分文字列。完全一致で判定する。
3. **複数行 template literal を取りこぼす** — `className={\`... text-ink-1 ${cond}\`}` は行単位スキャンだと落ちる（既知21箇所のうち1件を落とした）。ファイル全体をトークン列として走査する。
4. **検出器そのものを自己テストする** — 既知の壊れたトークンを含むツリー（`git archive origin/main | tar -x` で安全に取り出せる）に対して走らせ、既知件数を全件拾えることを確認してから「クリーン」を信用する。

誤検出はほぼ**コメント文中の文字列**（`box-sizing: border-box` の説明、JSDoc の「border-strong 下線」等）。実クラスかどうかは目視で切り分ける。

**「生成CSSが置換前後でバイト単位同一」は、旧トークンが何も出力していなかったことの証明になる**（PR #531 で使用）。逆に言えば差分が出たら想定外の副作用がある。

## 未処理の同種案件（2026-08-22 時点）

`warning` というトークンは `globals.css` に一切存在せず、`warn` も `--color-warn-bg` / `--color-warn-fg` のみでスカラーの `warn` は無い。PR #531 のスコープ外として残していた2件は **2026-08-22 に解消済**（`border-warn-fg/30` / `bg-warn-bg` へ置換。既存の警告カード idiom = `roster-drafts/[id]/page.tsx:224,281` に合わせた）:

- `admin/mail-inbox/components/TournamentSeriesSelectSheet.tsx:165` — `border border-warning/30 bg-warning/10`。**影響大**だった: 背景が出ず、素の `border` で枠線が `currentColor`（≒黒）になり警告ボックスが「黒枠・無地の箱」になっていた
- `admin/mail-inbox/[id]/page.tsx:349` — `<Card className="border-warn bg-warn-bg">`。枠線色だけ既定のまま。軽微

全ツリーに `warning` 参照と裸の `warn` カラーユーティリティは残っていない（確認済）。

## 1ファイル単位で「この呼び出し箇所が直ったか」を検証する

全ツリーコンパイルでは**直したトークンが他のファイルからも出力されている場合、存在確認が判定材料にならない**（`bg-warn-bg` は約15箇所、`border-warn-fg/30` は roster-drafts が既に使用）。呼び出し箇所単位で見るには対象ファイル1件だけをスキャンさせる:

```
@import "tailwindcss" source(none);
@source "<対象ファイルだけを置いた一時ディレクトリ>";
```

globals.css の本文はそのまま使い、`@import` 行だけ上記に差し替える。worktree には `node_modules` が無いので `postcss.process()` の `from` はメインリポの `apps/web/src/app/globals.css` を指す（`@import "tailwindcss"` の解決基点にしか使われない。スキャン対象は `source(none)` + `@source` で固定されるのでメインリポのソースは読まれない）。

**hex で判定してはいけない**: `warn-bg` / `danger-bg` / `accent-bg` はすべて `#f7e6e2`、`warn-fg` / `danger-fg` / `accent-fg` はすべて `#8f2d20`。`bg-danger-bg` と誤記しても hex 照合は通る。`var(--color-warn-bg)` の**参照名**で判定すること。見た目も同一になるのでスクリーンショットも判別材料にならない。

**`border-warn` は `border-warn-fg` の部分文字列**（トラップ2の実例）。ソース側の substring 検索は「まだ残っている」と誤答するので、生成CSS側のセレクタ集合に対する完全一致だけを判定に使う。

**再発しやすい構造**: `--kg-*` 系は `fg` / `fg-2` / `fg-3`、`@theme` 系は `ink` / `ink-2` / `ink-meta` と命名が食い違う。`ink-1` は番号付きの `fg-2` からの類推で生まれる。掃討スクリプトの CI ガード化が本質的な対策（未実施）。

関連: [[project-kagetra-color-tokens]] [[feedback-tailwind-utility-output-order-not-classname]]
