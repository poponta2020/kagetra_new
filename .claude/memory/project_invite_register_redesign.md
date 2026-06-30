---
name: project_invite_register_redesign
description: "招待URL会員登録リデザイン＆プロフィール拡張。全6タスク実装＋Codex2Rレビュー対応→SHIPPED。PR#206 merge f8d8f5c(2026-06-30)・親#199＋子#200-205全クローズ・migration0035。残=本番実機目視"
metadata: 
  node_type: memory
  type: project
  originSessionId: cc597249-d06f-4b5b-afc1-b86855ec1cd2
---

招待URL会員登録 `/register/[token]` のUIリデザイン＋プロフィール拡張（/design-screen 起点→/define-feature で要件化）。`docs/features/invite-register-redesign/`（requirements.md=**completed** / design-spec.md=**locked** A-flat / implementation-plan.md=**completed**）。**親Issue #199 ＋子 #200-205 作成済み。実装未着手＝/implement か /do-plan 待ち**（CLAUDE.md ルール1）。

- **視覚（design-spec, A-flat「脱カード」）:** ユーザーが Claude Design 上で A案を反復改修（`design.md §2.5 アンチスロップ`：カード箱/影撤去・アンダーライン入力・下線セグメント・箱なしチェック・serif ワードマーク維持）。確定モック=`preview/invite-register-a.html`（projectId 74ab8bf1…）。
- **スコープ確定（全部1機能）:** ①氏名=姓/名(漢字)＋せい/めい(かな) 全必須→新4列＋表示名`name`=`姓␣名`合成(UNIQUE維持) ②級=任意 ③段位=A級のみ必須・既定四段(四〜八=int 4-8)→既存`users.dan` ④全日協チェック=A/B/C級で表示・既定ON→**既存`users.zen_nichikyo`流用(新列でない)** ⑤全日協ON時 PII全必須=性別(既存`gender` 男女のみ)/生年月日/電話/郵便/住所1(丁目番地)/住所2(建物部屋) ⑥郵便→住所は**サーバー経由 zipcloud**＋手入力フォールバック。
- **非自明な判断:** 住所2は**DB nullable・フロントは「集合住宅でない(一軒家)」チェック未選択時のみ必須**（戸建てチェックは保存しない＝フロント検証制御のみ）。性別enumは male/female のみ（その他不採用）。既存約100名は新列null（自動分割しない）。`name`を正典に保ち管理者createMember/self-identifyは不変＝波及最小。
- **DB:** `users`に nullable **9列**追加(`family_name/given_name/family_kana/given_kana/birth_date/phone/postal_code/address1/address2`)・migration **0035**(実装時に並行番号衝突確認)。test/dev=push・本番=migrate。
- **対象外(別PR):** 会員設定画面での本人PII自己編集（可視性=管理者閲覧＋本人編集可だが本人編集導線は別slug）。
- **タスク:** #200土台/#201 api/zip/#202 registerViaInvite改修/#203 フォーム+ページ(A-flat)/#204 管理者編集拡張/#205 E2E。順序=1,2並行→3→4 / 5(1依存)→6。
- 元機能=[[impl_invite_link_registration]]（PR#182）。スキーマ事実は[[project_dev_rules]]準拠で確認済（gender/dan/zen_nichikyo/affiliation は既存・kana/姓名分割/birth/phone/postal/addressは新規）。

## 実装完了（2026-06-29・/implement）— worktree C:/tmp/impl-invite-register-redesign / branch feature/invite-register-redesign
全6タスク実装・テスト green・push 済。**ユーザー指示で Codex レビュー直前（/prepare-pr 未実行）で停止中**。再開は `/prepare-pr feature/invite-register-redesign`（PR作成→auto-review-loop→Codex）。
- **コミット:** docs(a46f86d) / T1 migration0035=`0035_user_profile_pii.sql`(f8fadb1, auto生成名をリネーム・journal tag更新) / T2 api/zip(8a82b68) / T3 registerViaInvite(a5eacbc) / T4 form+page A-flat(61de3ca) / T5 admin編集(3b15338) / T6 E2E(dba835a)。子Issue #200-205 は Fixes でマージ時クローズ予定、親#199 タスクリストは全チェック済。
- **検証:** shared 16 / web 789(+1 skip) / E2E invite-link-registration 10ケース / check-types(shared/web/api/mail-worker) + lint 全 green。
- **非自明な実装事実:**
  - `birth_date` は drizzle `date()` **string モード**（columnType=`PgDateString`・'YYYY-MM-DD' で round-trip）。action/フォームは文字列で扱う。
  - **middleware matcher に `api/zip` を除外追加**必須だった（未除外だと未紐付け(/register中)ユーザーが /self-identify へリダイレクトされ住所補完失敗）。無認証・無鍵の公開 zipcloud プロキシなので matcher 除外で対応。
  - registerViaInvite は zod(常時必須の姓名かな)＋手続き的条件分岐(段位/全日協/PII)。`name=姓␣名`合成。サーバーが不変条件を強制（級≠A→dan null・級∉{A,B,C}→zen=false・zen OFF→PII全null＝提出値に依存しない）。郵便は7桁正規化保存。`noUncheckedIndexedAccess` で `split('-').map(Number)` 分割代入が `number|undefined` になるので `Number(parts[i])` で回避。
  - フォームの下線セグメント＝sr-only `<input type=radio>`＋ラベル。E2E は `getByText(label,{exact})` でラベルクリック。住所2は `required={!detachedHouse}`＝戸建て未チェックだと**ネイティブHTML5検証で送信ブロック**（E2E A級でこれに嵌り、戸建てチェック or 住所2入力が必要）。
  - 管理者編集(T5)は新9列を直接 表示/編集（段階表示なし）。`name` は**再合成しない**＝正典のまま（新列は補助）。可視性は既存ロール制御(admin/vice_admin のみ到達)で担保。
  - test/E2E は docker `kagetra-db-test`(5434) 必須。worktree に pnpm install 済。Docker Desktop 起動→`docker compose -f <main>/docker/docker-compose.yml up -d postgres-test`（worktree cwd 回避は[[feedback_no_longlived_process_from_worktree_cwd]]）。

## SHIPPED（2026-06-30・/prepare-pr→/auto-review-loop→/ship）— PR #206 merge `f8d8f5c`
ハンドオフ後に別端末で再開し出荷。親 #199＋子 #200-205 全クローズ。本番 migration 0035 は auto-deploy 対象（main push で適用）。残 DoD=本番実機目視（招待URL登録 各級＋全日協PII＋郵便→住所＋管理者編集）。
- **Codex auto-review 2R で pass**（effort=high・累計 227,172 tokens）。R1=should_fix 2件→`/fix`(commit `10f51c3`)→R2=pass。修正2点（いずれも回帰テスト追加・web 50 tests green）:
  - **未来日の生年月日**: 管理者編集の `isRealYmd` が未来日を許容していた（登録側 `validateBirthDate` は未来日拒否）。共有 `users.birth_date` への両書込経路で「実在日・1900年以降・未来日でない」に統一。
  - **changeGrade の PII リセット漏れ**: dan/zenNichikyo しか戻さず、B/C/A で入力した PII が D/E 降級→再昇級で復活し送信され得た（changeGrade が zenNichikyo を ON に戻すため）。gender/birthDate/phone/postalCode/address1/address2/detachedHouse/zipStatus も初期化しコメント通りの挙動に。
- **環境ハマり（再発注意）:** codex CLI 0.130.0 が `~/.codex/config.toml` の `service_tier = "default"`（Codex Desktop 書込値・CLI は `fast`/`flex` のみ受理）で**起動時パース失敗→codex CLI 全体が無効**。当該行除去で解消（[[reference_codex_config_service_tier]]）。worktree 物理ディレクトリは node_modules 長パスで一度削除失敗→PowerShell リトライ＋`rmdir /s /q` で除去。
