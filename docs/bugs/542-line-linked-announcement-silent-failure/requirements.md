---
status: approved
issue: 542
---
# バグ改修要件: LINE Bot 紐付け成立時の案内4通が無言で失敗し、要綱 push もスキップ・痕跡ゼロになる

## インシデント概要（2026-08-24 椿杯ABC / bot-4）

- 13:30:19 JST: bot-4（line_channels id=5, @764jvtvm）が椿杯ABC 用グループへ join
- 13:30:22 JST: 招待コード発言 → 認証成功。event_line_broadcasts id=18（entry_group 20 = 椿杯ABC）が `linked` へ遷移、チャネル active 化。**ここまでは正常**
- 直後: 紐付け成立の案内4通（PR #530 line-bot-message-revamp の新経路・本番初実行）の reply 送信が **400 で失敗**。エラーは no-op logger に握り潰され痕跡ゼロ。`sendGuidelinesOnLink`（要綱1件選択済み）も巻き添えスキップ
- 13:32: 管理者の再発行試行は「現在 LINE 配信中の大会です」で拒否。案内を再送する経路が存在しない
- **2026-08-25 運用復旧済み**: 要綱1件 push 成功（`guidelines_sent_at` 刻印済み）、案内4通は在籍管理者2名のみメンションで push 成功

## 再現手順

1. admin/vice_admin（LINE 連携済み）の**一部がまだ参加していない**大会用 LINE グループに Bot を招待し、招待コードを発言する
2. 紐付け（DB）は成功するが、案内③の @管理者 個人メンションに未在籍ユーザーが含まれるため LINE が reply 全体を 400 で拒否する
3. グループには何も届かず、要綱 push もスキップされ、ログにも何も残らない

## 根本原因（確定・2026-08-25 実エラー捕捉）

```
400 "A message (messages[2]) in the request body is invalid"
details: [{ message: "The mentioned user is not found in the group.",
            property: "substitution[\"m1\"].mentionee" }]
```

1. **③の @管理者 メンションがグループ在籍を考慮しない（直接原因）**: [line-webhook-handler.ts:645-653](apps/web/src/lib/line-webhook-handler.ts) は `resolveAdminMention`（= admin/vice_admin 全員の line_user_id）をそのまま textV2 メンションにするが、LINE はグループ未在籍ユーザーへのメンションを 400 で拒否する。reply は1リクエスト4通のため**全滅**する。紐付け直後の新設グループに管理者全員が揃っていることは稀 → **新設グループでほぼ確実に再現する決定的バグ**（インシデント時は4名中2名在籍）
2. **観測性の欠如**: [route.ts:29](apps/web/src/app/api/webhook/line/route.ts) が `handleLineWebhook` に logger を渡さず、[line-webhook-handler.ts:239](apps/web/src/lib/line-webhook-handler.ts) の `options.logger ?? (() => undefined)` により per-event catch のエラーが完全に消える
3. **案内送信と要綱 push の不当な結合**: reply の throw で `sendGuidelinesOnLink`（同 675 行）に到達しない。DB は linked 済みなのにグループへの全アウトプットが失われる

補足: 当初案の「push フォールバック」単独では不十分（push も同一 400 で失敗することを実測確認）。ただし一過性障害（ネットワーク断・LINE 5xx）への防御としては引き続き有効なので採用する。

## 修正方針

1. **③のメンション対象をグループ在籍者に絞る（主修正）**: linked 案内の組み立て時、admin 候補の各 line_user_id を `GET /v2/bot/group/{groupId}/member/{userId}`（200=在籍 / 404=未在籍。全 Bot で利用可能なことを実測済み）でプローブし、在籍者だけをメンションする。在籍0名なら `buildMentionMessage` の既存仕様（空配列 → 素テキスト `@管理者` 行）に倒す。プローブの失敗（404 以外のエラー）は安全側=メンションしない。テスト差し替え可能な形（fetchImpl 注入 or 専用モジュール）で実装する
2. **logger 配線**: route.ts から構造化 logger（`console.error`/`console.log` に JSON 1行）を渡し、`webhook_event_failed` / `guidelines_warn` 等を journalctl で追えるようにする（大会用・級グループ用の両フローに効く）
3. **linked 案内の push フォールバック + 要綱 push の独立実行**: 案内 reply を try/catch で包み、失敗時はエラーログ + 同一4通を push（宛先 = linkedGroupId）で1回再送。push も失敗したらログのみ（linked 状態は維持）。案内送信の成否に関わらず `sendGuidelinesOnLink` へ到達させる

不採用の代替案: ③のメンションを常に素テキスト化（プローブ不要で最简だが、PR #530 で意図的に導入した「在籍管理者への ping」仕様を失うため見送り）。

## Acceptance Criteria

| ID | 条件 | 検証手段 |
|----|------|------|
| AC-1 | 管理者の一部がグループ未在籍でも、③は在籍者のみのメンションで組み立てられ、案内4通の送信が成功する | auto-test（回帰テスト） |
| AC-2 | 在籍管理者0名の場合、③は素テキスト（`@管理者` 行）で送信され、送信が成功する | auto-test |
| AC-3 | 在籍プローブが 404 以外のエラーを返した場合、該当ユーザーはメンションから除外され、送信は継続する | auto-test |
| AC-4 | 案内 reply が失敗しても、①エラーが logger へ出力され、②同一4通が push で再送され、③`sendGuidelinesOnLink` が実行される | auto-test |
| AC-5 | push フォールバックも失敗した場合、その失敗も logger に残り、要綱 push は実行され、webhook は 200 を返す（linked 状態は維持） | auto-test |
| AC-6 | 本番構成（route.ts 経由）で webhook 内のイベント処理エラーが console へ JSON 出力される | auto-test |
| AC-7 | 全管理者が在籍している正常系では従来どおり全員メンションで送信される（挙動不変） | auto-test |
| AC-8 | 既存テスト・lint・typecheck がすべて成功する | auto-test |

## Non-goals

- 管理画面からの「案内再送」ボタン（必要なら別 Issue）
- 招待コード無効時の ❌ reply への push フォールバック（ログ記録のみで対応）
- 級別グループ（grade_broadcast）フローへの push フォールバック追加（個人メンションを使わないため本バグの影響なし。logger 配線による観測性改善のみ）
- `resolveTreasurerMention`（@会計）を使う他経路（会計向け通知等）の在籍プローブ対応 — push 宛先が個人 or 既存グループで文脈が異なるため、必要なら別 Issue
- LINE OA 側設定（chatMode 等）の変更
- 椿杯ABC への案内手動再送（2026-08-25 運用対応済み）

## 影響範囲

- `apps/web/src/app/api/webhook/line/route.ts` — logger 配線
- `apps/web/src/lib/line-webhook-handler.ts` — ③の在籍プローブ絞り込み・案内送信 try/catch + push フォールバック・要綱 push の独立化
- 在籍プローブ用の新モジュール（`line-group-membership.ts` 等、fetchImpl 注入可能な形）
- `apps/web/src/lib/line-webhook-handler.test.ts` — 回帰テスト追加
- 挙動への影響: 全員在籍の正常系は不変（AC-7）。未在籍者がいる場合のみメンション対象が減る（従来はその場合送信自体が全滅していた）。プローブは linked 成立時のみ・管理者数回の GET（数件）で頻度・負荷とも軽微
