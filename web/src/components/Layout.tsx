import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import Header from './Header'

/** The signed-in shell: navigation on the left, top bar, and a page canvas. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-app text-ink">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 px-4 md:px-5 py-4 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  )
}
