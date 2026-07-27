import type { Grade } from '@kagetra/shared/types'
import type { UploadedTemplate } from './actions'

/**
 * entry-form-autofill タスク7 (UI): ウィザード全体で共有する型。
 * `EntryFormWizard.tsx` が状態として持ち、各ステップの表示コンポーネントへ
 * props で渡す（設計要求4: 状態は1コンポーネントに集約）。
 */

/** ステップ1で選んだテンプレの出所。`analyzeTemplateAction` の入力へそのまま渡せる形。 */
export type TemplateSelection =
  | { kind: 'candidate'; attachmentId: number; filename: string }
  | { kind: 'upload'; file: UploadedTemplate }

/** 会員1行分の編集可能な状態（`EntryFormMemberRow` に `excluded` を足したもの）。 */
export interface WizardMember {
  userId: string
  displayName: string | null
  /** 初期値（サーバー算出）。編集後もこのフラグ自体は変えない——警告バナーは
   * 「初期状態で入力が必要だったか」ではなく現在値で毎回再判定する。 */
  needsNameInput: boolean
  excluded: boolean
  grade: Grade | null
  dan: number | null
  familyName: string | null
  givenName: string | null
  familyKana: string | null
  givenKana: string | null
  appearanceCount: number | null
  note: string | null
}

/** ステップ2の編集シートで保存する値（会員情報へ書き戻すのは姓名・かな4項目のみ）。 */
export interface MemberEditValues {
  familyName: string | null
  givenName: string | null
  familyKana: string | null
  givenKana: string | null
  grade: Grade | null
  dan: number | null
  appearanceCount: number | null
  note: string | null
}

/** 宛先プレフィルの出所（requirements §3.2.6 優先順①③④。②AI抽出は現状の
 * `analyzeTemplateAction` 契約に含まれず到達不能——mail-template-client.ts 参照）。 */
export type ToEmailSource = 'template' | 'ai' | 'sourceMail' | null

/** 件名・添付ファイル名のプレフィル出所。'organizer' = 主催者指定を AI が抽出。 */
export type PrefillSource = 'organizer' | 'default'

export interface MailDraftState {
  toEmail: string
  toSource: ToEmailSource
  subject: string
  subjectSource: PrefillSource
  attachmentFilename: string
  attachmentFilenameSource: PrefillSource
  body: string
}
