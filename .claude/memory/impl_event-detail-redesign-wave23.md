---
name: impl-event-detail-redesign-wave23
description: event-detail-redesign Wave2-3(タスク4-6)完了
type: project
---

event-detail-redesign（親Issue #352・全6タスク）を実装完了。worktree=`C:/tmp/impl-event-detail-redesign`・ブランチ `feature/event-detail-redesign`・6コミット。Wave1 は [[impl-event-detail-redesign-wave1]] に記録済み。

## Wave 2（タスク4・5 を並行）＋ Wave 3（タスク6 は main 直実装）
- **タスク4 (#356・5198908)** 名簿を級タブ化・級の若い順、Excel 取込（`uploadRoster`/`RosterUploadForm`）廃止、関連メールをトグル化
- **タスク5 (#357・6eebfc1)** 進行管理を申込/支払の2トグル化、LINE 配信をトグル化して非管理者には何も描画しない、級別配信を LINE トグル内へ内包、配信履歴を罫線リスト化
- **タスク6 (#358・2489721)** page.tsx 全面書き換え、`EventDetailHeader`/`EntryFlow` 新設、対象級を級別定員へ統合、不参加人数の算出削除

## ★実装中に確定させた判断（要件に明記が無くモック/整合性から決めた分）
1. **名簿の並びは 申込者→確定**（現行実装は確定が上）。requirements に明記が無く、レイアウトの正はモックで、モックが両ビュー一貫してこの順
2. **級タブは「その名簿に実在する級」から導出**。`eligibleGrades` 由来にすると定員未設定・全級対象の大会で空タブが並ぶ
3. **`carried_up`（繰上）を朱にしない。** 朱は `cancelled`/`carry_up_declined` のみ（design-spec「朱は警告・否定にのみ」）
4. **級別定員の「（抽選日：M/D）」を両ビューに出す。** モックは会員ビューにだけ描いていたが、ロールで出し分ける理由が無いため統一
5. **セクション間余白 34px は各セクションコンポーネントが自前で持つ。** page.tsx 側のラッパー div に付けると、非管理者の LINE 配信・団体戦の名簿・0件の関連メールが null を返したときに**空の 34px が残る**。実機で関連メール0件を確認して確定
6. **LineBroadcastSection の status のみスタブは維持**（要件 §6 の契約）。非管理者では component が null を返すが、遮断の仕組み自体は残す

## ハマりどころ・注意点
- **jsdom の `getByText` は要素の"直下のテキストノードのみ"で照合する**（`getNodeText`）。`<h2>参加者<span>5</span></h2>` は `getByText('参加者')` でマッチする。一方 **同じ文字列が `<select>` の option にもあると複数マッチで落ちる** — 「現地払い」「未設定」で実際に踏んだ（summary に絞って解決）
- **`noUncheckedIndexedAccess` で `arr[0].x` が型エラー**。ワーカーはテストを実行できないので型エラーを持ち帰れない → main がバリア後に `?.` で修正（entry-flow.test 3箇所・GradeBroadcastSection 1箇所）
- **ローカル dev DB（5433）はスキーマが古く `entry_status` 列が無い** → 実機確認には使えない。**E2E 固定 DB `kagetra_test`（5434）に `pnpm test:db:push` してシードする**のが低リスク（ユーザーの dev データを触らない）
- **`docker exec` は `-i` が無いと stdin を受けない** → heredoc の SQL が無言で流れず「0件」になる。**必ず独立系統で verify する**（[[tool-output-fabrication]] と同じ教訓）
- **Auth.js のセッション cookie は認証済みロードの後 HttpOnly になる** → JS で上書きできない。ロールを切り替えるには `/api/auth/csrf` → POST `/api/auth/signout` を挟んでから再注入する
- **in-app pane の cookie 注入は `/sw.js`（`application/javascript`）では効かない**（設定しても `document.cookie` に残らない）。**HTML ページ（`/auth/signin`）で注入する**。tab-1 が dead error page に張り付いたら `tabs_create` で新規タブを作ると素直に通る
- `preview_start` は worktree を指す junction 経由（`.design-live`）で起動する。**確認後は必ず `preview_stop` してから junction を戻す**（worktree cwd の長寿命プロセスは削除を Device busy で妨げる）

## 検証（実測）
- **Vitest 全スイート green: 129 files / 1762 passed / 1 skipped**・`pnpm check-types` clean・eslint clean
- **忠実度チェックリスト 12/12 クリア（実機実測。375px・admin/member 両ビュー）**
  - ページ全長（トグル閉）: **管理者 942px（基準 1100px 以内）/ 会員 759px（基準 800px 以内）**
  - 横スクロール: `scrollWidth === clientWidth` で両ビュー 0
  - `<details>` は admin 0/6・member 0/3 = **既定=閉**
  - ルート `p-4` / `<main>` padding 0（AC-23）
  - `rounded-full` は申込フローの点5個（9px×4＋goal 11px）だけ＝ピル/チップ0
  - 参加者の人数 Serif 20px `#2b4e8c`（藍）／備考 Serif 16px・line-height 30.4px（=1.9）／級別定員は mono級+Serif数字+sans単位を1行
  - 名簿は級の若い順・自会員は `#1e3a6b`（藍）＋所属末尾「・会員」・取消は neutral に落として朱ラベル
  - 生 ISO 表記 0件
- **★AC-10/AC-28 を実サーバーの RSC payload で検証**: 会員ビューの HTML 79KB を全文検索し、参加費/支払方法/振込先/申込方法/ゆうちょ/事前振込/進行管理/支払締切/公認/正式名称/主催/申込済/未払 が**すべて 0件**（唯一マッチした "2000" はフォントの `unicode-range: U+2000-206F`）。unit test より強い証拠
