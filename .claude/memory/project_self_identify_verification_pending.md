---
name: /self-identify の本人性検証は未実装（Follow-up 必須）
description: PR #5 で LINE Login + /self-identify 自己申告フローを入れたが、任意の LINE user が任意の招待会員を claim できる状態。運用開始前に必ず塞ぐこと。
type: project
originSessionId: b09f3526-58d2-4875-a1a0-7c646f986b97
---
PR #5（`76d40f1` / 2026-04-22 merged）で LINE Login + `/self-identify` 自己申告フローを導入したが、**本人性検証は意図的に未実装**のまま ship した。Codex Round-3 レビューで Blocker として指摘された項目を、ユーザー判断で本 PR スコープ外に切り出した。

**Why:**
- 現状、LINE Login 通過後の `/self-identify` は「候補一覧から選ぶだけ」で `lineUserId` が確定する。
- 招待制で LINE Login 自体に閉じた ACL はあるが、招待された任意の member が他の member を claim できるため、身内による乗っ取りを防げない。
- 公開運用前に必ず対策する。

**How to apply:**
- 次に `/self-identify`, `apps/web/src/app/self-identify/`, `apps/web/src/auth.ts` の `signIn` callback を触る依頼が来たら、この Follow-up を思い出すこと。
- 設計案は 3 つ（レビュアから提示済み）:
  1. **ワンタイムトークン / PIN** — 招待時に会員ごとに発行 → 自己申告時に一致検証。最堅牢。`invited_members` に token 列追加 + 管理者の配布運用が必要。
  2. **管理者承認フロー** — 自己申告は pending 仮紐付け、admin が確定。`users.status = 'pending'` 等を追加、admin UI 追加、pending 時のアクセス制限も要検討。
  3. **本人のみが知る属性（誕生日等）** — 軽量だが会員名簿漏洩時に無力なので非推奨。
- 関連ファイル:
  - `apps/web/src/app/self-identify/page.tsx` — 候補一覧表示
  - `apps/web/src/app/self-identify/actions.ts` — `claimMemberIdentity` server action
  - `apps/web/src/app/self-identify/candidate-list.tsx` — クライアント検索 UI（PR #5 で info 最小化済み: 氏名のみ表示）
- PR #5 内で対応済みの緩和策（Should fix 相当）: 表示を氏名のみに絞り、級/所属は DB から取得すらしないようにした（`columns: { id, name }`）。ただし氏名から会員を特定できることには変わらない。
- 運用ドキュメント（`docs/phase-1-5-migration-plan.md` §3.4 等）も、この検証方式を決めたタイミングで合わせて更新すること。
