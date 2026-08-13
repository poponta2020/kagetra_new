---
status: completed
design_required: false
---
# external-entrants-api 要件定義書

match-tracker の月次練習会抽選で「大会出場予定者」を優先枠としてデフォルト選択できるようにするための、kagetra 側データ提供 API。

## 1. 概要

- **目的**: match-tracker の抽選（`/admin/lottery`・優先選手指定）で、大会に出る予定の人を管理者が手作業で思い出してチェックする手間と漏れをなくす。大会前の人が練習枠を確保できる運用を仕組み化する。
- **背景**: guest-role（PR #489）の最終目的として明記されていた「match-tracker へ渡す出場予定者の母集団を会員以外へ広げる」の連携本体。
- **役割分担（本要件の核）**: kagetra は「**事実**」（誰が・いつ・どの大会に出る予定か）を返す読み取り専用 API を提供するだけ。優先枠ウィンドウの判定（n月＋n+1月15日ルール）・名寄せ・デフォルト選択 UI・失敗時フォールバックはすべて **match-tracker 側の責務**（あちらのリポジトリで別途要件定義する）。15日ルールが将来変わっても kagetra は無改修で済む。

## 2. ユーザーストーリー

- **誰が**: match-tracker のバックエンド（最終受益者は抽選を実行する会の管理者＝ユーザー本人）。
- **何を**: 抽選画面を開いたとき、kagetra の出場予定データを取得し、対象者を優先枠チェックボックスのデフォルト ON にする。
- **なぜ**: 現状は管理者が「今月・来月頭に大会に出るのは誰か」を記憶と目視で照合しており、漏れると大会前の人が練習に入れない。

## 3. 機能要件

### 3.1 画面と遷移

なし（UI なし・API のみ）。`design_required: false`。

### 3.2 ビジネスルール

**エンドポイント**
- 認証必須・読み取り専用の HTTP GET エンドポイントを apps/web の route handler として新設する（パスは技術計画で確定。例: `/api/external/tournament-entrants`）。
- クエリパラメータなし（期間ウィンドウは受け取らない。消費側で判定する）。

**認証**
- 静的 API キー（環境変数で管理・match-tracker バックエンドと共有）。キー欠落・不一致は 401。
- Auth.js セッション認証とは独立の経路。middleware がこのルートをセッションへリダイレクト／遮断しないこと（技術計画で matcher との関係を確定する）。

**母集団（ホーム出場タイムライン `dashboard/page.tsx` の導出と同一定義）**
- 対象イベント: `kind = 'individual'` ∧ `status ≠ 'cancelled'` ∧ `eventDate >= 当月1日（JST）`（過去日も当月内なら含む。終点なし＝登録済みの将来イベント全部）。
- 確定名簿（`roster_type='confirmed'` ∧ 非 superseded）があるグループ:
  - 名簿が正。名簿行のうち `status ∈ {confirmed, carried_up}` ∧ `selection_outcome ∉ {waitlisted, rejected}` ∧ 会員として同定済み（`user_id` 非 NULL）∧ 現ロールが guest でない行の人。
  - ゲストは名簿に構造的に載らないため、`attend = true` の出欠回答から合流（guest-role AC-22 と同じ非対称）。
- 確定名簿が無いグループ: `attend = true` ∧ `is_invited = true` ∧ 対象級内（`eligible_grades` が空/NULL なら全員）の回答者（会員・ゲストを区別しない）。
- 同一人物×同一イベントは 1 件に dedupe（userId 基準）。

**レスポンス（人単位）**

```jsonc
{
  "generatedAt": "2026-08-13T09:00:00+09:00",
  "persons": [
    {
      "userId": "…",            // kagetra users.id（将来の安定マッピング用の不透明文字列）
      "name": "山田 太郎",       // users.name（表示名・姓名は空白区切りが基本だが保証なし）
      "familyKana": "やまだ",    // 未登録なら null（旧来会員 ~100 名は null）
      "givenKana": "たろう",     // 同上
      "grade": "B",             // users.grade（現在の級）。null あり
      "isGuest": false,
      "entries": [
        {
          "eventId": 123,
          "eventDate": "2026-09-06",
          "displayName": "多摩 B級",   // ホーム/申込ボードと同じ導出（通称＋級）
          "confidence": "confirmed"    // confirmed=確定名簿由来 / hoped=出欠回答由来（ゲストは常に hoped）
        }
      ]
    }
  ]
}
```

- 出場予定が 1 件以上ある人だけを載せる。
- `confidence` は**その人の掲載根拠**（イベント単位の名簿有無ではない）: 名簿由来 = `confirmed`、出欠回答由来 = `hoped`。
- 名簿はグループ帰属なので、確定名簿由来の人はグループ内の全開催日それぞれに entries 行を持つ（ホームと同じ読み方）。

**エラーケース・境界条件**
- API キー欠落・不一致 → 401（本文にヒントを含めない）。
- 対象イベント 0 件・対象者 0 名 → `persons: []` の 200（エラーにしない）。
- 月初の境界は JST で判定（UTC 日付を使わない）。

## 4. Acceptance Criteria

| ID | 条件（客観的に判定できる文） | 検証手段 |
|----|------|------|
| AC-1 | 有効な API キー付き GET でステータス 200・§3.2 のレスポンス形が返る | auto-test |
| AC-2 | API キーが欠落または不一致のリクエストは 401 になり、本文に会員情報を一切含まない | auto-test |
| AC-3 | 確定名簿があるグループ: 名簿由来の会員が `confidence='confirmed'` で載り、補欠・落選・未同定（user_id NULL）・現ロール guest の名簿行は載らない | auto-test |
| AC-4 | 確定名簿があるグループでも、ゲストの `attend=true` 回答者は `confidence='hoped'` で合流する | auto-test |
| AC-5 | 確定名簿が無いグループ: `attend=true` ∧ `is_invited` ∧ 対象級内の回答者（会員・ゲスト）が `hoped` で載り、`attend=false`・対象級外の回答者は載らない | auto-test |
| AC-6 | 当月1日（JST）より前のイベント・`kind='team'`・`status='cancelled'` のイベントは entries に現れない。当月内の過去日イベントは現れる | auto-test |
| AC-7 | 同一人物が名簿と出欠の両方で同一イベントに該当しても、その人の entries に当該イベントは 1 件だけ | auto-test |
| AC-8 | 出場予定が 0 件の会員・ゲストは persons に現れない | auto-test |
| AC-9 | レスポンスに電話番号・生年月日・住所・メールアドレス等の PII が含まれない（name / kana / grade / isGuest / userId / entries のみ） | auto-test |
| AC-10 | 同一 DB 状態で、API の（会員・ゲスト × イベント）集合がホーム出場タイムラインの出場者集合と一致する（導出モジュールを共有する） | auto-test |
| AC-11 | 既存テスト・lint・typecheck がすべて成功する（CI で確認。ローカル全実行を要求しない） | auto-test |

## 5. Non-goals

- **match-tracker 側の実装すべて**: kagetra API の取得・名寄せ（name/kana → Player）・優先枠チェックのデフォルト ON・n月＋n+1月15日のウィンドウ判定・kagetra 停止時のフォールバック。→ match-tracker リポジトリで別途要件定義。
- kagetra 側での優先枠の管理画面・可視化・通知。
- 団体戦（`kind='team'`）の出場予定。
- 認証の高度化（IP 制限・レート制限・キーの自動ローテーション）。招待制身内アプリ間の連携として静的キーで足りる。
- ホーム出場タイムラインの挙動変更（導出共通化のリファクタは挙動不変）。
- 過去月の出場実績の提供（当月1日以降のみ）。

## 6. 技術的制約・契約

- **公開契約**: §3.2 のレスポンス JSON が match-tracker との公開契約。破壊的変更は match-tracker 側と同時に行う（契約ドキュメントは docs に置き、双方から参照する）。
- **互換性**: ホーム出場タイムラインの表示・挙動は変えない。導出ロジックの共通モジュール化は純リファクタ（既存テスト green を維持）。
- **セキュリティ**:
  - API キーは環境変数（本番 `.env.production`。match-tracker 側は Render の env var）。キーをレスポンス・ログ・リポジトリに出さない。
  - 返す個人情報は name / kana / grade / isGuest / userId に限定（PII ゲート）。
  - エンドポイントは読み取り専用（GET のみ・DB 書き込みなし）。
- **middleware との関係**: `api/**` はページ用ガードで守れず middleware の matcher に入っている（guest-role で確立した知見）。新ルートがセッション認証へ誘導されない許可設計を技術計画で確定する。ただし「セッション不要＝誰でも」ではなく API キー必須の fail-closed にする。
- **未解決の技術論点（技術計画への申し送り）**:
  1. エンドポイントの正確なパスと命名。
  2. middleware matcher の許可方法（既存の公開ルートの前例確認）。
  3. ホーム `dashboard/page.tsx` からの導出ロジック切り出し先（`src/lib/` 配下の共通モジュール）と、page.tsx 側の無挙動変更リファクタ手順。
  4. displayName 導出（`entry-board-utils` の `displayName`）の再利用方法。

## 7. 設計判断の根拠

- **ライブ API（SSH 日次複製ではなく）**: 抽選は管理者の手動実行なので画面を開いた瞬間の鮮度が価値。確定名簿→出欠フォールバック等の導出をホーム画面の実装（テスト済み）ごと再利用でき、external-players-sync 型の生 SQL 二重実装によるロジック乖離を構造的に避けられる。
- **ウィンドウ判定を kagetra に持たせない**: 「どの範囲を優先枠にするか」は消費側のポリシー。kagetra は事実のみ返す契約にしたことで、15日ルールの変更・団体差が生じても kagetra 無改修。
- **人単位のレスポンス**: 消費側の処理（人→出場日→優先判定→Player へ名寄せ）に直結する形。
- **母集団＝ホームと同一**: 優先枠の顔ぶれがホームの「会の出場予定」と常に一致し、管理者が画面同士で突き合わせて説明・検証できる。
- **当月1日起点**: 月中の抽選やり直しでも月初の大会参加者が欠落しない。過去分の要否判断も消費側に委ねられる。

## デザインへの宿題（→ /design-screen external-entrants-api）

なし（UI なし）。
