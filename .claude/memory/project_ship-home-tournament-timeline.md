---
name: ship-home-tournament-timeline
description: ホームを「会の出場予定」へ全面置換
type: project
---

**PR #400** ホームを「会の出場予定」へ全面置き換え — https://github.com/poponta2020/kagetra_new/pull/400
マージ済み（merge commit 290ebaf・2026-07-28）。Issue は無し（design-screen 経路で /define-feature を回していないため）。

## 何を出したか
`/dashboard` のプレースホルダー（あいさつ＋権限カード）を撤去し、**未回答アラート → 今日の大会カード → 出場タイムライン**の3ブロックへ置換。スキーマ変更なし・migration なし。要件成果物は docs/features/home-tournament-timeline/design-spec.md、視覚の正は design-prototype.patch。

- 母集団は `/admin/entries` と同条件。クエリ6本固定（イベントごとに投げない）
- 確定名簿（entry_group 単位・superseded 除外）があれば「確定」、無ければ出欠 attend=true の「希望」へフォールバック
- **確定パスは現在の users.grade で絞らない**（昇級者が名簿から消えるため）。チップの級は名簿行の grade 優先
- 未回答アラートは基準締切 COALESCE(internal_deadline, entry_deadline) の7日前〜当日
- 仕様書更新: docs/spec/events-attendance.md「ホーム画面（ダッシュボード）」を全面改稿

## レビュー（auto-review-loop 4ラウンド・累計 449,283 tokens）
R1(initial/sol/medium) blocker 1 → R2(delta/terra/high) pass → R3(final/sol/medium) pass+nit 1 → R5(delta/terra/medium) pass

**★R1 の blocker が最重要**: `is_invited=false` の一般会員にも未回答アラートが出ていた。実装中に main と advisor の**両方が**「spec に無い条件は足さない（スコープ膨張回避）」と判断して isInvited ゲートを意図的に見送った箇所。Codex は既存の canRespond / submitAttendance を根拠に「タップしても回答できないアラート」として指摘した。→ `viewerCanRespond = 管理者 || isInvited` を追加（3ff2f63）。

## ★CI red を1回踏んだ（教訓）
R3 pass 後の CI で `apps/web/src/app/(app)/page-padding.test.ts`（nav-settings-hub AC-16b の**横断ガード**。各ページの page.tsx 根要素が padding utility を持つことをソースレベルで固定）が red。ページ余白 p-4 を HomeTimeline.tsx 側に置いていたため page.tsx にアンカーが0本になっていた。
→ 5d9e69e で p-4 を page.tsx の `<div className="p-4">` へ移動（描画結果は同一）。
**見落とした理由**: ローカルで変更ディレクトリ（dashboard/）しかテストを回しておらず、**他ディレクトリから対象ファイルを読む横断ガード**に当たらなかった。新規ページ追加・page.tsx の根要素構造を変える変更では、パッケージ全体のテストを1回は回すこと（今回は事後に web 全体 140ファイル/2007テスト green を確認）。

## ★残る申し送り（ユーザー判断が必要・未計測）
確定名簿は **entry_group 単位**なので、複数日/複数級を1グループに束ねた大会では**全日が同じ出場者リストを共有する**（「多摩A」の行に B 級チップが出る）。design-spec §6 が名簿行 grade ルールで防ごうとしたのと同じ失敗形だが、手順書・design-spec が「絞りは3条件だけ」と明記しており、直前2コミットがまさにこの領域の訂正だったため plain reading のまま出荷した。
- 切り替えは page.tsx の `confirmedEntrantsOf()` 1関数だけの変更で済むよう分離済み
- **影響規模は未計測** — ローカル dev DB が旧スキーマ（14テーブル・tournament_entry_rosters 無し）で、実データは本番にしかない。判断には本番への read-only クエリが要る

## 残 DoD
- **本番実機確認**（375px でホームを開く）は出荷後に行う
