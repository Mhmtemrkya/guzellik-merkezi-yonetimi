'use client'

import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckSquare, Loader2, Square, Trash2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Toplu seçim + toplu silme altyapısı (müşteri / hizmet / paket listelerinde ortak).
 *
 * Kullanım: `useBulkSelect()` satırların seçim durumunu tutar; `BulkSelectBar`
 * seçim varken alt tarafta beliren çubuğu çizer ve silmeyi onaylatır. Silme,
 * mevcut tekil silme uçlarıyla sırayla yapılır (ayrı bir toplu uç gerekmez) —
 * başarısız olanlar sayılır ve kullanıcıya bildirilir.
 */
export interface BulkSelectApi {
  selected: Set<string>
  count: number
  isSelected: (id: string) => boolean
  toggle: (id: string) => void
  selectMany: (ids: string[]) => void
  clear: () => void
  /** Seçim modu: en az bir kayıt seçiliyken satır tıklaması seçim yapar. */
  active: boolean
}

export function useBulkSelect(): BulkSelectApi {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectMany = useCallback((ids: string[]) => {
    setSelected((prev) => {
      // Hepsi zaten seçiliyse tekrar tıklama seçimi kaldırır (tümünü seç/kaldır).
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id))
      const next = new Set(prev)
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)))
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  return useMemo(
    () => ({
      selected,
      count: selected.size,
      isSelected: (id: string) => selected.has(id),
      toggle,
      selectMany,
      clear,
      active: selected.size > 0,
    }),
    [selected, toggle, selectMany, clear],
  )
}

/** Satır başındaki seçim kutusu (satır tıklamasını yutar). */
export function SelectBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onToggle()
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.stopPropagation()
          e.preventDefault()
          onToggle()
        }
      }}
      className={`grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-[6px] border transition-colors ${
        checked ? 'border-[#8C4460] bg-[#A5556E] text-white' : 'border-[#e0cad4] bg-white text-transparent hover:border-[#8C4460]'
      }`}
    >
      <CheckSquare className="h-3 w-3" strokeWidth={2.4} />
    </span>
  )
}

/**
 * Silme dışında, seçili kayıtlar üzerinde çalışan ek toplu işlem
 * (ör. "KVKK onay mesajı gönder"). Tek çağrıda tüm Id'leri alır ve
 * kullanıcıya gösterilecek sonuç metnini döner.
 */
export interface BulkAction {
  key: string
  label: string
  icon: LucideIcon
  run: (ids: string[]) => Promise<string>
}

export default function BulkSelectBar({
  api,
  itemLabel,
  onDelete,
  onDone,
  pageIds,
  actions = [],
  allowDelete = true,
}: {
  api: BulkSelectApi
  /** "müşteri" / "hizmet" / "paket" — mesajlarda kullanılır. */
  itemLabel: string
  /** Tek bir kaydı siler. Hata fırlatırsa o kayıt "başarısız" sayılır. */
  onDelete: (id: string) => Promise<unknown>
  /** Silme bittikten sonra listeyi tazelemek için. */
  onDone: () => Promise<unknown> | unknown
  /** Sayfadaki tüm kayıtlar ("tümünü seç" için). */
  pageIds: string[]
  /** Silme dışındaki toplu işlemler (silme butonunun solunda çıkar). */
  actions?: BulkAction[]
  /** false ise silme butonu hiç çizilmez — seçim yalnızca ek işlemler için açılır. */
  allowDelete?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<string>('')
  const [runningAction, setRunningAction] = useState<string | null>(null)

  const runAction = async (action: BulkAction): Promise<void> => {
    const ids = Array.from(api.selected)
    setRunningAction(action.key)
    setResult('')
    try {
      const message = await action.run(ids)
      api.clear()
      setResult(message)
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'İşlem tamamlanamadı.')
    } finally {
      setRunningAction(null)
      setTimeout(() => setResult(''), 6000)
    }
  }

  const runDelete = async (): Promise<void> => {
    const ids = Array.from(api.selected)
    setBusy(true)
    setProgress(0)
    setResult('')
    let ok = 0
    let failed = 0
    for (const id of ids) {
      try {
        await onDelete(id)
        ok++
      } catch {
        failed++
      }
      setProgress(ok + failed)
    }
    setBusy(false)
    setConfirming(false)
    api.clear()
    setResult(failed === 0 ? `${ok} ${itemLabel} silindi.` : `${ok} ${itemLabel} silindi, ${failed} kayıt silinemedi.`)
    await onDone()
    setTimeout(() => setResult(''), 5000)
  }

  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => api.isSelected(id))

  return (
    <>
      <AnimatePresence>
        {result && !api.active && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-[12px] font-semibold text-emerald-700 shadow-lg"
          >
            {result}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {api.active && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-5 left-1/2 z-[60] flex w-[min(94vw,640px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-[18px] border border-[#EAD8DF] bg-white/98 px-4 py-3 shadow-[0_24px_60px_-30px_rgba(120,71,88,0.75)] backdrop-blur"
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-[#F6DFE6] px-3 py-1.5 text-[12px] font-bold text-[#a34a62]">
              {api.count} {itemLabel} seçildi
            </span>

            <button
              type="button"
              onClick={() => api.selectMany(pageIds)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#EAD8DF] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#74616A] transition-colors hover:border-[#BE7690] hover:text-[#A5556E] disabled:opacity-50"
            >
              {allOnPageSelected ? <Square className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
              {allOnPageSelected ? 'Sayfa seçimini kaldır' : 'Sayfadakilerin tümü'}
            </button>

            <button
              type="button"
              onClick={api.clear}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#EAD8DF] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#74616A] transition-colors hover:border-[#BE7690] hover:text-[#A5556E] disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Seçimi temizle
            </button>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!confirming &&
                actions.map((action) => {
                  const Icon = action.icon
                  const running = runningAction === action.key
                  return (
                    <button
                      key={action.key}
                      type="button"
                      onClick={() => runAction(action)}
                      disabled={busy || runningAction !== null}
                      className="inline-flex items-center gap-1.5 rounded-[11px] border border-[#cfe3d8] bg-[#f2fbf7] px-3 py-1.5 text-[11px] font-bold text-[#2c7d63] transition-colors hover:border-[#9bd0ba] hover:bg-[#e7f7f0] disabled:opacity-60"
                    >
                      {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                      {action.label}
                    </button>
                  )
                })}
              {busy && (
                <span className="text-[11px] font-semibold text-[#74616A] tabular-nums">
                  {progress}/{api.count}
                </span>
              )}
              {!allowDelete ? null : confirming ? (
                <>
                  <span className="text-[11px] font-semibold text-[#b3453f]">Emin misiniz?</span>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                    className="rounded-[11px] border border-[#EAD8DF] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#74616A] disabled:opacity-50"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    onClick={runDelete}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-[11px] bg-[#cf4d68] px-3.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-[#b8405a] disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Evet, sil
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={runningAction !== null}
                  className="inline-flex items-center gap-1.5 rounded-[11px] bg-[#cf4d68] px-3.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-[#b8405a] disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Seçilenleri sil
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
