---
name: ship-fix-line-linked-announcement
description: LINE紐付け成立案内の未在籍メンション400全滅バグ修正
type: project
---

shipped: PR #543 (https://github.com/poponta2020/kagetra_new/pull/543) — merge成功・Issue #542 自動クローズ。

## バグ（本番インシデント 2026-08-24 椿杯ABC×bot-4）
招待コード認証・DB紐付けは成功したのに紐付け成立案内4通が届かず、痕跡ゼロ。**根本原因**: ③(@管理者)の textV2 メンションが admin/vice_admin 全員(4名)を無条件メンション → グループ在籍は2名のみ → LINE がメッセージ全体を 400 拒否（"The mentioned user is not found in the group."）→ reply は1リクエスト4通で全滅 → route.ts が logger 未配線で per-event catch が no-op → 痕跡ゼロ → sendGuidelinesOnLink も巻き添えスキップ。新設グループでほぼ確実に再現する決定的バグだった（PR #530 の新経路の本番初実行で顕在化）。

## 修正（apps/web/src/lib/）
- line-group-membership.ts 新設: GET /v2/bot/group/{groupId}/member/{userId}（200=在籍/404=未在籍・全Botで利用可を実測）で③のメンションを在籍者に絞る。プローブ失敗は除外+ログ
- line-webhook-handler.ts: 案内reply失敗時は③を素テキスト降格した push で1回再送／reply前とpush前の両送信点で linked 再検証(bindingStillLinked)／要綱pushを案内送信から独立化／既定loggerを console JSON化（journalctlで追える）／reply・push・プローブに30s AbortController
- 回帰テスト10件追加（line-webhook-handler.test.ts bug#542ブロック）。46/46 green・tsc green

## レビュー
auto-review-loop 4R(i+d+f+fd)・最終verdict=pass・effort h→m→m→m・累計331,938トークン・WONTFIX 0件・未再確認の修正なし。CI pending のままマージ（赤なら追修正）。

## 運用復旧（2026-08-25 実施済み）
要綱1件push成功(guidelines_sent_at刻印)・案内4通は在籍2名メンションでpush成功。表示順が要綱→案内と逆になったのは復旧手順上の制約(実害なし)。

## 残DoD
次回の実運用紐付け（新大会グループ作成時）での本番実機確認。requirements=docs/bugs/542-line-linked-announcement-silent-failure/requirements.md
