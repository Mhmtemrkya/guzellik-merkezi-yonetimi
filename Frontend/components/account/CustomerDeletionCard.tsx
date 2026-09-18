'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Loader2, ShieldAlert, Trash2 } from 'lucide-react'
import DangerZone, { dangerFieldCls, dangerLabelCls } from './DangerZone'
import { CUSTOMER_DELETE_PHRASE, deleteMyCustomerAccount } from '@/lib/customerPortalApi'

/**
 * HESABIMI SİL — online randevu portalı müşterisi.
 *
 * <p>
 * Kurumdan farklı olarak <b>ANINDA uygulanır</b> ve bekleme süresi yoktur: müşteri hesabı
 * kişisel bir hesaptır, ardında işletilmesi gereken bir muhasebe ya da personel yapısı yoktur.
 * Beklemek, kişinin kendi verisinin silinmesini geciktirmekten başka işe yaramazdı.
 * </p>
 *
 * <p>
 * <b>Salonun kendi kaydı kapsam dışıdır</b> ve bu ekranda AÇIKÇA yazar. Randevu aldığınız
 * güzellik merkezi kendi müşteri defterinin veri sorumlusudur; oradaki kaydınız için doğrudan
 * o merkeze başvurulur. Bunu gizlemek, "her şey silindi" sanan bir kullanıcı bırakırdı.
 * </p>
 *
 * <p>
 * PAROLA SORULMAZ, çünkü müşteri hesabında parola YOKTUR (giriş e-posta koduyla yapılır).
 * Niyetin tek kanıtı elle yazılan onay metnidir; sunucu da aynı metni arar.
 * </p>
 */
export default function CustomerDeletionCard({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      await deleteMyCustomerAccount(confirmation.trim(), reason.trim() || null)
      // Sunucu oturumu zaten kapattı; yerel oturumu da temizlemek çağıranın işi.
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hesap silinemedi.')
      setBusy(false)
    }
  }

  return (
    <DangerZone
      title="Hesabımı sil"
      description="Portal hesabınızı ve kişisel bilgilerinizi (ad, telefon, e-posta, doğum tarihi, notlar) kalıcı olarak siler."
    >
      <AnimatePresence mode="wait" initial={false}>
        {!open ? (
          <motion.div key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-rose-300 bg-white px-5 text-[13px] font-semibold text-rose-700 transition-colors hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" /> Hesabımı sil
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
                Bu işlem <b>anında uygulanır ve geri alınamaz</b>. Hesabınız kapanır, bir daha
                giriş yapamazsınız. Randevu aldığınız güzellik merkezinin kendi müşteri
                kayıtlarındaki bilgileriniz için doğrudan o merkeze başvurmanız gerekir.
              </span>
            </div>

            <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
              <div>
                <label className={dangerLabelCls} htmlFor="cust-del-confirm">
                  Onay için “{CUSTOMER_DELETE_PHRASE}” yazın
                </label>
                <input
                  id="cust-del-confirm"
                  type="text"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  className={dangerFieldCls}
                  placeholder={CUSTOMER_DELETE_PHRASE}
                />
              </div>
              <div>
                <label className={dangerLabelCls} htmlFor="cust-del-reason">
                  Gerekçe (isteğe bağlı)
                </label>
                <input
                  id="cust-del-reason"
                  type="text"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={dangerFieldCls}
                  placeholder="Nedenini paylaşmak ister misiniz?"
                />
              </div>
            </div>

            {error && (
              <div className="mt-3.5 rounded-2xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-[12px] leading-relaxed text-rose-700">
                {error}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-rose-600 px-5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Hesabımı kalıcı olarak sil
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setConfirmation('')
                  setReason('')
                  setError('')
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
