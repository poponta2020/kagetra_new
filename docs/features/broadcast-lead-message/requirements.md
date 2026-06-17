---
status: completed
---
# broadcast-lead-message 要件定義書

## 1. 概要

### 目的
既存の大会（イベント）にメールを紐付けて LINE グループへ配信するとき、LINE BOT から
**冒頭の見出しテキスト（例:「抽選結果が出ました！」）**を任意で 1 通先頭に付けられるようにする。

### 背景・動機
現状、既存イベントへメールを紐付けて配信すると、LINE グループには
**メール本文の画像（A4 JPEG）と添付ファイルのリンクしか届かない**。
受け取った会員は「これが何の連絡なのか」を示す導入テキストが無いまま、画像とファイル
リンクだけを見ることになり、文脈が伝わりにくい。抽選結果・組合せ・オープンチャット案内
など、既存大会への補足連絡は内容が毎回変わるため、1 行の見出しがあるだけで受け取り体験が
大きく改善する。

## 2. ユーザーストーリー

- **対象ユーザー**: 管理者／副管理者（mail-inbox から既存大会へメールを紐付けて配信する人）と、
  配信を受け取る LINE グループの会員。
- **管理者の目的**: 補足連絡を既存大会の LINE グループへ流すとき「何の連絡か」を一目で伝える見出しを付けたい。
- **会員の目的**: LINE 通知を開いた瞬間に「抽選結果が出たんだな」と分かり、画像や添付を見る前に文脈を把握できる。
- **利用シナリオ**:
  1. 大会主催者から「抽選結果」メールが届く（kagetra のメール受信トレイに入る）。
  2. 管理者が mail-inbox 詳細で「既存イベントに紐付ける」シートを開き、対象大会を選ぶ。
  3. 冒頭メッセージ欄でプリセット「抽選結果が出ました！」チップをタップ（必要なら手直し）。
  4. 「結びつける」を押すと、LINE グループへ **冒頭テキスト → 本文画像 → 添付リンク** の順で配信される。

## 3. 機能要件

### 3.1 画面仕様（既存イベント紐付けシート）

対象は `ExistingEventLinkSheet`（mail-inbox 詳細の「既存イベントに紐付ける」ボトムシート）。
イベント選択リストの下に **「冒頭メッセージ（任意）」** セクションを追加する。

- **プリセットチップ**: 定型文をチップ（ボタン）で横並び表示。タップすると下のテキスト欄に
  その文言を**流し込む**（上書き）。チップは選択状態を保持しない（単なる流し込みトリガー）。
- **テキスト欄**: 編集可能な複数行テキスト欄（2 行程度）。プリセット流し込み後に手直し可、
  プリセットを使わず直接入力も可。`maxLength = 200`。プレースホルダ例:「例: 抽選結果が出ました！」
- **任意**: 空欄のまま「結びつける」を押せる。空なら従来通り本文＋添付のみ配信。
- 「結びつける」押下時、テキスト欄の値（trim 後）を `linkMailToEvent` に渡す。

プリセット文言（コード固定・初期セット。増減・修正は小 PR で対応可）:
1. 抽選結果が出ました！
2. 組合せ（対戦表）が出ました！
3. 大会専用オープンチャットのお知らせ
4. タイムテーブル・進行のご案内
5. 会場・アクセスのご案内
6. その他のご連絡

### 3.2 配信仕様

- 冒頭テキストが非空のとき、LINE 送信メッセージ配列の **先頭** に
  `{ type: 'text', text: <冒頭テキスト> }` を 1 通追加する（本文画像／本文テキストより前）。
- 冒頭テキストが空（trim 後に空文字）なら何も追加しない（既存挙動）。
- 適用範囲は **手動の `linkMailToEvent` 経由の配信のみ**。
  AI 下書き承認の自動配信（`approveDraft` / `approveDraftUnits`）、訂正下書き紐付け
  （`linkDraftToEvent`）には冒頭テキストを付けない（引数 `leadText` は渡さない＝null）。
- 冒頭テキストは配信ログ（`event_broadcast_messages.lead_text`）に保存する。
  イベント画面からの **再配信（`manualBroadcast`, force=true）では保存済みの冒頭テキストを
  そのまま再送**する（`isCorrection` の継承と同じパターン）。

### 3.3 ビジネスルール・制約

- 冒頭テキストは 1〜200 文字（trim 後）。空は許容（=付けない）。201 文字以上は
  Server Action 側で弾く（エラー文言「冒頭メッセージは200文字以内で入力してください」）。
- LINE のテキストメッセージ上限（5000 文字）に対し 200 文字なので分割不要。
- プリセットはあくまで入力補助。Server 側はプリセット一覧と照合しない（自由入力を許容）。
- 配信先 LINE グループが無い（`loadActiveBinding` が null）場合は、従来通り配信自体が
  スキップされる（冒頭テキストの有無に関わらず）。

### 3.4 エラーケース・境界条件

| ケース | 挙動 |
|--------|------|
| 冒頭テキスト空欄 | 冒頭テキストを付けず本文＋添付のみ配信（従来通り） |
| 空白のみ入力 | trim で空とみなし付けない |
| 201 文字以上 | `linkMailToEvent` がエラー返却、紐付け・配信とも実行しない |
| 本文・添付が空 + 冒頭テキストあり | 冒頭テキストのみ 1 通配信（空配信プレースホルダは出ない） |
| 部分送信（partial）後の再送 | `sent_lead_count` で冒頭の送信済み有無を追跡し、未送信分のみ再送 |
| 再配信（manualBroadcast） | 保存済み `lead_text` を再送。null なら冒頭なし |

## 4. 技術設計

### 4.1 API（Server Actions）設計

REST エンドポイントではなく既存の Server Action を拡張する。

- **`linkMailToEvent(mailId, eventId, leadText?)`**
  （`apps/web/src/app/(app)/admin/mail-inbox/actions.ts`）
  - 第 3 引数 `leadText?: string | null` を追加。
  - trim → 空なら null。201 文字以上なら `{ ok: false, error }` を返す（紐付け前にバリデート）。
  - `after()` 内の `broadcastMailToEvent(db, { eventId, mailMessageId, isCorrection: false, leadText })` に渡す。
- **`manualBroadcast(eventId, mailMessageId)`**
  （`apps/web/src/app/(app)/events/[id]/actions.ts`）
  - 既存監査行の SELECT に `leadText` を追加し、`broadcastMailToEvent` へ
    `leadText: existing[0]?.leadText ?? null` を渡す（isCorrection 継承と同じ）。

### 4.2 DB 設計

`event_broadcast_messages` に 2 カラム追加（`packages/shared/src/schema/event-broadcast-messages.ts`）:

| カラム | 型 | 制約 | 用途 |
|--------|----|----|------|
| `lead_text` | `text` | nullable | 配信した冒頭テキスト本文。再配信時の再送元・監査 |
| `sent_lead_count` | `integer` | NOT NULL default 0 | 冒頭テキストの送信済み件数（0 or 1）。partial 再送の skip 計算・監査 |

- マイグレーション: `pnpm --filter @kagetra/shared db:generate` で `0025_*.sql` を生成
  （`ADD COLUMN lead_text text; ADD COLUMN sent_lead_count integer NOT NULL DEFAULT 0;`）。
  既存行はデフォルトで `lead_text=NULL`, `sent_lead_count=0`。後方互換。
- 本番反映は `db:migrate`（journal ベース・非 interactive）。

### 4.3 フロントエンド設計

- **`apps/web/src/lib/broadcast-lead-presets.ts`（新規）**: `BROADCAST_LEAD_PRESETS`
  （string 配列）と `LEAD_TEXT_MAX_LENGTH = 200` を export。client/server 双方から import。
- **`ExistingEventLinkSheet.tsx`**:
  - `useState<string>` で `leadText` を保持。シート open 時にリセット。
  - プリセットチップ群（`BROADCAST_LEAD_PRESETS.map`）。タップで `setLeadText(preset)`。
  - 編集可能 textarea（`maxLength={LEAD_TEXT_MAX_LENGTH}`、2 行）。
  - `onConfirm` で `linkMailToEvent(mailId, eventId, leadText.trim() || null)` を呼ぶ。

### 4.4 バックエンド設計（`broadcastMailToEvent`, `apps/web/src/lib/line-broadcast.ts`）

- 引数型に `leadText?: string | null` を追加。
- `MessageRole` 型に `'lead_text'` を追加。
- `existingAudit` の SELECT に `sentLeadCount` を追加し、`deliveredCount` の合算に含める。
- 監査行 insert / onConflictDoUpdate の `set` に `leadText: args.leadText ?? null` を追加
  （manualBroadcast が継承値を渡すため update でも上書き保存して問題ない）。
- メッセージ組み立ての**先頭**で、`leadText` が trim 後非空なら
  `messages.unshift`/先頭 push 相当で `{ type:'text', text: leadText.trim() }` を追加、
  `roles` 先頭に `'lead_text'`。実装はビルド順を「lead → body → attachment」に固定する。
- `layoutShrunk` 判定に lead 件数比較を追加（`existingAudit.sentLeadCount > currentLeadCount`）。
- 完走カウントに `deliveredLead` を追加し、`sentLeadCount: deliveredLead` で更新。

### 4.5 処理フロー

```
[mail-inbox 詳細] ExistingEventLinkSheet
  └ イベント選択 + 冒頭メッセージ入力（プリセット流し込み/手入力, 任意）
      └ linkMailToEvent(mailId, eventId, leadText)
          ├ leadText を trim + 200字 validate（NGなら配信せずエラー）
          ├ mail を event に紐付け（既存ロジック）
          └ after() → broadcastMailToEvent({ eventId, mailMessageId, isCorrection:false, leadText })
                ├ loadActiveBinding（無ければskip, 既存）
                ├ 監査行 upsert（lead_text 保存）
                ├ messages = [lead_text?, body_image*/body_text*, attachment_link*]
                ├ pushMessages（既存）
                └ 監査確定（sent_lead_count 含む role 別カウント）

[イベント画面] 再配信ボタン
  └ manualBroadcast(eventId, mailMessageId)
      └ 既存監査行から leadText + isCorrection を継承
          └ broadcastMailToEvent({ ..., force:true, leadText })  → 保存済み冒頭を再送
```

## 5. 影響範囲

### 変更が必要な既存ファイル
- `packages/shared/src/schema/event-broadcast-messages.ts` — 2 カラム追加
- `packages/shared/drizzle/0025_*.sql` — 自動生成（新規）
- `apps/web/src/lib/broadcast-lead-presets.ts` — 新規（プリセット定数）
- `apps/web/src/lib/line-broadcast.ts` — leadText 引数・先頭メッセージ・lead カウント
- `apps/web/src/app/(app)/admin/mail-inbox/actions.ts` — `linkMailToEvent` に leadText 引数＋バリデート
- `apps/web/src/app/(app)/events/[id]/actions.ts` — `manualBroadcast` で leadText 継承
- `apps/web/src/app/(app)/admin/mail-inbox/components/ExistingEventLinkSheet.tsx` — 冒頭メッセージ欄
- 対応テスト各種

### 既存機能への影響
- **AI 下書き承認の自動配信**（`approveDraft` 等）: `leadText` を渡さない＝null なので**挙動不変**。
- **イベント画面の再配信**: 保存済み `lead_text` を再送するようになる（新規行は null＝従来通り）。
- **partial 再送ロジック**: lead 件数を skip 計算に含めるよう拡張（既存テキスト/画像/リンクの扱いは不変）。
- **DB 後方互換**: 追加カラムは nullable / default 付きで既存行・既存クエリに影響なし。

## 6. 設計判断の根拠

- **プリセット＋自由入力／コード固定**: 連絡内容（抽選結果・組合せ・OC 案内…）は毎回変わるため
  固定文言では不十分。一方で身内アプリにつき DB 管理＋CRUD 画面は過剰。コード定数なら最小実装で
  即出しでき、文言変更も小 PR で足りる（スコープ管理・1PR=1機能）。
- **チップで欄に流し込む 1 フィールド構成**: プルダウン＋別欄は「プリセットを選んでから一部修正」が
  しづらい。チップ→編集可能欄なら「速い」と「柔軟」を両立。
- **既存イベント紐付けのみに限定**: 新規大会案内（AI 下書き）は本文自体が案内なので冒頭テキストは
  冗長。ユーザー要望も「既存の大会に紐づけて通知するとき」に限定されている。
- **lead_text を監査行に保存して再送**: `manualBroadcast` は force 再送で `isCorrection` を監査行から
  継承する既存パターンがある。冒頭テキストも同じ場所に保存して継承すれば、再配信が忠実になり
  実装も一貫する。`sent_lead_count` を分離するのは partial 再送の skip 計算・監査の明瞭さのため
  （既存も role 別カウントを分離している方針に合わせる）。
- **先頭固定・任意**: 見出しは本文より前にあってこそ機能する。常時必須にすると単純な添付転送が
  煩雑になるため任意とし、空ならスキップして既存挙動を完全維持する。
