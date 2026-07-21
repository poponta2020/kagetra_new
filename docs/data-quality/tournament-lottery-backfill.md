# 大会抽選名簿バックフィル・完全性レポート

## 目的と安全境界

2018-07-26以降に取得可能な `INBOX` と `99_202510以前のメール` を、mailbox×受信年の再開可能な単位で候補抽出する。本書のコマンドはまずdry-runと読み取り専用coverageだけを行う。本番migration、非dry-run取得、名簿ドラフトの一括生成、ドラフト採用は別々の明示承認が必要であり、本書の検証完了を実行承認とみなさない。

## 事前確認

- 対象DB、対象mailbox、年度範囲、候補上限を作業記録へ固定する
- 本番操作前にDBバックアップと件数スナップショットを取得する
- `--max-roster-ai-calls=0` を既定とし、AI補助は候補確認後の個別ジョブに限定する
- `successfulClassifications` は級・名簿用途の決定的推定成功であり、承認・公開済みではない
- `needsReview`、`failures`、coverageの不足を0件として補完しない

## dry-run

Windows/PowerShellではリポジトリルートから次を実行する（認証情報は環境変数または既存の安全な設定から読み込み、コマンドへ直書きしない）。

```powershell
pnpm --filter @kagetra/mail-worker exec tsx src/index.ts --dry-run --mailbox=INBOX --from-year=2025 --to-year=2026 --max-roster-candidates=500 --max-roster-ai-calls=0
pnpm --filter @kagetra/mail-worker exec tsx src/index.ts --dry-run --mailbox=99_202510以前のメール --from-year=2018 --to-year=2025 --max-roster-candidates=500 --max-roster-ai-calls=0
```

候補上限に達した場合は出力の `resume.nextAfterUid` を次回へ渡す。

```powershell
pnpm --filter @kagetra/mail-worker exec tsx src/index.ts --dry-run --mailbox=99_202510以前のメール --from-year=2018 --to-year=2025 --max-roster-candidates=500 --max-roster-ai-calls=0 --resume-after-uid=<nextAfterUid>
```

同じ引数を2回実行し、候補・成功・要確認・失敗・次回カーソルが一致することを確認する。`blockedByFailure=true` の場合は先へ進めず、失敗UIDの原本取得または解析原因を解消して同じカーソルから再実行する。

## 2024年度以降のcoverage

次はDB読取のみを行う。

```powershell
pnpm --filter @kagetra/mail-worker exec tsx src/index.ts --lottery-coverage-report --from-year=2024
```

協会年度（4月1日〜翌3月31日）別に `unknownCategory`、`missingReferenceDate`、`missingGradeScope`、`missingConfirmedRoster`、`missingActualResult` を確認する。すべて0になるまで `complete=false` とし、区分不明開催を公認・新春へ推定しない。対象級は `events.eligible_grades` を正とし、原本に存在する級から補完しない。開催日、対象級、級別の確定名簿、実出場原本が不足する開催回は年度回数・A級当落線の完全値へ利用しない。

## 承認後のドラフト一括生成

dry-runレポートとcoverageを保存し、候補原本のレビューとDBバックアップを完了して明示承認を得た後に限り、1バッチを次の形で実行する。`--stage-roster-drafts` は取得した候補原本から確認用ドラフトを作るだけで、ドラフトの採用や一般公開集計への反映は行わない。

```powershell
pnpm --filter @kagetra/mail-worker exec tsx src/index.ts --once --stage-roster-drafts --mailbox=99_202510以前のメール --from-year=2018 --to-year=2025 --max-roster-candidates=500 --max-roster-ai-calls=0 --resume-after-uid=<previousCursor>
```

レポートの `rosterDraftsCreated`、`rosterDraftsReused`、`rosterDraftFailures` を照合する。同じ引数の再実行は既存ドラフトを再利用する。`rosterDraftFailures` が1件でもあれば `blockedByFailure=true` とし、原因解消まで同じカーソルから再実行する。`--dry-run` と `--stage-roster-drafts` は併用しない。

## 実装時のfixture検証（2026-07-21）

- archive dry-run: fetched 6、DB insert 0、AI eligible 0、failures 0
- 専用テストDBcoverage: 3開催中 category unknown 1、開催日不足2、公認・新春の開催済み2、確定名簿不足1、実出場原本不足1、`complete=false`。追加fixtureで対象級未設定とA/B一部級欠落を検出
- これはfixture／専用テストDBの機構確認値であり、Yahoo Mailまたは本番DBの実件数ではない

## 本番書込み前の承認チェック

1. dry-run JSONとcoverage JSONを保存し、mailbox・年度・cursor・上限を記録する
2. `failures=0` または各失敗を意図的に保留した根拠を確認する
3. 候補原本の件数、重複、訂正関係、開催回・級・用途をレビューする
4. DBバックアップ、migration差分、想定INSERT件数、ロールバック方針を確認する
5. 非dry-run取得の明示承認を得る
6. 取得後にMessage-ID重複0、原本件数、ドラフト状態を照合する
7. ドラフト採用は別途管理画面で1件ずつ検証し、一般公開集計を再確認する
