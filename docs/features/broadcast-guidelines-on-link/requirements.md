---
status: completed
design_required: false
design_note: UI変更は既存モーダル＋既存ui/プリミティブへの小追加のため、ライブ試作(/design-screen)は不要と判断（2026-07-16・ユーザー選択）。レイアウト論点は下記「デザインへの宿題」を実装計画に統合。
completed_sections: [ユーザーストーリー, 機能要件, Acceptance Criteria と Non-goals, 技術的制約・契約]
approved_at: 2026-07-16
base_feature: event-line-broadcast
---

# broadcast-guidelines-on-link 要件定義書

`event-line-broadcast` への追加機能（改修 / delta）。既存の配信・招待コード・紐付けライフサイクルは変更しない。機能仕様の正典は [docs/spec/notifications.md](../../spec/notifications.md)（実装時に更新）。

## 1. 概要

### 目的
大会LINEグループの紐付けが完了した瞬間に、その大会の「要綱」ファイルを自動でグループへ送信する。要綱として流すファイルは、大会案内メールの添付から管理者が選択できるようにする。

### 背景・動機
- 現状、Botとグループを紐付けた後に承認されたメールは自動配信されるが、**紐付け前に承認済みだった大会案内メール（＝多くの場合、要綱そのもの）はバックフィルされない**（`event-line-broadcast` のシナリオC）。運営は口頭・LINE内で別途共有する運用になっている。
- 案内メールの添付には要項のほか申込用名簿・振込先案内など複数ファイルが混在するため、「どれを要綱としてグループに流すか」を機械的に決められない。管理者が選ぶ必要がある。
- そこで、**アプリ側の紐付け操作（招待コード発行）時に要綱ファイルを選択 → 紐付け完了時にそのファイルだけをグループへ送信** する導線を追加し、シナリオCの穴を要綱に限って埋める。

### 位置付け
P2「大会運営」×P3「AI+メール」の既存 `event-line-broadcast` に対する追加。既存の全メール自動配信フローとは独立した、**選択ファイルのみの1回きり・ベストエフォート送信**。

## 2. ユーザーストーリー（delta）

- **対象ユーザー**: 管理者 / 副管理者（招待コード発行・要綱選択を行う実質1名）。一般会員は受け手（グループでファイルを受け取るのみ）。
- **シナリオ（追加分）**:
  1. 大会案内メールが取り込まれ・承認され、イベントが作られている（＝関連メールと添付が存在）。
  2. 管理者が `/events/[id]` の「LINE配信」で「LINE配信を有効化」→ 招待コード発行モーダルが開く。
  3. モーダル内に、この大会の全関連メールの添付一覧（メール別）が表示される。管理者が要綱にあたるファイル（複数可）にチェックを入れる。選択は即時保存される。
  4. Botをグループに招待しコードを発言 → 紐付け完了（`linked`）。
  5. 紐付け完了と同時に、選択済み要綱ファイルが `📎【大会要綱】ファイル名 + ダウンロードURL` の形でグループへ push 送信される。
  6. 要綱を選ばなかった場合は、紐付け完了時に要綱送信は行われない（従来どおり）。

## 3. 機能要件

### 3.1 画面と遷移（見た目は design-spec 参照）

対象画面: `/events/[id]`（既存）の「LINE配信」セクションと `InviteCodeModal`（既存）。新規画面なし。

- **招待コード発行モーダル（`InviteCodeModal`・既存を拡張）**: 既存の招待コード表示＋手順に加え、「要綱として送信するファイル」の選択リストを追加する。
  - この大会の全関連メール添付を**メール別にグルーピング**して列挙（件名・受信日時＋ファイル名・サイズ）。
  - 各ファイルにチェックボックス（複数選択可）。チェックのトグルで選択を即時保存。
  - 選択できる添付が1件も無い場合は「送信できる添付ファイルがありません」と表示（送信対象なし）。
- **LINE配信セクション（`LineBroadcastSection`・既存を拡張）**:
  - `linked` 表示に「要綱: N件選択済み（最終送信日時）」の1行と、選択済みファイルがある場合の「要綱を再送」ボタンを追加（ベストエフォート失敗時／取りこぼし時の復旧導線）。
  - 選択操作自体はモーダル内（＝紐付け前）に限る。`linked` 後に選択内容を変更したい場合は連携解除→再発行で再度モーダルから選ぶ。

ナビゲーション地図: 既存の「LINE配信を有効化 → 招待コードモーダル → （LINE操作）→ linked表示」に変更なし。モーダルとlinked表示に上記の要素が加わるのみ。

### 3.2 ビジネスルール

- **選択の対象**: `EventRelatedMails` と同一の3経路union（`mail_messages.linked_event_id` / `tournament_drafts.event_id` / `events.tournament_draft_id`）で集めた関連メールに紐づく `mail_attachments` 全件。形式（PDF/Word/Excel/その他）は問わない。
- **選択の永続化**: 選択は当該イベントの LINE 連携（`event_line_broadcasts` 行、1大会1行）に紐づけて保存する。モーダルを閉じても保持。招待コードの再発行（同一行のUPDATE）でも保持。
- **送信トリガー**: `event_line_broadcasts.status` が `linked` に遷移した時（＝webhookの招待コード照合成功、および管理者の手動紐付け `manualLinkGroup`）。選択済みファイルが1件以上あれば送信、無ければ何もしない。
- **送信内容・形式**: 選択ファイルごとに、既存の添付配信と同じ署名URL方式（`getOrCreateShareToken` → `/api/line-broadcast/attachments/[token]`、有効期限60日）。先頭に `【大会要綱】` の見出しを付す。1ファイル=1 textメッセージ（`📎【大会要綱】ファイル名` ＋ URL）。既存のバッチ送信制御（5通/バッチ・1.5秒間隔・429リトライ）に従う。
- **ベストエフォート**: 送信は紐付け成立**後**に走る（紐付け成功のreply枠は消費済みのためpush）。送信の成否は紐付け（`linked`）の成否に影響しない。失敗はログに記録する。
- **再連携**: 連携解除→再発行→再紐付けした場合、選択は保持され、新しいグループへ改めて送信される。
- **再送**: `linked` 状態で「要綱を再送」を押すと、選択済みファイルを同じ形式で再度 push する（best-effortの取りこぼし復旧）。
- **未選択時**: 紐付け完了時の要綱送信は行われない（既存挙動と完全に同じ）。
- **DRY_RUN**: `LINE_NOTIFY_DRY_RUN=1` のとき実 push を行わない（既存配信と同じ）。

### 3.3 権限
- 要綱ファイルの選択・保存・再送は admin / vice_admin のみ（既存の招待コード発行・配信操作と同じガード）。
- webhook経由の送信は既存どおり署名検証済みチャネルからのみ発火。送信対象・内容は事前に管理者が選択したものに限られる。

## 4. Acceptance Criteria

| ID | 条件（客観的に判定できる文） | 検証手段 |
|----|------|------|
| AC-1 | 招待コード発行モーダルに、対象イベントの全関連メール（3経路union）の添付が、メール別にグルーピングされて列挙される | auto-test |
| AC-2 | モーダルで添付を複数選択でき、選択が当該イベントのLINE連携に永続化される（モーダル再オープン・招待コード再発行後も保持） | auto-test |
| AC-3 | `event_line_broadcasts` が `linked` に遷移した時、選択済み要綱ファイルが署名URL方式（`📎【大会要綱】…` ＋ `/api/line-broadcast/attachments/[token]`）でグループへ push される | auto-test |
| AC-4 | 送信URLは `getOrCreateShareToken` により発行され、既存の添付DL route で開ける（新規経路を作らない） | auto-test |
| AC-5 | 要綱が未選択の場合、`linked` 遷移時に要綱送信は一切行われない（既存挙動不変） | auto-test |
| AC-6 | 要綱送信が失敗しても `event_line_broadcasts.status='linked'` は保たれる（紐付けは成功のまま）。失敗はログ記録される | auto-test |
| AC-7 | 管理者の手動紐付け `manualLinkGroup` でも、選択済み要綱があれば同じ形式で送信される | auto-test |
| AC-8 | 連携解除→再発行→再紐付けの後、選択が保持され、新グループへ改めて送信される | auto-test |
| AC-9 | 要綱の選択・保存・再送 Server Action は admin / vice_admin 以外を拒否する | auto-test |
| AC-10 | `LINE_NOTIFY_DRY_RUN=1` のとき要綱送信は実 push を行わない | auto-test |
| AC-11 | 既存の `broadcastMailToEvent`（全メール自動配信）・`generateInviteCodeForEvent`・紐付けライフサイクルの挙動は不変（既存テスト green） | auto-test |
| AC-12 | 既存テスト・lint・typecheck がすべて成功する | auto-test |
| AC-13 | 実機で、要綱を選択した大会の紐付け完了時に、要綱リンクがLINEグループへ届く | manual |

（内訳: auto-test 12 / manual 1）

## 5. Non-goals（今回やらないこと）

- 要綱の画像インライン化（署名URLリンクに統一。撤廃済みの添付画像化経路は再導入しない）。
- 要綱内容のAI要約・整形・OCR。
- 案内メール**本文**の送信（本文は既存の全メール自動配信／手動再配信の担当。今回はファイルのみ）。
- 紐付け前の関連メール全体のバックフィル（選択した要綱ファイルのみが対象）。
- 添付以外（メール本文・外部URL・自由入力ファイル）の要綱指定。
- `linked` 後にモーダルを使った選択内容の編集（変更は連携解除→再発行で対応。`linked` 中の操作は「再送」のみ）。
- スケジュール送信・時刻指定。

## 6. 技術的制約・契約

- **既存挙動の互換性**: `broadcastMailToEvent`（全メール配信）、`generateInviteCodeForEvent`、webhook の紐付け遷移（CASガード）、`event_broadcast_messages` の冪等制約は変更しない。要綱送信はこれらと独立した経路として追加する。
- **監査の分離（契約）**: 要綱送信の記録に `event_broadcast_messages`（`UNIQUE(broadcast, mail_message_id)`）を**流用しない**。案内メールの後続 full-mail 配信と衝突・上書きし、role別カウンタの意味も壊れるため。要綱送信は独自の保存先（列 or 別テーブル）を持つか、記録しない。
- **選択の保存先（契約）**: 添付の複数選択＋FK整合＋添付削除時のカスケードを踏まえ、選択は `event_line_broadcasts` に紐づく形で保持する（具体のテーブル/列は技術計画で確定）。招待コード再発行が `event_line_broadcasts` 行をリセットしても選択は失われないこと。
- **署名URL経路の再利用**: 送信は既存の `getOrCreateShareToken` / `attachment_share_tokens`（60日）／`/api/line-broadcast/attachments/[token]` を用いる。新規の公開エンドポイントは作らない。
- **runtime制約**: 送信ロジックはwebhook（`runtime='nodejs'`）と手動紐付けの両方から呼ばれる。webhookハンドラを不必要に重くしない（heavy依存を巻き込まない）。
- **push制御**: 既存の `pushMessages` と同じバッチ/リトライ/`LINE_NOTIFY_DRY_RUN` 規約に従う。
- **セキュリティ・権限**: 選択系Server Actionは `requireAdminSession` 相当のガード必須。webhook送信は署名検証済みチャネル経由のみ。
- **未解決の技術論点（技術計画へ申し送り）**:
  1. 選択保存先を `event_line_broadcasts` の配列列にするか、join テーブル（`event_broadcast_guideline_attachments` 等）にするか（多選択＋FKカスケード観点で後者が有力）。
  2. 要綱送信ヘルパーの置き場（既存 `line-broadcast.ts` に薄く追加するか、webhook向け軽量モジュールを新設するか）。
  3. モーダルへの候補添付の受け渡し方法（`generateInviteCodeForEvent` の返却拡張 vs 別ローダーAction）。
  4. 要綱送信の監査を残すか（`event_line_broadcasts.guidelines_sent_at` 等の軽量記録 or 無し）。

## 7. 設計判断の根拠

- **紐付け完了時トリガー／push方式**: 紐付け成功のackは単発の replyToken で消費されるため、要綱は別途 push で送るしかない。必然的に紐付け成立**後**の best-effort になる。
- **署名URLリンクに統一**: 既存の添付配信（§3.4で画像化を撤廃済み）と揃え、pdfjs/libreoffice/sharp の変換失敗面を持ち込まない。要綱は「クリックで開く」形になるが運用上十分と判断。
- **選択UIを招待コードモーダル内に置く**: ユーザーの操作モデル（アプリ側の紐付け操作＝招待コード発行の場で要綱も決める）に一致。選択自体はDB永続化し、webhook紐付け・手動紐付けの両方が消費する。
- **監査を `event_broadcast_messages` と分離**: 同テーブルはメール単位配信の冪等・role別カウンタ用。要綱（案内メールの一部ファイルのみ）を同じキーで記録すると full-mail 配信と衝突するため独立させる。
- **新規featureディレクトリ**: 機能仕様の正典は `docs/spec/notifications.md` に移行済みで、旧 `event-line-broadcast/requirements.md` は履歴。プロジェクトの `-refinements` 系deltaと同じく本機能も独立ディレクトリ＋独自ACで持つ。

## デザインへの宿題（→ /design-screen broadcast-guidelines-on-link）

- 招待コード発行モーダル内の「要綱ファイル選択」リストのレイアウト（メール別グルーピング／チェックボックス／ファイル名・サイズ・件名の情報密度／モバイル375px）。既存モーダル（コード表示＋手順ol）との縦積みの収まり。
- 選択できる添付が無い場合の空状態表示。
- `LineBroadcastSection` の `linked` 表示に足す「要綱: N件選択済み（最終送信）」行と「要綱を再送」ボタンの配置。
