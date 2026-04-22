# Kagetra Design System 配布物

このディレクトリは Claude Design (claude.ai/design) から受け取った handoff bundle を展開したものです。
**実装ソース**（`apps/web` 配下のコード）ではなく、**設計の意思決定と参照資料** として配置しています。

## ファイル構成

| ファイル | 役割 |
|---|---|
| [design.md](./design.md) | 設計書本体。画面仕様・視覚原則・決定/未決事項・移行ガイド |
| [colors_and_type.css](./colors_and_type.css) | トークン原本（CSS 変数 + セマンティッククラス） |
| [design-system-readme.md](./design-system-readme.md) | 設計システム総論（content fundamentals + visual foundations） |
| [SKILL.md](./SKILL.md) | Claude Code 用の skill manifest |
| [ui_kits/kagetra-mobile/](./ui_kits/kagetra-mobile/) | 8 画面のプロトタイプ（React/JSX 張りぼて） |

## 実装側との対応

- 色・タイポ・余白・角丸・影の **最終的な値** は `apps/web/src/app/globals.css` の `@theme` および `:root` ブロックに反映済み（Phase UI-1）
- `design.md` § 4 の画面仕様は Phase UI-3 で順次既存画面に反映する
- `ui_kits/kagetra-mobile/*.jsx` は参照用。そのまま import してはいけない（inline style のプロトタイプ）

## 更新ポリシー

- デザインを変更する場合、Claude Design 側で編集して handoff bundle を受け取り直し、このディレクトリを更新する
- 実装側の都合でトークン値を調整した場合、`colors_and_type.css` ではなく `globals.css` が正
