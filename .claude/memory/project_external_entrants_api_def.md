---
name: feature-def-external-entrants-api
description: external-entrants-api 要件定義
type: project
---

# external-entrants-api 要件定義（2026-08-13）

正典: docs/features/external-entrants-api/requirements.md（AC §4・11件すべて auto-test）/ implementation-plan.md（4タスク・2 Wave）

## 何を作るか

match-tracker の月次練習会抽選（/admin/lottery・優先選手指定）で大会出場予定者をデフォルト選択できるようにするための、kagetra 側データ提供 API。guest-role（PR #489）に明記されていた「match-tracker 連携（出場予定者）」の連携本体。

## 主要な設計判断（ユーザー確認済み）

- **スコープ=kagetra側+契約のみ**。取得・名寄せ・デフォルト選択UI・失敗時フォールバックは match-tracker リポジトリで別途要件定義
- **役割分担が核**: kagetra は「事実」（誰が・いつ・どの大会に出るか）のみ返し、優先枠ウィンドウ判定（n月+翌月15日ルール）は消費側のポリシーとして持たせない → 15日ルールが変わっても kagetra 無改修
- **ライブAPI**（external-players-sync 型の SSH 日次複製は不採用）: 抽選は手動実行なので開いた瞬間の鮮度が価値。ホーム dashboard の導出（テスト済み）を共通モジュール化して再利用し、生SQL二重実装の乖離を回避
- **母集団=ホーム出場タイムラインと同一**（確定名簿優先・補欠/落選除外・出欠 attend=true フォールバック・ゲストは出欠から合流・個人戦のみ・中止除外）。期間は当月1日(JST)以降・終点なし
- **人単位レスポンス**: {userId, name, familyKana, givenKana, grade, isGuest, entries:[{eventId, eventDate, displayName, confidence(confirmed|hoped)}]}。PII（電話・生年月日・住所・メール）非含有
- **認証=静的APIキー**（EXTERNAL_ENTRANTS_API_KEY・Authorization: Bearer・fail-closed）。middleware matcher から api/external を除外しルート内検証（LINE webhook と同型）

## deep-advisor 相談の収穫（設計そのまま採用+修正）

- **空文字キーの一致罠**: env 空文字 × 空 Bearer で '' === '' が素通り → 比較前に if (!expected) return 401 必須・テスト固定
- env は**ハンドラ関数内で読む**（モジュールトップはビルド時固定）。本番は systemd EnvironmentFile で実行時読み → キー未設定でも常に 401 なのでコード先行出荷が安全（デプロイ順序制約なし）
- 共有モジュールの entrant は entryGrade（名簿行の級）と userGrade（現在の級）を**分離保持**（dashboard チップは entryGrade ?? userGrade、API の grade は userGrade — 混ぜると契約が壊れる）
- キー比較は verifyLineSignature と同形（長さ early return → try/catch 内 timingSafeEqual）。キーは URL クエリ渡し禁止（nginx access log に残る）
- 将来のキーローテはカンマ区切り複数キー許容で無停止化できる（今は1本）

## Issue

- 親 #490 https://github.com/poponta2020/kagetra_new/issues/490
- 子 #491（タスク1: 導出共通モジュール化・Wave1 単独先行）/ #492（タスク2: API ルート・#491 依存）/ #493（タスク3: middleware+env example）/ #494（タスク4: docs/spec/external-api.md 新設）。Wave 2 = #492/#493/#494 並行

## 残 DoD（ship 後）

本番 .env.production へ EXTERNAL_ENTRANTS_API_KEY 追記（openssl rand -base64 32）+ kagetra-web.service restart + curl 401/200 確認。match-tracker 側へのキー共有（Render env var）はあちらの実装時
