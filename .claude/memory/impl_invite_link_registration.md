---
name: impl_invite_link_registration
description: "招待リンク会員セルフ登録 実装完了（PR#182 merge）。registration_invites + invite_link enum + registerViaInvite"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8b0e4ed6-4d28-4697-9c93-8c2f228139d6
---

招待リンクによる会員セルフ登録を実装・ship。管理者が発行した招待URL → 「LINEで登録」→ LINE OAuth → 氏名+級入力 → role=member で会員作成＋LINE紐付け → ダッシュボード。既存の admin createMember＋[/self-identify] は置き換えず併存（[[project_invite_link_registration_def]] の定義どおり）。

**PR #182 merge `62e9da9`（2026-06-26）。親 #173＋子 #174-181 全クローズ。8タスク。** migration **0030**（registration_invites テーブル＋ line_link_method enum に `invite_link` 追加）。

**非自明な実装判断:**
- **generateRegistrationToken は Web Crypto グローバル（`crypto.getRandomValues`＋`btoa` で base64url 43文字）**。当初 `node:crypto` の randomBytes だったが、admin section（client component）が同モジュールから期限プリセットを import するため webpack がブラウザ向けに `node:crypto` をバンドルしようとして `/admin/members` ビルドが落ちた。**E2E（管理者発行テスト）が実検出** → 同形 API に置換。教訓は [[feedback_node_import_breaks_client_bundle]]。tsc/vitest では出ない。
- **registerViaInvite は self-identify と同型のセッション更新**: INSERT 後 `unstable_update({user:{lineLinkedAt,lineLinkedMethod}})` で **id は渡さない**。id は [node-jwt-callback] が `!id && lineUserId` のとき DB から解決する（INSERT 済みなので unstable_update の jwt callback 内でその場解決）。**Codex R1 が「id 未反映で /self-identify に飛ぶ」と blocker を出したが false positive**（E2E テスト2 が登録→dashboard 到達を実証・auth.config の update 分岐は id パッチを無視するので提案は dead code）。ユーザー承認で override し ship。
- **同名衝突→文言エラー / 同一 line_user_id（二重送信 race）→ `/` へ誘導**。`uniqueViolationConstraint()` を db-errors に追加して制約名で分岐。
- middleware `/register/*` は新カテゴリ: 未ログイン通過・未紐付け時 self-identify 強制の例外・紐付け済みは `/`（id ガードで未紐付け registrant を `/` に飛ばさない）。既存ルーティング非破壊。
- 発行URLのベースは `PUBLIC_BASE_URL` env →無ければ `headers()` の host fallback（E2E は localhost:3001 になる）。
- listActiveRegistrationInvites は `'use server'` export＝RPC なので自前で authz（assertAdminSession）。

**検証:** lib 26 / 発行系 actions 10 / registerViaInvite 10 / E2E 6 ・ web unit 638 ・ shared 12 ・ mail-worker 401 ・ check-types/lint green。Codex auto-review 1R（blocker は上記 false positive、override）。

**残 DoD:** 本番反映後の実機確認（migration 0030 は code 変更ありのため [[project_auto_deploy]] が main push で自動適用→スマホで発行→登録の通し目視）。
