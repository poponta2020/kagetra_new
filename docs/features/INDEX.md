# Features Index

- `remove-schedule` — 大会以外の予定タブ・画面を廃止し、大会特化の提供範囲へ整理する。対象範囲: apps/web, packages/shared, docs。

<!-- 規約: 1スラッグ=1行。/define-feature が作成時に、/ship が出荷時に末尾へ追記・更新する。並べ替え禁止。 -->
<!-- 初期生成（2026-07-11）分はアルファベット順。以降は末尾追記。 -->

- `admin-member-create` — 管理者による会員の手動作成（LINE未連携会員の事前登録）（主要領域: apps/web）
- `ai-dev-optimization` — AI開発最適化 — 全体仕様書のドメイン分割新規作成・docsレジストリ・診断スクリプト整理（主要領域: docs, scripts, apps/web）
- `broadcast-lead-message` — LINE一斉配信にリード文（プリセット+自由文）を付加する機能（主要領域: apps/web）
- `broadcast-guidelines-on-link` — 大会LINE紐付け完了時に、選択した要綱ファイルをグループへ自動送信（招待コードモーダルで添付選択）（主要領域: apps/web, packages/shared）[shipped: PR #284]
- `bulk-result-import` — 過去大会結果の一括投入（開催×級identity・訂正版優先dedup・リハーサル+冪等+read-back）（主要領域: scripts, apps/web）
- `entry-notify-lottery-treasurer` — 大会申込の確定時に参加者と会計係へLINE通知を送る機能（主要領域: apps/web, packages/shared）
- `event-lifecycle-notify` — イベントの申込開始・締切等ライフサイクルをBotが自動通知（主要領域: apps/web, packages/shared）
- `event-line-broadcast` — 承認済み大会案内メールのLINEグループ自動配信（主要領域: apps/web, apps/mail-worker）
- `event-list-refinements` — イベント一覧の締切ソート・残日数3段階表示・申込可能フィルタ（主要領域: apps/web）
- `invite-link-registration` — 招待リンクによる会員セルフ登録→LINEログイン完結（主要領域: apps/web, packages/shared）
- `invite-register-redesign` — 招待URL会員登録のリデザインとプロフィール項目拡張（主要領域: apps/web, packages/shared）
- `mail-body-as-image` — メール本文をA4 JPEG画像化して安全に表示（主要領域: apps/web, apps/mail-worker）
- `mail-inbox-mailer` — 受信箱のメーラーモデル化（機能定義のみ・実装未着手）（主要領域: apps/web）
- `mail-tournament-import` — 大会案内メールのIMAP取込→Claude API振り分け→管理者承認（主要領域: apps/mail-worker, apps/web）
- `mail-triage-badge` — メール振り分けの承認待ち件数をPWA/アプリ内バッジ表示（主要領域: apps/web）
- `player-display-name-mode` — 選手表示名を出場記録の最頻表記へ自動再計算（主要領域: apps/web, packages/shared）
- `player-search-redesign` — 選手検索一覧のリデザイン（derived_bracket再利用・直近所属表示）（主要領域: apps/web）
- `player-tournament-shortname` — 選手検索・戦績詳細の大会名を通称+本人出場級表示へ変更（主要領域: apps/web）
- `pwa-minimal` — PWA最小対応（manifest・iPhone standalone起動）（主要領域: apps/web）
- `senseki-detail-redesign` — 戦績詳細画面のリデザイン（順位は対戦記録から導出）（主要領域: apps/web）
- `senseki-ranking-drilldown` — ランキングから選手検索一覧へのドリルダウン絞り込み（主要領域: apps/web）
- `senseki-ranking-refinements` — 統計ランキング改修5件（デフォルト直近5年/A級・現級母集団+昇段者トグル等）（主要領域: apps/web）
- `senseki-stats` — 戦績→統計タブ再編・4セクション化（derived_bracket基盤）（主要領域: apps/web, packages/shared）
- `senseki-stats-refinements` — 統計delta改修4件（大会通称short_name新設・現級から直近優勝除外等）（主要領域: apps/web, packages/shared）
- `settings-sheet` — 設定ボトムシートとAccountMenuの新設（主要領域: apps/web）
- `stats-grade-population` — 大会統計への級別競技人口サマリー追加（1人=1級方式）（主要領域: apps/web）
- `sticky-mobile-shell` — ヘッダー・ボトムナビ固定のモバイルシェル（主要領域: apps/web）
- `tournament-entry-rosters` — 大会ライフサイクル基盤（edition）+申込/確定名簿（主要領域: apps/web, packages/shared）[shipped: PR #292]
- `tournament-results` — 大会結果の取込・承認・materializeとパーサ基盤（主要領域: apps/web, apps/mail-worker, packages/shared）
- `tournament-title-grade-split` — 大会イベントのタイトル・級の分離入力（主要領域: apps/web, packages/shared）
- `tournament-lottery-trends` — 大会系列ごとの申込者数・倍率推移とA級の出場回数別当落線を表示する（主要領域: apps/web, apps/mail-worker, packages/shared）[shipped: PR #304]
- `entry-overdue-alert` — 会内締切超過の未申込大会を管理者個人LINEへ毎朝アラート＋進行管理に「申込なし」を追加（主要領域: apps/web, packages/shared）[shipped: PR #312]
- `event-grade-group-broadcast` — 新規大会の概要を級別LINEグループへ自動配信（主要領域: apps/web, packages/shared）[shipped: PR #321]
- `entry-management` — 管理者向け大会申込進捗ボード（7エリア自動仕分け）＋ボトムナビ導線（主要領域: apps/web）
