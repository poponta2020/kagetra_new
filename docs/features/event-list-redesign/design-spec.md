---
status: locked
slug: event-list-redesign
target: apps/web/src/app/(app)/events/ （/events 一覧＝見出し「大会申込」）
design_source: claude-design
mock_dir: docs/features/event-list-redesign/design-mock/
design_project: { name: Kagetra Design System, id: 74ab8bf1-f11a-48e8-9853-e063b2f1f2d5 }
round: 4
chosen_direction: 参加可否の色帯（redesign.html）
---
# 大会申込一覧リデザイン デザイン仕様（design-spec・確定）

> 前回リデザイン（PR #251）の確定仕様は
> [`../event-list-refinements/design-spec.md`](../event-list-refinements/design-spec.md)（locked）。
> 今回はその実装済み画面を出発点にした再リデザイン。方向性は未確定（ユーザーと
> Claude Design 往復で探索中）。

## 進行状況

- **Round 1（2026-07-26）:** ユーザー要望「今の画面をそのまま Claude Design へ」。
  現行実装を忠実に再現した `current.html` を push 済み。
  - カード: Claude Design「Kagetra Design System」→ グループ **大会申込リデザイン** → `features/event-list-redesign/current.html`
  - データは本番 2026-07-26 時点の実 15 行（dev サーバー+本番トンネルで DOM 実測し一致確認）

## Round 1 で確定した現状の事実（実測）

- **ページ余白ゼロは実装の現実**: `<main>`・ページコンテナとも padding 無し。h1「大会申込」もリストも x=0 で画面端に接する（/tournaments 系は各ページが `p-4` を自前で持つが /events と /dashboard は持たない）。
- **本番データの見え方**: 現在は 15 行全てが「参加 0名」（チップ皆無）、上位 6 行が「締切済」。既定ソート＝締切日順（昇順）のため**締切超過の行が先頭に固まる**。本日/あと3日以内の強調・中止ピルは現データに出現せず（凡例としてモック下部に併記）。
- トークンは `colors_and_type.css`（プロジェクト直下）が実コード globals.css と一致済み（更新不要）。ダークテーマは実コードに存在しない（ライトのみ）。
- モック内のトークン外リテラル（h1 20px / タイトル 18px / 11px メタ / #fff 等）は実装の Tailwind クラス由来の忠実再現値。`current.html` 冒頭コメントに列挙。

## Round 2（2026-07-26）— ユーザーが Claude Design 上で作成した案の読み戻し

リモートに新規3ファイル（作成者=ユーザー側の Claude Design セッション）:
- `features/event-list-redesign/redesign.html` — **本命の案「参加可否の色帯」**（ローカルへミラー済み）
- `features/event-list-redesign/flatness-reference.html` / `participants-options.html` — 検討過程の参照カード（未ミラー・確定時に扱い決定）

### 案の内容（redesign.html 記載の変更6点＋暗黙1点）
1. 行左端に 3px 色帯: 朱=自分の級が対象 / 砂=対象外（canApply の可視化）
2. 参加者表示刷新: 0名は meta 行ごと非表示。人数を藍の serif 大きめ＋苗字を淡テキストで**全員**表示（チップ・上限5・他N名を廃止）
3. ページ余白 16px 導入（現状は 0）
4. 上段の順序を 大会名→日付 に入替え。日付は 13.5px・fg-2 に従属化
5. 締切強調を朱系に統一: 3日以内=朱太字（現状は墨太字）、当日=朱の塗りピル
6. 締切の数字のみ拡大（通常15px/間近19px・serif）
7. **（カード未言及）実データ15行中、締切済6行がモックに存在しない** — 意図か簡略化か要確認

### 逸脱検証（トークン・ブランド規約）
- **★朱の意味の逆転**: ブランド規約は 参加=藍/不参加・警告=朱（colors_and_type.css・design.md）。この案は色帯の朱を「参加できる」という肯定に使う — 意図的逸脱かユーザーに確認要
- トークン外リテラル: 13.5/16.5/11.5/19px 等のサイズと #fff。Tailwind arbitrary value で再現可能なので採用時は忠実度チェックリストに列挙する

## Round 3（2026-07-26）— ユーザー決定の反映

3つの論点をユーザーに確認し、以下で確定：
1. **締切済（会内締切超過）の大会は一覧から非表示**（仕様変更として採用。申込済み者の確認導線が一覧から消える点はリスク説明の上で受容 → 要件定義で扱いを最終確認）
2. **色帯は藍に変更**（Round 2 の朱はブランド規約「参加=藍/朱=否定・警告」と逆転していたため規約準拠へ。藍=出られる・朱=締切warning と色でも軸が分離）
3. **参加者表示の刷新を採用**（0名は meta 行ごと非表示・苗字は全員表示・チップ/上限5/他N名を廃止）

redesign.html へ反映し remote push 済み（帯色 brand 化・凡例/注記の更新・変更7点化・締切済非表示の明記）。

## Round 4（2026-07-26）— ユーザー微修正の読み戻し・確定（locked）

ユーザーが claude.ai/design 上で直接編集（すべてトークン準拠・逸脱なし。むしろトークン外リテラルが減少）:
- **3日以内（soon）の朱をやめて墨に**: `.ddl.soon .val` = text-xs / `--kg-fg`、数字 em のみ 19px。**朱は「当日」の塗りピルだけ**に絞る
- **苗字テキスト**: 11.5px `--kg-fg-3` → `--kg-text-xs`(12px) `--kg-neutral-fg`
- 注記・凡例の対応箇所も同旨に修正済み

「見た目 OK」の合図により locked。ローカルミラーはリモートと一致済み。

## Round 5（2026-07-26）— 要件確認による locked 後の修正

locked 後にユーザーへ 3 点確認した結果（締切済でも自分が参加回答済みなら表示継続／中止行の帯は砂固定／締切未設定は表示継続）、**Round 4 時点のチェックリストと矛盾が生じたため 2 項目を修正**した。ドリフトではなく、ユーザー決定が lock より後に来たことによる正当な改訂。

- 「締切済の行は描画されない」→ **自分が attend=true の行は例外的に描画**（見え方: 締切済淡色＋砂帯＋meta 行あり）。この状態は redesign.html に描かれていない — 実装時は本 spec の記述が正
- 帯の色規則を `canApply` 単独 → **`canApply && !cancelled && !pastDeadline`** に厳密化（藍＝「今申し込める」の意味に統一）

## 忠実度チェックリスト（/implement の完了ゲート。視覚の正 = design-mock/redesign.html）

- [ ] 行の左端に 3px 縦帯（角丸2px）。**藍（`--kg-brand`）は「今この行から申し込める」ときだけ** ＝ `canApply && !cancelled && !pastDeadline`。それ以外は砂（`--kg-border`）。帯と本文の間隔 11px
- [ ] 上段の並びが左から: 大会名（18px serif 太・truncate）→ 開催日 `M/D(曜)`（13.5px serif 太・`--kg-fg-2`・tabular-nums）→ 右端に締切（現状の「日付が先頭」から入替わっている）
- [ ] 締切表示: ラベル「締切」10px `--kg-fg-muted`。通常＝文言 12px `--kg-fg-2`＋数字のみ 15px serif 太。3日以内＝数字のみ 19px・色は `--kg-fg`（**朱にしない**）。当日＝「本日」が `--kg-accent` 塗りピル・白字 15px 太（数字なし）
- [ ] 朱（accent）の使用は「当日」塗りピルのみ。色帯・soon・参加者数に朱を使っていない
- [ ] 参加者 meta 行は attendCount ≥ 1 の行だけ描画（「参加 0名」を出さない）。人数＝19px serif 太 `--kg-brand`＋「名」11px、苗字＝12px `--kg-neutral-fg`・「・」区切り（`--kg-fg-muted`）・**全員表示**・苗字の途中で折り返さない（span 単位で wrap）
- [ ] 締切済（会内締切超過）の行は原則描画されない。**例外＝閲覧者自身が attend=true の行は描画される**（Round 5 追記）。その行の見え方は「締切＝『締切済』淡色（`--kg-fg-muted`）／帯＝砂（`--kg-border`）／meta 行あり（自分を含む参加者を表示）」
- [ ] ページ余白: main 相当に padding 16px（現状の余白ゼロから変更）
- [ ] 見出し行・ソートセグメント・申込可能スイッチ・AppBar・ボトムナビは current.html と同一（変更なし）
- [ ] 中止イベント: 中止ピル（danger・10px）＋タイトル `--kg-fg-3` は現状踏襲
- [ ] 375px で横スクロールが発生しない。長い大会名（例: 全日本かるた協会法人化30周年記念ABC）が省略記号で切れる

## 要件への宿題（→ /define-feature event-list-redesign）

**採用確定に伴う要件化項目（Round 4 確定版）:**
- **締切済行の非表示**: 会内締切超過（internalDeadline < 今日）の大会を /events 一覧から除外する。境界（当日=表示）・締切なし(null)の扱い・「申込済みユーザーが締切後に自分の申込を確認する導線」の代替を要件で確定する
- **参加者表示ロジック**: 0名時は meta 行非表示／苗字は全員表示（CHIP_LIMIT・「他N名」撤廃）→ サーバーの chipSurnames 取得上限（slice(0,5)）も撤廃
- **色帯 = canApply の可視化**: 既存の canApply（級のみ判定）をそのまま使う。新データ不要。中止行での帯の扱い（砂に落とすか）は要件で明記
- **締切カウントダウンの表示変更**: 当日=朱塗りピル・3日以内=数字19px（色は墨のまま）・通常=数字のみ15px拡大。しきい値・ロジックは不変（表示のみ）

## 確定モックの補足

- `flatness-reference.html` / `participants-options.html` は検討過程の参照カード（リモートのみ・視覚の正ではない）
- モック内のトークン外リテラル（h1 20px・タイトル 18px・日付 13.5px・人数 19px・「名」11px・ナビ 11px・#fff 等）は Tailwind arbitrary value で再現する実装値。上記チェックリストが照合先

## 観察メモ（方向性議論の種・未決定）

- 締切日順が既定のため「締切済＋参加0名」の行が画面上部を占有する — 見せ方（沈める/畳む/区分ける）はロジック変更を伴うので、採用するなら要件へ宿題化。
- ページ余白ゼロ（全幅ベタ付き）を意匠として維持するか、`p-4` 系に寄せるかは今回の論点候補。
