---
name: ship-entry-group-page
description: entry-group-page 出荷（PR #503）
type: project
---

PR #503 (feat(entry-group-page): 申込グループページを新設し管理者の申込運用を集約する) をマージ。
https://github.com/poponta2020/kagetra_new/pull/503 — merge commit c0f9003。
親 #496 クローズ／子 #497〜#502 は closing keyword で自動クローズ。

## 出荷内容
`/admin/entries/[groupId]`（申込グループページ）を新設し、管理者の申込運用（進行管理・共通締切編集・
LINE配信・申込書・関連メール）をそこへ集約。日ページ `/events/[id]` は会員が「その日に出るか」を
答える画面に純化した。マイグレーション無し（新しい状態を1つも作らず、既存の group 帰属データを
本来の場所へ置き直すだけ）。コミット6本＋テスト修正1本。

主な決定:
- 日程表は「進行フェーズ1語」。語彙は申込管理ボードの区画名と同一（7語）で、判定はボードの
  classify をそのまま日ごとに回し、短縮ラベルは AREAS.label から機械的に導出する
- 進行管理は**表示専用**（GroupProgressSection を新設）。状態の切り替えは日程表で日を選ぶ1つの形に統一
- フロー帯は既存 buildEntryFlow を変更せず、グループ集約入力を作る純関数を新設
- 級別グループ配信は event 単位なので LineBroadcastSection を日ごとの配列へ拡張

## ★計画からの逸脱2件（locked な design-spec / requirements が勝った）
1. 「希望者なし」を撤回し「申込なし」に畳んだ（design-spec §2/§8・requirements §3.3 が語彙を7語に固定）
2. 進行管理で EventLifecycleSection を再利用しなかった（design-mock §④ に操作コントロールが1つも無い）。
   参照ゼロになった EventLifecycleSection / GroupToggleDialog / EventEditSubmit / GroupDayLinks を削除

## レビュー
auto-review-loop 1R（initial / gpt-5.6-sol / effort=high）。verdict=needs_changes → blockers 3件は
**全件ユーザー判断で見送り（WONTFIX）**（詳細と理由は auto-review-round-pr503.md）。
修正対象として残った blockers 0 / should_fix 0 / nits 0 → cutoff(reason=user-wontfix) で終了。
「修正したが再レビューしていない指摘」は無し（テスト修正のみ push し、それは再レビューしていない）。

## ★★出荷後の残作業（main が赤）
ローカルで Docker が起動せず vitest を一度も回せないまま PR を出した。CI が2回検出した:
- 1回目: unit 7件失敗（すべてテスト側の誤り）→ 修正して green にしてからマージ
- 2回目（マージした HEAD）: **Playwright E2E 2件失敗**
  - apps/web/e2e/event-lifecycle.spec.ts:80 「/events/[id] 進行管理セクション」
  - apps/web/e2e/event-line-broadcast.spec.ts:60 「/events/[id] LINE 配信セクション」
  どちらも**日ページから撤去したセクションを対象にした既存 E2E テスト**で、遷移先を
  /admin/entries/[groupId] へ張り替える必要がある。→ /quickfix で追修正する

★教訓: requirements §6 の「計画的に壊れる既存テスト」一覧に **apps/web/e2e/ を含めていなかった**。
画面からセクションを撤去する改修では unit だけでなく e2e も grep すること
（`grep -ln "<撤去するセクション名>" apps/web/e2e/*.spec.ts`）。
