---
name: auto-review-round-pr351
description: auto-review PR #351
type: project
---

PR #351 nav-settings-hub のレビューループ記録。

## R1
- effort=high（差分 2,204 行 > 400 による自動判定）
- verdict=**pass**。blockers 0 / should_fix 0 / nits 0
- tokens: 151,585（累計 151,585 / 500,000）
- 評価点: ロールプレビュー許可リストから外れた利用者にも本来のロールへ戻す選択肢が残る締め出し防止契約の維持／セグメント境界を考慮したパス判定／`/settings/line-link` の URL と Server Action を保ったままの `(app)` 移設

## R1 pass 後に CI が赤 → main が修正 → R2
CI（run 30205100560）が **新規 E2E 1 件だけ** で失敗。**Codex の見落としではなく、差分だけを見ても踏めない種類の欠陥**:
- `/settings/line-link` は「LINE 連携済みの会員が別アカウントへ切り替える」画面で、`lineUserId` が null だとページ側のガードが `/self-identify` へ飛ばし、そこが「内部 id あり」を見て `/dashboard` へ再送する
- test-utils の `createUser` は **`lineUserId: null` が既定**。`seedAdminSession({name})` のままでは必ず `/dashboard` に着地
- ページのガードは本 PR で変更しておらず、旧 E2E は line-link へ遷移していなかったため露見していなかった
- 修正 = そのテストだけ LINE 連携済み（`lineUserId`/`lineLinkedAt`/`lineLinkedMethod`）でシード。ローカル `playwright test settings-entry` で 2 件 green を確認してから push（コミット `0a22dad`）

## R2
- effort=medium（追加差分が E2E シード 10 行のみ・ソース変更なしのため main が override）
- verdict=**pass**。blockers 0 / should_fix 0 / nits 0
- tokens: 89,575（累計 **241,160 / 500,000**）

## 教訓
**ローカル vitest が全 green でも E2E のシード前提までは守れない**。今回のように「変更していないページのガード」に新規 E2E が引っかかるケースは、差分レビューでも単体テストでも検出できず CI が唯一の網になる。E2E を新規追加したら、そのページが要求するユーザー状態（連携済み / 級 / 権限）をシード側で満たしているかを書いた本人が確認する。
