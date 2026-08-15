'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Lock, Save, X } from 'lucide-react'
import ModalPortal from '@/components/dashboard/ModalPortal'
import CatalogPicker, { type PickerItem } from '@/components/dashboard/CatalogPicker'
import type { GiftCard } from '@/lib/types'

export type EditTargetKind = 'service' | 'package' | 'product'

/**
 * KART DÜZELTME — yanlış girilen bilgiyi onarır, kartı yeniden BASMAZ.
 *
 * <p>KOD, TÜR ve DEĞER burada yok ve sunucu da kabul etmez. Kart basılıp müşterinin eline geçer;
 * üstündeki QR o kodu kalıcı olarak kodlar. Kodu değiştirmek dolaşımdaki kartı tek hamlede
 * öldürür ve müşteri elindeki kâğıdın neden çalışmadığını asla öğrenemez. Yanlış basılmış kartın
 * doğru yolu: pasifleştirip yenisini basmaktır — bu modal onu da açıkça söyler.</p>
 */
export default function GiftCardEditModal({
  card,
  open,
  busy,
  targetKinds,
  itemsForKind,
  onClose,
  onSave,
}: {
  card: GiftCard | null
  open: boolean
  busy: boolean
  targetKinds: ReadonlyArray<readonly [EditTargetKind, string]>
  itemsForKind: (kind: EditTargetKind) => PickerItem[]
  onClose: () => void
  onSave: (body: Record<string, unknown>) => Promise<void>
}) {
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [note, setNote] = useState('')
  const [scopeLabel, setScopeLabel] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [targetKind, setTargetKind] = useState<EditTargetKind>('service')
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState('')

  // Kart değiştiğinde form onun MEVCUT hâliyle doldurulur: bu bir düzeltme ekranıdır, boş bir
  // form değil — boş açılsaydı "dokunmadığın alan silinir" tuzağı kurardı.
  useEffect(() => {
    if (!open || !card) return
    setValidFrom(card.validFrom ? card.validFrom.slice(0, 10) : '')
    setValidUntil(card.validUntil ? card.validUntil.slice(0, 10) : '')
    setMaxUses(card.maxUses > 0 ? String(card.maxUses) : '')
    setNote(card.note || '')
    setScopeLabel(card.scopeLabel || '')
    setRecipientName(card.recipientName || '')
    const kind: EditTargetKind = card.servicePackageId ? 'package' : card.productId ? 'product' : 'service'
    setTargetKind(kind)
    setTargetId(card.serviceDefinitionId || card.servicePackageId || card.productId || '')
    setError('')
  }, [open, card])

  const items = useMemo(() => itemsForKind(targetKind), [itemsForKind, targetKind])
  /** Kullanılmış kartın müşteri bağı sunucuda kilitlidir — kullanıcı boşuna denemesin. */
  const used = (card?.usedCount ?? 0) > 0

  if (!open || !card) return null

  const submit = async (): Promise<void> => {
    // Ters aralık SESSİZCE TAKAS EDİLMEZ (sunucu da reddeder): operatör yanlışını görmeli.
    if (validFrom && validUntil && validFrom > validUntil) {
      setError('Geçerlilik başlangıcı bitişten sonra olamaz.')
      return
    }
    const uses = maxUses ? Number(maxUses) : 0
    if (uses > 0 && uses < card.usedCount) {
      setError(`Bu kart ${card.usedCount} kez kullanılmış; kullanım hakkı bunun altına indirilemez.`)
      return
    }
    setError('')
    try {
      await onSave({
        validFromUtc: validFrom ? new Date(`${validFrom}T00:00:00`).toISOString() : null,
        validUntilUtc: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null,
        maxUses: uses,
        note: note.trim() || null,
        scopeLabel: scopeLabel.trim() || null,
        recipientName: recipientName.trim() || null,
        // Müşteri bağı bu ekranda DEĞİŞMEZ: kartı müşteriye bağlama işi QR eşleştirmesinde yapılır.
        customerId: card.customerId,
        serviceDefinitionId: targetKind === 'service' ? targetId || null : null,
        servicePackageId: targetKind === 'package' ? targetId || null : null,
        productId: targetKind === 'product' ? targetId || null : null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi.')
    }
  }

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 z-[145] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button type="button" aria-label="Kapat" onClick={onClose} className="absolute inset-0 cursor-default bg-[#2a141f]/55 backdrop-blur-[3px]" />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${card.code} kartını düzelt`}
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 my-auto flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[24px] border border-[#EAD8DF] bg-white shadow-[0_40px_120px_-50px_rgba(90,40,60,0.6)]"
          >
            <header className="flex items-start justify-between gap-3 border-b border-[#EAD8DF] bg-gradient-to-br from-white via-[#fff7fa] to-[#ffeef4] px-5 py-4">
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#A5556E]">Kartı düzelt</div>
                <div className="mt-0.5 font-display text-[19px] font-bold tracking-tight text-[#2A2027]">{card.code}</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Kapat"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#EAD8DF] bg-white text-[#74616A] transition-colors hover:bg-[#F6DFE6] hover:text-[#A5556E]"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-auto overflow-y-auto bg-[#FBFAFA] p-4 sm:p-5">
              <p className="flex items-start gap-2 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[11.5px] leading-relaxed text-[#5A4B53]">
                <Lock className="mt-px h-3.5 w-3.5 shrink-0 text-[#A5556E]" />
                <span>
                  <b>Kod, tür ve değer değiştirilemez.</b> Kart basılıp müşteriye verilir; kodu değiştirmek
                  elindeki kartı geçersiz kılardı. Yanlış basılmış bir kartı pasifleştirip yenisini basın.
                </span>
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Geçerlilik başlangıcı</span>
                  <input
                    type="date"
                    value={validFrom}
                    onChange={(e) => setValidFrom(e.target.value)}
                    className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Son geçerlilik</span>
                  <input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">
                    Kullanım hakkı (boş = sınırsız)
                  </span>
                  <input
                    inputMode="numeric"
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="örn. 1"
                    className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5]"
                  />
                  <span className="mt-1 block text-[10.5px] text-[#74616A]">
                    Bugüne kadar {card.usedCount} kez kullanılmış — bunun altına indirilemez.
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Kartta yazacak alıcı</span>
                  <input
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="örn. Ayşe Hanım"
                    className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5]"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">Kartta yazacak kapsam</span>
                  <input
                    value={scopeLabel}
                    onChange={(e) => setScopeLabel(e.target.value)}
                    placeholder="örn. El ve Ayak Bakım"
                    className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5]"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[11px] font-semibold text-[#74616A]">İç not</span>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Yalnız panelde görünür"
                    className="w-full rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-2.5 text-[13px] text-[#2A2027] outline-none transition focus:border-[#ef9ab5]"
                  />
                </label>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-[#74616A]">Hangi hizmet / paket / ürün için?</span>
                  <div className="inline-flex rounded-full border border-[#EAD8DF] bg-[#F7F6F6] p-0.5">
                    {targetKinds.map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => { setTargetKind(k); setTargetId('') }}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                          targetKind === k ? 'bg-[#A5556E] text-white' : 'text-[#5A4B53] hover:text-[#8C4460]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <CatalogPicker items={items} value={targetId} clearable onChange={setTargetId} emptyText="Kayıt bulunamadı." />
              </div>

              {used && (
                <p className="mt-3 rounded-[11px] border border-[#EFC98B] bg-[#FDF3E2] px-3 py-2 text-[11.5px] font-medium text-[#8A5A11]">
                  Bu kart kullanılmaya başlanmış. Bağlı müşterisi buradan değiştirilemez — bakiyesinden
                  harcama yapılmış bir çek başka müşteriye geçerse eski satışın iptali yeni sahibin
                  bakiyesini şişirirdi.
                </p>
              )}
              {error && (
                <p className="mt-3 rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-2 text-[12px] font-medium text-[#A32347]">
                  {error}
                </p>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#EAD8DF] bg-white px-5 py-3.5">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-10 items-center rounded-[12px] border border-[#EAD8DF] bg-white px-3.5 text-[12px] font-semibold text-[#5A4B53]"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-4 text-[12px] font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Kaydet
              </button>
            </footer>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  )
}
