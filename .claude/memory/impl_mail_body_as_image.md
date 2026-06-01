---
name: impl_mail_body_as_image
description: mail-body-as-image 機能の実装進捗・ブランチ・worktree・非自明な実装判断
metadata: 
  node_type: memory
  type: project
  originSessionId: 7ac76341-fb6b-44c8-9630-2b9826cb7193
---

LINE 配信メール本文を A4 縦 JPEG 画像で送る機能。添付は全形式 URL リンク統一（Excel と同じ）。要件/手順は `docs/features/mail-body-as-image/`（親 Issue #73、子 #74-#78）。**1 PR で全 5 タスク**。

- ブランチ `feat/mail-body-as-image`（merge 済・削除）/ worktree も削除済
- **SHIPPED + 本番反映済 (2026-06-01)**: 全 5 タスク → PR #84 → auto-review R1 PASS → merge `cc6c765`。子 #74-#78 + 親 #73 全クローズ。**本番 `322b3b7` に手動デプロイ済**（ホスト上で build→静的cp→`systemctl restart kagetra-web`、libreoffice/pdftoppm/日本語フォント86 揃い確認）。手順は [[project_auto_deploy]] のデタッチ実行方式で実証。**残 DoD = 実機 LINE で本文画像目視のみ**
  - Task1 #74 `f68e918`: `mail-body-image-render.ts` 新規（`buildBodyImageHtml` + `renderBodyImageToJpegs`）
  - Task2 #75 `f994a18`: `line-broadcast.ts` 本文 text→画像化、`renderAttachment` 全添付リンク統一、`MessageRole` を body_image/body_text/attachment_link に再編
  - Task3 #76 `1518d67`: 共通 `runLibreofficeConvertToPdf` を `attachment-image-render.ts` に抽出 export、未使用 `renderDocxToJpegs` 削除
  - Task4 #77 `0cb2764`: `line-broadcast.test.ts` 更新（`renderBodyImageToJpegs` をモジュールモック）
  - Task5 #78 `03c8b36`: plan 全チェック + worklog 追記
  - 検証: apps/web 全ユニット **263 passed / 1 skipped**（skip=libreoffice 統合テスト, Windows ローカル未搭載）、check-types clean、lint clean
- 非自明な実装判断/罠:
  - **line-broadcast.test.ts は `@/lib/mail-body-image-render` をモジュールモック**して決定化。libreoffice spawn を mock しない統合テストは `mail-body-image-render.test.ts` 側に隔離（要件 §4.4）。本文画像成功ケースは sharp 生成の有効 JPEG を使う
  - 本文画像化失敗・30 ページ超・0 枚・10 MB 超・baseUrl 未設定はすべて text fallback（buildBroadcastBody + splitForLine）に降格
  - 30 ページ超は text fallback のみ（本文専用 share token テーブルは作らない、§4.3）
  - 手順書 Task 5 の検証コマンド `pnpm --filter @kagetra/web typecheck` は**誤記**。実スクリプトは `check-types`（`tsc --noEmit`）。lint は `next lint`
  - フィーチャー docs は main で未追跡だった → feature ブランチに同梱コミット
- **残 DoD**: 本番デプロイ後に実機 LINE グループで本文画像表示を目視確認（Windows ローカルに libreoffice 無く画像描画はローカル未検証、CI/本番 Linux で実描画）
- **後日バグ修正 (PR #94, merge `c6a4be6`, 2026-06-01)**: 本文画像の **1 枚目が真っ白** になる不具合 (Issue #93)。原因は LibreOffice の HTML→PDF が Writer コンポーネント未指定だと「Web レイアウト」で先頭に空白ページを挿入する既知バグ。`runLibreofficeConvertToPdf` に `--writer` を追加して回避し、libreoffice 統合テストを「短い本文→ちょうど 1 ページ」(`toBe(1)`) に強化。auto-review R1 PASS → CI green(Linux 実描画で 1 ページ確認) → ship → auto-deploy で本番反映。残 DoD は実機 LINE で「先頭の真っ白ページが消えた」目視のみ。詳細: [[feedback_libreoffice_writer_blank_page]]

関連: [[impl_event_line_broadcast_task1]]（同じ LINE 配信パイプライン）、[[feedback_libreoffice_ja_fonts]]（本番 Noto CJK 必須）、[[feedback_libreoffice_writer_blank_page]]（HTML→PDF は --writer 必須）、[[feedback_windows_worktree_path]]
