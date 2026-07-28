---
name: fix-pr399
description: fix PR #399
type: project
---

PR #399（feature/entry-form-autofill）の Codex R1 指摘の修正記録。blocker 6・should_fix 6 をすべて対応。

## CRITICAL（blocker）
1. **テンプレ解析のレース**: 候補Aの解析中にBを選ぶと、遅れて届いたAの結果も無条件で反映され「選択中はB・列対応はA」になっていた（誤ったセルへの記入・誤送付先）。解析要求に連番を持たせ、最新の要求と一致する応答だけ反映する
2. **AI 推定失敗が行き止まり**: source='unresolved' で sheets=[] のとき、画面からシートを追加できず canProceed も常に false だった。analyzeTemplateAction が sheetNames を返し、シートを選ぶと空の対応表ができて列と記入開始行を手で埋められるようにした（氏名列が未指定なら次へ進めない）
3. **会員0名で空の申込書を作れた**: Server Action に members.length===0 の拒否を追加。ステップ2・3の CTA も無効化
4. **APPEND 成功後の logout 失敗を作成失敗として扱っていた**: Yahoo に下書きがあるのに再試行させ重複していた。logout を finally の best-effort に降格
5. **会員構成を変えても古い本文を再利用**: xlsx は新構成なのに本文だけ旧人数・旧級別内訳だった。未編集なら作り直し、手編集済みなら「構成が変わった」警告＋「定型で作り直す」を出す
6. **履歴を created で先行保存**: 挿入から結果更新までの間に落ちると「下書きが無いのに成功」が永久に残る。enum に pending を足し、APPEND 成功を確認してから created へ上げる

## WARNING（should_fix）
1. アップロード上限（UI 2MB）と next.config の serverActions.bodySizeLimit=4mb。既定 1MB では実サイズ 750KB 程度で 413 になっていた
2. 差出人（sourceMailFrom）の取得を mailAttachments の innerJoin から切り離した。添付が無い案内メールこそ手動アップロードが要る場面で、そこで宛先③が消えていた
3. **参加級を自由入力に**（F級など大会独自級・当日昇級。requirements §3.2.1）。EntryFormMember.grade を string へ広げ、標準級（A〜E）の判定は lib/entry-form/grade-normalize.ts に一本化した（server-only を付けないモジュール。fill.ts と client の両方が同じ規則を使わないと「画面の人数」と「生成 xlsx の振分」が食い違う）
4. ふりがな入力後も警告が残っていた（初期フラグ needsNameInput を見ていた）。現在値から再判定する
5. From/To の制御文字を MIME 組立の手前で拒否（ヘッダ注入）
6. 退会済み会員を対象・追加候補の両方から除外（isNull(deactivatedAt)）

## 実装上の判断
- migration は 0050 に畳んだ。ALTER TYPE ADD VALUE した enum 値を同一トランザクションで DEFAULT に使うと Postgres が拒否するため、未出荷の 0050 を作り直して CREATE TYPE に pending を含めた

## 検証
web 2143 / shared 39 テスト green・lint・typecheck clean

worktree: C:/tmp/impl-entry-form-autofill
