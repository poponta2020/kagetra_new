---
name: impl-openchat-broadcast
description: openchat-broadcast 実装
type: project
---

openchat-broadcast（大会オープンチャットの抽出・LINE 配信）を全11タスク実装。worktree=C:/tmp/impl-openchat-broadcast、ブランチ feature/openchat-broadcast、コミット a099498..7348920（11本）。

## Wave 構成（実測）
- W1 main: タスク1 スキーマ+migration 0056 **+ jsqr 追加 + QR フィクスチャ生成**（手順書では W1=タスク1のみだったが、advisor 指摘で lockfile を触る依存追加を先出しした。これでタスク5 が純コードになり Wave 衝突が消えた）
- W2 worker×3: タスク2 extract / タスク3 label / タスク4 flex（手順書は4タスク並列だが max_workers=3 かつタスク5 が package.json を触るため3件に分割）
- W3 main: タスク5 qr（小径のため委譲せず）
- W4 main: タスク6 line-broadcast ヘルパー抽出（高リスクパス・move only の規律はワーカーだと崩れるため main）
- W5 worker: タスク7 collect
- W6 main: タスク8 Server Action（5タスクの合流点）
- W7 worker×2: タスク9 抽出シート / タスク10 大会詳細欄（別ディレクトリ）
- タスク11 main: 忠実度チェック+正典ドキュメント更新

排他宣言のミスなし。Wave 内でファイル衝突は起きなかった。

## 設計判断（手順書からの意図的な逸脱）
- **タスク3 の級型**: 手順書は roster-adopt-utils.ts の RosterAdoptGrade 再利用を指示していたが、それは app/ 配下で lib/ → app/ の逆方向 import になる。roster-adopt-utils 自身がやっているのと同じ「ローカルで5リテラル union を宣言」に変更。client-safe leaf の目的は同じく達成
- **タスク6 の切り出し粒度**: assertBindingUnchanged は **verdict のみ**（{changed, current}）を返し、event_broadcast_messages への監査行 UPDATE は broadcastMailToEvent 側に残した。applyPushFailureRecovery も binding revoke + channel 遷移だけを移し finalize は残した。**ヘルパーが監査行を書くと openchat 側が §6 契約（同テーブルに書かない）を破るか broadcastMessageId を要求することになる**
- **loadActiveBindingByEntryGroup を新設**: 既存 loadActiveBinding は events 経由の event-keyed。openchat は最初から entry_group 単位なので events を経由しない版を追加（返り値の eventId は -1）
- **pushMessages の logger を既定 no-op 化**（既存呼び出し側は全て logger を渡すため挙動不変）

## 発見した問題・注意点
- **sharp の grayscale() 後の raw は 1ch のまま**。toColourspace('srgb') + ensureAlpha() を挟んでも 1ch で出る（sharp 0.34 実測）。jsQR は 4ch 前提で 1ch を渡すと 'Malformed data passed to binarizer.' を投げる → **手で RGBA へ展開する**必要がある。最初この罠で QR テストが落ちた
- **ワーカーは eslint しか回せない（worker_verify: none）ため noUncheckedIndexedAccess 起因の型エラーが素通りする**。タスク2 で 22 件発生し main が回収。ワーカープロンプトに『apps/web は noUncheckedIndexedAccess: true。配列 index アクセスは T|undefined。eslint では検出されない』を明記したら以降のワーカー（タスク7/9/10）はゼロ件だった。**この一文は次回以降も必ず入れる**
- **extract.ts の TOKEN_LENGTH=33 は feasibility.md のサンプル1件からの推定値**。ワーカーが長さ検証を『改行直後に続き、かつ33文字未満のとき』だけに限定した（杉並の『6/20(土)：url\n6/21(日)：url』で2本目のラベル先頭が1本目のトークンへ食い込む事故を実際に踏んだため）。偽陰性より偽陽性を選ぶ設計判断で、確認シートが人のゲートになる。本番コーパスでの確認は未実施
- **LINE Flex に等幅フォント指定のプロパティが存在しない**（fontFamily 相当が仕様に無い）。design-spec の忠実度項目『パスワードはモノスペースで出る』は色・背景のみ再現で**プラットフォーム制約により部分的にしか満たせない**
- **Flex の action.label には文字数上限がある**。超えると push 全体が落ちるため、配信時ではなく**保存時**に LABEL_MAX_LENGTH=40 で弾く実装にした（配信しようとして初めて全件失敗する状態を作らない）
- 抽出候補シートを再度開くと保存済み URL も候補に再掲される（既存 URL 一覧をクライアントへ渡していない）。保存は UNIQUE 違反を拾って『すでに登録されている URL があります』を返すので事故にはならないが、UX の粗さは残る（AC 範囲外）

## 検証
- 影響領域テスト 607 passed / 31 files（lib/open-chat・line-broadcast・line-broadcast-helpers・admin/mail-inbox 全体・events/[id] 全体）。既存 line-broadcast.test.ts は**無改変で green**＝タスク6 の回帰の網が成立
- pnpm check-types（全4パッケージ）green、pnpm lint green
- migration 0056 はテスト DB へ対話プロンプトなしで push 済み

## 残（出荷後に消化する manual AC）
- **AC-15**: 本番相当環境で QR 入り PDF を実際に通す。素材=本番 mail#134/#136（京都大会）または #176（高校選手権）の添付。読めなければ失敗として記録し、renderPdfToJpegs への DPI 引数追加か zxing-wasm 差し替えを**別 Issue** に起票する（本 PR では既存レンダリング経路を触らない）
- **AC-46**: 実グループへ1回 push して Flex の表示・ボタンタップでオープンチャット参加画面へ遷移・パスワード行が読めることを確認。**本番の会員グループではなく検証用グループで行う**
- 忠実度チェックリスト『375px で URL が1行省略され横スクロールが出ない』は truncate クラスの存在までコード照合で確認。実描画は未確認（グローバル方針により Browser を起動しない）
