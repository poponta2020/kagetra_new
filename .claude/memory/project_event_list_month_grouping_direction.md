---
name: event-list-month-grouping-direction
description: イベント一覧 月区切りタイムライン 方向性合意
type: project
---

/events（大会申込一覧）の開催日順ビューに月区切りセクションを導入。**design-spec locked（2026-07-28・round 2）**＝実装待ち。正典= docs/features/event-list-month-grouping/（design-spec.md + design-mock/ + implementation-plan.md 2タスク直列）。次= `/implement event-list-month-grouping`。

**Round 2（ユーザーが claude.ai/design 上で直接編集）で追加確定:**
- 土曜=藍（日曜=朱・平日=淡墨のカレンダー色則）
- 申込可否の**二重符号**: 3px色帯（藍）＋大会名の太さ（canApply=bold／不可=regular）。必ず同条件連動
- **ページ見出し行（h1「大会申込」・過去のイベント→・新規作成）を実装でも削除**。両者はリスト末尾のフッター行へ移設（左=過去のイベント／右=新規作成・管理者のみ）

**確定デザイン（探索は widget モックで11回反復、最終案=T-4系）:**
- 月見出し: 詰めゴシック・ゼロ埋め2桁数字（08, 09, 10…年間で幅が揃う）+ 英字添字 AUG/SEP + 藍（brand）太罫 2.5px の下線。件数表記（2 EVENTS 等）は**不採用**（ユーザー明示指示）
- 行: 左に日付ブロック（日数字はゼロなし 9/23、下に SUN 英字・日曜=朱）+ 大会名 + 右端に締切「あと12日」の数字強調（現行 DeadlineValue 踏襲）
- 曜日・月の英字は装飾タイポとしての採用＝「UI文言は日本語のみ」原則の意図的例外（design-spec に明記すること）
- 適用範囲: **開催日順ソート時のみ**。締切日順はフラットな現行リスト維持。申込可能フィルタも現状維持
- 経緯: ユーザーの初期イメージは「左に縦線・月ごと区切り」→ 垂直タイムライン5案→案1/案3拡張6案→日付左4案→月数字特大化→英字化(SUN/AUG)→タイポ5案(T-1〜T-5)→T-4派生5案→ゼロ埋め検証で「月08・日9」に収束
- 対象コード: apps/web/src/app/(app)/events/EventListClient.tsx（design-spec B案・区切り線リスト）。純UI変更＝design-spec が要件成果物（define-feature 本編は不要、feedback_design_spec_is_requirement_for_ui 参照）
- 次工程: /design-screen event-list-redesign の delta で実トークン（藍--kg-brand-fg・和紙・朱）・実データ本組み
