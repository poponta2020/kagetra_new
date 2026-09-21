---
name: ship-home-tournament-timeline-status-pill
description: ホーム大会ピルを4値ステータスへ
type: project
---

ホーム大会ピルを4値ステータス（参加受付中／締切済／申込済／名簿確定）へ — PR #659 https://github.com/poponta2020/kagetra_new/pull/659

- マージ: 成功（merge commit 1569d70・2026-09-21）。CI（Lint / Typecheck / Test）は pending のままマージ（CI 待ちしない方針）→ 赤なら /quickfix で追修正
- クローズした Issue: 親 #649・子 #650 / #651 / #652
- 内容: 今日カードとタイムライン行のピルを、名簿確定(brand) > 申込済(info) > 締切済(neutral) > 参加受付中(warn) で導出（deriveHomeEventStatus / HOME_EVENT_STATUS_PILL）。名簿確定は confirmed-roster.ts の4材料（正典）で判定。名前チップの出所・外部API・申込管理ボードは不変（upcoming-entrants には entryStatus を追加しただけ）
- レビュー: auto-review-loop 1ラウンド（initial のみ・R1 pass・gpt-5.6-sol / effort medium＝元判定 high を上限で丸め）・Codex 累計 109,140 / 500,000 トークン・再レビューせずに修正した指摘 0・WONTFIX 0
- DoD: gate-dod 全 PASS（A1〜A3 は CI 実行中で SKIP・A4 WARN=ローカル HEAD 差のみ）
- ローカル未実行: DB 統合テスト（page.test.tsx・upcoming-entrants.test.ts 等。Docker 停止）→ CI の結果で確認すること
- ★残DoD: AC-17 本番 375px 実機確認 — 4ステータスの読み分けと大会名の省略。**申込済(info #d2dee9) と締切済(neutral #d8dde2) はほぼ同色・fg も同じ #3d4958**。既存トーン・朱禁止の制約内に4色目が無い（success は brand と同色）ため、ユーザー判断で要件どおり出荷。見づらければ別の小改修で調整
- 出荷時の注意: メイン作業ツリーに別セッション（invite-link-registration 改修の要件定義・#653）の未コミット変更があったため、同期コミットには本件の行だけを index へ載せた（INDEX.md・MEMORY.md・worklog.md）
- 関連: [[impl-home-tournament-timeline-status-pill]] / [[auto-review-round-pr659]] / [[project_home_status_pill_def]]
