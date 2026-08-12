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
 * 上位 → 下位。設定シートのボタン並び順の正。
 *
 * ⚠️ guest-role: **`guest` はここに入れない**（`parseUserRole` が受理するのと
 * 逆を向いているのは意図的）。`auth.config.ts` の JWT 更新経路は
 * `selectableRoles(realRole).includes(requested)` で切替を認可しているので、
 * この配列から外すことがそのまま「ゲストビューへは切り替えられない」になる。
 * ゲストの設定画面には切替セクション自体が無いため、管理者が一度ゲストビューへ
 * 入ると復帰導線を失う（requirements R7 / AC-36）。
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
 * ⚠️ guest-role: **`guest` は受理する**。ここで弾くと `resolveEffectiveRole` が
 * ゲストの実効ロールを解決できず、`session.user.role` が `'guest'` として下流の
 * 認可（許可リスト）に届かない。「切替先として選べない」ことは
 * `ROLES_HIGH_TO_LOW` 側で表現しており、この関数の責務ではない。
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
  // guest-role: ゲストは**プレビュー先になれない**。ランクだけで丸めると
  // guest(0) <= admin(3) が成立して管理者がゲストビューへ落ち、ゲストの設定
  // 画面には切替セクションが無いので復帰不能になる（requirements R7）。
  // `selectableRoles` からの除外に加えて、実効ロールの生成点であるここでも
  // 塞ぐ（JWT が直接書き換えられた場合の最後の砦）。
  if (view === 'guest') return real
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

/** 切替先として選べるロール (本物のロール以下) を上位から並べる。 */
export function selectableRoles(realRole: UserRole): UserRole[] {
  return ROLES_HIGH_TO_LOW.filter((role) => ROLE_RANK[role] <= ROLE_RANK[realRole])
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
  // guest-role: ゲストはプレビュー機能を一切持たない。許可リスト任せにすると、
  // ゲストの id が誤って ROLE_PREVIEW_USER_IDS に入っていた場合に
  // selectable が空のセクションだけが描画される（AC-24 の「表示のみ」が崩れる）。
  if (real === 'guest' || current === 'guest') return null
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
