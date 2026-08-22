---
status: approved
issue: 528
---
# バグ改修要件: /mail 一覧の添付チップが sticky 検索バーの手前に描画される

## 再現手順

1. 一般会員（またはそれ以上）でログインし `/mail` を開く
2. 添付ファイル付きのメールが一覧に含まれる状態で下方向へスクロールする
3. 添付チップがヘッダー領域に差し掛かったとき、チップが検索バーの上に重なって表示される

- 期待: sticky 検索バーが常に一覧コンテンツより手前に描画され、添付チップは検索バーの下へ隠れてスクロールアウトする
- 実際: 添付チップだけが検索バーより手前に描画される（日時・大会案内/処理済みピル・件名・抜粋は正常に隠れる）

## 根本原因

| 箇所 | 現状 |
|------|------|
| `apps/web/src/app/(app)/mail/page.tsx:72` | sticky 検索バー = `sticky top-0 z-10` |
| `apps/web/src/app/(app)/mail/MailCard.tsx:71` | カードのルート = `relative`（`z-index: auto`） |
| `apps/web/src/app/(app)/mail/MailCard.tsx:119` | 添付チップの `<Link>` = `relative z-10` |

`position: relative` は `z-index: auto` のままではスタッキングコンテキストを作らない。したがってチップの
`z-10` はカードの外へ抜け、sticky 検索バーと**同じ**スタッキングコンテキスト（`<main>` は
`overflow-y-auto` だけなのでスタッキングコンテキストを作らない）で `z-10` 同士のタイになる。
CSS のペイント順では同一 z-index の positioned 要素は DOM 順で決まるため、後方にあるチップが手前に出る。

裏付け: カード内の他要素（日時・ピル・件名・抜粋・履歴サマリ）は非 positioned なので必ずヘッダーの下に
描画され、実際に重ならない。「チップだけが重なる」という症状が z-index 起因であることを示している。

チップの `z-10` 自体は必要な指定で、カード全体オーバーレイ `<Link>`（`absolute inset-0 z-0`）より
チップを手前に出して個別リンクをタップ可能にするためのもの（`MailCard.tsx` 冒頭コメント）。

## 修正方針

`MailCard` のルート要素に `isolate`（`isolation: isolate`）を足し、**カード内の z-index をカード内で閉じる**。

- カードは自前のスタッキングコンテキストになるため、内部の `z-0`（オーバーレイ）と `z-10`（チップ）の
  上下関係は従来どおり維持される＝タップ可能性・リンク構造は無変更
- カード自身は親のスタッキングコンテキストでは `z-index: auto` の positioned 要素として描画され、
  `z-10` の sticky 検索バーより後ろに回る＝重なりが解消する

### 採らない案

- **検索バーを `z-20` に上げる**: 対症療法。`players/page.tsx:44` と `components/stats/section-tabs.tsx:66`
  が「検索バー = z-10 / タブ = z-20」を明文化しており、これを崩すと他画面と不整合になる。
  加えてチップの z が外へ抜ける構造自体は残るため、別の sticky 要素で再発する
- **チップの `z-10` を落とす（`relative` のみ）**: ツリー順でオーバーレイ（`z-0`）より後なので動作はするが、
  「チップはオーバーレイより手前」という意図が暗黙になり壊れやすい。封じ込め（isolate）を採る

## Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|------|
| AC-1 | `MailCard` のルートがスタッキングコンテキストを閉じている（`isolate`）ため、チップの `z-10` が `sticky z-10` の検索バーへ届かない | auto-test（回帰テスト・クラス不変条件） |
| AC-2 | `/mail` の sticky 検索バーが `sticky top-0 z-10` + 背景 `bg-canvas` を保つ（検索バー側の z を上げる対症療法をしていない） | auto-test |
| AC-3 | カード内では従来どおり添付チップがカード全体オーバーレイ `<Link>` より手前（`a a` = 0・リンク数・href が不変） | auto-test（既存テスト） |
| AC-4 | 既存テスト・lint・typecheck がすべて成功する | auto-test |
| AC-5 | 本番実機で `/mail` をスクロールしてもチップが検索バーに重ならない | manual（出荷後・ユーザー確認） |

### 検証手段についての注意

jsdom にはレイアウト・ペイントが無いため、**実際の重なりはテストでは証明できない**。回帰テストは
「重なりを生む条件（カードが z を閉じていない／検索バーの z 契約が変わった）」をクラス不変条件として
固定するもの。実描画の確認は AC-5（本番実機）に委ねる。

## Non-goals

- 検索バーの `z-10` を `z-20` へ上げる対症療法
- 他画面の z-index 整理・sticky 周りのリファクタ
- `/mail/[id]` 詳細画面や `admin/mail-inbox` の見た目変更
- 添付チップのデザイン・情報量の変更

## 影響範囲

- `apps/web/src/app/(app)/mail/MailCard.tsx` … ルートに `isolate` 追加 + 冒頭コメント追補（1 行の class 変更）
- `apps/web/src/app/(app)/mail/MailCard.test.tsx` … AC-1 の回帰テスト追加
- `apps/web/src/app/(app)/mail/page.test.tsx` … AC-2 の sticky 契約テスト追加

同じ overlay パターン（`absolute inset-0` + `relative z-10`）を使っているのは `MailCard.tsx` のみで
（repo 全体 grep 済み）、他画面への波及はない。BottomNav はシェルの flex 兄弟で重なり領域を持たないため無関係。
