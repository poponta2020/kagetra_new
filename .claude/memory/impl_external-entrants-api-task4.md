---
name: impl-external-entrants-api-task4
description: external-entrants-api タスク4
type: project
---

external-entrants-api タスク4（#494）完了。契約ドキュメント新設（main 直・契約内容は main のコンテキストが正のため委譲せず）。commit 911994b。

- docs/spec/external-api.md 新設: 外部連携 API ドメインの正典（役割分担=事実のみ返しポリシー持たない・認証 fail-closed・URLクエリ渡し禁止・鍵管理と本番配備手順・カンマ区切り複数キーの将来ローテメモ・レスポンス契約 JSON）。母集団定義は events-attendance.md 参照で1事実1ファイル維持
- SPECIFICATION.md ドメイン表+features/INDEX.md へ索引行追加（主要領域を確定値へ）
- メイン作業ディレクトリ側の未コミット INDEX.md（主要領域: 未定の行）は ship のマージで worktree 版に置き換わる想定
