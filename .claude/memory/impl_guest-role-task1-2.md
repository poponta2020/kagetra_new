---
name: impl-guest-role-task1-2
description: guest-role タスク1・2
type: project
---

# guest-role タスク1・2（基盤 / アクセス制御）実装記録

worktree: `C:/tmp/impl-guest-role`（branch `feature/guest-role`）。正典 = `docs/features/guest-role/{requirements,implementation-plan}.md`。

## タスク1（#481・commit dfcfb1b）基盤

- migration **0057**: `ALTER TYPE user_role ADD VALUE 'guest'` + `registration_invite_kind`(member/guest) 新設 + `registration_invites.kind`(NOT NULL DEFAULT 'member')。drizzle が生成した SQL は `user_role` の新値を同 migration 内で参照していないので分割不要だった。
- **`drizzle-kit push --force` は新 enum を無言で適用でき、対話プロンプトにならない**ことを DB テスト1本（entry-fee-tally 15件 green）で先に確認した。Wave 前に確認しないと、ワーカー3体ぶんのテストを書き終えたバリア時点で初めて全滅が判明する。
- role-preview: `parseUserRole` は guest を**受理**／`ROLES_HIGH_TO_LOW` には**入れない**（同ファイル内で逆を向く。両方の理由をコメントに残した）。
- ★**要件・手順書に無かった穴を1つ塞いだ**: `ROLE_RANK.guest=0` だと `resolveEffectiveRole('admin','guest')` が `guest<=admin` で成立し、**管理者がゲストビューへ落ちて復帰不能**になる（ゲスト設定画面には切替セクションが無い）。実効ロールの生成点で `if (view==='guest') return real` を追加。手順書のテスト指定は逆方向（realRole='guest' の昇格不能）だけだった。
- 同様に `buildRolePreviewSelection` は `real==='guest'` で即 null（許可リスト任せだと、ゲストの id が誤って ROLE_PREVIEW_USER_IDS に入っていた場合に空セクションが描画されて AC-24 が崩れる）。
- 型: `next-auth.d.ts` の `role`/`realRole` は guest へ拡張、`JWT.viewAsRole` は**意図的に guest を含めない**。その結果 `auth.config.ts` で型エラーが出たので `requested !== 'guest'` を明示的に足した（実行時は selectableRoles で既に冗長だが、型とランタイム防御を同じ形で並べる）。

## タスク2（#482・commit 0285704）アクセス制御

- `apps/web/src/lib/guest-access.ts`（新規・純関数・Edge safe）に `isGuestRole` / `isGuestAllowedPath` を一本化。middleware（Edge）と Node 側（route handler・ページ）の**両方から同じ関数**を呼ぶ二段構え。
- 許可: `/`・`/403`・`/events`・`/events/:id`・`/events-archive`・`/settings`(完全一致)・`/roster-files/:id`・`/api/roster-files/:id[/preview/:page]`・`/api/auth/**`。他は全拒否。
- ★**`/403` を許可リストに入れないとリダイレクトループになる**（要件の遷移図には書かれていない）。
- ★**`/roster-files/:id`（ページ）も許可に入れた**。要件は API だけを AC-34 で明記していたが、この API は当該ページのビューアからしか使われないので、ページを閉じると AC-34 が無意味になる。R2「名簿はゲストにも見える」との整合を取った解釈。
- middleware は API とページで応答を変える（`/api/` は 403 JSON・他は `/403` へ。search は落とす）。
- Node 側ガード: `api/mail/attachments` の2本（`api/` は `(app)/` 配下でないので画面ガードが一切効かない）＋ ログイン済みなら誰でも見られる会員向け13ページ（mail/players/tournaments/settings-line-link）。管理者専用ページは既存の `role==='admin'||'vice_admin'` 判定でゲストが自動的に落ちるので追加不要。
- 添付ルートの `attachment-route-parity.test.ts` は admin セッションで両ルートを叩く設計なので、認可の追加で壊れなかった（10件 green）。
- 新規テスト: `middleware.test.ts`（**既存の middleware テストは存在しなかった** — 手順書の「既存の middleware テストが回帰しない」は誤り。next-auth を恒等モックして NextRequest で叩く形で新規作成）・`lib/guest-access.test.ts`・`api/mail/attachments/guest-access.test.ts`。

## AC-28（通知）の調査結果 ★実装変更ゼロ

Explore 調査で判明: **個人宛 LINE 通知は実装が存在しない**（全 LINE 送信はグループ宛ブロードキャストか、運用者が固定設定した `line_channels.notification_line_user_id` 宛）。Web Push は送信側3経路（`mail-worker/src/notify/web-push.ts` の2関数 + **`mail-worker/src/result-import/run.ts` の `notifyResultParseCompleted`＝docs 未記載の第3経路**）すべてが `inArray(users.role, ['admin','vice_admin'])` のアローリストで、購読作成側も admin 限定。よって guest 除外を足すべき宛先クエリは**現状ゼロ件**。AC-28 は回帰テストで固定するだけでよい。

## Wave 構成

Wave1 = タスク1（main 直・共有ホットスポット）→ タスク2（main 直・認可の新設）→ Wave A = タスク3/4/5（並行3）→ Wave B = タスク6/7/8。profile の `max_workers: 3` が手順書の「7並行」より優先。`worker_verify: none` のためワーカーはテストを書くだけ。
