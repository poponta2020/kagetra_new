---
name: impl-event-line-broadcast-ship
description: event-line-broadcast 全機能 ship 完了 (2026-05-31)。PR
metadata: 
  node_type: memory
  type: project
  originSessionId: bdf544e9-cf0c-4681-90d4-e0b0d2b2c4aa
---

# event-line-broadcast 全機能 ship 完了

## 状態 (2026-05-31)
- **PR #65 merge 済み** (`50f4574`、main HEAD)
- 親 Issue #54 + 子 #55-#63 すべて自動クローズ
- ブランチ `feature/event-line-broadcast-schema` 削除済み (リモート + ローカル)
- worktree 削除済み

## 実装サマリー
- スキーマ: enum 3 + 新規 3 テーブル + line_channels 拡張、migration 0013-0015
- Bot プール 30 個 + 招待コード方式 (6 桁数字 + 30 分 + 1 回限り) + 1 大会 1 グループ
- 大会終了 +30 日経過で自動解放 (JST)、UI 上の expectedEventId による stale 防御
- 訂正版【訂正】prefix を split 前に結合
- LINE push: 5 件/batch + 1.5 秒間隔 + 429 Retry-After + 30s タイムアウト
- sharp で original 4096px / preview 240x240 リサイズ
- pdftoppm + libreoffice で PDF/Word 画像化、Excel は 60 日署名 URL
- force=true 強制再送、partial/failed の skip prefix で重複配信防止
- audit CAS + stale sending reclaim + binding 再検証

## レビュー実績
- Codex auto-review-loop を **22 ラウンド完走** (中断・再開混じり)
- **blockers=0 達成 8 回** (R6/R11/R12/R15/R17/R18/R21/R22)
- 累計 **CRITICAL 43+ + WARNING 64+** に対応
- Vitest **85 ケース pass**、Playwright E2E **11 ケース pass**
- CI 2 段階修正: lockfile + E2E spec の seedAdminSession 戻り値

## Why
mail-tournament-import の下流として「メール承認 → events 登録 → LINE 自動配信」のラストワンマイルを完成させた。年 10 大会程度の利用を想定し、Lightsail / Oracle Cloud Always Free 環境で月数十通の push 配信を行う設計。

## How to apply
- 本番デプロイは [docs/deploy/event-line-broadcast.md](docs/deploy/event-line-broadcast.md) 通り (poppler-utils + libreoffice + LINE 30 Bot 作成 + seed + systemd timer + .env.production に PUBLIC_BASE_URL)
- 本番運用開始後の追加機能 (例: 配信内容の AI 整形 / 既読確認) は v2 で別途

## 関連
- PR: https://github.com/poponta2020/kagetra_new/pull/65
- 要件定義書: docs/features/event-line-broadcast/requirements.md
- 実装手順書: docs/features/event-line-broadcast/implementation-plan.md
- デプロイ手順書: docs/deploy/event-line-broadcast.md
- [[project-event-line-broadcast]] — 要件定義段階のメモ
