---
name: ship-event-line-headcount-breakdown
description: 紐付け案内③を役割別の人数内訳へ改訂
type: project
---

PR #647 マージ完了（2026-09-14）。event-line-broadcast の紐付け案内③を「北溟上の申込人数は〇名（内他会〇名）です」から**役割別の人数内訳**へ改訂した。

- PR: https://github.com/poponta2020/kagetra_new/pull/647 （feat(line): 紐付け案内③を役割別の人数内訳へ改訂する）
- マージ: 成功（merge commit e5a313d・ブランチ削除済み・worktree 削除済み）
- クローズ: 親 #642 / 子 #643 #644 #645 #646
- 正典: docs/features/event-line-broadcast/requirements.md §3.1.3a〜3.1.3c ／ docs/spec/notifications.md

## 出荷内容
- 合計1行＋内訳5行（大会参加者・管理者・会計・副連絡責任者・Bot）。**5行は排他**（優先順位 大会参加者 ＞ 会計 ＞ 副連絡責任者 ＞ 管理者）で単純和＝合計
- **ゲストを人数から除外**し「内他会〇名」併記を廃止。ゲストは遠征届の要否判定にだけ使う
- ③のメンションを role='admin' だけに絞る（loadPrimaryAdminLineUserIds を新設。汎用の loadAdminLineUserIds＝admin+vice_admin は不変）
- MentionValue に { text } を追加（中括弧は差し込み時に除去。throw すると①〜④の reply が丸ごと落ちるため）
- 新規 entry-headcount-breakdown.ts（pure）／削除 countGroupEntrants・formatEntrantCountParts・EntryHeadcount

## ★要件の穴を実装時に発見・修正
「排他を適用したうえで副連絡責任者を判定」を字義どおり実装すると、**副連絡責任者を兼ねる管理者がいて遠征届不要の大会**でその人がどの行にも計上されず合計が実人数より少なくなる（AC-H2 違反）。遠征届の要否で副連絡責任者バケット自体を空にし、寄っていない該当者を管理者行へ落とす形にした。注記の分岐1（全員が上位行へ寄った）は排他の結果で先に判定するので §3.1.3b の宣言順は保たれる。要件 §3.1.3b に★注記として明記済み。

## レビュー
R1(initial/gpt-5.6-sol/medium) のみ・300,905トークン。blockers 2件はユーザー判断で**両方とも見送り（WONTFIX）**→ cutoff(user-wontfix) で終了。**修正コミットはゼロ**なので「修正したが再レビューしていない差分」は無い。見送り内容は auto-review-round-pr647.md 参照。
CI: Lint/Typecheck/Test pass（19m10s）。DoD 全項目 PASS。

## ★残 DoD（未消化）
- **AC-H25（本番実機確認）**: 本番で Bot を大会グループへ紐付け、新しい③が届き内訳の合計が LINE のメンバー数と一致することを確認する。ずれていたら /quickfix
- **運用（コードではない）**: 本番の is_circle_member は全会員 OFF・is_travel_report_submitter は0人。このままだと副連絡責任者の行は常に `0名（遠征届不要のため）` になる。会員編集（/admin/members/[id]/edit）とサークル一括編集（/admin/members/circle）でフラグを設定する
- ★会計フラグはゲストにも付けられる（Server Action にガード無し）。付けると③の会計行に他会の人が出て合計が1名多くなる（レビューで指摘され見送った件）。運用で付けないこと
