---
name: homonym-risk-accepted
description: 同姓同名の選手を区別しない方針で確定（リスク受容）。所属会も識別に使わない
metadata: 
  node_type: memory
  type: project
  originSessionId: 85f6ce81-70fc-4ccb-8988-ba69aa23a261
---

大会結果の選手名寄せで、**同姓同名は区別しない**（同一 player に統合する）方針で確定（2026-06-21）。所属会で区別したいが**所属会は変わる**（高校→大学→社会人）ため識別キーに使わない。

判断: 「同姓同名が同一人物として扱われる影響」＜「区別のために生じる悪影響（別人の乱立・所属変更での同一人物の分裂）」。区別ロジックの害の方が日常的に大きい、というユーザー判断。

**不可逆ではない**のが受容の根拠: `tournament_participants` が各大会の生の氏名・所属を常に保持する（[[impl_tournament_results]]）ので、players をどう名寄せしても生データは無傷。将来区別したくなれば participant 生データから player を再構築・分割できる。影響は player 単位の戦績集計が稀に混ざる点のみ。

身内アプリゆえのリスク受容で、[[project_self_identify_verification_pending]] と同じ思想。
