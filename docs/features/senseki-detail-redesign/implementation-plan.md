---
status: ready
slug: senseki-detail-redesign
kind: delta
---
# 戦績詳細リデザイン 実装手順書（薄め・テスト先行）

> 入力＝[design-spec.md](./design-spec.md)（視覚 LOCKED）＋[requirements.md](./requirements.md)（ロジック R1 確定）。本書は実装タスクのみ。
> 既存画面 `/players/[id]` の改修。新規 API/DB/migration なし（読み取り層の拡張のみ）。GitHub Issue は作らない運用（コミットに `Fixes #` を付けない）。

## 実装タスク

### タスク1: 順位導出ロジック（純関数）＋ユニットテスト【テスト先行】
- [x] 完了
- **概要:** 級内の matches から各選手の順位（優勝/準優勝/ベスト4/ベスト8/ベストN/…）を導出する純関数を作る。導出不能なら `null` を返し、呼び出し側が保存 `final_rank` にフォールバックする。`入賞`判定（ベスト8以上）ヘルパも。
- **アルゴリズム（design-spec §6）:** 級内 `maxRound`=決勝。各選手の最終試合の round/result で判定（決勝勝=優勝／決勝負=準優勝／準決勝負=ベスト4／準々負=ベスト8／round (maxRound-k) 負=ベスト(2^(k+1))）。`round_label`(決勝/準決勝/準々決勝) が意味ラベルなら優先。**導出不能 → null**（複数敗・round_label に「リーグ/順位/予選」・決勝勝者が一意でない・3位決定戦の気配・データ欠け）。walkover/forfeit は勝敗集計から除外（既存踏襲）。
- **変更対象:**
  - `apps/web/src/lib/players/placement.ts` — 新規（純関数 `derivePlacement(matchesInClass)` ＋ `isNyusho(rank)`）
  - `apps/web/src/lib/players/placement.test.ts` — 新規（**先に書く**。優勝/準優勝/ベスト4/8/16・round_label有無・非導出→null・walkover/forfeit・シード/byes best-effort）
- **依存タスク:** なし
- **テスト:** `pnpm vitest --no-file-parallelism` で placement.test.ts green

### タスク2: getPlayerRecord 拡張（導出適用＋opponentPlayerId＋サマリー集計）＋クエリテスト
- [x] 完了
- **概要:** 戦績取得クエリを拡張。①各 match に `opponentPlayerId`（`opponent_participant_id`→`tournament_participants.player_id`）②各 participation の順位＝T1 で導出（不能なら保存 `final_rank` フォールバック）③サマリー集計（優勝N＝導出優勝数／入賞N＝ベスト8以上／出場大会数／活動年スパン min-max／現在の級＝最新参加 grade／通算勝敗+勝率＝既存）。
- **変更対象:**
  - `apps/web/src/lib/players/queries.ts` — `getPlayerRecord` 拡張、`PlayerMatchView` に `opponentPlayerId: number | null`、`PlayerParticipationView` の `finalRank` を「導出 or フォールバック」結果に、`PlayerRecord` にサマリー（`championships`,`nyushoCount`,`tournamentCount`,`activeYears`,`currentGrade`）追加
  - `apps/web/src/lib/players/queries.test.ts` — 拡張（導出順位・opponentPlayerId 解決・サマリー集計・フォールバック。test DB）
- **影響範囲:** `queries.ts` は `/players` 検索ページと共有。`searchPlayers` の戻り型は変えない。`PlayerMatchView`/`PlayerRecord` 利用箇所（`/players/[id]/page.tsx` のみ）を確認。
- **依存タスク:** タスク1
- **テスト:** queries.test.ts green、`pnpm typecheck`

### タスク3: 戦績詳細ページ UI 実装（フラット・年sticky・○N/×N・相手名タップ）
- [ ] 完了
- **概要:** `/players/[id]` を design-spec A 案に作り替え。サマリー（箱なし・serif 数字）＋年(暦年)グループの sticky 折りたたみタイムライン（展開単位＝年、その年の全大会の試合表）。試合表はフラット・降順・`○12/×7` トークン・相手名＋所属会。相手名タップ＝解決済みのみ `/players/[id]` へ（見た目は黒・通常テキスト＝明示 affordance なし）。
- **変更対象:**
  - `apps/web/src/app/(app)/players/[id]/page.tsx` — サーバーコンポーネントは取得＋整形、表示はクライアントへ委譲
  - `apps/web/src/app/(app)/players/[id]/SensekiTimeline.tsx` — 新規クライアントコンポーネント（年の開閉状態・sticky 見出し）
  - スタイルは Tailwind トークン（design-spec の配色）。`feedback`: `flex-1 overflow-y-auto` には `min-h-0`、sticky は親スクロール基準
  - `apps/web/src/app/(app)/players/[id]/SensekiTimeline.test.tsx` — 新規（年開閉・○×表示・解決済み相手にリンク有/未解決に無・空状態）
- **依存タスク:** タスク2
- **テスト:** component test green、`pnpm typecheck`、`pnpm lint`

### タスク4: E2E スモーク（任意）
- [ ] 完了
- **概要:** Playwright で 選手戦績詳細を開く→年を展開→解決済み相手をタップ→その選手のページに遷移、を1本。
- **変更対象:** `apps/web/e2e/` に1ファイル（既存 E2E 基盤に合わせる）
- **依存タスク:** タスク3
- **テスト:** E2E green（重ければスモーク最小で可）

## 実装順序
1. タスク1（依存なし・純関数テスト先行）
2. タスク2（タスク1）
3. タスク3（タスク2）
4. タスク4（タスク3・任意）
