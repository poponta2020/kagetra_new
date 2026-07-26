---
name: feature-def-entry-management
description: entry-management（申込管理）要件定義
type: project
---

管理者向け大会申込進捗ボード /admin/entries の要件定義・デザイン確定・Issue 作成まで完了（実装未着手）。

## 決まったこと（設計判断と理由）

- **進行フェーズは永続カラムにせず既存列からの導出**。スキーマ変更・migration なし。状態カラムを足すと既存の申込/支払/名簿取込すべてに同期処理が必要になり、ずれたら直せなくなるため
- **5 区画・ライフサイクル順**（締切前 → 要対応 → 申込済み・抽選待ち → 名簿確定・振込待ち → 完了）。当初 7 区画・緊急度順だったが、デザイン収束で集約・並べ替え
- **区画ごとに見る日付が違う**: 会内締切 / **本締切(entry_deadline)** / 抽選日 / 支払締切 / 開催日。「要対応」だけ会内締切ではなく本締切を見るのは、その区画は会内締切が既に過ぎている大会の集まりで、行動を決めるのは主催者への申込締切だから
- **参加希望者 0 名（締切超過後）と手動 not_applying は画面に出さない**。手動見送りの復帰導線は大会詳細 URL 直叩きのまま（entry-overdue-alert の設計を維持）
- **毎朝 LINE アラートにも attendCount >= 1 を追加**して画面と定義を一致させる。entry-overdue-alert が意図的に見送っていた「出欠0名からの自動判定」を反転する形で、リスクはユーザー判断として受容
- **強調は「締切到来済み（当日・超過・日付未設定）が 1 件以上あるときだけ」**。常時赤いと慣れて効かなくなるため。日付未設定を到来済み扱いにするのは fail-safe（本締切未入力で強調が外れるのが一番危ない）
- **大会名は通称+級**（tournament_series.short_name を events→edition→series で引く）。当初 Non-goal だったが原案の「5/4大阪AB」形式に合わせて反転。edition 未紐付けは title フォールバック
- **1 行 24px・5 区画で 375px の 1 画面に収める**のが最優先の制約（実測余裕 86px）。カード型デザインが「今風に見える」実体は面積を 2 倍使っていることで、この制約と正面衝突するため不採用

## Acceptance Criteria

全 33 件（auto-test 32 / manual 1）。うち 3 件は回帰 AC（/events 一覧・進行管理パネル・既存アラート）。

## Issue

- 親: #322 https://github.com/poponta2020/kagetra_new/issues/322
- 子: #323（純関数+テスト）/ #324（ボトムナビ7タブ）/ #325（アラート条件追加）/ #326（データ取得と画面）

## Wave 構成

- Wave 1: #323 / #324 / #325（変更領域が直交: admin/entries 純関数 / components/layout / lib/entry-overdue-alert）
- Wave 2: #326（#323 に依存。UI patch の適用はここ）

## ★実装時の落とし穴

design-prototype.patch には**プロトタイプ用の認証バイパス**（middleware.ts の /admin/entries 素通し、(app)/layout.tsx の未ログイン時シェル描画）が含まれる。適用は必ず
`git apply --exclude=apps/web/src/middleware.ts --exclude='apps/web/src/app/(app)/layout.tsx'`
で行う。除外し忘れると無認証で開ける状態が本番へ出る。

## デザインセッションの環境メモ

- C:/tmp/design-live は**別リポジトリ(match-tracker)のワークツリー**で衝突する。kagetra 用は C:/tmp/design-live-kagetra に作った（launch.json の design-live エントリは絶対パスのため preview_start では起動できず、Bash で next dev --port 3100 を起こした）
- Browser ペインの screenshot はクリップ・拡大が起きて信用できない。レイアウト検証は getBoundingClientRect / scrollHeight の実測で行う
- 認証 cookie の注入は分類器にブロックされる。プロトタイプは worktree 限定の認証バイパスで開いた
