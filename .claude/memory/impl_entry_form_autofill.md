---
name: impl-entry-form-autofill
description: entry-form-autofill 実装（全8タスク）
type: project
---

entry-form-autofill（大会申込書 xlsx 自動記入 + Yahoo 下書き作成）の実装。全8タスク完了・PR 未作成。

## 出荷内容（feature/entry-form-autofill・11コミット）
- migration 0050: app_settings（会定数 key-value・entry_form. 接頭辞）/ entry_form_drafts（作成履歴・生成 xlsx bytea・status created|imap_failed）
- apps/web/src/lib/entry-form/: cell-map（列対応推定）/ fill（記入エンジン）/ ai-extract（Haiku フォールバック＋主催者指定抽出）/ mail-template / mime（自前組立）/ imap-draft（APPEND）/ settings / workbook（exceljs 型境界）
- 画面: /admin/entry-form/[groupId]（3ステップウィザード）・/settings/entry-form（会定数）・進行管理への「申込書」行
- /api/admin/entry-form/drafts/[id]（生成 xlsx DL。再取得と失敗時取得を1本に集約）

## 実装中の重要判断（次回の判断材料）
- **fixture は合成せず実物由来にした**。ローカル dev DB の mail_attachments に実際の申込書テンプレが残っており（id 127/123/90/86）、PII だけ差し替えて 5 fixture を生成（build-fixtures.mts + README に構造マップ）。合成 xlsx だと結合セル・数式・入力規則が「自分のスクリプトが書いたものだけ」になり AC-10（非破壊性）の検証が空回りする
- **明細行の終端は入力規則の最終行で決める**。空セルのスキャンだけだと余白行まで書けてしまい、セルは壊れないまま主催者側 COUNTIF/SUM の集計値だけが実数より少なくなる（standard.xlsx は DV r12..r31 に対し空行は r36 まで）。最も気づきにくい壊れ方
- **本番 env の追加作業は不要と判明**。実装手順書は「compose の web サービスへ YAHOO_IMAP_* 追記」としていたが、compose に web は無く systemd の kagetra-web.service が /opt/kagetra/.env.production を EnvironmentFile に読む。YAHOO_IMAP_* は mail-worker と共用で既にある
- **AC-13 が一度未配線で落ちかけた**。UI ワーカーが「extractOrganizerInstructions がどこからも呼ばれていない」と報告して発覚。actions の analyzeTemplateAction に案内メール本文の取得と AI 抽出を足して配線
- 本文の名乗りはフルネーム・署名は姓（design-mock/b-step3.html の実例）。settings.managerName をそのまま渡す

## Wave 構成と委譲
- Wave1: T1(main) / T2・T3(worker 並行) → Wave2: T4・T5・T6(worker 3並行) → T7 actions(main)→UI(worker) → T8(main)
- 変更領域の重複ゼロ。統合時の衝突なし

## 環境の罠（今回踏んだもの）
- **server-only は vitest から import すると throw する**（default condition が「throw する1行」。Next のビルドだけが react-server condition で空実装に差し替える）。vitest.config.mts で src/test-utils/server-only-stub.ts へ alias した。パッケージ同梱の ./empty.js は exports に載っておらず直接指せない
- **apps/web の vitest（jsdom）では import.meta.url が file: にならず fileURLToPath が throw する**。fixture パスは resolve(process.cwd(), 'src/lib/entry-form/__fixtures__') で解決する（mail-worker 側の先例は使えない）
- exceljs の xlsx.load/writeBuffer は非ジェネリック Buffer 型で、Node22 の Buffer<ArrayBufferLike> と噛み合わない。lib/entry-form/workbook.ts に境界を閉じ込めた
- **Windows では next build の standalone コピーが EPERM（symlink 権限）で落ちる**。コンパイルとページ生成は完了しており、CI(Linux) では問題にならない

## 検証状況
- web 2107 / shared 32 / mail-worker 456 テスト green・lint clean・typecheck clean
- 生成 CSS で使用トークンが全て var(--color-*) に解決することを照合済み
- **未実施**: 375px 実画面の目視（worktree から長寿命プロセスを起動しない規約のため）・AC-21 本番実機確認

worktree: C:/tmp/impl-entry-form-autofill
