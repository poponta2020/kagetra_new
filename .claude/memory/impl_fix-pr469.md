---
name: fix-pr469
description: fix PR #469
type: project
---

PR #469 (openchat-broadcast) の Codex R1 指摘を修正。ブランチ feature/openchat-broadcast、コミット 9bda252。

## 対応した指摘（blockers 9件中 7件）
- [CRITICAL] **認証欠落** — `listOpenChatsForGroup` / `countOpenChatsAddedSinceLastBroadcast` が `'use server'` ファイルから**認可ガードなしで export** されていた。'use server' の export は全て公開 Server Action エンドポイントになるため、Action ID さえ分かれば未ログインで任意 entryGroupId の招待 URL・パスワードが取れる状態だった → 読み取りクエリを `server-only` の `lib/open-chat/queries.ts` へ移動。未使用だった集計関数は削除
- [CRITICAL] **再配信不能** — 抽出シートが保存済み URL を候補に再掲したまま保存 Action を呼ぶため `UNIQUE(entry_group_id, url)` 違反で止まり、**配信処理まで到達しなかった**。AC-35/36/53 で作った再配信確認ダイアログが UI 経路で一度も使えず、push 失敗後の再試行も不可 → 保存済み URL を候補から除き、新規ゼロなら「配信する（M件）」で配信のみ行う配信専用モードを追加
- [CRITICAL] **ラベル重複検査が既存行を見ていない** — 入力行どうししか比較しておらず、既に C級 が保存済みのグループへ最終ラベル C級 の別 URL を足すと素通りしていた（requirements §3.2.1 の契約違反）→ 既存行＋入力行を合わせて判定。返す index は入力行のものだけ
- [CRITICAL] **配信済み回数に failed/skipped を数えていた** → `status='sent'` の行だけから算出。1度も届いていないのに「すでに1回配信」と出て「（今回追加）」印まで消える不具合
- [CRITICAL] **配信 Action が呼び出し元指定の sentByUserId / displayName を信頼** → 公開 Action の引数を entryGroupId のみに限定し、実処理は非 export の内部ヘルパーへ分離。送信者はセッション、大会名は DB から導出（監査行の偽装と、存在しないユーザー ID による push 成功後の FK 違反＝配信の未記録を塞ぐ）
- [CRITICAL] **HTML 本文の取りこぼし** — `bodyText ?? bodyHtml` のため plain part が存在するだけで HTML を丸ごと捨てていた（招待 URL が `<a href>` にしかない multipart メールで候補ゼロ）→ 両方を抽出対象に
- [CRITICAL] **URL 検証が前方一致のみ** → `URL` でパースし https + ホスト非空を検証。`https://` 単体等がすり抜けると LINE が Flex 全体を拒否し全件配信が失敗する

## 対応しなかった指摘（ユーザー判断で見送り = WONTFIX）
- [WONTFIX] **push 前に永続的な配信試行記録を確保していない** — LINE が push を受理した直後・履歴 INSERT 前にプロセスが落ちると「配信済みなのに記録なし」→次回重複送信。修正は sending→sent/failed の2段書き込み。**管理者が実質1名で、その瞬間に落ちる確率が極めて低く、実害もカードが2回届く程度**というユーザー判断で見送り
- [WONTFIX] **再配信確認と実際の配信対象が並行操作に対して固定されていない** — 確認ダイアログを開いてから押すまでに別管理者が行を追加すると、ダイアログに無い行まで送られる。管理者2人が同時確認すると二重配信。**管理者は基本1人、仮に2人でも同時操作の可能性は極めて低い**というユーザー判断で見送り。※これに伴い、ラベル重複検査の行ロック（並行保存時の取りこぼし）も入れていない

## 追加した回帰テスト
既存行とのラベル衝突 / 衝突しない追記 / failed を配信回数に数えない / 不正 URL 4種 / HTML 本文のみの URL 抽出 / 配信 Action の送信者がセッション由来 / 保存済み URL が候補に再掲されない / 配信専用モードで保存 Action を呼ばない

## 検証
影響領域 618 passed / 31 files（修正前 607 → 11 件増）。pnpm check-types（全4パッケージ）green、pnpm lint green。

## 気づき（次回に効く）
- **`'use server'` ファイルからの export は全て公開エンドポイント**。読み取りヘルパーを同居させると認可の穴になる。内部クエリは `server-only` の別モジュールへ置くのが正しい（このリポジトリには `lib/entry-form/*` に既存の前例がある）
- **UI 経路のテストが無いと「Action 単体は green なのに画面からは一度も成功しない」が起きる**。再配信は Action を直接呼ぶテストしか無かったため、シート経由で必ず UNIQUE 違反になることを検出できていなかった
- `new URL('https:///path')` は WHATWG URL ではホスト `path` として解釈できてしまう（構文検証としては通る）。テストの不正 URL 例に使わないこと
