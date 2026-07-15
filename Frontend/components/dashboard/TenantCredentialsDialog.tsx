'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { motion } from 'framer-motion'
import { CheckCircle2, Copy, Download, KeyRound, Mail, ShieldAlert, Sparkles, X } from 'lucide-react'
import { generateCredentialsPdf } from '@/lib/credentialsPdf'
import type { ApiTenantCredentials } from '@/lib/types'

interface TenantCredentialsDialogProps {
  /** Tek yönetici veya (çoklu yönetici oluşturulduysa) yönetici listesi. */
  credentials: ApiTenantCredentials | ApiTenantCredentials[] | null
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
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const credentialsList: ApiTenantCredentials[] = Array.isArray(credentials) ? credentials : credentials ? [credentials] : []
  const open = credentialsList.length > 0
  const multi = credentialsList.length > 1
  const first = credentialsList[0]

  const copyToClipboard = async (text: string, field: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    } catch {
      // ignore
    }
  }

  // PDF yalnızca hem e-posta hem geçici şifre varken üretilebilir; eksikse boş/bozuk PDF üretmeyiz.
  const canPdf = (cred: ApiTenantCredentials): boolean => Boolean(cred.email && cred.initialPassword)
  const anyPdf = credentialsList.some(canPdf)

  const downloadPdfFor = (cred: ApiTenantCredentials, index: number): void => {
    if (!canPdf(cred)) return
    generateCredentialsPdf({
      heading: pdfHeading,
      subjectLabel: pdfSubjectLabel,
      personName: cred.ownerName || cred.email || 'Kurum Yöneticisi',
      email: cred.email || '',
      initialPassword: cred.initialPassword || '',
      tenantName: cred.tenantName || 'Kurum',
      branchName: cred.branchName || null,
      // Çoklu yöneticide dosya adı kişiye göre ayrışsın ki PDF'ler üst üste binmesin.
      filenameBase: multi
        ? `${cred.tenantName || 'kurum'}-${cred.ownerName || cred.email || `yonetici-${index + 1}`}`
        : cred.tenantName || cred.ownerName || 'kurum-yoneticisi',
    })
  }

  const handleDownloadAll = (): void => {
    credentialsList.forEach((cred, index) => downloadPdfFor(cred, index))
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
                  {first?.tenantName ? `${first.tenantName} · ` : ''}
                  {multi ? `${credentialsList.length} kurum yöneticisi oluşturuldu. ` : ''}
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
            <div className="space-y-4">
              {credentialsList.map((cred, index) => (
                <div key={`${cred.email || index}`} className={multi ? 'rounded-[20px] border border-[#ead8df]/[0.85] bg-white/[0.55] p-3' : ''}>
                  {multi && (
                    <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
                      <div className="flex items-center gap-2 text-[11px] text-[#352432]/[0.75]">
                        <Sparkles className="h-3.5 w-3.5 text-[#c85776]" />
                        <span className="font-mono text-[9px] uppercase tracking-widest text-[#c85776]/[0.75]">{index + 1}. yönetici</span>
                        <span className="font-semibold">{cred.ownerName || cred.email}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadPdfFor(cred, index)}
                        disabled={!canPdf(cred)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#efbfd0]/[0.80] bg-white/[0.85] px-3 py-1.5 text-[9px] font-mono uppercase tracking-widest text-[#c85776] transition-colors hover:bg-[#fff1f6] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Download className="h-3 w-3" /> PDF
                      </button>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[18px] border border-emerald-200/[0.80] bg-white/[0.86] p-3 shadow-[0_14px_34px_-28px_rgba(16,185,129,0.35)]">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/[0.70]">
                        <Mail className="h-3 w-3" /> E-posta (kullanıcı adı)
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <code className="truncate text-[13px] font-mono text-[#352432]">{cred.email}</code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(cred.email || '', `email-${index}`)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#ead8df]/[0.80] bg-white/[0.78] text-[#7e5f6e] transition-colors hover:border-[#efbfd0]/[0.90] hover:text-[#352432]"
                          title="Kopyala"
                        >
                          {copiedField === `email-${index}` ? <CheckCircle2 className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-emerald-200/[0.80] bg-white/[0.86] p-3 shadow-[0_14px_34px_-28px_rgba(16,185,129,0.35)]">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/[0.70]">
                        <KeyRound className="h-3 w-3" /> Geçici şifre
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <code className="text-[15px] font-mono font-bold tracking-wide text-[#c85776]">{cred.initialPassword}</code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(cred.initialPassword || '', `pwd-${index}`)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#ead8df]/[0.80] bg-white/[0.78] text-[#7e5f6e] transition-colors hover:border-[#efbfd0]/[0.90] hover:text-[#352432]"
                          title="Kopyala"
                        >
                          {copiedField === `pwd-${index}` ? <CheckCircle2 className="h-3 w-3 text-emerald-700" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Yetkili adı (tek yönetici görünümünde) */}
                  {!multi && cred.ownerName && (
                    <div className="mt-3 flex items-center gap-2 rounded-[16px] border border-[#ead8df]/[0.80] bg-white/[0.78] px-3 py-2 text-[12px] text-[#352432]/[0.75]">
                      <Sparkles className="h-3.5 w-3.5 text-[#c85776]" />
                      <span className="text-[#352432]/[0.45]">Yetkili:</span> {cred.ownerName}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* İlk giriş uyarısı */}
            <div className="mt-3 flex items-start gap-2 rounded-[18px] border border-amber-200/[0.90] bg-amber-50/[0.86] px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 shadow-[0_14px_34px_-28px_rgba(245,158,11,0.35)]">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {multi ? 'Yöneticiler' : 'Yetkili'} ilk girişte şifresini <strong>zorunlu olarak</strong> değiştirecek. Bu belgeleri
                ilgili kişilere güvenli bir kanaldan iletin; başkasıyla paylaşmayın.
              </span>
            </div>

            {!anyPdf && (
              <div className="mt-4 flex items-start gap-2 rounded-[16px] border border-rose-200/[0.90] bg-rose-50/[0.80] px-3 py-2 text-[11px] leading-relaxed text-rose-700">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Giriş bilgileri eksik geldiği için PDF oluşturulamıyor. Lütfen sayfayı yenileyip tekrar deneyin.</span>
              </div>
            )}
            <button
              type="button"
              onClick={handleDownloadAll}
              disabled={!anyPdf}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {multi ? `Tüm giriş bilgisi PDF'lerini indir (${credentialsList.length})` : "Giriş bilgileri PDF'ini indir"}
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
