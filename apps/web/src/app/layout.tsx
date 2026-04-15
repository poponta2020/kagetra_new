import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'かげとら',
  description: '競技かるた会グループウェア',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
