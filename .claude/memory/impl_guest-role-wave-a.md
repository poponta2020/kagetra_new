---
name: impl-guest-role-wave-a
description: guest-role Wave A
type: project
---

# guest-role Wave A（タスク3・4・5）実装記録

worktree: `C:/tmp/impl-guest-role`。Wave A = task-implementer 3体並行（profile の max_workers: 3 が手順書の「7並行」より優先）。`worker_verify: none` でワーカーはテストを書くだけ・実行は main がバリア後に直列。

- タスク3（#483・985173a）招待リンク種別 + 3項目登録。`registerViaInvite` はトークンから `kind` を引き直して分岐。ゲスト分岐は PII 列を一切書かない。招待種別は `user_role` 再利用でなく専用 union（リンクから admin を作れない）
- タスク4（#484・c51506a）ナビ2タブ・設定は表示のみ・`/` の着地先振り分け
- タスク5（#485・c05ca96）大会詳細。`isBeforeDeadline` 1変数のバイパスで回答可否と理由表示が同時に直る。`submitAttendance` にも対の判定。参加費はゲスト時に**計算自体をスキップ**（JSX 条件分岐だと RSC payload に載る）

## ★バリアで main が直した3件（ワーカーが検出できない類）

1. **`describe` ごとの `afterAll(closeTestDb)` が後続 describe のプールまで閉じる**。`register/[token]/actions.test.ts` に2つ目の describe が足された結果 `Cannot use a pool after calling end on the pool` で8件失敗。**ファイル単位の afterAll へ集約**して解消。同じ形（DB を使う describe が1ファイルに複数）を今後も踏むので注意。
2. **`return` でなく `await finishRegistration(now)` で終わる関数は TS が到達不能と扱わない**（`Promise<never>` を await しても制御フロー解析は効かない。元コードは末尾が `redirect()` 直書きだった）。`TS2366 Function lacks ending return statement`。**ワーカーには eslint しか許可していないので typecheck 由来の失敗は必ずバリアで出る**、という前提で運用すること。
3. **未定義 Tailwind トークン `text-ink-1`**（`--color-ink-1` は globals.css に無い）。新規ゲスト設定画面で使われていたので `text-ink` へ。既存24箇所は本件スコープ外として spawn_task 化。

## ★要件書の記述ミスを2件訂正

- S3「会員5タブ」→ member-mail-search でメールタブが一般会員へ開放される前の記述。実装に合わせ「会員・管理者とも6タブ」へ訂正（AC-8 自体はゲスト側しか規定していないので AC は無傷）
- 手順書タスク2「既存の middleware テストが回帰しない」→ **middleware のテストは存在しなかった**。新規作成した

## AC の追加担保（手順書に owner が無かったもの）

- **AC-28**（通知）: 実装変更ゼロ。個人宛 LINE 通知は実装が存在せず、Web Push は送信側3経路すべて `role IN (admin, vice_admin)` のアローリスト。送信側（mail-worker）と購読側（settings/notifications action）の両方に回帰テストを入れた（2a872bf）
- **AC-36**（`/api/auth/session` へ `viewAsRole='guest'` を直接送る）: 純関数テストだけでは jwt callback の `requested !== 'guest'` ガードを通らない。`auth-config-callbacks.test.ts` に jwt / session 両層のケースを追加（2a872bf）
- **AC-29**（退会済みゲストは回答できない）: `submitAttendance` に退会判定は無く、`node-jwt-callback` がセッションごと無効化する構造で担保されている（会員と同じ）。回答側に判定を足すと二重管理になるので、**node-jwt-callback 層で固定**した（c05ca96）

## ★`/admin/entries` の単段防御（Wave B タスク6へ追加スコープ）

PR #378 で role 判定が外れ、認可境界が `session.user.id` の有無だけになっている。要件 §6 が名指しで警告している「ログイン済み会員なら誰でも」の実例で、middleware 単独防御では降格直後の stale JWT が素通りする。タスク6の追加スコープとして Node 側ガードを指示した。
