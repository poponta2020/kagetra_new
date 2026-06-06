# Memory Index

## User
- [ユーザープロフィール](user_profile.md) — 競技かるた会運営者、1人開発、品質重視、札幌在住、家と会社の2環境

## Project
- [設計判断まとめ](project_kagetra_new_design.md) — 技術選定の却下理由、ドメインルール（未回答=不参加、締切の使い分け等）
- [/self-identify 本人性検証は実装しない](project_self_identify_verification_pending.md) — 身内アプリのためリスク受容で確定（2026-04-22）。外部公開時のみ再検討
- [PR#6 フォントウェイト方針](project_pr6_font_fix_r2.md) — Noto JP は実使用ウェイトのみ、serif は preload:false
- [本番デプロイ計画 (Phase A-D)](project_production_deploy.md) — Oracle Cloud Always Free 東京 + new.hokudaicarta.com サブドメイン分離 + Cloudflare R2 backup。**Phase A-D 全 ship 完了 (2026-05-22)**、本番稼働中、旧 kagetra と並行稼働、データ移行と cutover は Phase 4 完了後に別 PR
- [PWA 最小対応 ship 完了](project_pwa_minimal.md) — PR #49 merge + 本番反映 + iPhone 実機 standalone 起動 OK (2026-05-25)、#43/#44-#48 全 close
- [モバイルシェル固定 完全完了](project_sticky_mobile_shell.md) — PR #64+#66+#67+#68 ship + 本番反映 + 実機 OK (2026-05-28)、Issue #50/#51/#52/#53 全 close、教訓は 4 つの feedback memory に切り出し済
- [event-line-broadcast 本番運用開始](impl_event_line_broadcast_task1.md) — PR #65 + PR #70 (xlsx MIME fix) merge `d94199f` (2026-05-31)。Oracle Cloud 東京で稼働、2 Bot 運用、1 大会通しテスト成功
- [Codex review effort 自動判定](project_codex_review_effort.md) — PR #69 merge (647aa62)。/auto-review-loop が差分内容で medium/high を auto 判定。~/.codex/config.toml は medium 既定（git 管理外）
- [mail-body-as-image SHIPPED+本番反映](impl_mail_body_as_image.md) — 本文を A4 JPEG 画像で LINE 配信、添付全リンク統一。PR #84 merge `cc6c765`、**本番 `322b3b7` 手動デプロイ済** (2026-06-01)。Issue #73-#78 全クローズ。**後日 PR #94 (`c6a4be6`) で先頭空白ページ修正（libreoffice `--writer`、Issue #93）**。残 DoD=実機 LINE 目視のみ
- [event-lifecycle-notify 機能定義](project_event_lifecycle_notify.md) — Bot を大会ライフサイクル（申込/締切/支払い）通知役に拡張。要件+計画+Issue #79-83。支払いは事前/現地で分岐、通知は紐付け済み参加者グループに集約、once-ever ログで重複防止
- [event-lifecycle-notify SHIPPED](impl_event_lifecycle_notify.md) — PR #85 merge `42e1cef` (2026-06-01)、子#80-83+親#79クローズ。非自明: 自前push・同一tx で状態flip+once-ever claim・scripts を type/test 編入・未紐付けでも slot 消費・payment型変更は状態リセットするが once-ever ログ保持。**本番反映済 (migration 0017 適用 + reminder timer enable, 2026-06-01、auto-deploy 有効化の前提として実施)**。残=実機LINE目視のみ
- [本番自動デプロイ (Actions+SSH) 稼働中](project_auto_deploy.md) — PR #86 merge `7d15042` (2026-06-01)、初回 run 成功(SKIPPED_NOCODE 疎通確認)。main の code 変更 push で自動 build→migration(冪等)→restart、docs のみ skip。kagetra(scoped sudo)へ deploy 鍵で SSH。host 鍵/sudoers/secrets 設定済
- [mail-triage-badge SHIPPED](project_mail_triage_badge.md) — 全メールトリアージ＋PWA未処理バッジ(Web Push)。PR #95 merge `2ca9af2` (2026-06-01)、本番反映 success、Issue #87-92 全クローズ。triage_status 3状態・処理4アクション・既存メール processed 化・準リアルタイム同期。残 DoD=本番 VAPID 鍵設定+iOS 実機バッジ目視
- [tournament-title-grade-split SHIPPED+本番反映](project_tournament_title_grade_split.md) — 大会名を「場所+級」短縮通称化＋開催日ごとイベント分割（mail-tournament-import 拡張）。PR #111 merge `e664b3d` (2026-06-04)、本番反映 success(migration 0020)、親#102+子#103-109 全クローズ。1ドラフト:Nイベント・title合成(stem AI/級A→E連結)・AI抽出2.0.0・FOR UPDATE で承認/再抽出の payload race 直列化(R1-R6)・LINE配信グループ重複排除。残 DoD=実機目視のみ
- [settings-sheet SHIPPED](project_settings_sheet.md) — 設定画面への導線（ヘッダ {name}さん タップ→設定シート AccountMenu）。PR #110 merge `4857787` (2026-06-03)、親#97+子#98-101 全クローズ。design.md §3 未実装仕様の実装、ロール出し分け、ログアウト集約、/settings/notifications を (app) 配下へ移動(URL不変)・line-link は据え置き。残 DoD=実機目視
- [entry-notify-lottery-treasurer SHIPPED](impl_entry_notify_lottery_treasurer.md) — 申込完了通知を2通化（参加者へ抽選日追記＋会計へ振込方法/期限）。PR #118 merge `b64f291` (2026-06-06)、親#112+子#113-117 全クローズ。Codex R1 で pass/0指摘・CI green。同一tx で 2 claim + コミット後独立 try/catch push、cancelled/未紐付けでも対称、金額非表示・payment_type で出し分けず常時送信、承認画面は embedded で抽選日非表示。残 DoD=本番反映後の実機 LINE 目視（migration 0021）
- [mail-inbox-mailer 機能定義](project_mail_inbox_mailer.md) — メール処理を「アプリ＝メーラー」モデルに作り替え。AI 自動分類廃止＋ボタン起動化、triage 2 状態、3 アクション（AI抽出/既存イベント結びつけ/対応不要）。親#119+子#120-126（2026-06-06 定義、実装未着手）

## Reference
- [旧kagetra DBダンプ](reference_legacy_dump.md) — scripts/migration/dump/myappdb.dump、旧データ構造リファレンス
- [ローカル動作確認セットアップ](reference_local_dev_setup.md) — docs/dev/local-dev-setup.md がエントリーポイント、env 配置・Cookie 注入 vs 実 LINE・mail-worker 実 API テスト・コスト目安
- [旧 kagetra インフラ構成 (Lightsail + Route 53)](reference_legacy_kagetra_infra.md) — `hokudaicarta.com` の DNS は Lightsail DNS ゾーン (裏で Route 53)、お名前.com Navi の DNS 設定では効かない
- [VSCode拡張 tool_use パース退行](reference_vscode_ext_toolcall_parse_regression.md) — 「could not be parsed (retry also failed)」で停止する原因は拡張CLI 2.1.158-2.1.162 の退行。2.1.153/145 へ固定 or ターミナルCLI 2.1.109 で回避

## Feedback
- [開発ルール11条](project_dev_rules.md) — 実装前確認・テストファースト・セッションプロトコル・DoD等
- [メモリ運用ルール](feedback_memory_management.md) — 何を書く/書かない、セッション終了時の同期手順、肥大化防止
- [Auth.js v5 JWT strategy の user.id 罠](feedback_auth_js_jwt_strategy_user_id.md) — adapter なしだと毎回ランダム UUID。OAuth sub は account.providerAccountId から
- [/ship の main 直 push は事前承認済み](feedback_main_push_authorized_for_ship.md) — worklog/memory 同期 commit は確認なしで `git push origin main` 実行可。1人開発・身内プロジェクト前提
- [autonomous-loop sentinel の解釈](feedback_autonomous_loop_scope.md) — `<<autonomous-loop-dynamic>>` は実装 GO ではない。CLAUDE.md ルール 1 は autonomous でも有効
- [Windows worktree のパス罠](feedback_windows_worktree_path.md) — `/tmp` は git/pnpm が `%TEMP%`、Write/Read は `C:/tmp` を参照して別ディレクトリになる。worktree は最初から `C:/tmp/...` で明示作成
- [ブランチ作業は共有 main ディレクトリ禁止](feedback_no_shared_maindir_for_branch_work.md) — infra/CI の小 PR でも必ず隔離 worktree。共有 main 作業ディレクトリで checkout/commit すると並行セッションとブランチが揺れて衝突（2026-06-01 に実害）
- [jsdom が CSS env() inline style を捨てる](feedback_jsdom_css_env.md) — vitest 環境では `style={{ paddingBottom: 'env(...)' }}` は消える。Tailwind arbitrary value `pb-[env(...)]` で書け
- [flex + overflow-y-auto には min-h-0 が必須](feedback_flex_min_h_0_for_overflow.md) — `flex-1 overflow-y-auto` だけだと flex item デフォルト `min-height: auto` で親を突き抜けて body スクロール化。常に `min-h-0` を同時指定
- [Tailwind min-h-* + p-* は border-box で padding が算入される](feedback_tailwind_min_h_border_box.md) — `min-h-[52px]` + `pb-[env(...)]` だとコンテンツ 18px に圧縮。`min-h-[calc(52px_+_env(...))]` で合算必須
- [Tailwind arbitrary value 内のスペースは `_` でエスケープ](feedback_tailwind_arbitrary_underscore_space.md) — `calc(a+b)` のままだと CSS spec 違反で Safari が無効化。`calc(a_+_b)` で実 CSS の空白に展開
- [iOS Safari `100dvh` が URL バー込みで viewport 超える](feedback_ios_safari_dvh_url_bar.md) — sticky bottom UI で `h-dvh` だけだと BottomNav が下部 URL バーの裏に隠れる。`100vh → 100dvh → 100svh` の cascade を globals.css の専用クラスで固定
- [Tailwind の utility 出力順は className 順では制御できない](feedback_tailwind_utility_output_order_not_className.md) — 同一 property を複数 utility で重ねて cascade 期待するのは NG。CSS 側に専用クラスを切る
- [Next.js standalone リビルド時の static cp](feedback_nextjs_standalone_static_cp.md) — build 後に `.next/static` と `public` を `.next/standalone/apps/web/` 配下にコピーし忘れると CSS/JS 全部 404 で画面真っ白
- [本番ホストに Noto CJK 必須](feedback_libreoffice_ja_fonts.md) — `poppler-utils` + `libreoffice` で PDF/Word 画像化するなら日本語フォントを必ず apt install。デフォルトの Ubuntu Server は `fc-list :lang=ja` が 0 件で文字化け
- [libreoffice HTML→PDF は --writer 必須](feedback_libreoffice_writer_blank_page.md) — 無いと先頭に真っ白ページが入り本文が2ページ目にずれる(LibreOffice 既知バグ)。Issue #93/PR #94。HTML 変換は `--writer` で Writer 文書として開く
- [本番 migration は `db:migrate` 使う](feedback_drizzle_kit_push_prompt.md) — `db:push` は既存データありで UNIQUE 制約追加時に interactive prompt 要求 → TTY なしで詰む。`db:migrate` は journal ベースで非 interactive
- [公開添付 route は blocklist + attachment 固定](feedback_attachment_mime_blocklist.md) — allowlist 方式は xlsx 等をモバイルアプリで開けなくする副作用。`Content-Disposition: attachment` 固定 + 危険 MIME blocklist + token 検証の三重防御
- [vitest は --no-file-parallelism で逐次実行](feedback_vitest_no_file_parallelism.md) — WSL2 Docker test DB(5434) のクロックドリフトで時刻境界テスト(pipeline-runs/reextract)が並行実行で flaky。ローカルは常に `--no-file-parallelism`
