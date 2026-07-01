---
name: impl_senseki_stats_pr2_nav
description: senseki-stats PR-2（ナビ再構成）実装完了・PR作成待ち。タブ改称＋4セクションシェル＋ルート scaffold
metadata: 
  node_type: memory
  type: project
  originSessionId: 54d8b809-675e-4236-85c6-e581c48c22ab
---

senseki-stats タスク4（#212・PR-2 ナビ）**実装完了**。branch=`feature/senseki-stats-nav`、commit `fb9fd83`、push 済（PR 未作成→prepare-pr へ自動連鎖予定）。worktree=`C:/tmp/impl-senseki-stats-nav`。

**やったこと:**
- BottomNav「戦績」→**「統計」**改称（href=`/players` 据え置き・active 判定 `matches:['/players','/tournaments']`）。
- **`apps/web/src/components/stats/section-tabs.tsx`（新規）**＝ss-segA 相当の均等4分割下線タブ（選手検索`/players`／大会結果`/tournaments`／ランキング`/players/ranking`／大会統計`/tournaments/stats`）。
- `/players` を SectionTabs 配下に収納（検索ロジック不変・冗長な h1「選手戦績」削除・content を p-4 でラップ）。
- 新規ルート空 scaffold 7本：セクショントップ（ranking/tournaments/series/stats）は SectionTabs＋プレースホルダ、詳細プッシュ（tournaments/[id]・series/[id]・stats/[metric]）は戻る導線＋プレースホルダ（横断ナビ非表示）。
- テスト：section-tabs.test（10）／bottom-nav.test（14）／E2E senseki-stats-nav（4セクション到達＋既存検索非退行＋詳細はsegA非表示）。型チェック green・vitest 24 green・lint clean。

**非自明ポイント:**
- **SectionTabs の active は最長プレフィックス一致**（`activeHref`）。`/players/ranking` は `/players` にも前方一致するが長い方＝ランキングを勝たせる。`/tournaments/stats` も同様に大会統計。単純 startsWith だと親タブが誤点灯する。
- **SectionTabs はシェル layout ではなく各セクショントップ page で個別 render**。requirements §3.1「4セクションのトップにのみ表示・詳細プッシュには出さない」を、layout（server component）で pathname 判定するより per-page opt-in で表現する方が確実（詳細 page は単に render しない）。`/tournaments/series`（大会別トグル）も 大会結果セクションのトップなので segA を出す。
- **静的 seg（ranking/series/stats）> 動的 [id]** の Next.js 優先順位に依存（requirements §3.1 前提）＝衝突しない。
- prettier 罠を踏んだ（[[feedback_no_prettier_config_repo_style]]）→`--single-quote --no-semi` で復元。
- worktree の共有 test DB 競合回避に `kagetra_test_sstats` を新規作成し `TEST_DATABASE_URL` で隔離（[[feedback_shared_test_db_worktree_push_race]]）。

**残:** PR作成→auto-review-loop→ship。UI は最小 scaffold（PR-3〜5 で中身実装）。親=[[project_senseki_stats_tab]]、PR-1=[[impl_senseki_stats_pr1_derived_bracket]]。
