# Memory Index

## User
- [ユーザープロフィール](user_profile.md) — 競技かるた会運営者、1人開発、品質重視、札幌在住、家と会社の2環境

## Project
- [設計判断まとめ](project_kagetra_new_design.md) — 技術選定の却下理由、ドメインルール（未回答=不参加、締切の使い分け等）
- [/self-identify 本人性検証は実装しない](project_self_identify_verification_pending.md) — 身内アプリのためリスク受容で確定（2026-04-22）。外部公開時のみ再検討
- [PR#6 フォントウェイト方針](project_pr6_font_fix_r2.md) — Noto JP は実使用ウェイトのみ、serif は preload:false
- [本番デプロイ計画 (Phase A-D)](project_production_deploy.md) — Oracle Cloud Always Free 東京 + new.hokudaicarta.com サブドメイン分離 + Cloudflare R2 backup。**Phase A-D 全 ship 完了 (2026-05-22)**、本番稼働中、旧 kagetra と並行稼働、データ移行と cutover は Phase 4 完了後に別 PR
- [PWA 最小対応 ship 完了](project_pwa_minimal.md) — PR #49 merge + 本番反映 + iPhone 実機 standalone 起動 OK (2026-05-25)、#43/#44-#48 全 close

## Reference
- [旧kagetra DBダンプ](reference_legacy_dump.md) — scripts/migration/dump/myappdb.dump、旧データ構造リファレンス
- [ローカル動作確認セットアップ](reference_local_dev_setup.md) — docs/dev/local-dev-setup.md がエントリーポイント、env 配置・Cookie 注入 vs 実 LINE・mail-worker 実 API テスト・コスト目安
- [旧 kagetra インフラ構成 (Lightsail + Route 53)](reference_legacy_kagetra_infra.md) — `hokudaicarta.com` の DNS は Lightsail DNS ゾーン (裏で Route 53)、お名前.com Navi の DNS 設定では効かない

## Feedback
- [開発ルール11条](project_dev_rules.md) — 実装前確認・テストファースト・セッションプロトコル・DoD等
- [メモリ運用ルール](feedback_memory_management.md) — 何を書く/書かない、セッション終了時の同期手順、肥大化防止
- [Auth.js v5 JWT strategy の user.id 罠](feedback_auth_js_jwt_strategy_user_id.md) — adapter なしだと毎回ランダム UUID。OAuth sub は account.providerAccountId から
- [/ship の main 直 push は事前承認済み](feedback_main_push_authorized_for_ship.md) — worklog/memory 同期 commit は確認なしで `git push origin main` 実行可。1人開発・身内プロジェクト前提
- [autonomous-loop sentinel の解釈](feedback_autonomous_loop_scope.md) — `<<autonomous-loop-dynamic>>` は実装 GO ではない。CLAUDE.md ルール 1 は autonomous でも有効
- [Windows worktree のパス罠](feedback_windows_worktree_path.md) — `/tmp` は git/pnpm が `%TEMP%`、Write/Read は `C:/tmp` を参照して別ディレクトリになる。worktree は最初から `C:/tmp/...` で明示作成
