/**
 * role-preview-switch の純関数モジュール。
 *
 * 実効ロール (session.user.role) の導出・許可判定・選択肢生成・ロール名文言を
 * すべてここに閉じ込める。**DB / process.env / next-auth を一切 import しない**:
 *   - auth.config.ts は Edge でも動くため Node 専用 API を持ち込めない
 *   - クライアントコンポーネント側から間接的に参照されてもクライアント
 *     バンドルを汚さない
 *   - env 値は呼び出し側 (Server Action / layout) が読んで引数で渡す
 *
 * 設計の芯: 実効ロールの生成点はこの `resolveEffectiveRole` 1 箇所だけで、
 * `viewAsRole` は常に本物のロール以下へ丸められる。したがって JWT が改竄
 * されても権限は上がらない (昇格不能)。
 */

export type UserRole = 'admin' | 'vice_admin' | 'member' | 'guest'

/** 大きいほど強い権限。丸め込みの比較に使う。 */
const ROLE_RANK: Record<UserRole, number> = {
  admin: 3,
  vice_admin: 2,
  member: 1,
  guest: 0,
}

/**
 * 上位 → 下位。設定ページのボタン並び順の正。
 *
 * ⚠️ **`guest` はここに入れない**（`parseUserRole` が受理するのと逆を向いて
 * いるのは意図的）。この配列はランク比較 (`ROLE_RANK[role] <= ROLE_RANK[real]`)
 * にかけられるため、guest(0) を足すと**副管理者・一般会員の選択肢にもゲストが
 * 生える**。ゲストへの切替は「本物のロールが admin のときだけ」なので、
 * `selectableRoles` の中で別立てに末尾へ足す（requirements R1）。
 */
const ROLES_HIGH_TO_LOW: readonly UserRole[] = ['admin', 'vice_admin', 'member']

const ROLE_VIEW_LABEL: Record<UserRole, string> = {
  admin: '管理者',
  vice_admin: '副管理者',
  member: '一般会員',
  guest: 'ゲスト',
}

/**
 * enum 外の値 (改竄された JWT クレーム・FormData の任意文字列) は null。
 *
 * `guest` も受理する。ここで弾くと `resolveEffectiveRole` がゲストの実効
 * ロールを解決できず、`session.user.role` が `'guest'` として下流の認可
 * （許可リスト）に届かない。誰がゲストへ切り替えられるかは
 * `selectableRoles` / `resolveEffectiveRole` 側の責務。
 */
export function parseUserRole(value: unknown): UserRole | null {
  return value === 'admin' ||
    value === 'vice_admin' ||
    value === 'member' ||
    value === 'guest'
    ? value
    : null
}

/**
 * 実効ロール = `viewAsRole` を `realRole` 以下へ丸めた値。
 *
 * `realRole` が未解決 (token.role 未設定 = /self-identify 前のユーザー) の
 * ときは**受け取った値をそのまま返す**。ここで 'member' 等へ丸めると
 * プレビュー未使用時の既存挙動が変わってしまう (AC-18 の回帰)。
 */
export function resolveEffectiveRole(
  realRole: UserRole | null | undefined,
  viewAsRole: unknown,
): UserRole | null | undefined {
  const real = parseUserRole(realRole)
  if (!real) return realRole
  const view = parseUserRole(viewAsRole)
  if (!view) return real
  // ⚠️ この 1 行は冗長ではない。ゲストビューへ落とせるのは**本物のロールが
  // admin のときだけ**（requirements R1）で、ランク比較だけに任せると
  // guest(0) <= vice_admin(2) が成立して副管理者・一般会員も改竄 JWT で
  // ゲストビューへ落とせてしまう（AC-25）。実効ロールの生成点であるここが
  // `selectableRoles` を通らない `/api/auth/session` 経路に対する最後の砦。
  if (view === 'guest' && real !== 'admin') return real
  return ROLE_RANK[view] <= ROLE_RANK[real] ? view : real
}

/**
 * `ROLE_PREVIEW_USER_IDS` (カンマ区切りの users.id) による許可判定。
 * 未設定・空・空白のみ → false (fail-closed)。
 */
export function isRolePreviewAllowed(
  userId: string | null | undefined,
  rawEnv: string | undefined | null,
): boolean {
  if (!userId || !rawEnv) return false
  const target = userId.trim()
  if (!target) return false
  return rawEnv
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .includes(target)
}

/**
 * 切替先として選べるロール (本物のロール以下) を上位から並べる。
 *
 * ゲストだけは「本物のロール以下なら選べる」の例外で、**本物のロールが
 * admin のときだけ**末尾に足す（requirements R1）。ランク比較に混ぜない
 * 理由は `ROLES_HIGH_TO_LOW` のコメントを参照。この関数は UI の選択肢生成と
 * 切替の認可（Server Action・jwt コールバック）が**共に**読むので、ここが
 * admin 限定を内包していることがそのまま AC-4 / AC-25 の拒否になる。
 */
export function selectableRoles(realRole: UserRole): UserRole[] {
  const roles = ROLES_HIGH_TO_LOW.filter(
    (role) => ROLE_RANK[role] <= ROLE_RANK[realRole],
  )
  return realRole === 'admin' ? [...roles, 'guest'] : roles
}

/** 設定シートのボタン文言。 */
export function roleViewLabel(role: UserRole): string {
  return ROLE_VIEW_LABEL[role]
}

/** 設定ページの「表示ロール」セクションの入力。 */
export interface RolePreviewSelection {
  /** 現在の実効ロール (aria-current を付ける対象)。 */
  current: UserRole
  /** 本物のロール。 */
  real: UserRole
  /** 選択できるロール (上位から)。 */
  selectable: UserRole[]
}

/**
 * `(app)/settings/page.tsx` が描画する「表示ロール」セクションの入力を
 * 組み立てる。null なら**セクションごと描画しない**。
 *
 * ⚠️ 許可リストから外れていても、**プレビュー中なら本物のロールへ戻す 1 択
 * だけは残す**。ここで一律 null にすると、運用中に env から自分の id を
 * 外した瞬間に復帰導線が消えてログアウト以外に戻る手段が無くなる
 * （AC-9 と同じ失敗クラス。切替 Server Action 側も同様に、解除だけは許可
 * リスト判定を通さない）。
 */
export function buildRolePreviewSelection(
  userId: string | null | undefined,
  realRole: UserRole | null | undefined,
  effectiveRole: UserRole | null | undefined,
  rawEnv: string | undefined | null,
): RolePreviewSelection | null {
  const real = parseUserRole(realRole)
  const current = parseUserRole(effectiveRole)
  if (!real || !current) return null
  // **本物の**ゲストはプレビュー機能を一切持たない。許可リスト任せにすると、
  // ゲストの id が誤って ROLE_PREVIEW_USER_IDS に入っていた場合に selectable が
  // 空のセクションだけが描画される（guest-role AC-24 の「表示のみ」が崩れる）。
  // 一方 `current === 'guest'`（= admin のゲストビュー）は**通す**。ここが
  // ゲストビューからの唯一の復帰導線で、塞ぐと戻れなくなる（AC-21 / R7）。
  if (real === 'guest') return null
  const allowed = isRolePreviewAllowed(userId, rawEnv)
  const isPreviewing = current !== real
  if (!allowed && !isPreviewing) return null
  return {
    current,
    real,
    selectable: allowed ? selectableRoles(real) : [real],
  }
}

/**
 * 切替後に戻すパスの検証。切替 Server Action は `unstable_update` の直後に
 * ここで得たパスへ `redirect()` する (レスポンス cookie を載せた新しい
 * リクエストを踏ませないと同一レスポンス内の再描画が stale になる)。
 *
 * リダイレクト先はフォーム由来 = ユーザー入力なので、**相対パスだけ**を
 * 許可する。`//evil.com` (protocol-relative) や `/\evil.com`
 * (ブラウザが `//` と解釈する) を通すとオープンリダイレクトになる。
 */
export function sanitizeReturnPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback
  if (!/^\/(?![/\\])/.test(value)) return fallback
  // 制御文字 (CR/LF 含む) はヘッダー分割の温床なので弾く。
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback
  return value
}
