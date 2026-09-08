---
name: auto-review-round-pr618
description: auto-review PR #618
type: project
---

auto-review PR #618（mail-ai-extract-refinements: D・E 級の地域制限判定）
- R1 phase=initial model=gpt-5.6-sol effort=high（構造的高リスクパス schema.ts 起因・sol 較正でも維持） escalated=false→true verdict=needs_changes counts=B3/S0/N0 round_tokens=203336 cumulative=203336 reviewed_head=e2c1883
- 除外（review-diff 既定）: .claude/memory 2件・docs 4件
- トリアージ: ②evidence.ts の連結コーパス境界またぎ＝即修正（並行 Agent、commit 7fd7ac6）。①schema が D・E 判定の欠落を受理／③全級除外の単位を登録 ON だけで送信すると eligible_grades null=全級扱い＝要確認→ユーザー決定: ①修正案A（superRefine で集合一致）、③修正（クライアント側で級未選択なら送信ブロック。Server Action 不変）。/fix で 0f770bf・4ca4644、docs 92e3507
- R2 phase=delta model=gpt-5.6-terra effort=high（escalated・last_blockers=3） verdict=pass counts=B0/S0/N0 round_tokens=122237 cumulative=325573 reviewed_range=e2c1883..92e3507（510行/7ファイル）→ PHASE=final へ
- R3 phase=final model=gpt-5.6-sol effort=medium（escalated だが last_blockers=0 でデエスカレーション） verdict=needs_changes counts=B1/S0/N0 round_tokens=159760 cumulative=485333 reviewed_head=92e3507（2988行/23ファイル）。blocker=③の拡張（一部の級だけ自動除外された単位で残りも手動解除して送信すると null=全級）→ 即修正（ガード条件を allRemoved→removedGrades.length>0 へ拡張・ユーザー決定③と同形）commit 0a16df4 → PHASE=final-delta へ
- R4 phase=final-delta model=gpt-5.6-terra effort=high（escalated・last_blockers=1） verdict=pass counts=B0/S0/N0 round_tokens=78554 cumulative=563887（上限 500000 を最終ラウンドで超過。次ラウンドは無いので影響なし） reviewed_range=92e3507..0a16df4（96行/2ファイル）→ 成功終了（打ち切りなし・再レビュー未実施の修正なし）
- 結果: pass（i+d+f+fd の4R）。WONTFIX: なし。★教訓: R1 の③（全級除外の空選択）を直した時点で「一部除外の単位で残りを手動解除」の同型経路まで広げていれば final の1ラウンド（160k トークン）で再指摘されずに済んだ — 送信ガードは「自動除外が1つでもある単位」を単位に考える
