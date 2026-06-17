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
- [本番自動デプロイ (Actions+SSH) 稼働中](project_auto_deploy.md) — PR #86 merge `7d15042` (2026-06-01)、初回 run 成功(SKIPPED_NOCODE 疎通確認)。main の code 変更 push で自動 build→migration(冪等)→restart、docs のみ skip。kagetra(scoped sudo)へ deploy 鍵で SSH。host 鍵/sudoers/secrets 設定済。**PR #132 (2026-06-10) で `apps/*/systemd/kagetra-*.{service,timer}` 自動配置を追加 + sudoers を 12 unit 固定列挙に拡張 + `User=kagetra` defensive check**（Issue #131 多摩大会 AI 抽出滞留が契機）。**PR #137 (2026-06-11) でビルド対象判定を拡張: WEB は apps/(web|mail-worker)、pnpm-lock.yaml は SHARED**（Issue #135 が契機）
- [mail-triage-badge SHIPPED](project_mail_triage_badge.md) — 全メールトリアージ＋PWA未処理バッジ(Web Push)。PR #95 merge `2ca9af2` (2026-06-01)、本番反映 success、Issue #87-92 全クローズ。triage_status 3状態・処理4アクション・既存メール processed 化・準リアルタイム同期。残 DoD=本番 VAPID 鍵設定+iOS 実機バッジ目視
- [tournament-title-grade-split SHIPPED+本番反映](project_tournament_title_grade_split.md) — 大会名を「場所+級」短縮通称化＋開催日ごとイベント分割（mail-tournament-import 拡張）。PR #111 merge `e664b3d` (2026-06-04)、本番反映 success(migration 0020)、親#102+子#103-109 全クローズ。1ドラフト:Nイベント・title合成(stem AI/級A→E連結)・AI抽出2.0.0・FOR UPDATE で承認/再抽出の payload race 直列化(R1-R6)・LINE配信グループ重複排除。残 DoD=実機目視のみ
- [settings-sheet SHIPPED](project_settings_sheet.md) — 設定画面への導線（ヘッダ {name}さん タップ→設定シート AccountMenu）。PR #110 merge `4857787` (2026-06-03)、親#97+子#98-101 全クローズ。design.md §3 未実装仕様の実装、ロール出し分け、ログアウト集約、/settings/notifications を (app) 配下へ移動(URL不変)・line-link は据え置き。残 DoD=実機目視
- [entry-notify-lottery-treasurer SHIPPED](impl_entry_notify_lottery_treasurer.md) — 申込完了通知を2通化（参加者へ抽選日追記＋会計へ振込方法/期限）。PR #118 merge `b64f291` (2026-06-06)、親#112+子#113-117 全クローズ。Codex R1 で pass/0指摘・CI green。同一tx で 2 claim + コミット後独立 try/catch push、cancelled/未紐付けでも対称、金額非表示・payment_type で出し分けず常時送信、承認画面は embedded で抽選日非表示。残 DoD=本番反映後の実機 LINE 目視（migration 0021）
- [mail-inbox-mailer 機能定義](project_mail_inbox_mailer.md) — メール処理を「アプリ＝メーラー」モデルに作り替え。AI 自動分類廃止＋ボタン起動化、triage 2 状態、3 アクション（AI抽出/既存イベント結びつけ/対応不要）。親#119+子#120-126（2026-06-06 定義、実装未着手）
- [旧形式Word(.doc)抽出対応 SHIPPED](impl_fix_doc_attachment_extraction.md) — PR #134 merge `c208b66` (2026-06-10)、Issue #133 クローズ。word-extractor で .doc 抽出 + classifier lazy fallback (DB非更新) + prompt 2.1.0 (申込期間→終了日採用・和暦換算)。**残DoD=本番で多摩 draft #29 を再抽出→締切 prefill 確認→承認**（PR #137 デプロイ後に消化可能）
- [deploy: mail-worker変更でweb再ビルド fix](impl_fix_deploy_web_rebuild_on_worker_change.md) — PR #137 merge `f6da7a1` (2026-06-11)、Issue #135 クローズ。web は transpilePackages で mail-worker ソースをバンドル → mail-worker のみの PR #134 デプロイが web=0 となり本番の「再抽出」が旧 classifier のまま（=処理が走らないように見えた）。WEB 判定を apps/(web|mail-worker) に拡張 + lockfile→SHARED + next.config.ts コメント変更で即時 web 再ビルドを同梱
- [メール添付 inline allowlist 拡張 SHIPPED](impl_fix_mail_attachment_pwa_inline.md) — PR #139 merge `d84ae90` (2026-06-11)、Issue #138 クローズ。iPhone PWA で添付チップ白画面死 → PDF/Office/画像/text を fail-closed allowlist で inline 化。チップ遷移は PR #146 でアプリ内ビューアに置換済（ルート自体は元ファイルリンク/画像直表示で継続使用）
- [添付アプリ内ビューア SHIPPED](impl_fix_attachment_inapp_viewer.md) — PR #146 merge `c99b2ea` (2026-06-12)。チップ→`/admin/mail-inbox/attachments/[id]`、PDF/Office をページ JPEG 化（libreoffice forceWriter:false + pdftoppm + image-cache `attpv:`）、✕ は `?from=` 明示 + Link replace。preview ルートはキャッシュヒット時も行存在確認。残 DoD=iPhone 実機で表示と✕復帰確認
- [image-cache module instance 分離 fix](impl_fix_image_cache_module_instance.md) — PR #129 merge `57ceadc` (2026-06-07)、Issue #128 自動クローズ。PR #127 deploy 後に Next.js chunk splitting が再評価され Server Action 側と Route Handler 側で `image-cache.ts` が別 Map instance に分離 → LINE 本文画像 URL が全て 404 退行。`globalThis` pin で修正。残 DoD=本番反映後の実機目視+nginx ログ 200 OK 確認
- [admin-member-create SHIPPED](impl_admin_member_create.md) — 管理画面からの新規会員手動追加＋誤登録リカバリ(名前編集/削除)。PR #147 merge `27d6727` (2026-06-16)、親#140+子#141-145 全クローズ。createMember は role=member/招待済/未紐付け強制で即 self-identify 候補化、updateMemberName/deleteMember は未紐付け+role=member 限定、削除は FOR UPDATE+FK 参照チェックで履歴保護。Codex 4R 収束。残 DoD=実機通し確認
- [broadcast-lead-message SHIPPED](project_broadcast_lead_message.md) — 既存大会LINE配信に冒頭テキスト(見出し「抽選結果が出ました！」等)を任意で先頭追加。プリセット＋自由入力(コード固定)、linkMailToEvent のみ対象、event_broadcast_messages に lead_text/sent_lead_count 追加し manualBroadcast 再送で継承。PR #155 merge `4ff8d8f` (2026-06-17)、親#148+子#149-154 全クローズ、Codex 1R 即pass。残 DoD=本番 migration 0025 反映確認＋実機 LINE 目視

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
- [Next.js の module-level state は globalThis pin が必須](feedback_nextjs_module_state_globalthis_pin.md) — Server Action / Route Handler / Server Component を跨いで共有する `Map`/`Set`/`let` は globalThis pin しないと chunk splitting で別 instance になりうる。2026-06-07 [[impl_fix_image_cache_module_instance]] で実害（LINE 本文画像 全 404）
- [git textconv が .doc 入り diff を非UTF-8 化](feedback_git_textconv_doc_no_utf8_diff.md) — codex 等へパイプする diff は `--no-textconv` で生成（PR #134 R1 で実害）
- [iOS PWA は attachment disposition で白画面死](feedback_ios_pwa_attachment_disposition.md) — 管理画面の配信 route は inert type を実 MIME + inline の fail-closed allowlist で。送信者制御 Content-Type に blocklist inline は fail-open で NG
- [iOS PWA in-scope 遷移は脱出不可・iframe PDF は1ページのみ](feedback_ios_pwa_inscope_doc_preview.md) — same-origin は target=_blank でも同一 WebView（overlay は out-of-scope のみ）、iframe 内 PDF は iOS で1ページ目だけ。戻る UI 付き文書プレビューはサーバーでページ画像化一択
- [ship 後の残 DoD は本番未反映で実害化する](feedback_ship_dod_residual_check.md) — systemd / sudoers / env / VAPID key 等の本番手作業 DoD は worklog に書くだけで放置すると後で機能停止に直結（PR #127→Issue #131 で実害）。ship 完了時に消化手順併記+ユーザー口頭確認+可能なら auto-deploy 取り込み
- [worktree cwd から長寿命プロセスを起動しない](feedback_no_longlived_process_from_worktree_cwd.md) — Docker Desktop 等を worktree 内 cwd で Start-Process すると cwd 継承でハンドル保持、worktree 削除が Device busy で失敗（PR #136 ship で実害）。起動前に cwd を worktree 外へ
- [参照ゼロ確認→削除は FOR UPDATE で直列化](feedback_admin_delete_for_update_race.md) — 「子に参照が無いことを確認してから親を hard delete」は READ COMMITTED ではチェックとDELETEの間に参照挿入が割り込み履歴が静かに消える。親行を FOR UPDATE ロックしてから確認→削除（PR #147 R2 で実害指摘）
- [/implement タスク進行は都度承認不要](feedback_implement_task_progression.md) — 承認済み plan のタスクは連続実装してよい。確認は計画外の設計分岐・破壊的変更・想定外時のみ（2026-06-17 明言）
