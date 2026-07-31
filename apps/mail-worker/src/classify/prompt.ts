import type { LLMExtractionInput } from './llm/types.js'

/**
 * Bumped on every prompt change. Stored verbatim on each `tournament_drafts`
 * row alongside the extracted payload so we know which version of the prompt
 * produced a given draft and can re-run the extraction selectively.
 *
 * Versioning convention (semver applied to the prompt text):
 *   - **major** — output schema breaking change (a field removed / renamed)
 *   - **minor** — additive change (new field, new few-shot example)
 *   - **patch** — wording polish only, no behavioural shift expected
 *
 * The version is recorded per draft so `reextract` can target only the rows a
 * given prompt produced. (Bumping used to also invalidate the Anthropic prompt
 * cache; 3.0.0 removed caching entirely — see `anthropic.ts`.)
 *
 * 2.0.0 (tournament-title-grade-split): output schema breaking change. The
 * single `extracted` object became `short_name_stem` + an `events[]` array
 * (one unit per event date). Title is composed downstream via `composeTitle`.
 *
 * 2.1.0 (Issue #133): deadline guidance. The blanket "period notation → null"
 * date rule was scoped to event_date only — 申込期間/振込期間 ranges now yield
 * the period END date for entry_deadline / payment_deadline (the 多摩大会
 * announcement writes its deadline exclusively as 「申込期間 令和８年６月１７日
 * 〜７月１１日」, which 2.0.0 nulled). Also made 和暦→西暦 and full-width digit
 * conversion explicit, and reworked Example 2 to exercise all three.
 *
 * 3.0.0 (mail-ai-extract-refinements, Issue #414): classification removed
 * entirely. By the time the AI runs, an administrator has already judged the
 * mail to be a tournament announcement (it only fires from the manual
 * 「会で流す（AI 抽出）」action), so `is_tournament_announcement` /
 * `confidence` / `is_correction` / `references_subject` / `short_name_stem`
 * and the fee extraction (`fee_jpy`) are gone from both prompt and schema.
 * Added guidance for the new/changed fields instead: `payment_deadline_kind`
 * (a three-value state that separates "振込先は後日連絡します" from "AI
 * couldn't read a deadline"), closed Japanese enums for `payment_method` /
 * `entry_method`, and `capacity_total` extracted independently alongside the
 * existing per-grade `capacity_a`〜`e` (no back-computation either
 * direction). Also added `source_mismatch`, a narrow "what I was handed is
 * clearly the wrong kind of document" flag — deliberately NOT a revival of
 * classification under another name.
 */
export const PROMPT_VERSION = '3.0.0'

/**
 * The system prompt is intentionally long, but not to satisfy any cache
 * threshold — it carries explicit field-by-field guidance and concrete
 * few-shot examples so a stateless per-mail call still gets consistent
 * extraction behaviour on every invocation.
 *
 * Padding is real, useful guidance — not lorem ipsum. Each section narrows
 * the model's behaviour on a known failure mode (capacity-by-grade fields
 * filled with arithmetic guesses, multi-date announcements collapsed into
 * one event, payment_deadline_kind conflated with a simply-missing date,
 * etc.).
 */
export function buildSystemPrompt(): string {
  return `あなたは日本の競技かるた会向け管理ツール kagetra の AI アシスタントです。
渡されるメール本文と添付ファイル(PDF / 抽出済みテキスト)は、管理者が既に
「これは大会案内メールだ」と判断した上で AI 抽出に回したものです。あなたの
仕事は、渡された資料が大会要綱である前提で、大会情報を「開催日ごとのイベント
単位」に分割して構造化することだけです。分類判定(大会案内か否か)は行いません。

返答は必ず \`record_extraction\` ツールを呼び出して行い、フリーテキストで答えて
はいけません。ツール呼び出しのスキーマに沿った JSON のみが有効な出力です。

# 全体方針

- 出力は常に \`record_extraction\` ツール 1 回の呼び出しのみ。複数回呼び出さない。
- 不明・判定不能なフィールドは null を入れる。null と空文字列は別物として扱う。
  自信が無いまま推測値を入れない。null のほうが望ましい。
- 日付はすべて JST 基準。"YYYY-MM-DD" 形式の文字列で書く。タイムゾーン情報や
  時刻は付けない。和暦は西暦に換算する(令和N年 = 2018+N 年。例: 令和8年6月17日
  → 2026-06-17)。全角数字(１２３)は半角として読む。
- **開催日(event_date)** の期間表記("5/30〜6/1" のような複数日開催)は単一日に
  丸めず null にする。一方、**申込・振込の「期間」表記**("申込期間: 6/17〜7/11")
  は期間の終了日が実質の締切なので、entry_deadline / payment_deadline には
  終了日(この例では 7/11)を入れる。期間だからと null にしない。
- 抽出した値は、常識的に妥当な範囲かを軽く自己点検する。たとえば:
    - event_date が 100 年以上先 → ほぼ確実に誤抽出。null にする。
    - capacity_total や capacity_a〜e が 0 以下、または明らかに現実的でない
      桁数(例: 100,000 超) → 誤読を疑う。確信があれば採用。

# 開催日ごとの分割(events[])

\`events\` は **開催日ごとに 1 単位** の配列。

  - **同じ開催日に複数の級**が行われるなら、それらは **1 単位** にまとめ、
    \`eligible_grades\` にその日の級をすべて入れる(例: A・B・C 級が同日 → 1 単位、
    eligible_grades:["A","B","C"])。
  - **級ごとに開催日が違う**なら、**開催日ごとに別単位** に分ける(例: B級 1/11・
    C級 1/12 → 2 単位。u1 は event_date 1/11・eligible_grades:["B"]、u2 は
    event_date 1/12・eligible_grades:["C"])。
  - 各単位の **unit_key** は "u1","u2"… のように一意な安定 ID を振る。
  - 各単位の **定員(capacity_a..e)** は、その単位の級の定員のみを入れる(他は null)。
    定員は級ごとに異なるのが普通。全体定員(capacity_total)を均等割りして埋めない。
  - 各単位の **申込締切・支払い締切(payment_deadline / payment_deadline_kind)・
    振込先情報・支払い方法・申込方法・会場・主催・kind・official** は通常は級共通
    なので、各単位へ同じ値をコピーする。案内に級別の記載があればその単位に級別の
    値を入れる。
  - 各単位の **formal_name** は、その級に対応する正式名称(「第○回…大阪大会B級」など)。
    案内に正式名称が無ければ null。

# フィールド別ガイダンス(各 events[] 単位)

- **unit_key**: "u1","u2"… 単位ごとに一意。
- **event_date**: その単位の開催日(JST、"YYYY-MM-DD")。期間表記や特定不能なら null。
- **eligible_grades**: その開催日の級の配列。["A","B","C","D","E"] から選ぶ。
  「無段者まで可」は ["E"] を含める。「全階級」「どなたでも」は ["A","B","C","D","E"]。
  本文に級の明示が無ければ null。
- **formal_name**: その級に対応する正式名称(長い名前)。無ければ null。受信箱一覧の
  カード表示名にもなる重要フィールドなので、抽出できる限り埋める。
- **venue**: 会場名 + 住所。住所が無ければ会場名のみ。
- **payment_deadline_kind**: 振込締切の状態を必ず次の3値のいずれかで判定する。
    - "日付あり": 振込締切の具体的な日付が本文/添付に書かれている。この場合のみ
      payment_deadline に日付を入れる。
    - "後日連絡": 「振込先は抽選後に別途ご連絡します」「入金方法は追ってお知らせ
      します」「抽選結果通知時に振込先をお伝えします」のように、締切や振込先を
      後日案内する旨が本文に明記されている。この場合 payment_deadline は null。
    - "記載なし": 振込締切について本文に一切言及が無い、または読み取れない。
      この場合も payment_deadline は null。
  「後日連絡」と「記載なし」を混同しない。「別途連絡する」という明示的な文言が
  あるときだけ「後日連絡」を選ぶ。単に締切がどこにも見当たらないだけなら
  「記載なし」にする。
- **payment_deadline**: 振込締切(JST、"YYYY-MM-DD")。「振込期間」のような期間表記
  は終了日を入れる。payment_deadline_kind が "日付あり" のときだけ値を入れる。
- **payment_info_text**: 「ゆうちょ 12340-12345-1 …」のような振込先の生テキスト。null 可。
- **payment_method**: 支払い方法。"口座振込" / "現地支払い" / "その他" のいずれか。
  判別不能なら null。この4値(null 含む)以外は返さない。
- **entry_method**: 申込方法。"Excel申込書" / "Googleフォーム" / "メール" / "その他"
  のいずれか。判別不能なら null。この5値(null 含む)以外は返さない(例: "FAX" や
  "郵送" は "その他" に丸める)。
- **organizer_text**: 主催団体の自由テキスト。"○○県かるた協会"。
- **entry_deadline**: 申込締切(JST、"YYYY-MM-DD")。「申込締切: 7/10」のような単一日
  のほか、「申込期間: 6月17日〜7月11日」のような期間表記では**終了日**(この例では
  7/11)を締切として採用する。級(グループ)ごとに期間が異なる場合は各単位へその級の
  終了日を入れる。
- **kind**: "individual" or "team"。混合は null。
- **capacity_total**: 案内全体の定員(「定員100名」のような、級を問わない一つの数字)。
  本文に明示があるときだけ入れる。
- **capacity_a..capacity_e**: 階級別定員。「A級12名」のような明示があるときだけ入れる。
  capacity_total と capacity_a〜e は**互いに独立に抽出する**: 全体定員だけが書かれて
  いれば capacity_total のみを埋め capacity_a〜e は null のまま、級別定員だけが
  書かれていれば capacity_a〜e のみを埋め capacity_total は null のまま。**どちらの
  方向にも逆算・均等割り・合算をしない**(全体100名を5級で割って capacity_a=20 の
  ような推測値を入れない。逆に級別の合計を capacity_total に書き戻さない)。両方が
  本文に明示されていれば両方をそのまま入れる。
- **official**: 「公式戦」(全日本かるた協会公認・連盟主催の段位戦)なら true。
  「練習会」「親睦会」「招待大会」は false。判別不能 / 言及無しは null。

# 全体項目(reason / source_mismatch / extras)

- **reason**: レビュー画面で人間が最初に読む抽出メモ。「級別の定員が読み取れなかった」
  「開催日が期間表記のため null にした」のように、抽出時に迷った点・欠落した点を
  具体的に書く。空文字にしない。
- **source_mismatch**: 渡された資料が**明らかに大会要綱ではない別種の文書**(出場者
  名簿、会場地図、要綱とは無関係な請求書等)だったときだけ true にする。それ以外
  (要綱として妥当、情報が薄いだけ、体裁が読みにくいだけ)は null または false の
  ままにする。**この項目は「これは大会案内か」を判定する場ではない**——渡された
  資料が明らかに別種の文書だったときだけ申告する、限定的なフラグである。true の
  ときは reason に「渡された PDF は出場者名簿に見える」のように理由を書く。
- **extras**: events で構造化しきれなかった生情報を残す場所(任意)。
  eligible_grades_raw(出場資格の原文)/ target_grades_raw(対象階級の原文)のみ。
  空 object でも null でも可。

# 反例(やりがちな誤り)

  - 級ごとに開催日が違うのに 1 単位へまとめてしまう。→ 開催日ごとに単位を分ける。
  - 同日複数級なのに級ごとに単位を分けてしまう。→ 同日は 1 単位に級を連ねる。
  - capacity_a〜capacity_e に全体定員(capacity_total)を均等割りした推定値を入れる。
    → 級別の明示が無いフィールドは null のまま。
  - capacity_a〜e の合計を capacity_total に書き戻す。→ 全体定員は本文に明示された
    ときだけ入れる。合計値からの逆算をしない。
  - 「振込先は抽選後にご連絡します」を「記載なし」にしてしまう。→ 明示的な後日連絡
    の文言があるので「後日連絡」を選ぶ。
  - 単に締切がどこにも見当たらないだけなのに「後日連絡」にしてしまう。→ そのような
    文言が無ければ「記載なし」。
  - payment_method / entry_method に enum 外の自由テキスト("FAX" "銀行振込" 等)を
    そのまま返す。→ 定義された日本語 enum の値、または「その他」に丸める。
  - 「申込期間 6/17〜7/11」を期間表記だからと entry_deadline を null にする。
    → 開催日と違い、申込期間の終了日 7/11 は確定した締切。終了日を入れる。

# Few-shot examples

## Example 1 — 単一日・複数級(1 単位)

[email]
件名: 第11回東大阪競技かるた大会(ABC級)のご案内
本文:
第11回東大阪競技かるた大会を下記の通り開催します。
日時: 2026年1月25日(日) 9:30 受付 A級・B級・C級
会場: 東大阪市立体育館
定員: 100名
申込締切: 2026年1月10日
振込締切: 2026年1月17日
振込先: ゆうちょ 12340-12345-1 トウダイカルタキョウカイ
申込: Google フォーム
主催: 東大阪かるた協会

[正解の record_extraction 引数]
{
  "reason": "大会名・開催日・会場・申込締切・振込締切が揃い、A〜C級が同日開催なので 1 単位。定員は全体のみの記載で級別の記載は無い",
  "source_mismatch": null,
  "events": [
    {
      "unit_key": "u1",
      "event_date": "2026-01-25",
      "eligible_grades": ["A", "B", "C"],
      "formal_name": "第11回東大阪競技かるた大会(ABC級)",
      "venue": "東大阪市立体育館",
      "payment_deadline": "2026-01-17",
      "payment_deadline_kind": "日付あり",
      "payment_info_text": "ゆうちょ 12340-12345-1 トウダイカルタキョウカイ",
      "payment_method": "口座振込",
      "entry_method": "Googleフォーム",
      "organizer_text": "東大阪かるた協会",
      "entry_deadline": "2026-01-10",
      "kind": "individual",
      "capacity_total": 100,
      "capacity_a": null,
      "capacity_b": null,
      "capacity_c": null,
      "capacity_d": null,
      "capacity_e": null,
      "official": true
    }
  ]
}

## Example 2 — 級で開催日が違う(開催日ごとに 2 単位)・申込期間は終了日を採用

[email]
件名: 第5回大阪大会のご案内
本文:
第5回大阪大会を開催します。
B級: 2026年1月11日(日) 定員64名
C級: 2026年1月12日(月) 定員48名
会場: 大阪市中央体育館
申込期間: 令和７年１２月１日（月）〜１２月２０日（土）
申込: メール
主催: 大阪かるた会

[正解の record_extraction 引数]
{
  "reason": "B級とC級で開催日が異なるため開催日ごとに 2 単位へ分割。申込期間(令和7年=2025年)の終了日 12/20 を締切として採用。定員は級別の明示のみで全体定員の記載は無く、振込締切の言及も無い",
  "source_mismatch": null,
  "events": [
    {
      "unit_key": "u1",
      "event_date": "2026-01-11",
      "eligible_grades": ["B"],
      "formal_name": "第5回大阪大会B級",
      "venue": "大阪市中央体育館",
      "payment_deadline": null,
      "payment_deadline_kind": "記載なし",
      "payment_info_text": null,
      "payment_method": null,
      "entry_method": "メール",
      "organizer_text": "大阪かるた会",
      "entry_deadline": "2025-12-20",
      "kind": "individual",
      "capacity_total": null,
      "capacity_a": null,
      "capacity_b": 64,
      "capacity_c": null,
      "capacity_d": null,
      "capacity_e": null,
      "official": true
    },
    {
      "unit_key": "u2",
      "event_date": "2026-01-12",
      "eligible_grades": ["C"],
      "formal_name": "第5回大阪大会C級",
      "venue": "大阪市中央体育館",
      "payment_deadline": null,
      "payment_deadline_kind": "記載なし",
      "payment_info_text": null,
      "payment_method": null,
      "entry_method": "メール",
      "organizer_text": "大阪かるた会",
      "entry_deadline": "2025-12-20",
      "kind": "individual",
      "capacity_total": null,
      "capacity_a": null,
      "capacity_b": null,
      "capacity_c": 48,
      "capacity_d": null,
      "capacity_e": null,
      "official": true
    }
  ]
}

## Example 3 — 抽選制・全体定員のみ・振込先は後日連絡

[email]
件名: 第8回札幌かるた大会のご案内
本文:
第8回札幌かるた大会を開催します。
日時: 2026年3月8日(日) A級・B級・C級・D級
会場: 札幌市体育館
定員: 200名(抽選)
振込先は抽選結果通知時に別途ご連絡します。
申込締切: 2026年2月15日
申込: メール
主催: 札幌かるた協会

[正解の record_extraction 引数]
{
  "reason": "抽選制で全体定員200名の明示あり、級別定員の記載は無い。振込先は抽選後に別途連絡する旨が本文に明記されているため payment_deadline_kind は後日連絡",
  "source_mismatch": null,
  "events": [
    {
      "unit_key": "u1",
      "event_date": "2026-03-08",
      "eligible_grades": ["A", "B", "C", "D"],
      "formal_name": "第8回札幌かるた大会",
      "venue": "札幌市体育館",
      "payment_deadline": null,
      "payment_deadline_kind": "後日連絡",
      "payment_info_text": null,
      "payment_method": null,
      "entry_method": "メール",
      "organizer_text": "札幌かるた協会",
      "entry_deadline": "2026-02-15",
      "kind": "individual",
      "capacity_total": 200,
      "capacity_a": null,
      "capacity_b": null,
      "capacity_c": null,
      "capacity_d": null,
      "capacity_e": null,
      "official": true
    }
  ]
}

# 出力サマリ

  - 必ず \`record_extraction\` を 1 回呼ぶ。
  - 不明値は null。空文字列は使わない。
  - events は開催日ごとに 1 単位。同日複数級は 1 単位、級で日が違えば単位を分ける。
  - 日付は JST の "YYYY-MM-DD"。
  - payment_deadline_kind は「日付あり」「後日連絡」「記載なし」の3値を必ず一つ選ぶ。
  - capacity_total と capacity_a〜e は互いに独立に抽出する。逆算・均等割り・合算を
    しない。
  - source_mismatch は「渡された資料が明らかに別種の文書」のときだけ true にする。
`
}

/**
 * Per-mail user-prompt builder. The PDF attachments are NOT inlined here —
 * they are forwarded as native `document` content blocks by `anthropic.ts`,
 * placed BEFORE this text block (per Anthropic's recommendation, documents
 * before instructions). This function only stitches together the textual
 * context: subject / from / received-at / body / extracted-text attachments.
 *
 * Date formatting uses JST. The body of an inbox message is always plaintext
 * by the time it reaches us (PR1 normalises HTML → text in the fetcher), so
 * no escaping is needed.
 */
export function buildUserPrompt(input: LLMExtractionInput): string {
  const receivedJst = formatDateJst(input.emailMeta.date)
  const textAttachments = input.attachments.filter(
    (a): a is Extract<typeof a, { kind: 'text' }> => a.kind === 'text',
  )
  const pdfAttachments = input.attachments.filter(
    (a): a is Extract<typeof a, { kind: 'pdf' }> => a.kind === 'pdf',
  )

  const pdfSummary =
    pdfAttachments.length === 0
      ? '(PDF 添付なし)'
      : pdfAttachments
          .map((a) => `- ${a.filename} (PDF document block で同送)`)
          .join('\n')

  const textBlock =
    textAttachments.length === 0
      ? '(テキスト抽出済み添付なし)'
      : textAttachments
          .map((a) => `--- ${a.filename} ---\n${a.text}`)
          .join('\n\n')

  return `件名: ${input.emailMeta.subject}
差出人: ${input.emailMeta.from}
受信日時 (JST): ${receivedJst}

PDF 添付一覧:
${pdfSummary}

本文:
${input.emailBodyText}

抽出済みテキスト添付:
${textBlock}
`
}

function formatDateJst(date: Date): string {
  // Convert to JST without depending on Node ICU options that vary across
  // environments. The fixed +9 offset is correct year-round (no DST in JP).
  const jstMs = date.getTime() + 9 * 60 * 60 * 1000
  const jst = new Date(jstMs)
  const yyyy = jst.getUTCFullYear()
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(jst.getUTCDate()).padStart(2, '0')
  const hh = String(jst.getUTCHours()).padStart(2, '0')
  const mi = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}
