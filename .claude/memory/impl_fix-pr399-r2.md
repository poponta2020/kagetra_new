---
name: fix-pr399-r2
description: fix PR #399 (R2)
type: project
---

PR #399 の Codex R2 指摘（blocker 4・should_fix 2）の修正記録。R1 の記録は同ファイル前半を参照。

## ★最重要: fixture のドキュメントプロパティに実名が残っていた
実物の申込書テンプレから作った fixture について、**セル値だけを差し替えて PII 除去済みと判断していた**が、xlsx は docProps/core.xml と app.xml に別途メタデータを持つ。実際に残っていたもの:
- dc:creator（kawahara / Yumi / Yamazaki / hase）
- cp:lastModifiedBy（中村 優也 / 由美 奥村 / 義 松川 / 木村　俊昭）— **実名**
- Company（Toshiba）

**画面にもセルにも現れない**ため、生成物を目で見ても grep しても気づかない（sharedStrings.xml しか見ていなかった）。build-fixtures.mts に scrubDocumentProperties を足して全 fixture を再生成し、__fixtures__/fixtures-privacy.test.ts でメタデータとセル内メールアドレスを機械チェックするようにした。

**未解決**: 既に push 済みのコミット（0932d55 ほか）とその blob に旧 fixture が残っている。履歴の書き換え（force-push）は破壊的なのでユーザー判断待ち。リポジトリは private・単独開発なので流出範囲は限定的。

## その他の blocker
- **複数シートで対象級が未確定のまま作成できた**: targetGrades=null は fill.ts で「全会員をこのシートへ」と解釈されるため、上級/中級のような非標準シート名のテンプレで**全員が全シートへ重複記入**される。hasUnresolvedSheetGrades で次へ進めなくし、級指定とシート除外の導線を追加
- **入力規則の無いテンプレで表の外へ書いていた**: 空セル走査の上限を CAPACITY_SCAN_FALLBACK_ROWS(500) に置いていたため、rowCount=89 のシートでも 500 行目まで書けると判定し、overflow としても報告されなかった。上限を ws.rowCount にした
- **APPEND 成功後の status 更新失敗を imap_failed にしていた**: 同じ try/catch に入れていたのが原因。Yahoo には下書きがあるのに再試行を促し、下書きが重複する。APPEND の失敗と更新の失敗を分離し、後者では pending のまま残す

## should_fix
- attachmentId が対象申込グループの候補かを JOIN で検証（別大会の添付を任意のグループへ組み合わせられた）
- bodyStale の判定を本文の文字列比較から会員構成の指紋へ（手編集しただけで誤警告した）
- 会定数6項目の保存を db.transaction にまとめた

## 学び
- 実物由来の fixture は**セル値以外にも PII を持つ**。docProps・外部リンク・定義名まで見る
- 「null ＝全件」を意味するフィールドは、複数件の文脈で未設定のまま通すと静かに全件複製になる

worktree: C:/tmp/impl-entry-form-autofill
