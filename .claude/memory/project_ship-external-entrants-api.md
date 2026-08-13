---
name: ship-external-entrants-api
description: feat: 大会出場予定者の外部提供 API（match-tracker 連携）
type: project
---

match-tracker 連携の外部提供 API を出荷。PR #495 https://github.com/poponta2020/kagetra_new/pull/495 merged（2026-08-13）。親 #490・子 #491〜#494 クローズ済み。

## 内容
- GET /api/external/tournament-entrants: 大会出場予定者（人単位・当月1日JST以降・PII は name/kana/grade/isGuest/userId 限定）。契約の正典= docs/spec/external-api.md
- 認証: EXTERNAL_ENTRANTS_API_KEY（Bearer・fail-closed: env未設定/空文字は常に401・timingSafeEqual）。middleware matcher から api/external 除外
- ホーム dashboard の出場者導出を src/lib/upcoming-entrants.ts へ共通化（純リファクタ・page.test.tsx 無変更 green）。entrant は entryGrade/userGrade 分離+basis
- コミット: bdc8815(docs)→5054cef(タスク1)→21a6009(タスク2)→b135a3e(タスク3)→911994b(タスク4)→ed21be5(R1 fix)

## レビュー（auto-review-loop）
3R(i+d1+f), verdict=pass, effort=high→medium→high, tokens=441,914/500,000。R1 blocker 1件=route.test の JST 月末境界 flaky→Date fake timer 固定で即修正（ed21be5）。WONTFIX 0件・打ち切りなし（final まで正規収束）

## ★残 DoD（本番手作業・未実施）
1. openssl rand -base64 32 でキー生成→本番 /opt/kagetra/.env.production へ EXTERNAL_ENTRANTS_API_KEY= 追記（systemd EnvironmentFile・実行時読み・再ビルド不要）
2. systemctl restart kagetra-web.service
3. curl でキー無し 401 / 正キー 200 確認
※キー未設定の間も常に 401 で安全（fail-closed）。match-tracker 側へのキー共有（Render env var）はあちらの実装時
※マージ時 CI は pending のままマージ（v0.9.0 方針）。赤になったら /quickfix で追修正
