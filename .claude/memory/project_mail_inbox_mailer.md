---
name: project-mail-inbox-mailer
description: "mail-inbox を「アプリ＝メーラー」モデルに作り替える機能定義（親#119）。AI 自動分類廃止、AI 抽出は管理者ボタン押下で手動起動、補足情報は既存イベント結びつけアクションで LINE 配信、triage は 2 状態に削減"
metadata: 
  node_type: memory
  type: project
  originSessionId: 472b440d-1449-4b3e-9015-a5f33485bd28
---

mail-inbox-mailer (親 Issue #119) — 競技かるた会のメール処理フローを「全件 inbox に並ぶメーラー」化する大改修。2026-06-06 要件定義、2026-06-07 タスク1 (#120) 着手。

**進捗（2026-06-07）**: 全 7 タスク実装完了、`feature/mail-inbox-mailer` を push（HEAD `e8da84b`）。worktree `C:/tmp/impl-mail-inbox-mailer`。typecheck/Vitest（web 408 + mail-worker 236 + api/shared）pass、E2E 2 本追加（CI で実行）。残工程: PR 作成 → Codex レビュー → ship → 本番 systemd 反映（手動 cp + daemon-reload + enable）+ ANTHROPIC_API_KEY 確認。

実装コミット履歴:
- `ca10505` task1: DB schema + 0022 migration
- `8a8d69d` task2: mail-worker cron AI 廃止 + `--mode=extract-only`
- `d98516a` task3: triggerExtractDraft / linkMailToEvent / unlinkMailFromEvent
- `d19b9c8` task4: mail-inbox UI + 5 component + polling API
- `a773f1c` task5: EventRelatedMails (3 経路 UNION)
- `6a6b9fc` task6: kagetra-mail-worker-extract.{service,timer}
- `e8da84b` task7: E2E spec 2 本

**タスク1 で得たノウハウ:**
- **drizzle-kit の enum 値削除自動生成**: 「カラムを text に ALTER → DROP TYPE → CREATE TYPE → カラムを新 enum に再 ALTER (USING ::enum キャスト)」というパターンを自動生成する。当初想定した「一時 enum 経由 swap」より素直で良いが、既存 enum 値を持つ行を text 段階で UPDATE 句で潰しておかないと USING キャストで「invalid input value for enum」が出るので、**新 enum CREATE と再 ALTER の間に UPDATE を手動挿入**する必要がある（drizzle-kit は値削除自体に気付かないので UPDATE を生成しない）。
- **enum 削除に伴う追従修正**: TypeScript で `Record<EnumValue, ...>` や union 引数を持つ箇所が全部型エラーになる。「タスク1 = schema のみ」と切り分けたつもりでも、typecheck pass が DoD なら必ず追従が必要。今回は `actions.ts/TriageActions.tsx/page.tsx/mail/[id]/page.tsx` のソース 4 箇所 + テスト 4 箇所を最小修正（UI 本格的な再構成はタスク3/4 に持ち越し）。
- **新規 enum 値追加 (`ai_processing`) の追従**: DraftCard の status 型 union に明示的に追加してフォールバック分岐 (`'AI 抽出中'` ピル) を入れた。`Record<string, ...>` でフォールバックしている画面 (`[id]/page.tsx`) は型エラーが出ないので触らず、タスク4 で本格対応。
- **journal/snapshot リネーム**: drizzle-kit generate は `0022_lush_gressill.sql` のようなランダム名を付けるので、ファイル名 + `_journal.json` の `tag` も忘れず `0022_mail_inbox_mailer` にリネームする。

**Why:**
現状の mail-worker は受信メールを 30 分ごとに全件 fetch して Claude API で `tournament/noise/unknown` 自動分類していたが、ユーザー（poponta2020）が「メールの抜け漏れが怖い、結局全部見たい、AI が判断を奪うのが逆にストレス」と判断。AI を「振り分け判断者」から「抽出作業の自動化道具」に格下げする。

**How to apply:**
mail-inbox 関連の改修・バグ修正をする時は、この設計判断と互換性のあるアプローチを取ること。実装時は [[project_mail_triage_badge]] と [[project_tournament_title_grade_split]] の既存資産（triage_status、draft の race 直列化、N 件分割）を活かしつつ作り替える。

## 確定した設計判断

- **AI 自動分類廃止**: mail-worker の cron では llmExtractor を渡さない運用に変更
- **pre-filter は残す**: コード保持、`classification='noise'` 付与は維持、UI 側の「ノイズ非表示」フィルタだけ撤去（DB には既に全件保存されている）
- **draft テーブルは残す**: N 件分割、再抽出、承認 race 直列化、LINE 配信トリガー、訂正版管理の責務を持つ。`status='ai_processing'` enum 値を追加して手動起動時の中間状態を表現
- **triage_status 2 状態化**: `unprocessed / processed`、`deferred` 廃止（処理しないこと自体が暗黙の保留）。migration で既存 deferred → unprocessed
- **3 アクション**: (1) AI 大会抽出 / (2) 既存イベント結びつけ / (3) 対応不要。「訂正版」「補足情報」は同じ「既存イベント結びつけ」で統一処理
- **既存イベント結びつけ**: `mail_messages.linked_event_id` 直 FK（中間テーブルなし、1 メール 1 イベント）。確定時に既存 broadcastMailToEvent で本文画像化＋添付 URL で LINE 配信
- **events 詳細「関連メール」**: 3 経路 UNION（linked_event_id / tournament_drafts.event_id / events.tournament_draft_id）で受信日降順
- **AI 抽出の動線**: 確認ダイアログ → draft INSERT (ai_processing) → 画面遷移 → systemd 別 timer（30 秒間隔、`--mode=extract-only`）の dispatcher が picking → classifyMail + persistOutcome → 完了で client side polling（3 秒間隔の `/api/admin/mail-inbox/[id]/draft-status`）が検知して router.refresh()。Web Push 通知も配信
- **AI 抽出失敗時**: 「再試行」「手動でイベント作成」の 2 ボタン。手動作成は空 EventForm を mail 詳細画面に展開
- **既存イベント検索範囲**: 未開催全て + 過去 30 日以内（補足情報は未開催向け、領収書/事後連絡は過去 30 日向け）
- **mail_worker_jobs に kind カラム追加**: 既存 dispatcher を流用、`kind='fetch'`（既存）と `'manual_extract'`（新）を分岐
- **undo 機能あり**: 処理済画面で「未処理に戻す」ボタン。linked_event_id を NULL、triage_status を unprocessed に。ただし LINE 配信済みメッセージの取り消しは LINE API 仕様上不可

## 子 Issue 一覧
- #120 タスク1: DB スキーマ変更 + migration（0022_mail_inbox_mailer.sql）
- #121 タスク2: mail-worker の cron AI 廃止 + manual_extract dispatcher（--mode=extract-only）
- #122 タスク3: Server Actions（triggerExtractDraft / linkMailToEvent / unlinkMailFromEvent）
- #123 タスク4: mail-inbox UI 改修（本文即時表示、3 ボタン、polling、5 新規コンポーネント）
- #124 タスク5: events 詳細「関連メール」セクション
- #125 タスク6: systemd timer + 運用設定（30 秒間隔 extract-only）
- #126 タスク7: E2E + 既存テスト修正 + DoD

## 関連ドキュメント
- 要件定義書: `docs/features/mail-inbox-mailer/requirements.md`
- 実装手順書: `docs/features/mail-inbox-mailer/implementation-plan.md`

## 既存機能との関係
- [[project_mail_triage_badge]]: triage_status の概念と Web Push バッジ。新案では triage_status を 2 状態に削減
- [[project_tournament_title_grade_split]]: 1 ドラフト N イベント分割、AI 2.0.0、FOR UPDATE race 直列化。新案でも維持
- mail-body-as-image (PR #84): 本文 A4 JPEG 化 + 添付 URL 配信。変更なしで再利用
- event-lifecycle-notify / entry-notify-lottery-treasurer: events 経由なので影響なし
