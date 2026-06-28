---
name: impl_tournament_entry_rosters_foundation
description: "tournament-entry-rosters 全6タスク(親#184)を3PRで実装・Codexレビュー・ship・本番deployまで完了(2026-06-29 自律run)"
metadata: 
  node_type: memory
  type: project
  originSessionId: c9cb1b98-a35e-454a-97c5-8ccec1f015d5
---

大会ライフサイクル基盤＋名簿（[[project_tournament_entry_rosters_def]]・親 #184）を **全6タスク完了**。
2026-06-29、ユーザー就寝中の自律 run で実装→Codex 自動レビュー→ship→本番 deploy まで完走（ship 含む
本番操作はセッション承認済みで自己判断実行）。子 #185-190・親 #184 全クローズ。3 PR 構成:

- **PR #193 土台(Task1+2)** merge `83aaba7`: series/editions を Drizzle化（本番現物一致・冪等
  migration 0031）＋ events/tournaments.edition_id ＋ event_group 撤去（0032 FK→列→表順）。本番
  deploy 確認（0031=完全no-op / 0032 適用をログで確認）。Codex 1R（nit のみ）。
- **PR #195 edition解決(Task3+6)** merge `6e7298e`: `lib/edition/resolve.ts`（回次パース・NFKC名寄せ・
  find-or-create を FOR UPDATE＋onConflict 直列化・auto は完全一致単独のみ link）＋ flow①(approveDraftUnits)
  ＋ flow②(materializeResultDraft で tournaments.edition_id 自動解決＋unconfirmed→held 昇格)＋手動
  events/new・edit の紐付け。edition_id index(0033)。Codex **7R**→pass（部分承認 backfill・kind 整合・
  曖昧系列ガード・新規系列明示確認 等を逐次修正）。
- **PR #196 名簿(Task4+5)** merge `289ba07`: rosters/roster_entries(0034)＋ Excel パーサ(`lib/roster-import/
  parser.ts` ヘッダ署名で氏名/級/所属等検出)＋ materialize(置換・player姓名get-or-create・会員突合=正規化姓名
  単独一致で user_id)＋ uploadRoster Server Action＋ 大会詳細の RosterSection 表示。Codex 2R→pass。

**migration 0031-0034 全て本番ミラー(kagetra_rehearsal を TEMPLATE コピー)で dry-run 後に本番 auto-deploy 適用済み**。

**非自明（再利用可）**:
- test/dev=`drizzle-kit push`・本番=`db:migrate`。dry-run は kagetra_rehearsal(=本番ミラー)コピーへ
  migration SQL 直実行＝本番 apply-migrations.sh と同等。foundation の 0031 は本番ログでも dry-run 通りの
  no-op を実証（手法の妥当性確認）。
- 共有 test DB(5434) は並行 worktree と衝突→隔離 DB `kagetra_test_ter` 必須（[[feedback_shared_test_db_worktree_push_race]]）。
- mail-worker `result-import/reader`(readExcel) は web から使うので package.json exports に追記が必要（tsc は
  exports map を見る／vite は緩いのでテストだけ通る罠）。
- mail-worker `pipeline-runs.test.ts` は CI/連続実行で flaky（[[feedback_vitest_no_file_parallelism]] のクロック
  ドリフト）。post-merge CI で deploy が skip された時は `gh run rerun <id> --failed` で復旧（PR#195 で実害）。
- 長い FK 名は PG が 63 字に truncate（NOTICE）。push と migrate で同じ truncate なので整合。
- jsdom の File は `arrayBuffer()` 未実装→Server Action の file 取込テストは polyfill が要る。

**残（任意・後日）**: 本番実機目視（案内承認の edition 紐付け／結果取込の自動解決／名簿 Excel 取込→表示→
会員突合）。**UI は最小実装**＝実サンプル名簿＋ `/design-screen tournament-entry-rosters` の design-spec が
出たら精緻化推奨（PDF 名簿取込も未対応＝Excel のみ）。第4段（出場回数カウント）は当初からスコープ外。
