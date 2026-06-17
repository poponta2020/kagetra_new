---
status: completed
---
# broadcast-lead-message 実装手順書

既存大会への LINE 配信に「冒頭テキスト（見出し）」を任意で付ける機能。テストファースト
（CLAUDE.md ルール 2）で、各タスクは「テスト追加 → 実装 → green 確認」の順に進める。
ローカルの vitest は `--no-file-parallelism` で実行（test DB のクロックドリフト回避）。

## 実装タスク

### タスク1: DB スキーマ＋マイグレーション
- [x] 完了
- **概要:** `event_broadcast_messages` に冒頭テキスト保存用の 2 カラムを追加し、マイグレーションを生成する。
- **変更対象ファイル:**
  - `packages/shared/src/schema/event-broadcast-messages.ts` — `leadText: text('lead_text')`（nullable）と
    `sentLeadCount: integer('sent_lead_count').notNull().default(0)` を追加。doc コメントの counters 説明にも lead を追記。
  - `packages/shared/drizzle/0025_*.sql` — `pnpm --filter @kagetra/shared db:generate` で自動生成（`ADD COLUMN` 2 本）。
  - `packages/shared/drizzle/meta/_journal.json` ほか meta — generate で自動更新。
- **依存タスク:** なし
- **完了条件:** `db:generate` で 0025 が出力され、`db:migrate`（または test DB push）が通る。型チェック green。
  既存行が `lead_text=NULL`/`sent_lead_count=0` になることを確認（後方互換）。
- **対応Issue:** #149

### タスク2: プリセット定数ファイル
- [x] 完了
- **概要:** 冒頭テキストのプリセットと最大長を定数化（コード固定）。client/server 双方から import 可能にする。
- **変更対象ファイル:**
  - `apps/web/src/lib/broadcast-lead-presets.ts`（新規）— `export const BROADCAST_LEAD_PRESETS = [...] as const`
    （要件 §3.1 の 6 件）と `export const LEAD_TEXT_MAX_LENGTH = 200`。server-only import を含めないこと。
- **依存タスク:** なし
- **完了条件:** 定数が export され、各文言が 1〜200 文字に収まることを軽い unit test で確認（任意）。
- **対応Issue:** #150

### タスク3: broadcastMailToEvent に冒頭テキスト対応（バックエンド中核）
- [x] 完了
- **概要:** 配信オーケストレーションに `leadText` を導入。先頭に text メッセージを 1 通追加し、保存・role別カウント・partial 再送 skip を lead 対応にする。
- **変更対象ファイル:**
  - `apps/web/src/lib/line-broadcast.ts`
    - 引数型に `leadText?: string | null` を追加。
    - `MessageRole` に `'lead_text'` を追加。
    - `existingAudit` の SELECT に `sentLeadCount` を追加し、`deliveredCount` の合算に含める。
    - 監査行 insert / `onConflictDoUpdate` の `set` に `leadText: args.leadText?.trim() || null` を保存。
    - メッセージ組み立てを「lead → body → attachment」順に固定。`leadText` が trim 後非空のとき
      先頭に `{ type:'text', text }` を push、`roles` 先頭に `'lead_text'`。
    - `layoutShrunk` 判定に `existingAudit.sentLeadCount > currentLeadCount` を追加。
    - 完走カウントに `deliveredLead` を追加し、更新 set に `sentLeadCount: deliveredLead`。
  - `apps/web/src/lib/line-broadcast.test.ts` — 以下のケースを追加（テストファースト）:
    - leadText 指定 → 先頭が text==leadText / role lead_text / `lead_text` 保存 / `sent_lead_count=1`。
    - leadText 空・空白のみ → 冒頭メッセージなし（従来挙動）。
    - leadText + 本文画像 + 添付 → 送信順が lead, image, link。
    - 本文・添付空 + leadText → 冒頭 1 通のみ（空配信プレースホルダは出ない）。
    - （任意）partial 後の再送で lead の skip が効く。
- **依存タスク:** タスク1
- **完了条件:** 上記テスト green、既存 line-broadcast テストも green、型チェック green。
- **対応Issue:** #151

### タスク4: linkMailToEvent に leadText を通す＋バリデート
- [x] 完了
- **概要:** 手動紐付け配信の入口に `leadText` 引数を追加し、trim/長さ検証して broadcast に渡す。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `linkMailToEvent(mailId, eventId, leadText?: string | null)`。
    先頭で trim → 空なら null、201 文字以上なら `{ ok:false, error:'冒頭メッセージは200文字以内で入力してください' }`
    を返す（紐付け・配信を実行しない）。`after()` の `broadcastMailToEvent` 呼び出しに `leadText` を渡す。
  - `apps/web/src/app/(app)/admin/mail-inbox/actions.test.ts` — テスト追加（テストファースト）:
    - leadText 指定 → 紐付け成功 + 監査行に lead_text 保存（配信は DRY_RUN）。
    - 201 文字 → エラー返却・紐付けされない。
    - 空文字/空白 → null として正常（冒頭なし）。
- **依存タスク:** タスク3
- **完了条件:** 追加テスト green、既存 linkMailToEvent テスト green、型チェック green。
- **対応Issue:** #152

### タスク5: manualBroadcast で leadText を継承
- [ ] 完了
- **概要:** イベント画面からの再配信で、保存済み `lead_text` を監査行から継承して再送する（isCorrection 継承と同じ）。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/events/[id]/actions.ts` — `manualBroadcast` の既存監査行 SELECT に `leadText` を追加し、
    `broadcastMailToEvent` へ `leadText: existing[0]?.leadText ?? null` を渡す。
  - `apps/web/src/app/(app)/events/[id]/actions.test.ts` — テスト追加（テストファースト）:
    - lead_text 保存済みの行を manualBroadcast → 冒頭テキストが再送される。
    - lead_text=null の行 → 冒頭なしで再送（従来挙動）。
- **依存タスク:** タスク1, タスク3
- **完了条件:** 追加テスト green、既存 manualBroadcast テスト green、型チェック green。
- **対応Issue:** #153

### タスク6: ExistingEventLinkSheet に冒頭メッセージ欄
- [ ] 完了
- **概要:** 紐付けシートに「冒頭メッセージ（任意）」UI（プリセットチップ＋編集可能欄）を追加し、leadText を action に渡す。
- **変更対象ファイル:**
  - `apps/web/src/app/(app)/admin/mail-inbox/components/ExistingEventLinkSheet.tsx` —
    `leadText` state（open 時リセット）、`BROADCAST_LEAD_PRESETS` チップ（タップで `setLeadText`）、
    `maxLength={LEAD_TEXT_MAX_LENGTH}` の textarea（2 行）。`onConfirm` で
    `linkMailToEvent(mailId, eventId, leadText.trim() || null)`。エラー表示は既存 `error` を流用。
  - `apps/web/src/app/(app)/admin/mail-inbox/components/ExistingEventLinkSheet.test.tsx`（新規, テストファースト）:
    - プリセットチップ click → textarea にその文言が入る。
    - textarea 入力 → 「結びつける」で linkMailToEvent に leadText が渡る（action を mock）。
    - 空欄でも送信可（leadText=null）。
- **依存タスク:** タスク2, タスク4
- **完了条件:** コンポーネントテスト green、型チェック green、lint green。
- **対応Issue:** #154

## 実装順序
1. タスク1: DB スキーマ＋マイグレーション（依存なし）
2. タスク2: プリセット定数（依存なし）
3. タスク3: broadcastMailToEvent 冒頭テキスト対応（タスク1）
4. タスク4: linkMailToEvent に leadText（タスク3）
5. タスク5: manualBroadcast で leadText 継承（タスク1, 3）
6. タスク6: ExistingEventLinkSheet 冒頭メッセージ欄（タスク2, 4）

## DoD / 残作業（実装後）
- API（line-broadcast / actions）テスト + フロント（ExistingEventLinkSheet）テスト + 型 + lint が全 green。
- CI green、claude-mem 記録、PR 作成 + Codex レビュー対応。
- E2E は既存 `mail-inbox-link-event.spec.ts` の範囲に影響なし（冒頭欄は任意なので既存フロー不変）。
  必要なら冒頭テキスト入りの link→配信を 1 ケース追記検討（任意）。
- **本番反映時**: migration 0025 適用（`db:migrate`）。auto-deploy が SHARED 変更を拾って自動適用する想定。
- **実機確認（残 DoD）**: iPhone 実機で、紐付け時に冒頭テキストを入れて LINE グループに
  「冒頭テキスト → 本文画像 → 添付リンク」の順で届くことを目視。再配信でも冒頭が再送されること。
