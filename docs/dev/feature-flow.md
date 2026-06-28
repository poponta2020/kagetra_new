# 機能開発フロー：要件と設計の螺旋（define-feature ⇄ design-screen）

要件（ロジック）と設計（視覚）は**順番に並ぶ段階ではなく、互いを生みながら螺旋で深まる2つのレンズ**。`/define-feature` と `/design-screen` はその2レンズの入口で、**行き来して収束させる**。

## 2レンズ・1フォルダ
1つの機能は `docs/features/<slug>/` に**2つの生きた文書**を持ち、相互参照する（**重複させない**）：

| 文書 | スキル | 担当する「何を」 | 高度 |
|---|---|---|---|
| `requirements.md` | `/define-feature` | ロジック・画面遷移・データ・API・DB・ビジネスルール | 振る舞い（言葉） |
| `design-spec.md`（複数画面は `design-spec-<screen>.md`） | `/design-screen` | レイアウト・コンポーネント・状態・見た目 | 視覚 |

- requirements は**画面レイアウトを言葉で再記述しない**（design-spec を参照）。
- design-spec は**ロジックを決めない**（requirements に投げる）。
- **画面インベントリと画面間遷移（ナビゲーション地図）は requirements が持つ**（多画面でもスケール）。

## 宿題で投げ合う（行き来の実体）
片方のレンズで解けない論点は、相手レンズへ**宿題**として渡す：
- design-spec に `## 要件への宿題（→ /define-feature <slug>）`
- requirements に `## デザインへの宿題（→ /design-screen <slug>）`

例：「戦績詳細で相手名タップ→その選手の戦績へ」は design 中に出た emergent logic →「要件への宿題」→ define-feature で遷移/データ/同名処理を確定 → design-screen でリンク affordance を詰める → …

## 螺旋の回し方
1. **中心（center of gravity）から始める**：UI 駆動なら design-screen 起点／ロジック駆動なら define-feature 起点。
2. 各レンズは**完成を待たず**、宿題を投げ合って交互に深める。**文書は作り直しでなく追記**（戻っても無駄にならない）。
3. **収束ゲート**：両文書が `status: locked`＋互いの宿題ゼロ＋**薄い implementation-plan**（テスト先行のタスク／対象ファイル／影響範囲）→ `/implement`。

## 片レンズに自然に縮む
- **視覚だけ**（新ロジック皆無）→ design-screen のみ → 薄い計画 → implement（define-feature 不要＝design-spec が要件成果物）
- **ロジックだけ**（UIなし。cron/API 等）→ define-feature のみ → implement
- **両方** → 螺旋

## 新規作成 / 既存改修（どちらも同じ仕組み）
| | 新画面作成 | 既存画面の改修 |
|---|---|---|
| 起点 | ロジック寄り→define-feature／UI 寄り→design-screen | たいてい design-screen（UI 駆動） |
| requirements | greenfield（ストーリー/データ/API/DB/migration） | delta（既存挙動を参照し差分だけ） |
| design-spec | 画面ごとに分割可 | 1枚（現状=before を起点に） |
| 現状把握 | 近い既存画面＋`ui_kits/` 参照 | 対象画面のコード/トークン/データを snapshot |

現状把握の出し分けは design-screen の Step1 が、greenfield/delta は define-feature が、それぞれ内部で吸収する。連結（同居・宿題・収束ゲート）は新規/改修で同一。

> このフローは `/define-feature`・`/design-screen` の SKILL.md から参照される正典。変更時はこの1ファイルを直す。
