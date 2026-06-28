---
status: completed
slug: senseki-detail-redesign
kind: delta
target: /players/[id]（選手戦績の詳細）
design_spec: ./design-spec.md
---
# 戦績詳細 要件（ロジックレンズ / delta）

> 既存画面 `/players/[id]` の改修。視覚は [design-spec.md](./design-spec.md) を正とし、本書は**ロジック/遷移/データの差分だけ**を扱う（画面レイアウトは再記述しない）。フロー＝[`docs/dev/feature-flow.md`](../../../docs/dev/feature-flow.md)。

## 背景
リデザイン（design-spec）で見た目を詰める過程で出てきた emergent logic を確定する。

## 要件
### R1. 相手名タップ → その選手の戦績へ（確定）
- 試合表の**相手名**をタップすると、その相手選手の `/players/[id]` に遷移する。
- **リンク化の条件:** `matches.opponent_participant_id` が解決済みの相手のみ。その participant の `player_id` を遷移先にする。未解決（生名のみ）の相手は**遷移しない**。
- **同姓同名:** homonym-risk-accepted に従い、統合された player（姓名で同定）へ飛ぶ＝区別しない。
- **データ:** `getPlayerRecord` の match に `opponentPlayerId`（opponent participant → `player_id`）を追加で持たせる。
- **境界:** `player_id` が無い／表示中の本人を指す場合は遷移しない。

## デザインへの宿題（→ /design-screen）※解決済み
- **D1（解決）:** 相手名は**黒（ink, 既定色）・下線なし＝通常テキストと同じ見た目**で、明示的なリンク affordance は付けない。タップで遷移はするが視覚的な区別はしない（解決済み＝タップ可／未解決＝不可 が見た目では分からない＝タップして初めて遷移、をユーザー承認済み）。所属会は muted 併記のまま、タップ範囲は氏名文字列。→ design-spec §5 に反映。

## 影響範囲
- [apps/web/src/lib/players/queries.ts](../../../apps/web/src/lib/players/queries.ts)（`getPlayerRecord` 拡張・`PlayerMatchView` に `opponentPlayerId` 追加）。**`/players` 検索ページと共有**するファイルなので型影響を確認。
- ページコンポーネント `/players/[id]` に相手名のタップ遷移を実装（見た目は通常テキストのまま）。

## 確定事項（2026-06-28）
- R1 の判定方針（解決済みのみ遷移／同名は統合 player へ）で確定。
- 相手名タップ以外の emergent logic は無し（ユーザー確認済）。
- D1（リンク affordance）＝**黒・下線なし・明示 affordance なし**（通常テキストと同じ見た目）でインライン確定。

## 進捗メモ
- 2026-06-28: design round2 の emergent logic「相手名タップ→戦績」を R1 起票→ユーザー承認で確定。affordance D1 は「黒・下線なし（明示 affordance なし）」で確定。他 emergent logic 無し。**requirements 完了＝design-spec と収束**。
