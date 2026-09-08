---
name: fix-pr618
description: fix PR #618
type: project
---

fix PR #618（feature/mail-ai-extract-refinements・D・E 級の地域制限判定）: Codex R1 の blockers 3 件＋R3（final）の blocker 1 件を修正。
- [CRITICAL] eligible_grades と regional_eligibility の完全一致が検証されない → schema.ts の superRefine に不変条件5（eligible_grades の D・E 集合 == 判定の級集合。欠落・余分を拒否）を追加、prompt.ts に「過不足なく一致」を明記、schema.test.ts に欠落/余分の拒否テストを追加（ユーザー決定=修正案A スキーマ厳格化）commit 0f770bf
- [CRITICAL] 異なる入力同士をまたぐ引用が照合済みになる → evidence.ts をソース単位の配列照合に変更（並行 Agent、commit 7fd7ac6）、境界またぎの回帰テスト3件
- [CRITICAL] 全級除外の単位を戻すと対象級なしが全級扱いで保存される → ApprovalForm.tsx の onSubmit で級未選択を検出して preventDefault＋案内文（ユーザー決定=クライアント側1級以上必須。Server Action 不変）commit 4ca4644。テストは React 19 が submit を常に preventDefault するため defaultPrevented でなく action スパイの呼び出し有無で判定
- [CRITICAL・R3 final] 一部の級だけ自動除外された単位で残りも手動で外して送信すると null=全級 → ガード条件を allRemoved から removedGrades.length>0 へ拡張（ユーザー決定③と同形のため即修正）。混合級の回帰テスト追加・spec 更新。commit は git log 参照
- WONTFIX: なし。検証: mail-worker tsc/eslint/107件・web tsc/eslint/64件 green。commit+push 済み
