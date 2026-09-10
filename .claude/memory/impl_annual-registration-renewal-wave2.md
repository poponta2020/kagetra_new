---
name: impl-annual-registration-renewal-wave2
description: 年度確認 Wave 2（タスク2・3・4）
type: project
---

annual-registration-renewal Wave 2（タスク2・3・4）を task-implementer 3 並行で実装し、バリア後に main が受け入れ確認・直列テスト実行・タスクごとコミット。コミット f2b31ee(T2) / b5ea883(T3) / a2b310a(T4)。worktree=C:/tmp/impl-annual-registration-renewal。

Wave 構成: T2(純ロジック lib/membership-renewal/**) / T3(settings/club-line-group + lib/club-line-group + line-webhook-handler) / T4(lib/line-chat-tasks + api/line-chat-worker/** + middleware)。**排他宣言ミスなし**（3 者のファイルは完全に分離できた）。統合検証も矛盾なし。

★main が直した点（バリア後）:
1. **webhook の memberLeft**: ワーカーは実装手順書の「leave で NULL 化」を leave+memberLeft と解釈していた。会員が1人抜けただけで line_group_id が消え、再捕捉は Bot の再招待でしか起きない＝以後のリマインドが無言で全員テキスト列挙へ落ち続ける。**NULL 化は leave（Bot 自身が外された）だけ**に修正（テストも反転）。ワーカー自身が「要件書に根拠が無い」と報告してきたのが発見の端緒。
2. **test-utils/db.ts の truncateAll** に年度確認 4 テーブルを明示列挙（共有ファイルなのでワーカーには触らせず main が担当）。TRUNCATE CASCADE は FK 参照を辿るので消えはするが、membership_renewals.fiscal_year は UNIQUE なので取り残すとテスト間で年度衝突する。
3. **club-line-group.test.ts の FK 違反**（updated_by='admin-1' の users 行が無い）で 15 件失敗 → beforeEach で users を seed。★worker_verify: none の副作用で、ワーカーはテストを1度も実行できずこの種の失敗を検出できない。

受け入れ結果: 対象テスト 260 件 green、monorepo 全体 check-types green。

★後続タスクへの申し送り:
- defaultNextSchoolYear は最終学年を見ない。**タスク6 は isFinalSchoolYear を先に呼んで 3 択へ分岐すること**
- タスク5 の開始 Action は club_line_groups を FOR UPDATE すること（S3 の revert とのレース）
- line-chat-tasks store は送信時刻・本文・メンションを受け取るだけ。導出は呼び出し側（開始 Action・19:30 バッチ）が schedule.ts / messages.ts で行う
