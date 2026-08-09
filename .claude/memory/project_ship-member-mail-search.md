---
name: ship-member-mail-search
description: 会員向け 受信メール検索・閲覧
type: project
---

**PR #479** feat(member-mail-search): 会員向け 受信メール検索・閲覧（読み取り専用）
https://github.com/poponta2020/kagetra_new/pull/479 — **merged**（merge commit 680fe12・CI pending のままマージ＝方針どおり）

クローズ: 親 #470 ＋ 子 #471〜#478（全8タスク）。マイグレーション無し・管理者側（`/admin/mail-inbox` 配下と `api/admin/**`）は差分ゼロ。

## 入ったもの
- `/mail`（一覧＋sticky検索＋添付ありのみトグル＋もっと読み込む）／ `/mail/[id]`（ヘッダ→添付→本文→処理の記録）／ `/mail/attachments/[id]`（ビューア）
- `GET /api/mail/attachments/[id]` と `.../preview/[page]`（管理者ルートの意図的な複製。差分は認可のみ、drift は parity テストで防止）
- 処理の記録は**既存カラムからの導出**（H0〜H6）。履歴テーブルを作らない
- ボトムナビ「メール」を全員に開放（遷移先だけ role 振り分け。一般会員も6タブ）

## レビュー（/auto-review-loop）
4R（initial + delta + final + final-delta）で **pass**。effort は sol 較正で全ラウンド medium、escalated なし。累計 527,522 トークン。
blockers 累計7件 → **修正5 / ユーザー判断で見送り2**。打ち切り（再レビューせず修正）は無し＝最後まで pass を取って終了。

修正した blockers:
- 一覧 state が検索条件変更で初期化されない（key 無し）
- 同名 query 複数指定で 500
- ページ側 ID 検証が API より緩い（`1e5`→100000・int4 超過で 500）
- `?from=` が `/mailbox` を通す（AC-26 違反）
- 検索語数が無制限で巨大 SQL（認証済み DoS）
- 存在しないページ要求で毎回 LibreOffice 変換（認証済み DoS）

見送り（WONTFIX）:
- offset ページングの重複・欠落（新着の並行取り込み時）— 実害が一時的な数件のずれで、修正が既存2画面（RankingList / TournamentYearList）と方式を食い違わせるため
- 管理者ルートにも変換反復ガードを入れる — Non-goal・AC-30 で差分ゼロが要件のため

★**final（全差分の最終確認）が R1 の見落とした DoS 系 blockers を2件検出した**。R1 needs_changes → delta pass で終わらせていたら見逃していた。final を残す設計が効いた実例。

## ★残 DoD（本番で確認する）
- **AC-34（実機375px）**: iPhone で https://new.hokudaicarta.com/mail を開き、(1) 大会名で検索してヒット抜粋・添付チップが横スクロールを出さない (2) カードから詳細へ入りセクション順が ヘッダ→添付→本文→処理の記録 (3) 添付タップでページ画像が出て ✕ で `/mail` に戻る、を確認
- **AC-21**: 添付ビューアで PDF がページ画像として表示される
- 忠実度チェックリスト12項目のうち11項目は静的照合で確認済み。残り1件（375px で横スクロールが出ない）は上記 AC-34 と同時に確認する

関連: [[impl-member-mail-search-wave1]] / [[impl-member-mail-search-wave2-4]] / [[auto-review-round-pr479]] / [[feature-def-member-mail-search]]
