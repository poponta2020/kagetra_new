# kagetra_new — 仕様書（ハブ）

> このファイルは索引（ハブ）。機能仕様の本文は `docs/spec/` のドメインファイルが正典。
> 更新規律（どの事実をどのファイルに書くか）は `.claude/project-profile.md` の `## docs` を参照。

## システム概要

### 目的

競技かるた会向け総合グループウェア（poponta2020/kagetra の完全リプレイス）。
大会申込イベントの出欠・進行管理、大会案内メールの AI 取込と LINE 配信、大会結果の取込・戦績/統計の閲覧、会員管理を行い、大会運営を1つのアプリに集約する。

会の規模・技術スタック・リポジトリ構成・本番環境はリポジトリルートの `CLAUDE.md` が正典（本ファイルでは繰り返さない）。

### 対象ユーザー

会員全員が利用する。ロールは3層（admin / vice_admin / member）で、管理系画面・操作は admin / vice_admin に限定される。
ロール定義・認証方式は [spec/auth-admin.md](spec/auth-admin.md) を参照。

## ドメイン別仕様（正典）

改修時は該当ドメインのファイルだけを読めばよい。各ファイルは「機能仕様 → 画面 → フロー → API」の構成で、冒頭のメタブロックに責務・関連画面・主要実装パスを持つ。

| ドメイン | 責務 | ファイル |
|---|---|---|
| イベント・出欠 | 大会申込イベントの一覧・作成/編集・出欠回答・進行管理（申込/支払い）・申込進捗ボード・アーカイブ | [spec/events-attendance.md](spec/events-attendance.md) |
| 大会・結果取込 | 大会結果（Excel/HTML）の取込・承認・materialize、大会一覧/詳細、系列（series/edition）解決、参加名簿取込 | [spec/tournaments-results.md](spec/tournaments-results.md) |
| 選手 | 選手の名寄せ（姓名キー）・display_name・検索一覧・戦績詳細・会員とのセルフ紐付け（self-identify） | [spec/players.md](spec/players.md) |
| 統計 | 選手ランキング・大会統計（フィルタ正規化・集計・チャート描画） | [spec/stats.md](spec/stats.md) |
| 認証・会員管理 | LINE 認証（Auth.js v5・招待制）・RBAC 3層・招待リンク登録・会員管理 | [spec/auth-admin.md](spec/auth-admin.md) |
| メール取込 | IMAP 取込・AI 大会案内抽出・管理者承認・受信箱 UI・添付プレビュー配信 | [spec/mail-worker.md](spec/mail-worker.md) |
| 通知・LINE・Push | 大会単位 LINE グループ配信（Bot プール）・ライフサイクル通知・LINE アカウント切替・Web Push バッジ | [spec/notifications.md](spec/notifications.md) |
| UI シェル | 共通外枠（ボトムナビ）・PWA・設定ハブ（`/settings`）・モーダル/ボトムシート CSS 規約 | [spec/ui-shell.md](spec/ui-shell.md) |

## 横断ドキュメント

| 内容 | ファイル |
|---|---|
| データベース設計（テーブル定義の SSOT。Drizzle スキーマから生成） | [design/db.md](design/db.md) + db-tables-*.md |
| UI デザインシステム・トークン | [design/design.md](design/design.md) ほか docs/design/ |
| アーキテクチャ・技術スタック・リポジトリ構成 | リポジトリルート `CLAUDE.md`・`apps/web/CLAUDE.md` |
| 過去の改修履歴（機能別） | [features/INDEX.md](features/INDEX.md) |
| 開発プロセス | [dev/feature-flow.md](dev/feature-flow.md) |
| モデル委譲 | [dev/model-delegation.md](dev/model-delegation.md) |
| ローカル開発環境 | [dev/local-dev-setup.md](dev/local-dev-setup.md) |
| 本番結果データ品質の台帳 | docs/data-quality/ |

## 書き込み規律（要約）

- 1つの事実は1ファイルにのみ書く（重複掲載の禁止）。更新は該当セクションの in-place 書き換え
- 見出しに連番を付けない。実装参照はファイルパス粒度（行番号を書かない）
- 本文への変更履歴の追記禁止（履歴は git と `docs/features/<slug>/` が持つ）
- 詳細なレジストリと更新手順: `.claude/project-profile.md` の `## docs`
