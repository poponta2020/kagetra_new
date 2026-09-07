---
name: feature-def-travel-report
description: travel-report（遠征届）要件定義
type: project
---

**遠征届（travel-report）要件定義（2026-09-06 承認・設計収束・技術計画・Issue 作成まで完了）**。正典= docs/features/travel-report/{requirements.md, design-spec.md(locked), implementation-plan.md, design-mock/}。親 Issue #583、子 #584〜#591（T1〜T8、5 Wave）。

**機能の骨子**: 北大かるた会サークル所属者の大会出場時に大学へ出す「遠征届」Word を自動作成。①users に サークル所属・学部区分(学部/大学院)・学部等名(候補つき自由入力: 学部13+大学院21)・学年(選択のみ)・副連絡責任者フラグ(複数・**認可にも使う**＝会計フラグとの違い)・サークル長フラグ(同時1人・団体代表者と留守連絡先の既定) を追加。電話・生年月日は全日協の列を共用（サークルONでも必須）。ゲストもサークルONなら姓名を追加入力。②遠征単位＝グループ内の非cancelled連続開催日ブロック（キー unit_start_date、単位テーブルなし）。③経路入力(S8)は案A=日ごとのタイムライン。行き(札幌/帰省先から出場/その他=地名自由記述)×帰り(札幌へ戻る/そのまま帰省/その他)で既定行が決まり、既定行は本人の出場日の前日/翌日。出場行は保存せず出欠から導出。プロフィールは1行表示、欠落時のみ入力欄。④名簿確定時に管理者が確定/キャンセル待ち/不参加を手入力（遠征届の対象者判定にのみ使用＝他機能配線は Non-goal）。有効値の導出は 手入力→取込名簿の status×selection_outcome→確定。⑤作成は提出権限者(admin/vice_admin/副連絡責任者)のみ。ファイル分割の既定=遠征単位、日単位で統合/分割可。docx は原本.dotx のクリーン版を base64 モジュール同梱＋jszip で純コード記入（スパイク検証済み scripts/diagnostics/docx_spike.cjs）。⑥通知は大会別LINEグループへ @副連絡責任者（全員そろった時=保存前の未入力集合=={保存者} の遷移で1回・entry_groups 行 FOR UPDATE・コミット後 push・失敗は次の保存で自己回復／作成後）。⑦開催地は Haiku 4.5 で会場名から推定（destination_attempted_at の claim、RSC レンダー中に await しない）。⑧原本DLは提出権限者のみ（R3 で一般会員から外した）。

**AC**: 33件（auto-test 32 / manual 1=本番 Word 体裁）。特徴: AC-18 通知の冪等3条件、AC-22 生成 docx を XML 読み戻しで検証、AC-29 同梱テンプレに PII なし（docProps も）、AC-31 外部 API 回帰。

**設計判断の理由**: 副連絡責任者は一般会員が多いためフラグで認可／確定状況は添付なしメール確定が多く人ごとの確定/補欠がデータに無いため手入力／同梱テンプレをクリーン版にするのは原本の電話等を git 履歴に残さないため／`public/` 配置は認可不可で不採用。

**デザインの経緯**: Path L で環境を整えた後、ユーザー指示で Path D（Claude Design）へ切替。DesignSync 認可（/design-login）が取れず未 push（design-spec `remote_pushed: false`）。ローカル mock を Playwright で PNG 化して確認（Browser ペインは CSS 付き静的 HTML を描画できない）。design-live worktree は `design/travel-report`（未使用のまま残置）、design DB `kagetra_design_travel`（5434・tmpfs）も残置。

**未消化**: Claude Design push（認可後に `features/travel-report/**`）、docs/遠征届資料（原本・記入例＝PII、untracked のまま commit しない）、AC-33 は出荷後の本番 Word 確認。
