---
name: impl-annual-registration-renewal-wave4
description: 年度確認 Wave 4（タスク6・8・9）
type: project
---

annual-registration-renewal Wave 4（タスク6・8・9）を task-implementer 3 並行で実装。コミット ac800f5(T6) / 21f37b4(T8) / c37390d(T9)。対象テスト 253+21 件 green・monorepo lint / check-types green。

★**3 ワーカーが同時に API 接続エラー（ENOTFOUND）で途中終了**した（さらに再投入した T6 ワーカーはセッション上限 429 で 2 度目の中断）。**成果物はディスクに残っていた**ので、git status とファイルの存在確認で「どこまで出来ているか」を測り、残りだけを main が引き取るのが正解だった（フルの再実行はしない）。残っていたのは T6=RenewalForm 本体＋テストの断言修正・page.test.tsx、T8=deploy ドキュメントのみ。

★main が拾った抜け（ワーカーのタスク定義に入っていなかった実害）:
1. **infra/sudoers/kagetra-deploy への新 unit 登録**。unit 名は固定列挙（ワイルドカード禁止＝privilege escalation 対策）で、**未登録のまま unit を含む PR をマージすると auto-deploy が install の段階で sudo に蹴られて必ず fail する**。install 4 行・enable 2 行・restart 2 行を追記。sudoers の本番反映は**マージ前に手作業**が要る（PR #312 の残 DoD と同じ罠）。
2. **型エラーの取りこぼし**: store.test.ts / renewal/actions.test.ts を書いたあと check-types を回していなかった（テストだけ回して green を確認していた）。turbo のキャッシュもあって気づきにくい。**テストを追加したら check-types も回す**。
3. RenewalForm.test.tsx の 1 件が仕様誤解（非最終学年の既定表示に「3年に進む」が出ると誤認）。既定は「現在 → 4月から」の 1 行で、'3年に進む' は例外リンクを開いた後にしか出ない。テストを 2 件に割って正した。

★実装上の要点: RenewalForm は編集していない行も hidden input で現在値を送る（rosterPatchSchema は部分パッチではないので送り忘れると users の当該列が空で上書きされる）。
