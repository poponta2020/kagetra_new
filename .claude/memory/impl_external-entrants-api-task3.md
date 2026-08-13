---
name: impl-external-entrants-api-task3
description: external-entrants-api タスク3
type: project
---

external-entrants-api タスク3（#493）完了。middleware matcher の除外リストへ api/external を追加（main 直・小径のため委譲せず）。commit b135a3e。

- middleware.ts: matcher 負先読みリストに api/external 追加+既存流儀の理由コメント（この名前空間には外部連携ルート以外を作らない）
- middleware.test.ts: matcher 文字列を RegExp 化して除外/保護対象を回帰テスト（Next の matcher コンパイル近似）。既存10件+新2件=12件 green
- .env.local.example: EXTERNAL_ENTRANTS_API_KEY 追記（fail-closed・openssl rand 生成・実行時読みの説明付き）
