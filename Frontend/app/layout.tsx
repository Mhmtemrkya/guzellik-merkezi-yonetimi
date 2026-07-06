import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/components/dashboard/AuthContext'
import { BranchProvider } from '@/components/dashboard/BranchContext'
import { FeatureProvider } from '@/components/dashboard/FeatureContext'
import ApprovalToast from '@/components/dashboard/ApprovalToast'
import SessionExpiredModal from '@/components/dashboard/SessionExpiredModal'
import DesktopGuard from '@/components/desktop/DesktopGuard'

export const metadata: Metadata = {
  title: 'BeautyAsist — Güzellik Merkezleri İçin Yönetim Sistemi',
  description: "Excel'i unutun. Müşteri, paket, taksit, seans, randevu ve kasa yönetimi tek panelden.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className="theme-light">
      <body className="antialiased grain">
        <AuthProvider>
          <FeatureProvider>
            <BranchProvider>
              <div className="theme-surface">{children}</div>
              <ApprovalToast />
              <SessionExpiredModal />
              <DesktopGuard />
            </BranchProvider>
          </FeatureProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
