---
name: impl-member-mail-search-wave2-4
description: member-mail-search Wave 2〜4（タスク4〜8）
type: project
---

member-mail-search（会員向け受信メール検索・閲覧）の Wave 2〜4＝タスク4〜8。worktree=C:/tmp/impl-member-mail-search、ブランチ=feature/member-mail-search。実装は全8タスク完了。

## Wave 構成と結果
- W2: タスク4(一覧)/5(詳細)/6(ビューア) を task-implementer 3並行。同一ディレクトリだが**ファイル単位の排他契約**で衝突ゼロ。バリア後 main 直列で 110 tests green
- W3: タスク7(ボトムナビ) main 直接実装。41 tests green
- W4: タスク8 忠実度ゲート＋正典ドキュメント更新（main）
- typecheck(tsc --noEmit) 通過・admin 配下(app/(app)/admin, api/admin)の差分ゼロを毎バリアで確認

## コミット
88020fd 一覧(#474) / e675ca1 詳細(#475) / a9246ae ビューア(#476) / ea6da59 ナビ(#477) / 6a0d119 docs(#478)

## バリアで main が直した3件（ワーカーはテストを実行できないので必ず残る）
1. **vitest の beforeEach teardown 罠**: `beforeEach(() => mock.mockReset())` はモック本体を返し、vitest がそれを teardown 関数として登録して**テスト後に呼んで戻り値を await** する。never-resolve な Promise を返す実装を差し込むテスト（多重実行ガード）があると hookTimeout(10s) で落ちる。**ブロックで囲めば直る**。同じ形が RankingList.test.tsx / TournamentYearList.test.tsx にもあるが、あちらは never-resolve 実装を残さないので顕在化していない
2. **page.test.tsx の next/navigation モックに useRouter 不足**: Server Component のページテストでも、子の client component が useRouter を使うなら mock に足す必要がある（"No useRouter export is defined" で全ケース落ち）
3. **相対 import の深さミス**（`../admin/...` → `../../admin/...`）

## 設計上の判断（main）
- **splitSearchTerms は format.ts に置く**。検索の AND 条件（サーバー）と件名ハイライト（client component）が同じ分割規則を要るが、search.ts は @/lib/db を引くのでクライアントから import できない。2箇所に分かれると「検索ではヒットしたのにハイライトされない」で静かに壊れる
- **カード全体リンク×添付チップリンクの `<a>` 入れ子回避**: overlay Link を `absolute inset-0 z-0`、チップを `relative z-10`。positioned 要素のペイント順で解決し pointer-events の調整は不要
- **ボトムナビは memberHref で遷移先だけ振り分け**。adminOnly を外して表示・並び・active 判定は共通にした（`isAdmin` は実効ロール由来なので、管理者の会員プレビュー中は /mail を指すのが正）

## 忠実度ゲート（design-spec §8・12項目）
静的コード照合で11項目クリア。**未確認1件**＝「375px で横スクロールが発生しない」の実描画（コード上は line-clamp-2 / min-w-0+truncate を確認済みだが、実際の描画は静的照合では判定不能）。§6「仮データのまま確定した項目」は5件すべて実配線を確認。

## 残 DoD（出荷後にユーザーが本番で確認）
AC-34（実機375px 一覧→詳細→ビューア→戻る）と AC-21（PDF のページ画像表示）。消化手順は docs/worklog.md の 2026-08-09 行に併記済み。
