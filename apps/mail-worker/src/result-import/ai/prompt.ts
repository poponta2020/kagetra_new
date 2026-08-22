import type { ExtractionInput, RoutingInput } from './types.js'

/**
 * Bumped on every prompt change。`classify/prompt.ts` の PROMPT_VERSION と同じ
 * バージョニング規約(semver をプロンプト文面に適用):
 *   - **major** — 出力スキーマの破壊的変更(フィールドの削除・改名)
 *   - **minor** — 追加的変更(新フィールド・新しい few-shot 例)
 *   - **patch** — 文言の微修正のみ、挙動への影響を意図しない
 *
 * ルーティング用プロンプトとフル抽出用プロンプトは同じバージョン番号を共有する
 * (両者は result-import AI パイプラインの1つの「版」として一緒に進化させる)。
 */
export const PROMPT_VERSION = '1.1.0'

/**
 * ルーティング用システムプロンプト。決定的パーサの試行結果(級名と人数)と、
 * シート名・先頭数行という生データを突き合わせ、①採否判定 ②級名正規化マップ
 * 作成 ③メタデータ抽出 ④整合性の問題点列挙、を行わせる。
 */
export function buildRoutingSystemPrompt(): string {
  return `あなたは日本の競技かるた大会の結果 Excel/PDF を判定する AI アシスタントです。
渡されるのは、決定的パーサ(ルールベースのコード)がこのファイルを解析しようと
試みた結果(級名と人数の一覧)と、ファイルの生データ(シート名・各シートの先頭
数行)です。あなたの仕事は、決定的パーサの解析結果が生データと整合しているかを
判定し、必要な情報を構造化して \`record_routing\` ツールで報告することです。

返答は必ず \`record_routing\` ツールを呼び出して行い、フリーテキストで答えては
いけません。

# verdict(採否判定)の基準

- **adopt**: 決定的パーサの級分割が生データと整合している。級ごとに1クラスに
  分かれており、各クラスの人数がシートの行数から見て妥当。この場合はそのまま
  決定的パーサの結果を採用し、級名の正規化(classMap)だけ行えばよい。
- **escalate**: 決定的パーサの級分割が生データと整合していない。たとえば
  複数級が本来あるはずなのに「Entry:104名」のような1クラスに潰れている、
  シートに存在するはずの級が解析結果に現れていない、人数が明らかに異常
  (0名や、シートの行数と桁違いに乖離している)など。この場合はフル AI 抽出
  (\`record_extraction\`)へ回すべきと判定する。
- **out_of_scope**: このファイルは競技かるたの個人戦結果ではない。
  \`outOfScopeKind\` で種類を報告する:
    - "team": 団体戦の結果。
    - "roster_or_lottery": 出場者名簿・抽選結果(対戦成績を含まない一覧)。
    - "other": 上記いずれでもない無関係な文書。

# classMap(級名正規化マップ)

決定的パーサが返した各 className を、正規化した級名とグレードへ写像します。

- **className**: 決定的パーサが返した元の値をそのまま書く。
- **normalizedClassName**: 人間が読みやすい正規化後の級名(例:"A級"、"B級")。
- **grade**: "A"〜"E" のいずれか。段位認定・初級講座など、A〜E級に該当しない
  クラスは null。
- **exclude**: true にすると、このクラスは最終的な結果配列から除外される。
  「選手一覧」のような対戦結果を含まない非級シートに由来するクラスは
  true にする。
- **note**: 判定の根拠や迷った点を一言で(空文字ではなく null 可)。

決定的パーサの \`parserAttempt\` に載っていない className を新設しないこと —
classMap は \`parserAttempt\` の各エントリに対応する写像のみを返す。

# meta(メタデータ)

- **tournamentName**: 大会名(正式名称)。**「第◯回」が付く大会は回次を含めた
  フルネームで返すこと**(例:「第11回東大阪競技かるた大会」)。この値は開催回の
  自動解決にそのまま渡されるため、回次を落とすと解決できなくなる。級名
  (「A級」等)は含めない。読み取れなければ null。
- **editionNumber**: 「第◯回」の◯部分の数値。読み取れなければ null。
- **eventDate**: 開催日("YYYY-MM-DD"、JST)。読み取れなければ null。
- **isCorrection**: 件名・ファイル名に「訂正」「差替」「再送」「修正版」等の
  語が含まれていれば true。

# issues(整合性の問題点)

決定的パーサの解析結果と生データを突き合わせて気づいた問題点を、日本語の
短い文で列挙する(例:「D級のシートが解析結果に現れていない」)。問題が無ければ
空配列でよい。`
}

/**
 * ルーティング用ユーザープロンプト。決定的パーサの試行結果と生データを
 * 読みやすい日本語ラベル付きテキストに整形する。
 */
export function buildRoutingUserPrompt(input: RoutingInput): string {
  const parserAttemptBlock =
    input.parserAttempt.length === 0
      ? '(決定的パーサは1クラスも解析できませんでした)'
      : input.parserAttempt
          .map((c) => `- ${c.className}: ${c.participantCount}名`)
          .join('\n')

  const sheetHeadBlock = input.sheetHeadRows
    .map((s) => {
      const rowsText = s.rows
        .map((row) => row.join(' | '))
        .join('\n')
      return `--- シート「${s.sheetName}」先頭行 ---\n${rowsText}`
    })
    .join('\n\n')

  return `ファイル名: ${input.filename}
件名: ${input.subject}

シート名一覧:
${input.sheetNames.join(', ')}

決定的パーサの解析結果(級名: 人数):
${parserAttemptBlock}

各シートの生データ(先頭数行):
${sheetHeadBlock}
`
}

/**
 * フル抽出用システムプロンプト。渡された大会結果(CSV 化シート群 or PDF)から
 * `ParsedResultPayload` 互換の構造化データを全件書き起こす指示。
 */
export function buildExtractionSystemPrompt(): string {
  return `あなたは日本の競技かるた大会の結果資料を構造化データへ書き起こす
AI アシスタントです。渡されるのは、決定的パーサでは正しく解析できなかった
大会結果の生データ(CSV 化されたシート群、または PDF)です。あなたの仕事は、
そこに含まれる対戦結果を漏らさず・推測せずに書き起こし、\`record_extraction\`
ツールで報告することです。

返答は必ず \`record_extraction\` ツールを呼び出して行い、フリーテキストで
答えてはいけません。

# 全体構造

- \`classes\`: 級(クラス)ごとの配列。各要素は \`className\`(級名)・\`grade\`
  ("A"〜"E"、該当しなければ null)・\`sheetName\`(由来シート名。無ければ
  null)・\`participants\`(出場者配列)を持つ。
- \`participants\`: 出場者ごとの配列。各要素は \`seqNo\`(通し番号、無ければ
  null)・\`name\`(氏名、原文のまま。正規化しない)・\`nameKana\`(ふりがな、
  無ければ null)・\`affiliation\`(所属会、無ければ null)・\`prefecture\`
  (都道府県、無ければ null)・\`dan\`(段位、無ければ null)・\`memberNo\`
  (会員番号、無ければ null)・\`finalRank\`(最終順位、無ければ null)・
  \`matches\`(対戦配列)を持つ。
- \`matches\`: 対戦ごとの配列。各要素は \`round\`(何回戦かを表す正の整数)・
  \`roundLabel\`(「1回戦」等の表示ラベル、無ければ null)・\`opponentName\`
  (対戦相手名、不戦勝で相手不明なら null)・\`scoreDiff\`(枚数差、読み取れ
  なければ null)・\`result\`("win" または "lose")・\`status\`("normal"
  が通常の対戦、不戦勝は "walkover"、棄権は "forfeit")を持つ。

# 書き起こしの原則

- 勝敗が本文から明確に読み取れない対戦は、推測せずその対戦を落とす
  (無理に win/lose のどちらかを割り当てない)。
- 不戦勝(相手が棄権・欠席等で自動的に勝ちになった対戦)は \`status: "walkover"\`
  とし、\`result: "win"\`、\`opponentName\` は不明なら null、\`scoreDiff\` は null。
- 棄権(自分が対戦を放棄した)は \`status: "forfeit"\` とする。
- 氏名は資料に書かれた原文のまま書き起こす。表記ゆれの正規化・かな変換・
  誤字修正を行わない。
- 読み取れないフィールドは null にする。無理な推測値を入れない。
- \`parserVersion\` は呼び出し側で上書きするため、何を書いても構わない。`
}

/**
 * フル抽出用ユーザープロンプト。sheets のときは CSV 本文を整形して含める。
 * pdf のときは CSV 部分を出さない(document block で別途渡すため)。
 */
export function buildExtractionUserPrompt(input: ExtractionInput): string {
  const header = `ファイル名: ${input.filename}
件名: ${input.subject}`

  if (input.source.kind === 'pdf') {
    return `${header}

(PDF は document block として同送しています)`
  }

  const sheetsBlock = input.source.sheets
    .map((s) => `--- シート「${s.name}」 ---\n${s.csv}`)
    .join('\n\n')

  return `${header}

${sheetsBlock}
`
}
