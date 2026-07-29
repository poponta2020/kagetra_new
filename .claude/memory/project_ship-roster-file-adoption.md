---
name: ship-roster-file-adoption
description: 名簿ファイル採用（roster-file-adoption）
type: project
---

「名簿をパースせず原本ファイルのまま採用できる導線を追加」を出荷。**PR #409** https://github.com/poponta2020/kagetra_new/pull/409（親Issue #403 / 子 #404-#408）

## 何を出したか
決定論パーサが本番の実名簿3件すべてで採用不能だったため、名簿を**構造化せず原本ファイルのまま**採用してフェーズを進められる導線を新設した。フェーズ管理（会の進行）と構造化データ（統計）を分離する設計で、AI 取込（P3）導入後も抽出失敗の受け皿として残す。

- `tournament_entry_roster_files` 新設（migration 0051）。`tournament_entry_rosters` は拡張しない（entries 0件の行は /dashboard の出欠フォールバックを壊す）。UNIQUE(source_attachment_id) で二重採用を DB 制約で禁止
- メール詳細から添付を対象イベント＋種別で採用/解除（admin/vice_admin・**個人戦のみ**）
- 会員向けビューア `/roster-files/[id]` + 配信2 route（認可は loadAdoptedRosterFile 1本の fail-closed）
- 大会詳細: パース済みがあれば構造化が主・原本は補助リンク／無ければファイル一覧カード
- 申込管理ボードの hasConfirmedRoster を「パース済み ∪ confirmed のファイル採用」へ拡張（classify 純関数は無変更）

## 実装中に見つけて同時に直したもの
`deleteGroupIfEmpty`（apps/web/src/lib/entry-groups.ts）が新テーブルの RESTRICT FK を知らず、「events 0件・採用ファイル1件」のグループ削除が FK 違反で呼び出し元トランザクションごとロールバックする潜在バグ。ガード＋回帰テストを追加。**新テーブルに entry_group_id RESTRICT を足すときは deleteGroupIfEmpty を必ず一緒に直す。**

## レビュー（詳細は auto-review-round-pr409）
4ラウンド（initial+delta+final+final-delta）で verdict=pass。effort h→m→h→m、累計 746,986 トークン（既定上限 500,000 を超過。R3 完了時点で規定では token-budget 中断だったが、残り 106行の R4 だけユーザー承認のうえ実行して完結）。**再レビューせずに修正した指摘は無し**（打ち切りではなく pass で収束）。

blocker 2件をユーザー判断のうえ修正:
1. 団体戦への採用が dead-end（成功するのに RosterSection にもボードにも出ない）→ 個人戦のみに制限（f0c4de5）
2. 範囲外ページの連打で文書変換を無制限に再実行できる → キャッシュ済み pageCount で変換前に404（7c35522）。★この force 再変換は既存 admin route と同一挙動で本PR起因ではない。本PRが変えたのは到達範囲（管理者→会員全員）。Codex が併せて提案した「変換失敗のネガティブキャッシュ」「変換の同時実行数上限」は共用基盤 attachment-preview.ts の改修になるためスコープ外として不採用＝**別PRの候補として残っている**

## 検証
check-types 全4パッケージ green / lint green / shared 45件 green / web 167ファイル2358件 green。migration は空DBへ 0001→0051 の全チェーンを drizzle-kit migrate で適用し、UNIQUE・FK の onDelete を実DBで確認済み（vitest の push 経路では migration ファイルは実行されないため別途検証）。CI は pending のままマージ（赤なら追修正）。

## ★残DoD（AC-13・本番実機）
1. 本番メール詳細から滞留中の3添付を**確定名簿**として採用: 添付316（E級・D級クラス分け.xlsx, mail 251）／添付318・319（秋田大会 参加者一覧・参加費一覧, mail 253/254 → event 21 秋田DE）
2. /admin/entries で該当大会が「名簿確定・要振込」へ移り、/events/[id] に原本が出ることを確認
3. **★上記1を終えるまで名簿ドラフト #1〜#3 を却下しないこと**（却下すると同じ添付を再解析できなくなる既知バグ。修正は本機能の Non-goals＝別 quickfix）
