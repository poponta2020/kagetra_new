---
name: impl-annual-registration-renewal-task10
description: 年度確認 タスク10（docs・忠実度ゲート）
type: project
---

annual-registration-renewal タスク10（docs・忠実度ゲート）完了。コミット 28e1133。ブランチ feature/annual-registration-renewal（124 ファイル・+23707 行）。リポジトリ内 10 タスク（T1-T10）すべて完了。T11（match-tracker の複数アプリ対応＋メンション）は別リポジトリ・別レーンで未着手。

docs: docs/spec/membership-renewal.md 新設＋SPECIFICATION.md 索引、ui-shell.md の設定ハブに会 LINE グループ追記（notifications.md はタスク4 で、features/INDEX.md は初回コミットで反映済み）。

★忠実度ゲート（design-spec §8）: 13 項目中 **12 項目をコード照合で確認**。トークンは globals.css で --kg-* と --color-* の値が一致することを確かめてから Tailwind ユーティリティ名で照合した（例: --kg-fg-muted #9995a7 == --color-ink-muted → text-ink-muted）。**375px の横スクロール無しだけ未確認**（静的照合では判定不可・ブラウザ検証は方針上行わない）。design-spec の該当行に未確認の理由を書き残した。

★監査: PII/トークンのログ出力 0 件。モックの仮データ混入も無し（S3 の placeholder 文言とコメントの例示のみ）。

★残 DoD（出荷後の人手作業）:
1. **infra/sudoers/kagetra-deploy の本番反映はマージ前に手作業**（未反映のまま unit を含む PR をマージすると auto-deploy が install で sudo に蹴られて必ず fail する）
2. .env.production へ LINE_CHAT_WORKER_TOKEN 投入＋restart → curl で 401/403/200
3. S3 で会 LINE グループを設定（Bot 招待→発言→OAM の URL 貼り付け→join でグループ ID 捕捉）
4. match-tracker 側の APPS_JSON 対応（未デプロイの間はタスクが PENDING のまま残るだけで壊れない）
5. AC-28（375px 実機）・AC-30/31/32（本番送信・PoC）
手順は docs/deploy/annual-registration-renewal.md。
