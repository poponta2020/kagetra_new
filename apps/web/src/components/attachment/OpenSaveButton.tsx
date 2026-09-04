'use client'

import { useCallback, useRef, useState } from 'react'
import { Btn } from '@/components/ui'
import { cn } from '@/lib/utils'

/**
 * 添付ファイルを OS 側へ渡す唯一の導線。3つの添付ビューア
 * (`/mail/attachments/[id]`・`/admin/mail-inbox/attachments/[id]`・
 * `/roster-files/[id]`) が共有する。
 *
 * なぜバイナリ route への素のリンクではないのか: iOS ホーム画面 PWA は
 * manifest scope が `/` なので same-origin URL を `target="_blank"` 付きでも
 * 同一 WebView で開いてしまい、QuickLook 表示から戻る UI が一切ない行き止まり
 * になる (PR #146)。`Content-Disposition: attachment` に至っては白画面のまま
 * 死ぬ (PR #139)。モバイルでファイルを端末へ渡す道は **OS の共有シート**
 * だけしか残っていない。
 *
 * 動作は「共有シート → ダウンロード」のラダー:
 *   1. バイナリを fetch して `File` を組み立てる
 *   2. `navigator.canShare({ files })` が通れば `navigator.share` (共有シート)
 *   3. 通らなければ blob URL + `<a download>` (PC ブラウザはこちら)
 *
 * サーバー route には一切触れていない点が重要。`fetch` は
 * `Content-Disposition` を無視するため、3ルートの fail-closed な MIME
 * allowlist・disposition・`nosniff`・`no-store` をそのまま維持できる
 * (`attachment-route-parity.test.ts` が無傷で通る)。
 */

/**
 * 拡張子 → 共有シートへ申告する MIME。
 *
 * `blob.type` をそのまま使わないのは、バイナリ route が allowlist 外の型を
 * `application/octet-stream` に倒すため。実データにある `.xlsm`
 * (`application/vnd.ms-excel.sheet.macroenabled.12`) がまさにそれで、
 * octet-stream のまま共有すると OS が Excel に紐付けられない。
 *
 * ここは**自前の定数**であって保存値のエコーではないので、ヘッダ注入や
 * active content の持ち込みにはならない (そもそも共有シートへ渡すだけで
 * このオリジンでは描画しない)。
 */
const SHARE_MIME_BY_EXTENSION: Record<string, string> = {
  // 表計算 — macroEnabled は OS へ申告する側なので IANA の大小文字で書く
  // (小文字化するのは detectPreviewKind の比較用キーのほう)
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  // 文書
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  pdf: 'application/pdf',
  // テキスト・画像・書庫
  csv: 'text/csv',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  zip: 'application/zip',
}

export function pickShareMimeType(filename: string, fallback: string): string {
  const ext = /\.([a-z0-9]{1,10})$/i.exec(filename)?.[1]?.toLowerCase() ?? ''
  return (
    SHARE_MIME_BY_EXTENSION[ext] ?? (fallback || 'application/octet-stream')
  )
}

type OpenSaveState = 'idle' | 'preparing' | 'retry' | 'error'

const LABEL: Record<OpenSaveState, string> = {
  idle: '開く・保存',
  preparing: '準備中…',
  retry: 'もう一度タップして開く',
  error: '開く・保存',
}

/** 状態ごとの見え方は design-spec §5。準備中だけアイコンを出さない。 */
const STATE_CLASS: Record<OpenSaveState, string> = {
  idle: '',
  preparing: 'bg-neutral-bg text-ink-meta hover:bg-neutral-bg',
  retry: 'bg-warn-bg text-warn-fg hover:bg-warn-bg',
  error: '',
}

export interface OpenSaveButtonProps {
  /** バイナリ route の URL（例 `/api/mail/attachments/12`）。 */
  href: string
  /** 共有・保存時のファイル名。ビューアが表示しているものと同じ。 */
  filename: string
  /**
   * `header` = sticky ヘッダに置く小さいボタン。
   * `block`  = カード内・タイトル直下に置く横幅いっぱいのボタン。
   */
  variant?: 'header' | 'block'
  className?: string
}

function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
    </svg>
  )
}

export function OpenSaveButton({
  href,
  filename,
  variant = 'header',
  className,
}: OpenSaveButtonProps) {
  const [state, setState] = useState<OpenSaveState>('idle')
  // 取得済みのバイトはここに残す。iOS でユーザー操作の有効期限が切れて
  // (NotAllowedError) 再タップになったとき、待ち時間ゼロで共有シートを
  // 出せるようにするため。同じ添付を2度ダウンロードしない。
  const fileRef = useRef<File | null>(null)

  const handOff = useCallback(
    async (file: File) => {
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean
      }
      if (
        typeof nav.share === 'function' &&
        nav.canShare?.({ files: [file] }) === true
      ) {
        await nav.share({ files: [file] })
        return
      }
      // 共有シートが無い環境 (PC ブラウザ等) は素直にダウンロードさせる。
      // same-origin なので `download` 属性が効き、route 側の
      // `Content-Disposition: inline` より優先される。
      const url = URL.createObjectURL(file)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // 同期的に revoke するとダウンロード開始前に URL が消える実装が
      // あるため、1 tick 遅らせる。
      setTimeout(() => URL.revokeObjectURL(url), 0)
    },
    [filename],
  )

  const handleClick = useCallback(async () => {
    if (state === 'preparing') return

    let file = fileRef.current
    if (!file) {
      setState('preparing')
      try {
        const res = await fetch(href, { credentials: 'same-origin' })
        if (!res.ok) throw new Error(`attachment fetch failed: ${res.status}`)
        const blob = await res.blob()
        file = new File([blob], filename, {
          type: pickShareMimeType(filename, blob.type),
        })
        fileRef.current = file
      } catch {
        setState('error')
        return
      }
    }

    try {
      await handOff(file)
      setState('idle')
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      // ユーザーが共有シートを閉じただけ。失敗ではないので何も出さない。
      if (name === 'AbortError') {
        setState('idle')
        return
      }
      // iOS でユーザー操作の有効期限が切れたケース。バイトは取得済みなので
      // 次のタップで即座に共有シートが出る。
      if (name === 'NotAllowedError') {
        setState('retry')
        return
      }
      setState('error')
    }
  }, [handOff, href, filename, state])

  return (
    <div
      className={cn(
        variant === 'block' ? 'flex w-full flex-col items-center gap-1' : '',
        className,
      )}
    >
      <Btn
        kind="primary"
        size={variant === 'block' ? 'md' : 'sm'}
        block={variant === 'block'}
        disabled={state === 'preparing'}
        onClick={handleClick}
        className={cn('shrink-0', STATE_CLASS[state])}
      >
        {state !== 'preparing' && <ShareIcon />}
        {LABEL[state]}
      </Btn>
      {state === 'error' && (
        <p className="text-xs leading-normal text-danger-fg">
          ファイルを取り込めませんでした。通信状況を確認して、もう一度お試しください。
        </p>
      )}
    </div>
  )
}
