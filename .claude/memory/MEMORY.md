# Memory Index

## User
- [ユーザープロフィール](user_profile.md) — 競技かるた会運営者、1人開発、品質重視、札幌在住、家と会社の2環境

## Project
- [設計判断まとめ](project_kagetra_new_design.md) — 技術選定の却下理由、ドメインルール（未回答=不参加、締切の使い分け等）
- [/self-identify 本人性検証は実装しない](project_self_identify_verification_pending.md) — 身内アプリのためリスク受容で確定（2026-04-22）。外部公開時のみ再検討
- [PR#6 フォントウェイト方針](project_pr6_font_fix_r2.md) — Noto JP は実使用ウェイトのみ、serif は preload:false
- [本番デプロイ計画 (Phase A-D)](project_production_deploy.md) — Oracle Cloud Always Free 東京 + new.hokudaicarta.com サブドメイン分離 + Cloudflare R2 backup。**Phase A-D 全 ship 完了 (2026-05-22)**、本番稼働中、旧 kagetra と並行稼働、データ移行と cutover は Phase 4 完了後に別 PR
- [PWA 最小対応 ship 完了](project_pwa_minimal.md) — PR #49 merge + 本番反映 + iPhone 実機 standalone 起動 OK (2026-05-25)、#43/#44-#48 全 close
- [モバイルシェル固定 PR #64+#66+#67 ship、本番反映 #67 待ち](project_sticky_mobile_shell.md) — PR #64 `cdba79d` + PR #66 `6b980f2` + PR #67 `69c64b0` (border-box height fix)、Issue #51✅/#52✅、#50/#53 は #67 本番反映+実機 OK 後にクローズ
- [event-line-broadcast 要件定義済み](project_event_line_broadcast.md) — Issue 親#54/子#55-#63、`docs/features/event-line-broadcast/`、mail-tournament-import 下流、Bot プール 30 個 + 招待コード方式、`/implement event-line-broadcast` で着手可
- [event-line-broadcast 全 9 タスク完了 (#55-#63)](impl_event_line_broadcast_task1.md) — feature/event-line-broadcast-schema (b6a11cc..c47721d, 9 commits) push 済み、worktree C:/tmp/impl-event-line-broadcast、PR 作成・本番デプロイ未実施

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
- [jsdom が CSS env() inline style を捨てる](feedback_jsdom_css_env.md) — vitest 環境では `style={{ paddingBottom: 'env(...)' }}` は消える。Tailwind arbitrary value `pb-[env(...)]` で書け
- [flex + overflow-y-auto には min-h-0 が必須](feedback_flex_min_h_0_for_overflow.md) — `flex-1 overflow-y-auto` だけだと flex item デフォルト `min-height: auto` で親を突き抜けて body スクロール化。常に `min-h-0` を同時指定
- [Tailwind min-h-* + p-* は border-box で padding が算入される](feedback_tailwind_min_h_border_box.md) — `min-h-[52px]` + `pb-[env(...)]` だとコンテンツ 18px に圧縮。`min-h-[calc(52px_+_env(...))]` で合算必須
- [Tailwind arbitrary value 内のスペースは `_` でエスケープ](feedback_tailwind_arbitrary_underscore_space.md) — `calc(a+b)` のままだと CSS spec 違反で Safari が無効化。`calc(a_+_b)` で実 CSS の空白に展開
