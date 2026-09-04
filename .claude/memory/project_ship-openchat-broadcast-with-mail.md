---
name: ship-openchat-broadcast-with-mail
description: オープンチャットの配信をメール本文・添付と同じタイミングに揃える
type: project
---

オープンチャットの配信をメール本文・添付と同じタイミングに揃える — PR #553（https://github.com/poponta2020/kagetra_new/pull/553）。マージ成功（2026-09-04）。

## 何を変えたか

抽出シートの「保存して配信」がその場で LINE へ push していたため、オープンチャットの Flex だけが本文・添付より先に単独で届いていた。**抽出シートを保存専用にし、配信をメール詳細の「LINE 配信」（processMail の after()）へ相乗り**させて1回の配信にまとめた。

- `lib/open-chat/broadcast.ts` を新設し配信の実処理（`runOpenChatBroadcast`）を `'use server'` の外へ（保存経路・再送ボタン・processMail の3者で共有）
- `saveAndBroadcastOpenChats` → **`saveOpenChats`（保存専用）**。broadcast オプションと戻り値の broadcast フィールドを廃止
- 統合処理フォームに子チェック「オープンチャットの招待リンクも送る（N件）」。既定は **未配信なら ON／配信済みなら OFF／配信済みでも前回配信より後に増えた行があれば ON**（AC-35 の確認ダイアログの代替）
- `processMail` に `includeOpenChat`。世代トークンガードの中で本文配信の直後に push（try は分離）
- ★**再送導線を新設**: `/admin/entries/[groupId]` の `OpenChatBroadcastControl`（管理者のみ・全件ラベル列挙の確認ダイアログを移植）。統合処理フォームは未処理メールにしか出ず「未処理に戻す」は名簿採用まで取り消すため、配信失敗時のやり直しはここが唯一の口
- `loadOpenChatBroadcastSummary` に `lastAttempt` を追加し、after() へ移して呼び出し元へ返せなくなった失敗を画面に出す
- `event_broadcast_messages` に書かない契約（requirements §6）は維持

## Codex レビューで直した実害（計6件の blocker）

いずれも「二重配信」か「黙った配信漏れ」に直結:
1. 本文配信の待機中（画像化・添付処理で数十秒）に取り消してもオープンチャットだけ届く → 世代確認を `isCurrentGeneration()` に切り出し、**push の直前まで持ち越す**（配信ヘルパーに `abortBeforePush` を追加）
2. サマリー読み込み中に旧グループの件数で「実行する」を押せる → 大会切替で同期的に破棄＋読み込み中は実行不可
3. サマリー取得に失敗したまま実行できて黙って配信漏れ → 理由と「再読み込み」を出して実行を止める
4. 再送ボタンで配信成功後にサマリー再取得が失敗すると、次の押下が再配信確認を迂回して二重配信 → 成功時にローカルで配信回数を進める
5. `loadOpenChatBroadcastSummary` が集計と直近1件を別クエリで引くため「broadcastCount=0 なのに lastSentAt は配信済み」の矛盾したサマリーを返し得た → **1クエリの単一スナップショット**から算出
6. （2 の初期修正）

## 見送った指摘（WONTFIX 3件）→ Issue #565

- 配信枠を原子的に claim しないため二重 push（マイグレーション必須）
- 「未配信の行」判定が `created_at > 直近 sent_at` の時刻比較（マイグレーション必須）
- `abortBeforePush` の SELECT 直後〜`pushMessages` 開始までの残 TOCTOU（正規の修正が外部 HTTP をまたぐ FOR UPDATE 行ロックになるため）

## レビュー

4R（initial=sol/high → delta=terra/medium → final=sol/medium → final-delta=terra/high）、終了理由 cutoff（user-wontfix）、累計 526,030 トークン。**修正したが再レビューしていない指摘は無い**（R3 の修正は R4 の delta で確認済み。R4 の残 1 件は見送り確定）。CI green（Lint/Typecheck/Test）を確認してマージ。

## 残 DoD

- 本番実機確認: メール処理でオープンチャット＋本文が1回の配信としてグループへ届くこと／配信失敗後に申込グループページから再送できること
