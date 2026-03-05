import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ASCII Flowchart Editor',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'sans-serif', background: '#f0f2f5' }}>
        {children}
      </body>
    </html>
  )
}
