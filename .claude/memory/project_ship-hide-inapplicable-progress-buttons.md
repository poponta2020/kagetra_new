---
name: ship-hide-inapplicable-progress-buttons
description: 申込グループページの前進2ボタンを「今できる操作」のときだけ表示する
type: project
---

PR #552 出荷（マージ成功・https://github.com/poponta2020/kagetra_new/pull/552 ）

## 何をしたか

申込グループページ `/admin/entries/[groupId]` の一括操作バーで、前進2ボタンを「無効化して残す」から「今できるときだけ描画する」へ変更した。ユーザー依頼「申込が未だなら支払済ボタンを出さない／申込したら申込済ボタンを出さない。戻す導線は『戻す操作』で充分」。

- 申込済にする: 選択に `not_applied` の日があるときだけ描画（判定条件は従来の活性条件と同一）
- 支払済にする: 選択に **applied かつ advance かつ unpaid** の日があるときだけ描画。従来の活性条件は entryStatus を見ておらず、未申込の日でも押せた
- 2つとも出ないときはボタン行ごと畳む。支払タイプの select は従来どおり常設（選択0日で無効）

## ★設計の要点（再訪時に効く）

- **表示条件がサーバーのガードより厳しい**: `setPaymentsPaid` のガード付き UPDATE は `payment_type='advance'` と `payment_status='unpaid'` だけを見て `entry_status` を見ない。したがって申込済の日と未申込の日が**混ざった選択**ではボタンが出て両方が支払済になる。これは変更前の活性条件と同じ挙動で、依頼の範囲外として意図的に据え置いた（コメントと docs に明記済み）。サーバー側ガードを足すなら別 PR
- 押せないボタンを残さない根拠は「取り消し導線が `<details>` の『戻す操作』に集約済み」であること。後退3ボタンは従来どおり disabled 制御のまま

## 変更ファイル

- `apps/web/src/app/(app)/admin/entries/[groupId]/components/GroupDayTable.tsx`（canApply/canPay → showApply/showPay、条件描画へ）
- `apps/web/src/app/(app)/admin/entries/[groupId]/page.test.tsx`（表示条件テスト3件追加・既存2件を新仕様へ。**literal NUL を \u0000 エスケープへ置換** — git がこのファイルを binary 扱いして diff を出さなくなるのを解消）
- `docs/spec/events-attendance.md`（一括操作バーと進行管理フローの記述を「無効化」→「非表示」へ）

## 検証

- CI: Lint / Typecheck / Test **green**（9分37秒）。**CI 完了を待ってからマージした**
- ローカル vitest は未実行（Docker Desktop を起動したが 10 分待っても daemon が応答せずテスト DB を立てられなかった）。typecheck・lint はローカルでも green
- レビュー: Codex 1R(initial) verdict=pass・blockers/should_fix/nits ゼロ・修正コミットなし・100,870 トークン。打ち切りなし・WONTFIX なし

## 残 DoD

- 本番実機確認: 未申込の日だけ選択 → 支払済ボタンが出ない／申込済の日だけ選択 → 申込済ボタンが出ない
