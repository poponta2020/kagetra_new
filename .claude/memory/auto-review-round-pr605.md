---
name: auto-review-round-pr605
description: auto-review PR #605
type: project
---

## PR #605 — mail-ai-extract-refinements 通称⇄系列連動

- pr: 605 / https://github.com/poponta2020/kagetra_new/pull/605
- 対象: apps/web の lib/edition・admin/mail-inbox（10ファイル・1357行。docs 5ファイルは既定除外でレビュー対象外）

### R1 (phase=initial, model=gpt-5.6-sol, effort=medium, escalated=false)

- verdict: needs_changes / blockers 1・should_fix 0・nits 0
- round_tokens: 152,618 / cumulative: 152,618
- effort: ルーブリックは high（差分1357行 > 400）だが、サイズ起因のみ・高リスクパス非該当のため sol 較正で medium へ
- **blocker**: `resolve.ts` 4桁の漢数字回次が読めない。漢数字の文字数上限が6文字で「二千二百二十二」（7文字）が入らず、算用数字なら読める4桁が回次不明になる。ユーザー確認 →「修正する」
- 対応: 上限を7文字へ、値域上限 9999 の検証を追加、回帰テスト3件。commit `80bf679`（edition テスト 74 passed）
- WONTFIX: なし
- good_points: 既存系列の short_name を書かない境界がサーバー側でも維持／種別スコープが既存検証と整合／検索だけに short_name を足す契約がテストで固定

### R2 (phase=delta, model=gpt-5.6-terra, effort=high, escalated=true)

- 入力: 修正差分のみ 53行 / 2ファイル（8333d3d..80bf679）
- verdict: **pass** / blockers 0・should_fix 0・nits 0
- round_tokens: 43,467 / cumulative: 196,085
- R1 blocker の解消を確認 → PHASE=final（出荷される最終形の全差分を1回だけ確認）へ

### R3 (phase=final, model=gpt-5.6-sol, effort=medium, escalated=true→デエスカレーション)

- 入力: 最終形の全差分 1370行（origin/main...80bf679）
- verdict: needs_changes / blockers 1・should_fix 0・nits 0
- round_tokens: 126,120 / cumulative: 322,205（上限 500,000）
- **blocker → ユーザー判断で見送り（WONTFIX）**: `resolve.ts` `parseKanjiNumber` が位取りを検証せず、「第十二十回」=30・「第百百回」=200 のように壊れた漢数字を受理する。今回の漢数字対応で入った退行（変更前は漢数字を読まず null だった）。見送り理由＝実在の大会名に壊れた漢数字は現れず、承認画面に回次の入力欄が見えている
- good_points: 既存系列の short_name 非更新の境界／検索だけに short_name を足す契約／初期候補の kind 適合・混在抑止・系列IDのサーバー検証が維持

### 終了 (R4 = 打ち切り記録)

- verdict=**cutoff** / reason=user-wontfix / fixed_head=80bf679（= R3 の reviewed_head。修正コミットなし）
- 総ラウンド: 3（initial 1 / delta 1 / final 1）
- ★**WONTFIX 1件**: 壊れた漢数字の位取り検証（上記 R3 の blocker）。今後この PR 由来で「回次がおかしい edition」が本番に出たらこの見送りを疑う
