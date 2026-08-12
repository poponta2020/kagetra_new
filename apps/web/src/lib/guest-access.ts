/**
 * guest-role のアクセス制御。**許可リスト（fail-closed）**の唯一の正典。
 *
 * ゲスト（`users.role = 'guest'`）は会員ではない外部の人なので、
 * 「明示的に許したものだけ通す」形で塞ぐ。個別画面に「ゲストなら弾く」を
 * 書いて回ると、今後追加される画面が既定でゲストに開いてしまうため
 * （requirements §7）。
 *
 * このモジュールは **DB / next-auth / process.env を一切 import しない**:
 *   - middleware（Edge ランタイム）から呼ぶため Node 専用 API を持ち込めない
 *   - Node 側（route handler・ページ）からも同じ判定を呼び、二段構えにする
 *
 * ⚠️ 二段構えである理由: middleware が読む `token.role` は、Node 側の jwt
 * callback が DB から再同期して cookie を再発行するまで stale になりうる
 * （会員 → ゲストへ降格した直後など）。したがって middleware は早期ゲート
 * （UX）と位置づけ、**実際の防御は Node 側の判定にも置く**。
 */

/** 実効ロールがゲストか。`session.user.role` / `token.role` の両方に使う。 */
export function isGuestRole(role: unknown): boolean {
  return role === 'guest'
}

/**
 * URL パスをセグメント配列にする。クエリ・ハッシュは呼び出し側で除く前提
 * （`nextUrl.pathname` は既に除かれている）。末尾スラッシュは無視する。
 */
function toSegments(pathname: string): string[] {
  return pathname.split('/').filter((s) => s.length > 0)
}

/** 動的セグメント（イベント id 等）として妥当な形か。空・`.`・`..` を弾く。 */
function isIdSegment(segment: string | undefined): boolean {
  return !!segment && segment !== '.' && segment !== '..'
}

/**
 * ゲストがアクセスしてよいパスか。**ここに書かれていないものはすべて拒否**。
 *
 * 許可の内訳（requirements R2）:
 *   - `/`          — ログイン直後の着地点。ロールに応じて `/events` へ振られる
 *   - `/403`       — 拒否先そのもの。閉めるとリダイレクトループになる
 *   - `/events`, `/events/:id` — 大会申込一覧と大会詳細（出欠回答を含む）
 *     ただし `/events/new`・`/events/:id/edit` は管理者専用なので拒否
 *   - `/events-archive` — 過去のイベント
 *   - `/settings`  — **完全一致のみ**。`/settings/notifications` などの下位
 *     ページは会員・管理者向けなので拒否する
 *   - `/roster-files/:id` と `/api/roster-files/:id[/preview/:page]`
 *     — 大会詳細の名簿ファイルビューア。R2 でゲストにも見せると決めたもの
 *       （ページだけ／API だけ開けても意味を成さないので両方を許可する）
 *   - `/api/auth/**` — 認証そのもの（サインアウトを含む）
 *
 * `/api/mail/attachments/**`（会員向け受信メールの添付本体・ページ画像）は
 * 「ログイン済みなら誰でも」叩ける実在ルートなので、**明示的に拒否側**に
 * 落ちる（AC-33）。`api/` は `(app)/layout.tsx` の配下ではないため、画面側の
 * ガードでは一切保護されない。
 */
export function isGuestAllowedPath(pathname: string): boolean {
  const seg = toSegments(pathname)

  // "/" （ログイン後の着地点）
  if (seg.length === 0) return true

  if (seg[0] === 'api') {
    // 認証そのもの。実際には middleware の matcher が除外しているが、Node 側
    // からこの関数を呼んだときも同じ答えになるよう判定はここにも書く。
    if (seg[1] === 'auth') return true
    if (seg[1] === 'roster-files' && isIdSegment(seg[2])) {
      if (seg.length === 3) return true
      // /api/roster-files/:id/preview/:page
      return seg.length === 5 && seg[3] === 'preview' && isIdSegment(seg[4])
    }
    return false
  }

  switch (seg[0]) {
    case '403':
      return seg.length === 1
    case 'events':
      if (seg.length === 1) return true
      // 大会詳細のみ。`new`（作成）と 3 セグメント以上（`.../edit`）は拒否。
      return seg.length === 2 && seg[1] !== 'new' && isIdSegment(seg[1])
    case 'events-archive':
      return seg.length === 1
    case 'settings':
      // 完全一致のみ。下位ページ（notifications / entry-form / line-link）は
      // 会員・管理者向けなので開けない。
      return seg.length === 1
    case 'roster-files':
      return seg.length === 2 && isIdSegment(seg[1])
    default:
      return false
  }
}
