---
name: impl-annual-registration-renewal-task5
description: 年度確認 タスク5（store と Server Actions）
type: project
---

annual-registration-renewal タスク5（store + Server Actions）を main 直実装。コミット 1285b95。store 23 件 + Action 15 件 green・monorepo check-types green。

★設計上の決定:
1. **lib/member-profile-fields.ts を新設**して名簿の列の**形式検証だけ**を抽出（実装手順書「必須検証は既存の zod を流用する。二重定義しない」）。会員編集の updateProfileSchema と S1 の rosterPatchSchema が同じ定義から組む。**必須／任意の判断は各呼び出し側に残す**のが要点——管理者編集は「値が来たときだけ形式検証」で全項目 nullable、S1 の「登録する」だけが findMissingRegisterFields で必須を足す。会員編集の既存 122 件が回帰ガードで、抽出直後に実行して green を確認してから新規コードを書いた。
2. **startRenewal は URL・案内文を tx の外で確定**させてから tx へ入る（PUBLIC_BASE_URL 未設定はスナップショット投入後のロールバックではなく単なる入力検証）。tx 内では club_line_groups を FOR UPDATE してから進行中/同一年度を確認（S3 の revert とのレース）。
3. **changeRenewalDeadline は kinds: ['reminder'] が load-bearing**。省略すると案内タスク（target_date=開始日でリマインドの対象日集合には決して入らない）まで取り消され「送信済みの案内は取り消さない」に反する。新対象日 0 件のときは keepTargetDates を渡さない（cancelTasks は空配列を絞り込み無しとして扱うため、意図を呼び出し側で明示）。
4. **回答者は毎回 answered_by_user_id と answered_by_admin の両方を上書き**（代理回答のあとに本人が答え直したら代理の印が消えること）。
5. 対象集合の読み出しは必ず membership_renewal_members から（AC-1 は書き込み側だけでなく**読み出し側の性質**）。開始後にフラグを反転させて母数が動かないことをテストで固定した。
