# Kagetra Design 設計書

かげとら — 競技かるた部向けグループウェア `kagetra_new` のリデザイン案。
本ファイルは **設計の意思決定と全体像** を1枚にまとめたもの。
詳細なトークン定義・スキル manifest はそれぞれ `colors_and_type.css` / `README.md` / `SKILL.md` を参照。

---

## 0. 目次

1. プロダクト概要
2. 設計方針 (和紙 × 藍墨)
3. 情報設計とナビゲーション
4. 画面仕様 (全 8 画面)
5. コンポーネント設計
6. デザイントークン (抜粋)
7. コピー・文言ルール
8. 決定事項 / 未決事項
9. 実装移行ガイド (upstream `kagetra_new` へのパッチ方針)
10. 今後の展開 (Phase 2+)
11. ファイル索引

---

## 1. プロダクト概要

- **対象** : 約 100 名の競技かるた部 (会員制・招待制)。
- **ユーザ** : `admin` / `vice_admin` / `general` の 3 ロール。LINE ログインのみ。
- **中核価値** : 大会・練習などのイベントに対して、誰が参加するかを素早く把握・回答できること。
- **コア動線**
  1. LINE でログイン → 初回のみ会員一覧から自分を選ぶ (self-identify)
  2. ホームで今後の予定を一覧し、参加/不参加を回答
  3. イベント詳細で誰が来るかを見る
  4. 管理者は大会を作成し、級別集計とリマインドを送る
- **Phase 2+** (未着手) : 大会結果/統計、AI 要項取り込み、旅費見積、アルバム、BBS、wiki、住所録。

---

## 2. 設計方針 — 和紙 × 藍墨

> upstream `kagetra_new` は初期段階で `--color-brand: #00b900` (LINE グリーン) が暫定で入っているだけ。
> 本システムはそれを **「和紙 × 藍墨」** に置き換える方向を提案する。

### なぜこの方向か

- **競技かるた** は 100 人一首という文学的・古典的な題材。SaaS 的なプラスチックな UI より、和紙と墨を思わせるトーンが文脈に合う。
- 青一色の企業風より、**藍 (深い青)** + **朱 (差し色)** の二色で「肯定 / 否定」を即座に読ませるのが、出欠管理というドメインにも合致する。
- グリーンは LINE 認証ボタンだけで使えばよく、プロダクト全体のブランドカラーにする必要がない。

### 視覚原則

| 原則 | 実装 |
|---|---|
| **Warm washi surfaces** | 背景は `#F4EFE3`、カードは `#FBF7ED`。純白 `#FFF` は使わない |
| **Two-tone semantic palette** | 肯定 = 藍、否定 = 朱、それ以外は砂ニュートラル。紫の会議ピル・橙の懇親会ピルは作らない |
| **Serif for identity, sans for interaction** | 18px 以上の見出し・ワードマーク・大きな数字は Noto Serif JP。それ以外は Noto Sans JP |
| **Warm-tinted shadows** | `rgba(60,45,20, ...)`。純黒影は和紙の上で「汚れ」に見える |
| **Restrained radii** | ボタン/入力 6px、カード 8px、シート 12px。これ以上丸めない |
| **No decoration** | グラデ・写真・アバター画像・絵文字・ダークモード、いずれも使わない |

### 基調カラー

- **藍 (brand)** `#2B4E8C` — ワードマーク / 主要 CTA / アクティブタブ / フォーカス / 肯定ピル
- **朱 (accent)** `#B33C2D` — 不参加 / 締切警告 / 必須マーク / エラー / 破壊的操作
- **LINE green** `#06c755` — LINE 認証ボタン **だけ**
- **和紙 (canvas)** `#F4EFE3` / **surface** `#FBF7ED` / **recessed** `#F0EADC`
- **墨 (ink)** `#1E1B13` (primary) / `#3A342A` (secondary) / `#7A6E5A` (meta)

### タイポグラフィ (早見)

| サイズ | 用途 | family / weight |
|---|---|---|
| 28px | イベント詳細タイトル | Serif 700 |
| 22px | セクション見出し (今後の予定) | Serif 500 |
| 20px | ワードマーク | Serif 700 (letter-spacing 0.03em) |
| 18px | カード見出し (出欠状況) | Sans 700 |
| 16px | リストタイトル | Sans 500 |
| 15px | 本文・ボタン・入力 | Sans 400 |
| 13px | メタ・ラベル | Sans 400 |
| 12px | ピル | Sans 500 |

---

## 3. 情報設計とナビゲーション

### グローバル構造

```
┌─────────────────────────────┐
│ [ワードマーク]      {name}さん │  sticky top header (mobile)
├─────────────────────────────┤
│                             │
│           主コンテンツ        │
│                             │
├─────────────────────────────┤
│ ホーム │ イベント │ 予定 │ 会員 │  sticky bottom tab (mobile)
└─────────────────────────────┘
```

- **モバイル 375 × 812** が基準。デスクトップは管理テーブル画面のみ `max-w-5xl` (1024px)。
- **タブは 4 個** : ホーム / イベント / 予定 / 会員。5 個以上にしない。
- **ヘッダ** は左にワードマーク、右に `{name}さん`。設定は `{name}さん` をタップしてシート。

### ルーティング構想 (upstream 想定)

| パス | 画面 | ロール |
|---|---|---|
| `/auth/signin` | LINE ログイン | 全員 (未認証) |
| `/auth/self-identify` | 会員一覧から自分を選ぶ | 全員 (初回のみ) |
| `/` | ダッシュボード (今後の予定タイムライン) | 全員 |
| `/events` | イベント一覧 | 全員 |
| `/events/[id]` | イベント詳細 + RSVP | 全員 |
| `/events/new` | イベント作成 | admin / vice_admin |
| `/events/[id]/admin` | 級別集計・未回答者リマインド | admin / vice_admin |
| `/members` | 会員一覧 | 全員 |
| `/members/[id]` | 会員詳細 | 全員 |

---

## 4. 画面仕様

以下 8 画面は `ui_kits/kagetra-mobile/` 配下に React/JSX で実装済み (張りぼて)。

### 4-1. ダッシュボード (`/` , ホームタブ)

**目的** : 今後のイベントを時系列で俯瞰し、自分の参加状況と他メンバーの参加状況をスキャンする。

**レイアウト** : 縦タイムライン。左に日付チップ、中央にマーカー付き縦線、右にイベントカード。

```
┌──────────────────────────┐
│ 今後の予定                  │  Serif 18/700
│ 3件のイベント                │  meta 12
│                           │
│ ┌──┐ ●─┬─────────────┐ │
│ │10月│   │ 全国大会予選      │ │  card title Sans 14/600
│ │ 5 │   │ 締切 10/01      │ │  meta 11
│ └──┘   │ [橋本][田中][...]│ │  名字チップを全員、級の若い順
│        └─────────────┘ │
│ ┌──┐ ○─┬─────────────┐ │
│ │10月│   │ 月例練習         │ │
│ │12 │   │ まだ参加表明なし   │ │
│ └──┘   └─────────────┘ │
└──────────────────────────┘
```

**決定事項**
- 参加者は **苗字チップを全員表示** (アバターでなく)。**級の若い順** (A→E) でソート。
- 自分が参加しているイベントには、タイトル右に `参加` ピル + タイムラインのドットを藍塗りつぶしにする。
- 「会内締切」ではなく **「締切」** と短く表記。
- **表示しない** : 公認/非公認バッジ・会場・時間。情報過多を避ける。タイトルで伝える。
- **表示しない** : `draft` / `done` / `cancelled` のイベント。`published` のみ。

**未決**
- 遠い将来のイベント (3ヶ月以上先) の扱い — 現時点では同列。
- 「過去のイベント」タブの有無 — 現時点では省略。

### 4-2. イベント詳細 (`/events/[id]`)

**目的** : 1つのイベントに関するすべての情報を1画面で。RSVP を即座に取る。

**レイアウト** : 単列スクロール。画面下に sticky な `参加する` / `参加をキャンセル` ボタン。

```
┌──────────────────────────┐
│ ← イベント一覧              │  back link
│                           │
│ 全国大会予選                │  Serif 28/700
│ [公認]                     │  status pill
│                           │
│ ─ 日時 ─────────────────  │
│ 2025/10/05  09:00〜17:00  │  DescList
│ ─ 会場 ─────────────────  │
│ 東京体育館                   │
│ ─ 対象 ─────────────────  │
│ A級・B級                    │
│ ─ 定員 ─────────────────  │
│ 30名                       │
│ ─ 会内締切 ──────────────  │
│ 2025/10/01                 │
│                           │
│ 出欠状況                    │  Sans 18/700
│ ┌──┐┌──┐┌──┐          │
│ │参加││不参加││未回答│          │  AttendanceCounts (3カードグリッド)
│ │ 12││  3 ││  5 │          │  数字は Serif 700
│ └──┘└──┘└──┘          │
│                           │
│ 参加者                      │
│ [橋本 A級][田中 A級]...     │  苗字 + 級 chip、級の若い順
│                           │
│ [      参加する        ]   │  sticky bottom
└──────────────────────────┘
```

**決定事項**
- 出欠バーグラフは **使わない** 。3つのタイル (`参加 / 不参加 / 未回答`) のみ。バーは割合を誤認させる。
- RSVP は `参加する` ボタン 1 個のみ。タップで `参加をキャンセル` にトグル。不参加は別画面でシート (下記)。
- 参加者は **級の若い順** 。苗字 + 級チップのペアで表示。
- 必須情報がなければ `DescList` の行ごと省略 (例 : 定員なしなら「定員」行を出さない)。

### 4-3. RSVP シート (モーダル, `/events/[id]` から開く)

**目的** : `参加` だけでなく `不参加 / 未定 + コメント` を送る。

**レイアウト** : 画面下から 80% の高さで立ち上がるボトムシート。

- セグメント `参加 / 不参加 / 未定`
- コメント (任意, textarea)
- `[キャンセル]` (secondary) / `[回答する]` (primary)

### 4-4. ログイン (`/auth/signin`)

**レイアウト** : 画面中央に `12px` 角丸のシート。
- 上部 : ワードマーク `かげとら` (Serif 700 / 藍)
- 本文 : `LINE アカウントでログインします。`
- CTA : LINE 緑フルワイドボタン `LINE でログイン` (Sans 600, `#06c755`)

**唯一 LINE グリーンが使われる画面。**

### 4-5. 会員一覧 (`/members`)

**レイアウト** : 検索 + 縦リスト。各行 : 苗字チップ / 名前 / 級ピル / `退会` タグ (退会者のみ)。

- 検索ヒット 0 件 : `一致する会員が見つかりません。` (fragment, no period)
- 行タップで会員詳細へ。

### 4-6. 会員詳細 (`/members/[id]`)

**レイアウト** : カード 1 枚。
- ヘッダ : 苗字チップ (大, 48px) + 名前 (Serif 22/700) + 級ピル
- `DescList` : メール、入会日、LINE 連携状態
- 管理者のみ : `編集` ボタン (primary)

### 4-7. イベント作成 (`/events/new`, 管理者のみ)

**レイアウト** : 縦1列のフォーム。
- タイトル / 種類 (radio: 大会・練習・会議・懇親会・その他) / 公認 (checkbox) / 日付 / 開始時刻 / 終了時刻 / 会場 / 対象級 (A-E checkbox) / 定員 / 締切 / 詳細 (textarea)
- ペア項目 (開始/終了) は 2 カラムグリッド `gap 12px`。
- 必須マークは 朱 `*` (`margin-left: 2px`)。
- フッタ : `[キャンセル]` / `[作成]`

### 4-8. 管理者 出欠集計 (`/events/[id]/admin`, 管理者のみ)

**レイアウト** :
- 上部 : 級別集計テーブル (A〜E 行, `招待 / 参加 / 不参加 / 未回答` 列)
- 中部 : 未回答者リスト (苗字チップ + 名前 + `リマインド` 小ボタン)
- 下部 : `全員にリマインド送信` ボタン (primary)

---

## 5. コンポーネント設計

`ui_kits/kagetra-mobile/primitives.jsx` 内で定義され `window` に露出。

| コンポーネント | 役割 |
|---|---|
| `MobileFrame` | 375×812 iOS 風外枠 + sticky ヘッダ + タブ |
| `AppBar` | ワードマーク + `{name}さん` |
| `Card` | `#FBF7ED` 背景 + `1px #E6DDC4` 枠 + 暖色シャドウ |
| `Btn` | `primary` / `secondary` / `danger` / `line` |
| `Pill` | 小ラベル。`tone = success \| danger \| info \| neutral` |
| `StatusPill` | イベント状態 (`公開 / 中止 / 終了 / 下書き / 公認 / 非公認`) を tone にマップ |
| `GradePill` | `A級`〜`E級`、砂 info tone 固定 |
| `Avatar` | 苗字 1 文字チップ。24 / 32 / 48 の 3 サイズ |
| `AvatarStack` | 苗字チップを横に並べる (詳細画面ではなく、昔の案。ダッシュボードでは苗字全員表示に置換) |
| `DescList` | イベント詳細の `─ ラベル ─ / 値` リスト |
| `AttendanceCounts` | 出欠 3 タイル (参加 / 不参加 / 未回答)。数字は Serif 700 |
| `SectionLabel` | Serif 22/500 の節見出し |

**命名規則** : 共通コンポーネントは `window.Card` のように global 露出。画面コンポーネント (`Dashboard`, `EventDetail`, ...) も同様。style オブジェクトは画面名プレフィックス (`dashboardStyles` など) で衝突を避ける。

---

## 6. デザイントークン (抜粋)

詳細は `colors_and_type.css` (全量), UI kit 内 `palette.css` (画面プレビュー用) を参照。

```css
/* 色 */
--kg-brand:        #2B4E8C;  /* 藍 */
--kg-brand-hover:  #213C6D;
--kg-accent:       #B33C2D;  /* 朱 */
--kg-line-green:   #06C755;

--kg-canvas:       #F4EFE3;
--kg-surface:      #FBF7ED;
--kg-surface-alt:  #F0EADC;

--kg-border-soft:  #E6DDC4;
--kg-border:       #D8CDB3;
--kg-border-strong:#B8AA8A;

--kg-ink:          #1E1B13;
--kg-ink-2:        #3A342A;
--kg-ink-meta:     #7A6E5A;
--kg-ink-mute:     #A99C82;

/* semantic pair */
--kg-success-bg:   #E6EDF7;  --kg-success-fg: #1E3A6B;   /* 藍 */
--kg-danger-bg:    #F7E6E2;  --kg-danger-fg:  #8F2D20;   /* 朱 */
--kg-info-bg:      #EAE4D1;  --kg-info-fg:    #5B4F33;   /* 砂 */
--kg-neutral-bg:   #EBE3CE;  --kg-neutral-fg: #5B4F33;   /* 砂 */

/* 形 */
--kg-radius-sm: 3px;  --kg-radius-md: 6px;
--kg-radius-lg: 8px;  --kg-radius-xl: 12px;  --kg-radius-full: 9999px;

/* 影 (warm-tinted) */
--kg-shadow-sm:  0 1px 2px  rgba(60,45,20,.06);
--kg-shadow-md:  0 4px 12px rgba(60,45,20,.10);
--kg-shadow-lg:  0 10px 24px rgba(60,45,20,.14);
--kg-shadow-fab: 0 6px 16px rgba(60,45,20,.18);

/* type */
--kg-font-display: "Noto Serif JP","Yu Mincho","Hiragino Mincho ProN",serif;
--kg-font-sans:    "Noto Sans JP",ui-sans-serif,system-ui,"Hiragino Sans","Yu Gothic",sans-serif;

/* 間隔 (4px step) — 4 · 8 · 12 · 16 · 20 · 24 · 32 */
```

---

## 7. コピー・文言ルール

抜粋。完全版は `README.md` § CONTENT FUNDAMENTALS 参照。

- 日本語のみ (`<html lang="ja">`)、です/ます、絵文字なし、代名詞なし (onboarding の `あなたは誰ですか？` のみ例外)。
- フォームラベル・テーブル見出しは **名詞ラベル** (`タイトル` `場所` `定員`)、句読点なし。
- ボタンは **命令形動詞 1 語** (`作成` `保存` `参加` `不参加`)。
- 時刻範囲は **波ダッシュ** `13:00〜17:00`。ハイフンは使わない。
- 日付は `2025/10/05` を優先 (DB 原本が `YYYY-MM-DD` ならそのまま)。
- ステータス正規ラベル : `下書き / 公開 / 終了 / 中止 / 公認 / 非公認 / 練習 / 会議 / 懇親会 / その他`。
- エラー : 完全文 + 句点。空状態 : 断片 + 句点なし。
- `LINE` は常にラテン大文字、`ライン` と書かない。

---

## 8. 決定事項 / 未決事項

### 決定済み

- [x] 基調 : 和紙 × 藍墨 (Style B)。LINE グリーンは認証ボタン限定。
- [x] ダッシュボードは縦タイムライン、参加者は苗字チップ全員・級の若い順。
- [x] イベント詳細は出欠バーなし、3タイル集計 + 参加者リスト。
- [x] RSVP はメイン CTA `参加する` 1 個 + トグル。詳細な回答はシート。
- [x] アバター画像なし。苗字チップで統一。
- [x] 2 トーン semantic (藍=肯定 / 朱=否定 / 砂=その他)。
- [x] Serif display + Sans body の 2 ファミリー体制。
- [x] 絵文字・ダークモード・アニメーションは採用しない。

### 未決

- [ ] Phase 2+ (大会結果・AI 要項取り込み・アルバム・BBS・wiki) の情報設計。
- [ ] 通知履歴画面 (LINE プッシュの既読/未読管理が必要か)。
- [ ] `ホーム` と `イベント` タブの差分。現状はタイムライン vs リスト想定だが、重複する可能性。
- [ ] 過去イベント参照 UI (戦績/結果とどう紐付けるか)。
- [ ] 管理者リマインドの粒度 (全員一括 / 級別 / 個別) を現状案では「全員」と「個別」のみ提示。
- [ ] フィルタ/検索の詳細 (イベント種類・級・期間・出欠状態の掛け合わせ)。
- [ ] Lucide アイコン採用の正式決定 (upstream にはまだ入っていない)。

---

## 9. 実装移行ガイド — upstream `kagetra_new` へのパッチ方針

現在 `apps/web/src/app/globals.css` に以下の 1 行だけが暫定で入っている :

```css
--color-brand: #00b900;
```

これを本システムに合わせて差し替えるときの最小パッチ :

```css
/* apps/web/src/app/globals.css */
@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Noto+Serif+JP:wght@500;700&display=swap");

:root {
  /* brand */
  --color-brand:        #2B4E8C;
  --color-brand-hover:  #213C6D;
  --color-accent:       #B33C2D;
  --color-line:         #06C755;

  /* surfaces & ink */
  --color-canvas:       #F4EFE3;
  --color-surface:      #FBF7ED;
  --color-surface-alt:  #F0EADC;
  --color-border:       #D8CDB3;
  --color-border-soft:  #E6DDC4;
  --color-ink:          #1E1B13;
  --color-ink-meta:     #7A6E5A;

  /* type */
  --font-sans:    "Noto Sans JP", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Noto Serif JP", "Yu Mincho", serif;
}

body {
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
```

続いて :

1. **Tailwind 設定** : `theme.extend.colors` / `fontFamily` に上記変数をマップ。
2. **LINE ボタン** (`apps/web/src/app/auth/signin/page.tsx`) : `bg-[#06c755]` を据え置き、font-weight 600。
3. **主要 CTA** : `bg-[var(--color-brand)] text-[var(--color-surface)] hover:bg-[var(--color-brand-hover)]`。
4. **カード** : `bg-[var(--color-surface)] border border-[var(--color-border-soft)] shadow-[0_1px_2px_rgba(60,45,20,0.06)]`。
5. **ピル** : `Pill` / `StatusPill` / `GradePill` を新規に shadcn 風コンポーネントとして切り出す。

デザイン側の受け入れテストは `ui_kits/kagetra-mobile/index.html` を参照画面として行う。

---

## 10. 今後の展開 (Phase 2+ のヒント)

| 機能 | 方針の種 |
|---|---|
| 大会結果 / 統計 | 表中心。グラフを出すなら単色 (藍) の棒のみ。円グラフは使わない |
| AI 要項取り込み (PDF/Word → イベント作成) | upload ゾーンは 12px 破線 `#D8CDB3`。抽出結果は「下書き」として作成フォームにプリフィル |
| 旅費見積 | テーブル + 合計行。通貨は `¥` プレフィクス、3桁区切り |
| アルバム | グリッド 3 列 / 4px gap。サムネイルだけ初めて「写真」が出る画面になる。キャプションは Serif 14/500 |
| BBS / wiki | 本文の body は **Serif 16/400, leading 1.9** にすることで「読み物」感を出す。これが唯一 Sans から離れる場所 |
| 住所録 | 会員一覧の拡張。電話番号は tabular-nums |
| 通知履歴 | リスト。`未読` は左 3px の藍帯 + 太字、既読は通常。色で分けない |

---

## 11. ファイル索引

```
.
├── design.md                      ← このファイル
├── README.md                      ← 設計システム総論 (content / visual / index)
├── SKILL.md                       ← Claude Code skill manifest
├── colors_and_type.css            ← トークン定義 (CSS vars + semantic classes)
├── assets/
│   ├── wordmark.svg               ← Noto Serif JP / 藍 のワードマーク
│   └── icons/                     ← Lucide 抜粋 (flagged substitution)
├── preview/                       ← Design System タブ用 17 カード
│   ├── colors-brand.html          colors-neutrals.html   colors-semantic.html
│   ├── type-family.html           type-scale.html
│   ├── spacing.html               radii.html             shadows.html
│   ├── buttons.html               forms.html             banners.html
│   ├── header-nav.html            iconography.html
│   ├── card-event.html            attendance-widget.html
│   ├── table-members.html         sheet-signin.html
│   └── brand-wordmark.html
├── ui_kits/kagetra-mobile/        ← プロトタイプ本体
│   ├── index.html                 DesignCanvas で 8 画面一覧
│   ├── palette.css                UI kit 専用トークン (colors_and_type.css と同期)
│   ├── data.jsx                   MEMBERS / EVENTS シードデータ
│   ├── primitives.jsx             共通コンポーネント
│   ├── screen-dashboard.jsx       ホーム (タイムライン)
│   ├── screen-event-detail.jsx    イベント詳細 + RSVP トグル
│   ├── screen-extras.jsx          ログイン / 会員 / RSVP シート / イベント作成 / 管理集計
│   └── design-canvas.jsx          starter (pan/zoom grid)
└── explorations/                  ← 意思決定の記録 (確定していない案)
    ├── Layout Exploration.html    Style Exploration.html
    └── style-a.css style-b.css style-c.css ...
```

---

**最終更新** : Style B (和紙 × 藍墨) 確定時点。
