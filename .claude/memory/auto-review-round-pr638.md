---
name: auto-review-round-pr638
description: auto-review PR #638
type: project
---

pr: #638
round: R1
phase: initial
verdict: pass
counts: blockers 0 / should_fix 0 / nits 0
model: gpt-5.6-sol
effort: medium（--effort medium で明示指定。過去2回 high が 468k トークンを焼いて usage limit に当たったため）
escalated: false
round_tokens: 132,251
cumulative_tokens: 132,251 / 500,000
打ち切り: なし（R1 pass のため final は省略 = R1 が最終形を見ている）
WONTFIX 見送り: 0 件（ただし auto-deploy.sh の差分ベースゲートの構造的欠陥と 0066 本番未適用は、スコープ外として事前にプロンプトへ宣言済み。Codex は再掲しなかった）
レビュー対象外とした変更ファイル: なし（326行 / 9ファイル すべてレビュー対象）

内容: PR #631 出荷後の main 赤（本番ビルド破壊＋FK 違反によるテスト赤）の hotfix。Codex は「findMissingRegisterFields はロジックと型を維持したまま DB 非依存モジュールへ移され、クライアントから store.ts 経由で pg を取り込む経路が解消されている」「テストのクリーンアップも ON DELETE RESTRICT に対して子テーブルを先に削除する正しい順序」と判定。

ローカル検証: check-types 通過・lint 通過・build は Compiled successfully / Module not found 0 件 / 静的ページ 15/15（最後の exit 1 は Windows 固有の symlink EPERM）・vitest は共有 DB 1本の直列実行で 23 ファイル 356 テスト全 green（赤だった open-chat-actions.test.ts の 35 件を含む）。

auto-ship: 禁止。マージ前に本番 DB へ 0066 の適用が必要（未適用でマージすると /dashboard が loadMemberRenewalView を呼ぶため全会員のホーム画面が 500 になる）。
