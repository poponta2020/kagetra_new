/**
 * 既存大会への LINE 配信（manual existing-event link）に任意で付ける冒頭
 * 見出しテキストのプリセット。連絡内容（抽選結果・組合せ・OC 案内…）は毎回
 * 変わるため固定文言では不十分だが、身内アプリゆえ DB 管理＋CRUD 画面は過剰。
 * コード定数として持ち、文言の増減・修正は小 PR で対応する。
 *
 * client（ExistingEventLinkSheet のチップ）と server（linkMailToEvent の
 * 長さ検証）双方から import するため、server-only な依存を持ち込まないこと。
 */
export const BROADCAST_LEAD_PRESETS = [
  '抽選結果が出ました！',
  '組合せ（対戦表）が出ました！',
  '大会専用オープンチャットのお知らせ',
  'タイムテーブル・進行のご案内',
  '会場・アクセスのご案内',
  'その他のご連絡',
] as const

/**
 * 冒頭メッセージの最大長（trim 後）。LINE テキストメッセージ上限 5000 文字に
 * 対し十分小さく、分割不要。client の textarea maxLength と server の長さ検証で
 * 共有する。
 */
export const LEAD_TEXT_MAX_LENGTH = 200
