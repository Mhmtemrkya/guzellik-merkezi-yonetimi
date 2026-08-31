import './globals.css'
import { connection } from 'next/server'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/components/dashboard/AuthContext'
import { BranchProvider } from '@/components/dashboard/BranchContext'
import { FeatureProvider } from '@/components/dashboard/FeatureContext'
import { RealtimeProvider } from '@/components/dashboard/RealtimeContext'
import ApprovalToast from '@/components/dashboard/ApprovalToast'
import RealtimeToast from '@/components/dashboard/RealtimeToast'
import SessionExpiredModal from '@/components/dashboard/SessionExpiredModal'
import DesktopGuard from '@/components/desktop/DesktopGuard'
import DesktopNotifier from '@/components/desktop/DesktopNotifier'
import OfflineBanner from '@/components/desktop/OfflineBanner'
import OutboxSync from '@/components/desktop/OutboxSync'
import ReducedMotionProvider from '@/components/dashboard/ReducedMotionProvider'

export const metadata: Metadata = {
  title: 'BeautyAsist — Güzellik Merkezleri İçin Yönetim Sistemi',
  description: "Excel'i unutun. Müşteri, paket, taksit, seans, randevu ve kasa yönetimi tek panelden.",
}

/**
 * TÜM UYGULAMA İSTEK ANINDA RENDER EDİLİR — CSP NONCE'UNUN ÖN KOŞULU.
 *
 * `connection()` beklenmezse Next sayfaları BUILD ZAMANINDA üretir; o HTML'de nonce olamaz
 * (istek yoktur). Statik HTML + istek başına üretilen nonce = uygulamanın KENDİ script'lerinin
 * bloklanması, yani beyaz ekran. Ölçüldü: `next start` altında /login'in 25 script etiketinin
 * hiçbirinde nonce yoktu.
 *
 * Bedeli her istekte sunucu render'ı; kazancı `script-src`'in gerçekten kısıtlanabilmesi
 * (bkz. proxy.ts). Panel zaten kimlik doğrulamalı ve dinamik veriyle çalışıyor; tanıtım
 * sayfalarının render maliyeti de ölçüldü (bkz. denetim notları).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection()
  return (
    <html lang="tr" className="theme-light">
      <body className="antialiased grain">
        {/* EN DIŞTA: "hareketi azalt" tercihi bütün Framer Motion animasyonlarını kapsasın —
            CSS media sorgusu JS ile sürülen hareketi durduramıyordu. */}
        <ReducedMotionProvider>
        <AuthProvider>
          <FeatureProvider>
            <BranchProvider>
              <RealtimeProvider>
                <div className="theme-surface">{children}</div>
                <ApprovalToast />
                <RealtimeToast />
                <SessionExpiredModal />
                <DesktopGuard />
                <DesktopNotifier />
                <OfflineBanner />
                <OutboxSync />
              </RealtimeProvider>
            </BranchProvider>
          </FeatureProvider>
        </AuthProvider>
        </ReducedMotionProvider>
      </body>
    </html>
  )
}
