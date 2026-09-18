'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, Check, Loader2, ShieldAlert, Trash2, Undo2 } from 'lucide-react'
import DangerZone, { dangerFieldCls, dangerLabelCls } from './DangerZone'
import { accountApi, type ApiTenantDeletionStatus } from '@/lib/apiClient'

/**
 * KURUM HESABINI SİL — "hesabımı sil" (kurum yöneticisi).
 *
 * <p>
 * <b>Silme ANINDA olmaz.</b> Talep alınır, sunucudan gelen bekleme süresi işler ve süre dolunca
 * kurum ile tüm verisi kalıcı olarak silinir. Süre boyunca panel çalışmaya devam eder: kullanıcı
 * verisini dışa aktarabilsin ve kararından dönebilsin. Bu ekran, iptal düğmesini bekleme süresi
 * boyunca görünür tutar — bekleme süresinin var olma sebebi odur.
 * </p>
 *
 * <p>
 * ÜÇ KAPI: parola (oturum değil, HESAP sahibi olduğunu kanıtlar), elle yazılan kurum kodu
 * (refleksle basılamaz) ve ekranda açıkça yazan tarih. Üçü de bilinçli; "Emin misiniz?" diyen
 * tek bir kutu, geri alınamaz bir işlem için yeterli bir eşik değildir.
 * </p>
 */
export default function TenantDeletionCard() {
  const [status, setStatus] = useState<ApiTenantDeletionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    accountApi
      .tenantDeletionStatus()
      .then((s) => !cancelled && setStatus(s))
      // Uç okunamazsa (ör. rol yetmiyor) kart hiç gösterilmez — bozuk bir kutu göstermektense.
      .catch(() => !cancelled && setStatus(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const reset = (): void => {
    setPassword('')
    setConfirmation('')
    setReason('')
    setError('')
  }

  const submit = async (): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      const next = await accountApi.requestTenantDeletion(password, confirmation.trim(), reason.trim() || null)
      setStatus(next)
      setOpen(false)
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Talep kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      setStatus(await accountApi.cancelTenantDeletion())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Talep geri alınamadı.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 rounded-[24px] border border-[#ead8df] bg-white/70 px-5 py-6 text-[12.5px] text-[#352432]/[0.55]">
        <Loader2 className="h-4 w-4 animate-spin text-[#c85776]" /> Hesap durumu okunuyor…
      </div>
    )
  }
  if (!status) return null

  // ---------------- TALEP VAR: geri sayım + iptal ----------------
  if (status.pending) {
    return (
      <DangerZone
        title="Hesap silme talebiniz işleniyor"
        description="Bekleme süresi dolduğunda kurumunuz ve tüm verisi kalıcı olarak silinir. Fikrinizi değiştirdiyseniz talebi şimdi geri alabilirsiniz."
      >
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-white px-4 py-3.5">
          <CalendarClock className="h-5 w-5 shrink-0 text-rose-600" strokeWidth={1.7} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-rose-900">
              Silinme tarihi: {formatDate(status.scheduledAtUtc)}
            </div>
            <div className="mt-0.5 text-[11.5px] text-rose-800/[0.75]">
              Talep {formatDate(status.requestedAtUtc)} tarihinde oluşturuldu.
              {status.reason ? ` Gerekçe: ${status.reason}` : ''}
            </div>
          </div>
        </div>

        <p className="mt-3.5 text-[12px] leading-relaxed text-[#352432]/[0.65]">
          O tarihe kadar paneli normal şekilde kullanmaya devam edebilirsiniz. Verilerinizi
          indirmek isterseniz Raporlar sayfasından dışa aktarabilirsiniz.
        </p>

        {error && <ErrorBox message={error} />}

        <button
          type="button"
          onClick={() => void cancel()}
          disabled={busy}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-5 text-[13px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
          Silme talebini geri al
        </button>
      </DangerZone>
    )
  }

  // ---------------- TALEP YOK: silme akışı ----------------
  return (
    <DangerZone
      title="Hesabımı sil"
      description={
        <>
          Kurumunuzu ve <b>tüm verisini</b> (müşteriler, randevular, satışlar, tahsilatlar,
          raporlar ve personel hesapları) kalıcı olarak siler. Talebiniz{' '}
          <b>{status.graceDays} gün</b> sonra uygulanır; bu süre içinde vazgeçebilirsiniz.
        </>
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {!open ? (
          <motion.div key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-rose-300 bg-white px-5 text-[13px] font-semibold text-rose-700 transition-colors hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" /> Hesabımı silmek istiyorum
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="open"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/[0.85] px-3.5 py-3 text-[12px] leading-relaxed text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Bu işlem <b>geri alınamaz</b>. Silme gerçekleştikten sonra verileriniz hiçbir
                yedekten geri getirilemez ve personel hesaplarınız da kapanır.
              </span>
            </div>

            <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
              <div>
                <label className={dangerLabelCls} htmlFor="del-password">
                  Parolanız
                </label>
                <input
                  id="del-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={dangerFieldCls}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className={dangerLabelCls} htmlFor="del-confirm">
                  Onay için “{status.confirmationPhrase}” yazın
                </label>
                <input
                  id="del-confirm"
                  type="text"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  className={dangerFieldCls}
                  placeholder={status.confirmationPhrase}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={dangerLabelCls} htmlFor="del-reason">
                  Gerekçe (isteğe bağlı)
                </label>
                <input
                  id="del-reason"
                  type="text"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={dangerFieldCls}
                  placeholder="Neden ayrılıyorsunuz? Geliştirmemize yardımcı olur."
                />
              </div>
            </div>

            {error && <ErrorBox message={error} />}

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-rose-600 px-5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Silme talebini onayla
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
                disabled={busy}
                className="inline-flex min-h-11 items-center rounded-2xl border border-[#ead8df] bg-white px-5 text-[13px] font-medium text-[#4A3A44] transition-colors hover:border-[#c85776] disabled:opacity-60"
              >
                Vazgeç
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DangerZone>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-3.5 rounded-2xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-[12px] leading-relaxed text-rose-700">
      {message}
    </div>
  )
}

/** Sunucudan UTC gelir; kullanıcıya YEREL tarih gösterilir. */
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })
}
