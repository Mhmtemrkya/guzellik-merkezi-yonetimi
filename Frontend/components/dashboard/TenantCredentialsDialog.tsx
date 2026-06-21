'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { motion } from 'framer-motion'
import { CheckCircle2, Copy, Download, KeyRound, Mail, ShieldAlert, Sparkles, X } from 'lucide-react'
import { generateCredentialsPdf } from '@/lib/credentialsPdf'
import type { ApiTenantCredentials } from '@/lib/types'

interface TenantCredentialsDialogProps {
  credentials: ApiTenantCredentials | null
  onClose: () => void
  /** Üst küçük etiket — varsayılan "Kurum oluşturuldu"; şifre sıfırlamada "Şifre sıfırlandı" gibi. */
  kicker?: string
  title?: string
  description?: string
  pdfHeading?: string
  pdfSubjectLabel?: string
}

/**
 * Otomatik üretilen geçici giriş bilgilerini gösteren modal (kurum oluşturma ve
 * şifre sıfırlama akışları). PDF indirme + kopyalama. Bilgiler bir kez gösterilir.
 */
export default function TenantCredentialsDialog({
  credentials,
  onClose,
  kicker = 'Kurum oluşturuldu',
  title = 'Yetkili giriş bilgileri',
  description = 'Şifre girilmediği için otomatik geçici şifre üretildi. Bu bilgiler yalnızca bir kez gösterilir.',
  pdfHeading = 'KURUM YÖNETİCİSİ GİRİŞ BİLGİLERİ',
  pdfSubjectLabel = 'YÖNETİCİ',
}: TenantCredentialsDialogProps) {
  const [copiedField, setCopiedField] = useState<'email' | 'pwd' | null>(null)
  const open = Boolean(credentials)

  const copyToClipboard = async (text: string, field: 'email' | 'pwd'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    } catch {
      // ignore
    }
  }

  const handleDownloadPdf = (): void => {
    if (!credentials) return
    generateCredentialsPdf({
      heading: pdfHeading,
      subjectLabel: pdfSubjectLabel,
      personName: credentials.ownerName || credentials.email || 'Kurum Yöneticisi',
      email: credentials.email || '',
      initialPassword: credentials.initialPassword || '',
      tenantName: credentials.tenantName || 'Kurum',
      branchName: credentials.branchName || null,
      filenameBase: credentials.tenantName || credentials.ownerName || 'kurum-yoneticisi',
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        className="flex max-h-[94dvh] flex-col overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-white/[0.96] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 640px)', maxWidth: 'min(96vw, 640px)' }}
      >
        <div className="relative flex max-h-[94dvh] flex-col overflow-hidden bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5]">
          <motion.span
            aria-hidden
            animate={{ opacity: [0.5, 0.85, 0.5] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#f0aac2]/[0.22] blur-3xl"
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-[0.045]" />

          {/* HEADER */}
          <header className="relative shrink-0 border-b border-[#ead8df]/[0.70] p-5 pr-12 sm:p-6 sm:pr-14">
            <div className="flex items-start gap-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-emerald-200/[0.85] bg-emerald-50/[0.88] text-emerald-700 shadow-[0_14px_34px_-24px_rgba(16,185,129,0.55)]">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-emerald-700/80">
                  {kicker}
                </div>
                <DialogTitle className="mt-1 font-display text-2xl tracking-tight">
                  <span className="armo-shimmer">{title}</span>
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-[12px] leading-relaxed text-[#352432]/[0.60]">
                  {credentials?.tenantName ? `${credentials.tenantName} · ` : ''}
                  {description}
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead8df]/[0.80] bg-white/[0.82] text-[#7e5f6e] shadow-[0_10px_28px_-20px_rgba(120,71,88,0.55)] transition-colors hover:border-[#efbfd0]/[0.90] hover:text-[#352432]"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* BODY */}
          <div className="relative min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] border border-emerald-200/[0.80] bg-white/[0.86] p-3 shadow-[0_14px_34px_-28px_rgba(16,185,129,0.35)]">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/[0.70]">
                  <Mail className="h-3 w-3" /> E-posta (kullanıcı adı)
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <code className="truncate text-[13px] font-mono text-[#352432]">{credentials?.email}</code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(credentials?.email || '', 'email')}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#ead8df]/[0.80] bg-white/[0.78] text-[#7e5f6e] transition-colors hover:border-[#efbfd0]/[0.90] hover:text-[#352432]"
                    title="Kopyala"
                  >
                    {copiedField === 'email' ? <CheckCircle2 className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              </div>
              <div className="rounded-[18px] border border-emerald-200/[0.80] bg-white/[0.86] p-3 shadow-[0_14px_34px_-28px_rgba(16,185,129,0.35)]">
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/[0.70]">
                  <KeyRound className="h-3 w-3" /> Geçici şifre
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <code className="text-[15px] font-mono font-bold tracking-wide text-[#c85776]">{credentials?.initialPassword}</code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(credentials?.initialPassword || '', 'pwd')}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#ead8df]/[0.80] bg-white/[0.78] text-[#7e5f6e] transition-colors hover:border-[#efbfd0]/[0.90] hover:text-[#352432]"
                    title="Kopyala"
                  >
                    {copiedField === 'pwd' ? <CheckCircle2 className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Yetkili adı */}
            {credentials?.ownerName && (
              <div className="mt-3 flex items-center gap-2 rounded-[16px] border border-[#ead8df]/[0.80] bg-white/[0.78] px-3 py-2 text-[12px] text-[#352432]/[0.75]">
                <Sparkles className="h-3.5 w-3.5 text-[#c85776]" />
                <span className="text-[#352432]/[0.45]">Yetkili:</span> {credentials.ownerName}
              </div>
            )}

            {/* İlk giriş uyarısı */}
            <div className="mt-3 flex items-start gap-2 rounded-[18px] border border-amber-200/[0.90] bg-amber-50/[0.86] px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 shadow-[0_14px_34px_-28px_rgba(245,158,11,0.35)]">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Yetkili ilk girişte şifresini <strong>zorunlu olarak</strong> değiştirecek. Bu belgeyi yetkiliye güvenli
                bir kanaldan iletin; başkasıyla paylaşmayın.
              </span>
            </div>

            <button
              type="button"
              onClick={handleDownloadPdf}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] transition-opacity hover:opacity-90"
            >
              <Download className="h-3.5 w-3.5" />
              Giriş bilgileri PDF'ini indir
            </button>
          </div>

          {/* FOOTER */}
          <footer className="relative shrink-0 border-t border-[#ead8df]/[0.75] bg-white/[0.78] px-5 py-4 shadow-[0_-18px_46px_-36px_rgba(120,71,88,0.45)] backdrop-blur-xl sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.40]">
                PDF indirip kapatabilirsin
              </div>
              <motion.button
                type="button"
                onClick={onClose}
                whileTap={{ scale: 0.96 }}
                className="inline-flex items-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#2f1724]"
              >
                <CheckCircle2 className="h-3 w-3" /> Tamam, kapat
              </motion.button>
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
