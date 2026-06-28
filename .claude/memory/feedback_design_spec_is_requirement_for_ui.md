---
name: feedback_design_spec_is_requirement_for_ui
description: UIリデザインは design-spec を要件成果物として直接 implement へ。/design-screen の後に /define-feature を後追いで回さない
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2963994e-ce8b-4eae-aa79-ca848db31b5d
---

画面が主役のリデザインで `/design-screen` が design-spec を固めた後に `/define-feature`（要件定義セレモニー）を後追いで回すのは**重複・二度手間**。ユーザーが「画面設計終えてから要件定義スキル回すのきもくない？」と指摘（2026-06-28）。

**Why:** `/define-feature` は「何を・なぜ・どんなルールで」を言葉で先に固める*要件先行*フロー。ロジック/データ/フローが主役の機能では正しいが、画面主役のリデザインでは“難しい何を”は見た目とデータ形＝design-spec で既に解けている。要件をかぶせるとユーザーストーリー/画面仕様の言い直しになる。

**How to apply（co-evolution に発展, 2026-06-28 同日）:** 要件と設計は段階でなく**2レンズの螺旋**。1機能=`docs/features/<slug>/` に requirements.md（ロジック）と design-spec.md（視覚）が同居・相互参照・**非重複**（requirements は画面を言葉で再記述しない／design-spec はロジックを決めない）。解けない論点は相手に**宿題**で投げる（design-spec の `## 要件への宿題` ⇄ requirements の `## デザインへの宿題`）。**収束ゲート＝両 lock＋宿題ゼロ＋薄い implementation-plan→/implement**。片方だけなら自然に1レンズに縮む（純UI=design-screen のみ／ロジックのみ=define-feature のみ）。**禁止＝define-feature を「設計後の儀式」として丸ごと回す重複**。emergent logic（例 相手名タップ→戦績）は define-feature の delta パスで拾う。正典＝`docs/dev/feature-flow.md`。両スキルに連結反映済＝[[impl_design_screen_skill]]。初適用＝[[project_senseki_detail_redesign]]。
