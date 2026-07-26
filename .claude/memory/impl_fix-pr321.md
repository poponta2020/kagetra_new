---
name: fix-pr321
description: fix PR #321
type: project
---

PR #321 / ブランチ feature/event-grade-group-broadcast のレビュー指摘修正。worktree=C:/tmp/impl-event-grade-group-broadcast。修正コミット 2caaf75。

## 対応した指摘（R1・全5件対応、見送りなし）

### CRITICAL（blockers）
1. **push 成功後の確定失敗で二重配信** (`lib/event-grade-broadcast.ts`) — 級ごとの try/catch が `sent_at` UPDATE の失敗時に無条件で claim を DELETE しており、次回同じ本文を再送していた。`pushAccepted` を追跡し**受理後は claim を巻き戻さない**（曖昧な claim は残す）。加えて `X-Line-Retry-Key` を送るようにした。キーは **claim 行 id 集合の SHA-256 から決定的に導く UUID**（claim 行は (event,grade) で upsert され id が安定なので、同じ内容の再送は必ず同じキー／対象 event 集合が変われば別キー）。**409 は「LINE が受理済み」＝送信成功に倒す**（失敗扱いだと claim を巻き戻して次回さらに送る）。Web Crypto グローバルを使い node: import は避けた
2. **linked の級で招待コード再発行が紐付けを破壊** (`admin/line-grade-groups/actions.ts`) — 確認なしの1操作で lineGroupId/linkedAt が消え、その級が無言で配信対象から外れていた。Server Action で拒否し、`GradeGroupList.tsx` からも linked 時は再発行ボタンを出さない。既存 `generateInviteCodeForEvent` が linked を拒否しているのと同じ流儀に揃えた

### WARNING（should_fix）
3. 招待コードの 23505 衝突を savepoint 付き3回リトライに（既存 generateInviteCodeForEvent と同型）
4. **添付なし配信まで PUBLIC_BASE_URL を必須化していた** — 紐付けの有無で判定していたため、URL 行が出ない大会（手動作成は常に添付なし）まで env 不備で全滅。`needsBaseUrl`（対象 event に添付があるか）で判定するよう変更
5. `events.grade_broadcast_attachment_id` に index 追加（ON DELETE SET NULL のカスケードで events 全走査）。**migration 0044 を再生成**して同梱（0044 は未マージのため番号を増やさず作り直し。raw ALTER の FK は再付与し、新規 DB へ 0000〜0044 通し適用して index と FK の実在を確認済み）

## テスト結果
配信コア37 / 管理画面14 / webhook30 / mail-inbox135 / 再送9 / shared23 いずれも PASS。型チェック・lint 全4パッケージ green。
追加した回帰テスト: push 成功後の確定失敗で claim を消さない／同内容の再送で retry key が一致／409 を成功扱い／添付なしは PUBLIC_BASE_URL 不要／linked では再発行拒否・解除後は再発行可。

## 注意
web の全スイート一括実行は既存の累積 OOM（Issue #286）で完走しないため、ファイル単位で個別実行して確認している。
