# ライラック配色 + 立体感 実装手順書

**要件の正**: `design-spec.md`（UI リデザインのため design-spec が要件成果物。define-feature は回さない）
**slug**: `lilac-palette`
**ブランチ**: `feature/lilac-palette`

## 実装順序（Wave）

全タスクを **main 直列**で実装する。Wave（並行）は編成しない。理由:

- タスク1（`globals.css`）は全画面に効く中核で、他の全タスクが依存する
- タスク2〜8 はいずれも数箇所の編集で終わる**小径のタスク**であり、task-implementer 起動のオーバーヘッドの方が高くつく
- タスク7（`design.md` の原則改訂）は requirements / design-spec との整合性判断を伴うため main の担当

## タスク一覧

- [ ] 完了 **タスク1: `globals.css` の全面刷新**
  - `@theme --color-*` と `:root --kg-*` の 2 系統を同時更新（design-spec §2 の全トークン）
  - `--color-warn` を新設（**実装直前に裸の `warn` 参照 0 件を再確認する** — design-spec §2.5）
  - 影を 2 層化・色相を藤みへ・`--shadow-md-up` 新設・`--kg-shadow-*` 4 本を削除（design-spec §3）
  - 背景テクスチャを追加（design-spec §4。`body` / `.mobile-shell-h` の両面に意図した値を置く）
  - **Ink セクションの実測コントラスト値コメントを書き換える**（現在の値は変更後に嘘になる）
  - 依存: なし
  - 対応 AC: design-spec §2 全体・§3.2〜3.4・§4

- [ ] 完了 **タスク2: `Card` プリミティブの立体化**
  - 段 1 の影を付与・枠線を `border` → `border-soft` へ
  - **doc コメント「washi-ivory bg, kinari border」を書き換える**（変更後は嘘になる）
  - 依存: タスク1
  - 対応 AC: design-spec §3.1・§3.3

- [ ] 完了 **タスク3: シェルの段 2 影**
  - `bottom-nav.tsx` に段 2（上向き）の影
  - `mobile-shell.tsx` の sticky ヘッダに段 2（下向き）の影、背景テクスチャの配置
  - **z-index の積み重ね順を確認**（PR #529 で `relative` だけではスタッキングコンテキストを作らない件を踏んでいる）
  - 依存: タスク1
  - 対応 AC: design-spec §3.3・§4

- [ ] 完了 **タスク4: `shadow-sm` 14 箇所の整理**
  - `Card` への集約で冗長化した分を削除する。`Card` を使っていない独立要素は残す
  - 依存: タスク2
  - 対応 AC: design-spec §3.4

- [ ] 完了 **タスク5: ハードコード hex の置換**
  - `EventListClient.tsx` / `layout.tsx` の hex をトークン参照へ。テストの `#123456` は対象外
  - 依存: タスク1
  - 対応 AC: design-spec §6

- [ ] 完了 **タスク6: `docs/design/colors_and_type.css` の更新**
  - `globals.css` が `Source:` として参照する第 2 コピー。放置すると腐る
  - 依存: タスク1
  - 対応 AC: design-spec §6

- [ ] 完了 **タスク7: `docs/design/design.md` の改訂**
  - 視覚原則 2 箇所（「紫の会議ピル…」の明確化 ／「No decoration」へのテクスチャ例外）
  - 「基調カラー」節ほかカラー記述全般の更新
  - 依存: タスク1
  - 対応 AC: design-spec §5

- [ ] 完了 **タスク8: memory の更新**
  - `.claude/memory/project_kagetra_color_tokens.md` の「参加/成功 = 藍」「success は緑でなく藍」が偽になるため更新
  - 依存: タスク1
  - 対応 AC: design-spec §6

## 検証方針

- **静的検証のみ**。影・テクスチャは純粋な描画のため jsdom では検証できない（design-spec §7）
- 検証は `var(--color-*)` の**参照名**で行う。**hex 照合は無効**（`success == brand`、`danger == accent` で hex が衝突している）
- Tailwind v4 は未定義トークンを無言で握り潰すため、typecheck / lint / vitest はこの種のバグに診断能力がない。**生成 CSS の実コンパイル照合**で担保する
- ローカルのフルスイートは実行しない（`DEVFLOW_CI_COVERS` 宣言済み。CI が最終網）

## 未確認として報告する項目

- 影の見え方・ノイズ濃度（opacity 0.05 の初期値が適切か）
- テクスチャを `body` / `<main>` のどちらに置くのが正か
- 段 1 と段 2 の影が重なる z-index の実描画
- `--kg-nonattend`（暖色ピンク）が藤色の面の上で意図的に見えるか
