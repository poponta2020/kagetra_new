---
status: in_progress
---
# role-preview-switch 実装手順書（2026-08-22 改修: ゲストビューの解禁）

親Issue: #514 / 子Issue: #515・#516・#517

> 本ファイルは**今回の改修（表示ロールのプレビュー切替に「ゲスト」を追加）**のタスクで上書きしている。
> 初版（2026-07-26 出荷・PR #336）のタスク一覧は git 履歴（`6c671cf` 以前）にある。
> 要件の正典は [requirements.md](./requirements.md)（R1 / R7 / S1〜S3 / AC-20〜AC-27）。
> guest-role 側の R7・AC-24・AC-36 も同時に書き換え済み（撤回の記録は両要件定義書の変更履歴）。

## 設計の芯（このタスク群が守る不変条件）

1. **ゲストへの切替は本物のロールが `admin` のときだけ**。この条件を **3 層**に同じ形で置く:
   - `selectableRoles(realRole)` — 選択肢の生成（UI と Server Action の認可が共に読む）
   - `auth.config.ts` の `jwt` コールバック — `/api/auth/session` からの直接更新の認可
   - `resolveEffectiveRole` — 実効ロールの生成点（改竄 JWT に対する最後の砦）
2. **`ROLES_HIGH_TO_LOW` に `guest` を足さない**。ランク比較（guest = 0）だけで選択肢を作ると副管理者・一般会員にもゲストが生える。guest は `realRole === 'admin'` を条件に**別立てで末尾に足す**。
3. **本物のゲストはプレビュー機能を一切持たない**。`buildRolePreviewSelection` の `real === 'guest'` → `null` は残す（消してよいのは `current === 'guest'` の側だけ）。
4. **ゲストビューの唯一の復帰導線**は設定ページのゲスト分岐に出す「表示ロール」セクション。ここを削ると復帰不能になる（この改修が撤回した当初の禁止理由そのもの）。

## 実装タスク

### タスク1: 認可層（純関数・型・JWT コールバック）
- [x] 完了
- **目的:** ゲストを切替先として認める。ただし「本物のロールが管理者のときだけ」を型とランタイムの両方で表現する。
- **対応AC:** AC-3, AC-4, AC-20, AC-25, AC-26, AC-12（回帰）
- **主な変更領域:**
  - `apps/web/src/lib/role-preview.ts`
    - `selectableRoles`: 既存のランク filter の結果に、`realRole === 'admin'` のときだけ `'guest'` を末尾に足す（`ROLES_HIGH_TO_LOW` 自体は変更しない。`selectableRoles('guest') === []` は維持）
    - `resolveEffectiveRole`: `if (view === 'guest') return real` を **`if (view === 'guest' && real !== 'admin') return real`** に変更（admin だけは guest へ落ちる）
    - `buildRolePreviewSelection`: `if (real === 'guest' || current === 'guest') return null` を **`if (real === 'guest') return null`** に変更
    - 3 箇所とも、なぜ admin 限定なのかのコメントを requirements R1 参照で書き換える（現行コメントは「ゲストへは切り替えられない」と逆を向いている）
  - `apps/web/src/next-auth.d.ts`: `JWT.viewAsRole` の型に `'guest'` を追加し、「意図的に含めない」旨のコメントを「admin のときだけ入りうる」へ書き換え
  - `apps/web/src/auth.config.ts`: `jwt` コールバックの `requested !== 'guest' &&` を削除（認可は `selectableRoles(realRole).includes(requested)` に集約。これが admin 限定を内包する）＋コメント更新
  - `apps/web/src/app/(app)/role-preview-actions.ts`: ロジック変更なし（同じ `selectableRoles` を通る）。コメントの前提が変わる箇所だけ更新
- **依存タスク:** なし
- **必要なテスト（テストファースト）:**
  - `apps/web/src/lib/role-preview.test.ts` — 既存 `describe('guest-role（AC-1 / AC-24 / AC-36）')` の**反転**:
    - `selectableRoles('admin')` が `['admin','vice_admin','member','guest']`、`selectableRoles('vice_admin')` に guest が現れない、`selectableRoles('guest') === []`
    - `resolveEffectiveRole('admin','guest') === 'guest'` / `('vice_admin','guest') === 'vice_admin'` / `('member','guest') === 'member'`
    - `resolveEffectiveRole('guest', <any>)` は `'guest'` のまま（昇格不能・維持）
    - `buildRolePreviewSelection` — real=admin/current=guest は非 null、real=guest は null
  - `apps/web/src/auth-config-callbacks.test.ts` — AC-36 系の**反転**: 許可された admin の `viewAsRole='guest'` は転記される／`vice_admin`・`member` からは転記されない／`role='guest'` の昇格不能は維持
  - `apps/web/src/app/(app)/role-preview-actions.test.ts` — admin が `role=guest` を送ると `unstable_update({ user: { viewAsRole: 'guest' } })`、vice_admin が送ると `/403`
- **完了条件:** 上記テストが green・`pnpm check-types` 通過（型に guest を足さないと `token.viewAsRole = requested` が型エラーになるため、型変更漏れは検査で落ちる）
- **対応Issue:** #515

### タスク2: 設定ページ — ゲストビューの復帰導線
- [ ] 完了
- **目的:** ゲストビュー中の設定ページに「表示ロール」セクションだけを足し、そこから管理者へ戻れるようにする。ゲスト用の「表示のみ」ビューは維持する。
- **対応AC:** AC-21, AC-22, AC-26（画面側）, guest-role AC-24（回帰）
- **主な変更領域:** `apps/web/src/app/(app)/settings/page.tsx`
  - `buildRolePreviewSelection(...)` の呼び出しを**ゲスト分岐より前**へ移す（現在はゲスト分岐の後で計算しているため、ゲストビューでは到達しない）
  - 「表示ロール」セクションの JSX をファイル内のローカルコンポーネントへ抽出し、ゲスト分岐と会員/管理者分岐の**両方から同じものを描画**する（2 箇所に同じ JSX を書かない）
  - ゲスト分岐に足すのは**このセクションだけ**。アカウント／管理セクション・通知設定・申込書設定・LINE アカウント切替は足さない（requirements R7・Non-goals）
- **依存タスク:** タスク1（`buildRolePreviewSelection` が guest 実効ロールで非 null を返すこと、`selectable` に guest が入ることが前提）
- **必要なテスト:** `apps/web/src/app/(app)/settings/page.test.tsx`
  - realRole=admin・実効 guest・許可リスト内 → 登録情報（表示のみ）＋「表示ロール」セクション（4択）＋ログアウトが出て、通知設定・申込書設定・LINE アカウント切替・管理セクションが**出ない**
  - 本物のゲスト（realRole=guest）→ 許可リストに載せても「表示ロール」セクションが出ない（既存テストの維持＋許可リスト入りケースの追加）
  - 既存の会員／管理者ビューのテストが変わらないこと（回帰）
- **完了条件:** 上記テストが green
- **対応Issue:** #516

### タスク3: 境界と回帰（middleware・ナビ）
- [ ] 完了
- **目的:** 「ゲストビューは本物のゲストと同じ扱いになる」という契約を、認可の早期ゲートとナビの側でテストとして固定する。
- **対応AC:** AC-23, AC-24, AC-13, AC-27
- **主な変更領域:**
  - `apps/web/src/middleware.test.ts` — 実装変更なし。`realRole='admin'` かつ実効 `role='guest'` のセッションで `/dashboard`・`/players`・`/tournaments`・`/mail`・`/admin/**` が本物のゲストと同じく拒否され、`/events`・`/settings` は通ることをテストで固定する（middleware が実効ロールを読む性質＝ AC-24 の依存先を明示的に守る）
  - `apps/web/src/components/layout/bottom-nav.test.tsx` / `mobile-shell.test.tsx` — 実効 guest で 2 タブ（大会・設定）になり、設定タブのバッジが `ゲスト` になること
- **依存タスク:** タスク1（実効ロールが guest になれることが前提）
- **完了条件:** 追加テストが green・既存テストに変更なし
- **対応Issue:** #517

## 実装順序（Wave = 並行実装できるタスクの組）

- **Wave 1:** タスク1（認可層。他の 2 タスクの前提）
- **Wave 2:** タスク2, タスク3（依存はどちらもタスク1 のみ。変更領域は `app/(app)/settings/` と `middleware.test.ts` + `components/layout/` で重ならない）

## 移行・互換性

- **DB スキーマ変更・migration は無い**（状態は JWT クレーム `viewAsRole` 1 個のまま）。
- **既存 JWT との互換**: 旧 cookie は `viewAsRole` が `undefined` か 3 ロールのいずれかで、いずれも従来どおり解釈される。ログアウト不要。
- **環境変数の追加なし**（`ROLE_PREVIEW_USER_IDS` をそのまま使う）。本番の再配備手順も不要 — コード変更の push で自動デプロイされる。
- **公開契約**: `Session['user'].role` / `.realRole` の型は既に `guest` を含むため変更なし。変わるのは `JWT.viewAsRole` の型（内部）だけ。
