---
name: quickfix-entry-flow-lottery-roster
description: quickfix: entry-flow-lottery-roster
type: project
---

# quickfix: 申込フロー帯「抽選」の確定名簿連動（PR #448）

- **PR**: fix(entry-flow): 申込フロー帯の「抽選」に確定名簿連動を追加 — PR #448 https://github.com/poponta2020/kagetra_new/pull/448 → **MERGED**（merge commit dc8e6f3）
- **修正したバグ/停滞**: 大会詳細の申込フロー帯（会内締切→大会申込→抽選→支払→開催）の抽選ステップが lotteryDate の日付経過のみで完了判定しており、抽選日未設定・未来日の大会は確定名簿を取り込んでも現在地が「抽選」に停滞していた（entry-management 要件 Non-goals 記載の既知課題。Issue 未作成のまま quickfix 対応）
- **修正内容**: buildEntryFlow に hasConfirmedRoster を追加し「抽選日経過 || 確定名簿あり」で done。定義は申込管理ボードの classify と同一（パース済み confirmed の非supersede版 ∪ 採用済み原本ファイル。applicant 無視）。page.tsx はロード済み entryGroup.rosters/rosterFiles から導出（新規クエリなし）。not_applying の中立扱い・日付欄（未定表示）は不変
- **変更ファイル**: apps/web/src/lib/events/entry-flow.ts / apps/web/src/app/(app)/events/[id]/page.tsx / entry-flow.test.ts（+4ケース） / EntryFlow.test.tsx（fixture） / docs/spec/events-attendance.md（正典更新）
- **コミット**: ddc5e0c
- **テスト**: web フル 173 files / 2595 tests green・check-types・lint green
- **レビュー**: auto-review-loop 1R（initial のみ・sol/low・pass 即終了）。blockers 0 / should_fix 0 / nits 1（docs 未反映指摘は誤検知 — docs は同一コミット更新済みだが review-diff の既定除外で不可視）。累計 78,715 tokens
- **残DoD**: CI pending のままマージ（赤なら追修正）。本番実機確認=確定名簿取込済み大会で申込フロー帯の「抽選」が完了表示になること
