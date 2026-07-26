---
name: design-event-detail-redesign
description: 大会申込詳細リデザイン design-spec 確定(2026-07-26)
type: project
---

/events/[id]（大会申込詳細）の管理者・一般会員ビューを **「罫線＋余白主導（脱カード）」** へ作り替えるデザインを確定（Path D = Claude Design 往復・3ラウンド）。design-spec は status: locked。

## 確定した方向性
- カードを原則全廃し、下線付き見出し＋余白34px＋ヘアライン罫線で構造を作る。箱を残したのは**関連メール1件ずつのみ**（画面唯一の箱＝タップできる合図）
- sticky ヘッダー（日付+大会名+会場+申込フロー）を**1ラッパー**で固定。個別 sticky にすると崩れる
- 進行管理/LINE配信/名簿/関連メールを details で**既定=閉**。これがトグル閉時 会員764px・管理者1074px（内寸716px）を成立させている
- 申込フロー（会内締切→大会申込→抽選→支払→開催）を新設。**日付NULLでもステップを消さず「未定」表示**
- 朱はブランド規約どおり警告・否定のみ。event-list-redesign Round 2 で起きた「朱＝参加できる」の意味逆転はこの案には無い

## ★ユーザー確認済みの削除12項目（意図的）
会員から参加費・支払方法・支払情報・申込方法が**見えなくなる**／戻るリンク／不参加人数／中止・終了ピル／公認ピル／主催・対象級／コメント欄／名簿のExcel取込フォーム（RosterUploadForm と uploadRoster を削除）ほか。requirements では Non-goals ではなく「削除する仕様」として書くこと。

## スコープ外に切り出し
**オープンチャット欄**は DB に該当カラムが無く（line.me/ti/g2 の全文検索でゼロ）migration が必要なため別 feature。モックに UI 案を残し HTML に SCOPE-OUT: コメントを2箇所入れて実装時に拾わないようにした。

## ★申し送り（要件で決める）
- 「申し込まない」の唯一の入口がこの画面。/admin/entries は not_applying を**読んで隠すだけ**（entry-board-utils.ts の classify/HIDDEN_AREAS）で設定導線が無い。両方から消すと entry-overdue-alert（PR #312）が到達不能になる
- 申込フローの done/now/warn 判定ロジックが未定義（ユーザーが「Claude Code 側で詰める」と明記）
- テキストリンク化したアクションのタップ領域が実測17〜19px（iOS推奨44px未満）。見た目を変えず当たり判定だけ広げる方針で受容

## レビューで直した罠（忠実度チェックリスト）
- 「日付は8/5(水)に統一」は**誤り**。モックは文脈ごとに4書式（曜日つき/曜日なし/年つき日時/年なし）。統一するとLINE連携が年と時刻を失う
- 「備考本文のみSerif」も**誤り**。見出しと数値（参加者数・定員・フロー日付）でも load-bearing
- 「おおむね1画面」は照合不能＋実測764px>内寸716px → 数値基準へ

## 成果物（origin/main に push 済み）
docs/features/event-detail-redesign/ の design-spec.md と design-mock/（current.html=現状再現・redesign.html=確定案）。**untracked のままだと /implement の worktree（基点 origin/main）から欠落する**ため確定時点でコミット+push した。
次は **/define-feature event-detail-redesign を「改修モード（delta）」で**（requirements.md が無いので Δ1 の薄いベースライン起こしから）。
