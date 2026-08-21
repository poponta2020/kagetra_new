---
name: ship-e2e-group-page-sections
description: E2E をグループページへ張り替え（PR #504）
type: project
---

PR #504 (test(e2e): 進行管理・LINE配信の E2E をグループページへ張り替える) をマージ。
https://github.com/poponta2020/kagetra_new/pull/504
PR #503（entry-group-page）のマージ後に main の CI が赤になった件の追修正。
プロダクションコードは1行も変更していない（E2E テスト2ファイルのみ）。

## 何が起きていたか
PR #503 で日ページ `/events/[id]` から「進行管理」「LINE 配信」セクションを
`/admin/entries/[groupId]` へ移設したが、それらを操作する既存 Playwright E2E を
張り替えていなかった。requirements §6 の「計画的に壊れる既存テスト」一覧を作るときに
**`apps/web/e2e/` を見ておらず unit テストしか洗い出していなかった**のが根本原因。

`test.describe.configure({ mode: 'serial' })` のため CI は最初の失敗しか報告せず、
後続はスキップされる。そのため実際の要修正件数（5テスト）が CI の表示（2件）より多かった。

## 3 回の CI で判明したこと（教訓）
1. **1回目**: E2E 2件失敗 → グループページへ張り替え
2. **2回目**: `完了` フェーズが既定 5s 以内に出ず失敗。Server Action →
   `revalidatePath` → RSC 再取得の往復を短いタイムアウトで待つのは不安定
   → **DB を真実として先に `expect.poll`（15s）し、そのうえで UI を長めに待つ**形へ変更。
   これで「Server Action が失敗した」のか「反映が遅いだけ」なのかが切り分けられる
3. **3回目**: DB ポーリングは通過（entry_status=applied）＝ Server Action は成功していた。
   残る失敗は**期待値の誤り**だった → ★**`events.payment_type` のスキーマ既定値は
   `'advance'`（NULL ではない）**。よって申込済化した直後は「事前払い・未払・確定名簿なし」
   ＝ `classify` は `applied_waiting` を返し、日程表のフェーズは **「抽選待ち」**。
   「支払タイプ未設定だから完了」という前提が誤りだった
4. **4回目: 全green**（Vitest 3183 passed / E2E 44 passed）。serial でスキップされていた
   event-lifecycle の後続4件も実行され通過

なお 3回目の前に **CI が `timeout-minutes: 15` に到達して cancelled** になった run が1回ある
（Vitest 途中でキャンセル・E2E は skipped）。main の通常 run は 12分半前後なので、
**CI は 15分の上限にかなり近い**。将来また詰まるようなら timeout-minutes の引き上げを検討する。

## レビュー
auto-review-loop 1R（initial / gpt-5.6-sol / effort=low）。verdict=**pass**（blockers 0 /
should_fix 0 / nits 0 / WONTFIX 0）。Codex は「状態変更後のアサーションを <details> の外へ移した」
「検証意図を維持した」「heading ロールに限定して strict mode violation を避けた」を評価。
※ pass 判定はグループページへの張り替え時点のもので、その後の DB ポーリング化・
期待フェーズ修正の2コミットは再レビューしていない（CI green で確認）。

## ★教訓（次回に効くもの）
- 画面からセクションを撤去・移設する改修では、unit だけでなく **`apps/web/e2e/` も grep する**
  （`grep -ln "<撤去するセクション名>" apps/web/e2e/*.spec.ts`）
- E2E で `mode: 'serial'` の describe は、最初の失敗以降がスキップされるので
  **CI の失敗件数を「全部」だと思わない**
- Server Action の結果を待つ E2E は、UI ではなく **DB を真実にして `expect.poll`** で待つと
  原因の切り分けが早い
