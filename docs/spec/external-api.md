# 外部連携 API

> **責務:** kagetra のデータを他システム（現時点では match-tracker のみ）へ提供する読み取り専用 API（`/api/external/**`）の仕様。エンドポイント契約・静的 API キー認証・鍵管理と本番配備手順
> **関連画面:** なし（UI なし・機械間連携のみ）
> **主要実装:**
> - `apps/web/src/app/api/external/tournament-entrants/route.ts`
> - `apps/web/src/lib/external-api-key.ts`
> - `apps/web/src/lib/upcoming-entrants.ts`（ホームと共有する出場者導出）
> - `apps/web/src/middleware.ts`（matcher から `api/external` を除外）

## 機能仕様

### 役割分担（この名前空間の設計原則）

kagetra は「**事実**」（誰が・いつ・どの大会に出る予定か）だけを返し、消費側のポリシーを持たない。match-tracker の優先枠ウィンドウ判定（n月＋翌月15日ルール）・name/kana → Player の名寄せ・デフォルト選択 UI・kagetra 停止時のフォールバックは、すべて match-tracker リポジトリの責務。ウィンドウのルールが将来変わっても kagetra は無改修で済む。

`/api/external/**` の名前空間には外部連携ルート以外を作らない（middleware の matcher がプレフィックスで除外しているため）。

### 認証（静的 API キー・fail-closed）

- キーは環境変数 `EXTERNAL_ENTRANTS_API_KEY`。リクエストは `Authorization: Bearer <key>` で渡す
- **キーを URL クエリで渡すことは禁止**（nginx access log に残る）。受け口は Authorization ヘッダのみ
- 検証は `verifyExternalApiKey`（`apps/web/src/lib/external-api-key.ts`）。`timingSafeEqual` 比較で、**env が未設定・空文字なら比較せず常に 401**（空文字同士の一致で素通りさせない fail-closed）。キー未設定のままコードだけが本番に出ても常に 401 なので、デプロイ順序の制約は無い
- Auth.js セッション認証とは独立の経路。middleware の matcher から `api/external` を除外し、ガードはルート内のキー検証が全部担う
- 認証失敗は 401 で、本文にヒント（会員情報・キーの形式等）を含めない
- **将来のキーローテーション**: 現在は 1 本のみ。無停止ローテが必要になったら、env をカンマ区切りの複数キー許容にし「新キー追加 → match-tracker 側切替 → 旧キー削除」の順で行える（現状は未実装のメモ）

### 鍵管理・本番配備

- キーは `openssl rand -base64 32` 相当で生成し、本番 `/opt/kagetra/.env.production` に追記する。systemd の EnvironmentFile なので**実行時読み**（再ビルド不要）。反映は `systemctl restart kagetra-web.service`
- 配備後の確認: キー無し curl → 401、正キー curl → 200
- match-tracker 側は Render の environment variable で同じキーを保持する（レスポンス・ログ・リポジトリにキーを出さない）
- ローカルは `apps/web/.env.local`（サンプルは `.env.local.example`）

## API

### GET `/api/external/tournament-entrants`

大会出場予定者（match-tracker の月次練習会抽選・優先枠のデフォルト選択用）。クエリパラメータなし。読み取り専用（DB 書き込みなし）。`Cache-Control: no-store`。

**母集団はホーム出場タイムラインと同一**（導出モジュール `upcoming-entrants.ts` を共有。確定名簿優先・補欠/落選除外・出欠 `attend=true` フォールバック・ゲストは出欠から合流・個人戦のみ・中止除外。定義の正典は [events-attendance.md](events-attendance.md) の「ホーム画面（ダッシュボード）」）。期間だけが異なり、**当月1日（JST）以降・終点なし**（ホームは当日以降）。月中の抽選やり直しでも月初の大会参加者が欠落しない。

**レスポンス（この JSON が match-tracker との公開契約。破壊的変更は match-tracker 側と同時に行う）:**

```jsonc
{
  "generatedAt": "2026-08-13T09:00:00+09:00",  // JST オフセット付き ISO
  "persons": [
    {
      "userId": "…",            // kagetra users.id（安定マッピング用の不透明文字列）
      "name": "山田 太郎",       // users.name（表示名。姓名は空白区切りが基本だが保証なし）
      "familyKana": "やまだ",    // 未登録なら null（旧来会員 ~100 名は null）
      "givenKana": "たろう",     // 同上
      "grade": "B",             // users.grade（現在の級。名簿行の級ではない）。null あり
      "isGuest": false,         // ゲスト（登録会が他会のサークル員）か
      "entries": [
        {
          "eventId": 123,
          "eventDate": "2026-09-06",   // YYYY-MM-DD
          "displayName": "多摩 B級",    // ホーム・申込ボードと同じ導出（通称＋級）
          "confidence": "confirmed"    // confirmed=確定名簿由来 / hoped=出欠回答由来
        }
      ]
    }
  ]
}
```

- 出場予定が 1 件以上ある人だけを載せる。persons は `name` の ja ロケール昇順、entries は `eventDate` 昇順
- `confidence` は**その人の掲載根拠**（イベント単位の名簿有無ではない）。名簿はグループ帰属なので、確定名簿由来の人はグループ内の全開催日それぞれに entries 行を持つ。ゲストは名簿に構造的に載らないため常に `hoped`
- 同一人物×同一イベントは 1 件（userId 基準で dedupe）
- 対象イベント 0 件・対象者 0 名は `persons: []` の 200（エラーにしない）
- PII は name / kana / grade / isGuest / userId に限定（電話・生年月日・住所・メールアドレスは返さない）
