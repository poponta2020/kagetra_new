---
status: completed
---
# openchat-broadcast 実装手順書

正典: [requirements.md](requirements.md)（AC・Non-goals）／[design-spec.md](design-spec.md)（視覚の正・忠実度チェックリスト）／[feasibility.md](feasibility.md)（なぜ自動検知にしないか）

## 技術設計（確定事項）

### データ

新規2テーブル（migration 0056。既存テーブルの変更なし）:

- **`entry_group_open_chats`** — 1行 = オープンチャット1つ
  `entry_group_id`（FK・CASCADE）／`url`（NOT NULL）／`grades`（`gradeEnum('grades').array()`・NULL = 全級）／
  `event_date`（date・NULL = 全日）／`label`（NULL = 自動生成）／`password`／
  `source`（新 enum `open_chat_source`: body / attachment_text / qr / manual）／
  `source_mail_message_id`（FK・SET NULL）／`sort_order`／`created_at`／`updated_at`。
  **`UNIQUE(entry_group_id, url)`**
  - 級セットは `gradeEnum(...).array()`。**既存の `events.eligible_grades` /
    `tournament_entry_roster_files.grades` と同じ表現**（新表現を発明しない）。
    raw SQL で配列を渡す場合は `inArray` / `ANY(ARRAY[...])` を使い、空配列は early-return する
  - ラベルの一意性は**自動生成後の値**で決まるため DB 制約にできない。Server Action で判定する
- **`entry_group_open_chat_broadcasts`** — 配信履歴（1行 = 1回の配信）
  `entry_group_id`／`sent_at`／`sent_count`／`status`／`error_message`／`sent_by_user_id`
  - ★**`event_broadcast_messages` は使わない**（requirements §6 の契約）。同テーブルの
    `UNIQUE(eventLineBroadcastId, mailMessageId)` は「1メール=1配信」を強制し、「毎回全件を送る」と両立しない
  - 「N 回配信済み」= `count(*)`、「前回配信以降に増えた行」= `open_chats.created_at > max(sent_at)`

`entry_groups` 自身には列を足さない（同テーブルは「意図的に列を持たない」薄い基盤という既存方針）。

### モジュール構成（`apps/web/src/lib/open-chat/`）

| ファイル | 責務 | 制約 |
|---|---|---|
| `extract.ts` | テキスト → 候補（Tier1 直リンク・Tier2 短縮 URL・改行復元・級/日付/パスワード推定・重複排除） | 純関数。**fetch を呼ばない**（AC-8） |
| `label.ts` | 自動ラベル生成・最終ラベルの重複判定 | **client-safe leaf**（`'use client'` から import されるため DB 依存を持ち込まない。`process-candidate-utils.ts` 冒頭の注意と同じ罠） |
| `qr.ts` | 画像バイト列 → URL（`sharp` で grayscale/normalize → RGBA → `jsQR`） | sharp は既存依存。新規依存は `jsqr` のみ |
| `collect.ts` | メール本文＋添付 → 候補一覧（extract + qr + `renderPdfToJpegs` を束ねる） | サーバー専用 |
| `flex.ts` | 保存済み行 → Flex Message JSON | 純関数。`line-flex-attachment.ts` と同じく**重依存を持ち込まない** |

### 配信経路の再利用（★既存コードの扱いを明示）

`broadcastMailToEvent` の内部にある2つの処理を**動作を変えずに関数として切り出し、export する**
（openchat 側で書き直すと必ず乖離するため）:

1. **push 直前の binding 再取得と一致検証**（現 L916-954）→ `assertBindingUnchanged()`
2. **push 失敗時の復旧**（現 L1037 付近。401 → channel を disabled ＋ binding revoke／
   401 以外の 4xx → binding のみ revoke。いずれも「送信開始時に保持していた channel/group が
   現在も有効な場合に限る」）→ `applyPushFailureRecovery()`

`pushMessages` も export する（コードは移動しない）。
**`broadcastMailToEvent` の外部から見た挙動は一切変えない**（既存テストが回帰の網）。

### QR の依存選定

`sharp`（既存依存・本番 ARM Docker で稼働実績あり）で画像を RGBA に落とし、`jsqr`（純 JS・
ネイティブビルド無し）でデコードする。zxing-wasm は印刷 PDF の QR に強いが wasm 依存が増えるため
不採用。**`renderPdfToJpegs` の DPI は変更しない**（既存の本文画像化・添付プレビューが使う
出荷済み経路を触らないため）。AC-15（manual）で実 PDF が読めないと判明した場合は、
DPI 引数追加か zxing-wasm への差し替えを**別変更**として起票する。

## 実装タスク

### タスク1: スキーマとマイグレーション
- [ ] 完了
- **目的:** `entry_group_open_chats` / `entry_group_open_chat_broadcasts` と `open_chat_source` enum を追加する
- **対応AC:** AC-25, AC-27, AC-29, AC-40
- **主な変更領域:** `packages/shared/src/schema/entry-group-open-chats.ts`・`entry-group-open-chat-broadcasts.ts`・`enums.ts`・`relations.ts`・`index.ts`、`packages/shared/drizzle/0056_*.sql`
- **依存タスク:** なし
- **必要なテスト:** スキーマ単体のテストは置かない（後続タスクの DB テストが実質の検証）。`pnpm db:generate` の差分がレビュー可能であること
- **完了条件:** `pnpm db:generate` で migration が生成され、`pnpm check-types` が通る。テスト DB への push が対話プロンプトなしで通る
- **対応Issue:** #458

### タスク2: 抽出（純関数）
- [ ] 完了
- **目的:** テキストから候補 URL を決定的に抽出する
- **対応AC:** AC-1〜AC-9, AC-16〜AC-19
- **主な変更領域:** `apps/web/src/lib/open-chat/extract.ts`（＋ `extract.test.ts`）
- **依存タスク:** なし
- **必要なテスト:** テストファースト。**feasibility.md に載っている実メールの文面を素材にする**
  （改行で割れた さがみ野ケース／Outlook の `<https://…>` 二重表記／杉並の日付別2本／
  東京東会の級別3本／宮崎の直リンク1本）。`globalThis.fetch` を spy して**一度も呼ばれない**ことを検証（AC-8）
- **完了条件:** 上記テストが green
- **対応Issue:** #459

### タスク3: ラベル生成と重複判定（client-safe leaf）
- [ ] 完了
- **目的:** 級・開催日から表示ラベルを組み立て、最終ラベルの重複を検出する
- **対応AC:** AC-21〜AC-24, AC-47〜AC-49
- **主な変更領域:** `apps/web/src/lib/open-chat/label.ts`（＋ `label.test.ts`）
- **依存タスク:** なし
- **必要なテスト:** 「6/20(土) C級」「C級」「6/20(土)」「オープンチャットに参加」の4分岐、
  級・日付とも未指定が2行 → 重複、自由ラベルで解消
- **完了条件:** テスト green。`@kagetra/shared` / `drizzle-orm` / `@/lib/db` を**一切 import していない**
- **★級の型は `roster-adopt-utils.ts` の `RosterAdoptGrade` を再利用する**（`process-candidate-utils.ts` と同じ手口）。
  `@kagetra/shared/schema` から取ると型 import でも client バンドルへ DB 依存が漏れ、
  eslint / vitest / check-types のどれでも検知できず `next build` で初めて壊れる
- **対応Issue:** #460

### タスク4: Flex ビルダー（純関数）
- [ ] 完了
- **目的:** 保存済み行から Flex Message JSON を組み立てる
- **対応AC:** AC-30〜AC-34, AC-50
- **主な変更領域:** `apps/web/src/lib/open-chat/flex.ts`（＋ `flex.test.ts`）
- **依存タスク:** なし
- **必要なテスト:** 1件／複数件／パスワード有無、altText の 400 字上限（サロゲートペアを割らない。
  既存 `truncateToUtf16Units` と同じ扱い）、**バブル内テキストが2つだけ**であること
- **完了条件:** テスト green。design-spec の `## Flex はトークンの外` の色をそのまま使っている
- **対応Issue:** #461

### タスク5: QR デコード
- [ ] 完了
- **目的:** 画像バイト列から QR の URL を取り出す
- **対応AC:** AC-10
- **主な変更領域:** `apps/web/src/lib/open-chat/qr.ts`（＋ `qr.test.ts`）、`apps/web/package.json`（`jsqr` 追加）
- **依存タスク:** なし
- **必要なテスト:** **QR を含むフィクスチャ画像をコミットして**デコードできること、
  QR の無い画像で null が返ること、壊れたバイト列で例外を投げず null になること
- **完了条件:** テスト green
- **対応Issue:** #462

### タスク6: 配信経路の再利用ヘルパー抽出
- [ ] 完了
- **目的:** binding 再検証と push 失敗時の復旧を、既存挙動を変えずに再利用可能にする
- **対応AC:** AC-39（および requirements §6 の「既存挙動を壊さない」）
- **主な変更領域:** `apps/web/src/lib/line-broadcast.ts`（`pushMessages` を export、
  `assertBindingUnchanged` / `applyPushFailureRecovery` を切り出して export）
- **依存タスク:** なし
- **必要なテスト:** **既存 `line-broadcast.test.ts` が無改変で green**（これが回帰の網）。
  切り出した関数の直接テストを追加
- **完了条件:** 既存テスト全 green。`broadcastMailToEvent` の外部から見た挙動が変わっていない
- **注意:** profile の高リスクパス（LINE 一斉配信）。**コードは移動のみで書き換えない**
- **対応Issue:** #463

### タスク7: 候補収集オーケストレータ
- [ ] 完了
- **目的:** メール本文＋添付を走査して候補一覧を作る
- **対応AC:** AC-6, AC-11, AC-12, AC-13, AC-14, AC-20
- **主な変更領域:** `apps/web/src/lib/open-chat/collect.ts`（＋ `collect.test.ts`）
- **依存タスク:** タスク2, タスク5
- **必要なテスト:** 本文のみ／添付テキストのみ／画像添付の QR／PDF は
  `renderPdfToJpegs` を **mock**（既存 `attachment-preview.test.ts` と同じ流儀）してページ画像が
  デコーダへ渡ること、走査ページ数が `RENDER_PAGE_LIMIT` を超えないこと、
  添付1件が壊れていても他の候補が返ること
- **完了条件:** テスト green
- **対応Issue:** #464

### タスク8: Server Action（保存・配信・再配信）
- [ ] 完了
- **目的:** 抽出・保存・Flex 配信・再配信を管理者操作として提供する
- **対応AC:** AC-25〜AC-29, AC-35〜AC-41, AC-44, AC-47〜AC-49, AC-53
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/open-chat-actions.ts`（＋ `.test.ts`）
- **依存タスク:** タスク1, 3, 4, 6, 7
- **必要なテスト:** 冒頭 `requireAdminSession()`（一般会員は拒否）／URL 空・非 https・
  グループ外の開催日・URL 重複・ラベル重複で保存されない／LINE 未紐付けは保存のみ／
  **同一メールから2回配信しても DB 制約違反にならない（AC-41）**／
  `event_broadcast_messages` に行が増えない（AC-40）／配信失敗でも保存が残る／
  binding 変更で中止。`revalidatePath()` 漏れの確認
- **完了条件:** テスト green
- **対応Issue:** #465

### タスク9: メール詳細の抽出シート UI
- [ ] 完了
- **目的:** 「オープンチャットを抽出」ボタンと候補確認シートを実装する
- **対応AC:** AC-20, AC-35, AC-36, AC-37, AC-47
- **主な変更領域:** `apps/web/src/app/(app)/admin/mail-inbox/components/OpenChatExtractSheet.tsx`（新規）、
  `components/MailProcessForm.tsx`（ボタン追加）、`mail/[id]/page.tsx`（受け渡し）
- **依存タスク:** タスク8
- **必要なテスト:** 対象の大会未選択でボタンが無効／候補ゼロで手入力行が展開済みで出る／
  ラベル重複で CTA が無効／LINE 未紐付けで CTA 文言が「保存する」になる
- **完了条件:** テスト green。**視覚は `design-mock/sheet-normal.html`・`sheet-hard.html`・`states.html` に忠実**
- **対応Issue:** #466

### タスク10: 大会詳細のオープンチャット欄
- [ ] 完了
- **目的:** 保存済みオープンチャットを全会員に表示する
- **対応AC:** AC-42, AC-43, AC-45, AC-51, AC-52
- **主な変更領域:** `apps/web/src/app/(app)/events/[id]/components/`（新規セクション）、`page.tsx`（クエリ追加）
- **依存タスク:** タスク1, タスク3
- **必要なテスト:** 0件で見出しごと出ない／開催日で絞られず全行出る／並び順が Flex と一致／
  一般会員に表示される／未ログインは到達できない
- **完了条件:** テスト green。**視覚は `design-mock/event-detail.html` に忠実**
- **対応Issue:** #467

### タスク11: 忠実度チェックと仕上げ
- [ ] 完了
- **目的:** 確定デザインが実装で劣化していないことを確認し、出荷可能にする
- **対応AC:** AC-15, AC-46, AC-54（および design-spec の忠実度チェックリスト全項目）
- **主な変更領域:** 仕上げのみ（新規ファイルなし）
- **依存タスク:** タスク9, タスク10
- **必要なテスト:** 追加なし
- **★manual AC の消化手順（ここでしか消化されない。放置すると出荷後に実害化する）:**
  - **AC-15**: 本番相当環境で QR 入り PDF を実際に通す。素材は本番の mail#134/#136（京都大会
    「下記QRコードから」）または #176（高校選手権「右QRコードより参加可能」）の添付。
    読めなければ**失敗として記録し**、DPI 引数追加か zxing-wasm 差し替えを別 Issue に起票する
  - **AC-46**: 実グループへ1回 push して、Flex の表示・ボタンタップでオープンチャット参加画面へ
    遷移すること・パスワード行が読めることを確認する。**本番の会員グループではなく検証用グループで行う**
- **完了条件:** design-spec の `## 忠実度チェックリスト` 全14項目クリア。
  lint / check-types / 各パッケージのテストが green
- **対応Issue:** #468

## 実装順序（Wave）

- **Wave 1:** タスク1（スキーマ単独。`packages/shared/` 変更は全パッケージのテストへ波及するため単独で先行させる）
- **Wave 2:** タスク2 ／ タスク3 ／ タスク4 ／ タスク5（4つとも新規ファイルのみ・相互 import なし）
- **Wave 3:** タスク6（`line-broadcast.ts` 単独。高リスクパスなので他と混ぜない）
- **Wave 4:** タスク7
- **Wave 5:** タスク8
- **Wave 6:** タスク9 ／ タスク10（別ディレクトリ）
- **Wave 7:** タスク11

## 申し送り

- **AC-15（manual）が QR 品質のゲート。** 実 PDF の QR が読めない場合は、`renderPdfToJpegs` への
  DPI 引数追加か zxing-wasm への差し替えを**別変更**として起票する（本 PR では既存の
  レンダリング経路を触らない）
- **列リネームは無いが新規テーブル追加のため**、各 worktree のテスト DB は初回 vitest 起動時に
  自動 push される。並行 worktree で古いスキーマが残る場合はテスト DB を捨てる
