# kagetra_new

競技かるた会向け総合グループウェア。poponta2020/kagetra の完全リプレイス。

## 概要

- 会員100名超、LINE通知対象約50名/年、1人開発(Claude+Codex)
- コスト: Oracle Cloud + AI API以外は無料

## 技術スタック

- Next.js 15 (App Router) + Hono (API) の分離構成、TypeScript strict
- PostgreSQL 16 / Drizzle ORM / Auth.js v5 (LINE認証のみ/招待制)
- Tailwind CSS + shadcn/ui / Vitest + Playwright
- Turborepo + pnpm / Docker Compose on Oracle Cloud（東京 / new.hokudaicarta.com）
- CI/CD: GitHub Actions (テスト+型チェック+lint+自動デプロイ)
- レビュー: PR作成後 auto-review-loop が Codex CLI で構造化レビュー→`/fix` で自動修正→再レビューを回し、Codex pass 後に AC 適合チェック（acceptance-reviewer）→ pass かつ CI green なら `/ship` まで自動（`--no-auto-ship` で停止／手動レビューは `/review-manual`）
- モデル運用: セッション既定=opusplan（Plan=Opus/実行=Sonnet）+ Advisor=Opus。要件定義・設計は `/model opus` の設計セッションで行う。サブエージェント委譲は**コンテキスト隔離・作業独立性**で判断（正典=devflow の implement スキル）。調査は機械的列挙=Explore(haiku)／判断込み=Explore(sonnet)／核心は main 自読
- 開発スキル・エージェントは **devflow プラグイン**（poponta2020/claude-devflow）で提供。プロジェクト固有設定の正典= [.claude/project-profile.md](.claude/project-profile.md)

## 構成

```
apps/web/    → Next.js (フロント+BFF)。API 実処理はここ (Server Actions + src/app/api/)
apps/api/    → Hono (バックエンドAPI)。現状スケルトン (src 3ファイル・実処理なし)
apps/mail-worker/ → メール取込ワーカー (IMAP→AI振り分け。result-import パーサ本体もここ)
packages/shared/ → 共有型定義、Drizzleスキーマ
docker/      → docker-compose.yml, nginx
scripts/migration/ → データ移行
scripts/diagnostics/ → 使い捨て診断スクリプト置き場 (gitignore対象)
.github/workflows/ → CI/CD
```

使い捨て診断スクリプトは scripts/diagnostics/ に作る（apps/ 直下禁止）。

## 機能 (4フェーズ)

- P1基盤: プロジェクト構成 / ユーザー管理+LINE認証 / イベント / スケジュール / データ移行(会員+イベント)
- P2大会運営: 試合結果・統計 / LINE通知(1チャネル1人×80) / データ移行(試合結果)
- P3 AI+メール: Yahoo!JAPAN Mail IMAP→Claude API振り分け(管理者承認) / AI大会案内読み込み(PDF/Word) / AI名簿→反映 / AI旅費見積もり(札幌発,Amadeus+Agoda+楽天,2案提示)
- P4コミュニティ: アルバム / BBS / Wiki / アドレス帳 / データ移行(残り全て)
- 権限: 管理者/副管理者/一般会員(3層)
- データ移行: 一括スクリプト、全データ引き継ぎ、旧システムP4完了まで並行稼働
- UI: モバイルファースト、シンプル(デザイン詳細は別途)、日本語のみ

## 開発ルール

1. **実装前確認**: .claude/memory/ と docs/worklog.md を確認→曖昧さは確認→計画提示→ユーザー承認。**計画承認後もユーザーの明示的な実装開始指示（/implement 等）があるまで実装を開始しない**。実装時は worktree 隔離と並行作業の衝突検知を必ず行う
2. **テストファースト**: APIテスト→実装→フロントテスト→実装→E2E
3. **1PR=1機能**: 小さく、混ぜない、description(何を・なぜ・テスト方法)必須
4. **memory記録**: 設計判断/バグ修正/完了/フィードバック時に .claude/memory/ へ必ず記録（MEMORY.md 索引も更新）
5. **破壊的変更禁止**: テスト破壊は承認必須、直接ALTER禁止、本番操作は確認
6. **セッションプロトコル**: 開始→git pull→.claude/memory/からローカルmemoryへ同期→docs/worklog.md確認→続きから / 終了→worklog.md追記→ローカルmemoryから.claude/memory/へ同期→コミット→git push
7. **DoD**: 実装完了→テスト(API+フロント+E2E)+CI通過+memory記録→PR作成+Codexレビュー+AC適合+指摘修正→ship（DoD ゲートは gate-dod.sh で全自動。実機確認は出荷後に本番で行い、不具合は即修正）
8. **フェーズ品質ゲート**: 全DoD+移行確認+リグレッションなし+本番確認+総括+次Phase合意
9. **スコープ管理**: Phase外要望は .claude/memory/ に記録、混ぜない。ついでリファクタ禁止
10. **トラブル対応**: 原因確認→修正PRまたはロールバック→インシデント記録
11. **並行作業管理**: セッション開始時に docs/worklog.md と .claude/memory/ で他ブランチの進行状況を確認。worktree作成/削除、マイグレーション番号の衝突回避、shared/の競合チェック、マージ時のリベースは全てClaude側で行う。危険な並行は警告してユーザーに確認を取る

## 開発フロー (1機能)

[設計セッション: /model opus] grill-me(仕様確認) → define-feature(要件ヒアリング→**要件承認=唯一の承認ポイント**→技術計画→implementation-plan→Issue までノンストップ。UIは design-screen と収束ループ)
[実行セッション: opusplan+advisor] implement(**起動=実装GO**。worktreeでタスクループ→/verify で AC 実動作確認→自動連鎖) → prepare-pr(PR作成) → auto-review-loop(Codex レビュー→/fix→再レビュー + AC適合チェック、pass+CI green で ship まで自動) → ship(Step 0 の DoD ゲート通過が必須。マージ+memory同期+push)

実装系スキル（implement / quickfix / bug-report / fix-feature）はすべて末尾で次スキルを自動呼び出しし、**pass かつ CI green なら ship まで自動で繋がる**（auto-ship 既定 ON、`--no-auto-ship` で auto-review-loop の pass 時点で停止）。手動 Codex VS Code レビューを使いたい場合のみユーザーが個別に `/review-manual` を呼ぶ。
