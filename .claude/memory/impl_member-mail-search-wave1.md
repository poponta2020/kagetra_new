---
name: impl-member-mail-search-wave1
description: member-mail-search Wave 1（タスク1〜3）
type: project
---

member-mail-search（会員向け受信メール検索・閲覧）の Wave 1＝タスク1〜3。worktree=C:/tmp/impl-member-mail-search、ブランチ=feature/member-mail-search。

## Wave 構成と結果
3タスクを task-implementer(sonnet) 3並行で実装（ディレクトリ直交: lib/mail-history* / lib/member-mail/ / app/api/mail/）。排他宣言のミスなし・統合検証で不整合なし。バリア後に main が直列でテスト実行 → **129 tests green**（履歴75 + ルート54）・tsc --noEmit 通過・admin 配下の差分ゼロ。

## コミット
- 36c0bb9 タスク1 履歴導出（#471）
- 8bc6aa6 タスク2 検索クエリ＋フォーマッタ（#472）
- b78fdd7 タスク3 会員向け添付ルート2本（#473）

## main が事前に確定させた型契約（ワーカーに丸投げすると必ず食い違う箇所）
1. **HistoryRow は segments/summarySegments で文言まで確定**。一覧カードと詳細タイムラインが両方描画するため、表示側で文言を組み直させない。summarySegments だけ H2 が短縮形（「LINE配信」vs「LINEグループへ配信」）
2. **search.ts は行だけでなく subjectMatched / excerpt(source, attachmentFilename, text) を返す**。design-spec の「件名以外でヒットしたときだけ抜粋」を一覧側が再クエリせず実現するため
3. **AC-33 は injection で担保**。mail-history.ts は result-import を import せず、deriveHistory(input, extraRows) の第2引数で H0 を注入。H4/H5 の判定も extraRows を見る（AC-32）

## 仕様の曖昧さを実コードで解決した点
**H3 の対象イベント = linked_event の所属 entry_group 全件**（単一 event ではない）。根拠＝processMail(actions.ts:1815) は管理者が選んだ**申込グループ**の代表イベントを linked_event_id に書いている。design-mock の H3 行が畳んだグループ名なのとも整合。

## ハマり所（次回も踏む）
- drift テストは**両ルートとも admin セッション**で叩く。member セッションだと管理者ルートが 403 になり、drift ではなく認可差で落ちる
- worktree の相対 import 深さミス（`../admin/...` → `../../admin/...`）でテストファイルが解決不能。ワーカーはテストを実行できないので main のバリア実行まで発覚しない
- formatAttachmentMeta に filename を渡さない設計だと application/octet-stream の .zip が「ファイル」に劣化する（main が修正）
- docs/audits/senseki-boundary-audit.md は main リポジトリで untracked のため worktree に存在しない。タスク8で持ち込む
- ensure-worktree.sh は pnpm install も .env コピーもしない。ルート .env と apps/web/.env.local の両方を手でコピーしないとテストが動かない
