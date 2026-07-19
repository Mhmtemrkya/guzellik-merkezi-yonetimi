'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { adminApi } from '@/lib/apiClient'
import { apiItems } from '@/lib/apiMappers'
import type { ApiCustomer } from '@/lib/types'

export interface CustomerPickerItem {
  id: string
  name: string
  phone?: string
}

const PICKER_LIMIT = 50

/**
 * Sunucu-taraflı müşteri araması — `onSearch` prop'una verilir. Tüm listeyi
 * istemciye çekmeden ilk 50 eşleşmeyi getirir (isim/telefon/e-posta; sınırsız ölçek).
 */
export function customerSearchProvider(tenantId?: string): (q: string) => Promise<CustomerPickerItem[]> {
  return async (q: string) => {
    const res = await adminApi.customers<ApiCustomer>({
      tenantId,
      search: q || undefined,
      page: 1,
      pageSize: PICKER_LIMIT,
    })
    return apiItems(res)
      .map((c) => ({ id: c.id || '', name: c.fullName || c.name || 'Müşteri', phone: c.phone || undefined }))
      .filter((c) => c.id)
  }
}

function trLower(s: string): string {
  return s.toLocaleLowerCase('tr-TR')
}

/**
 * Aramalı müşteri seçici — binlerce kayıtlık listelerde native <select> yerine
 * isim/telefonla filtreleyip ilk 50 eşleşmeyi gösterir.
 */
export default function CustomerPicker({
  items,
  value,
  disabled,
  onChange,
  onSelectItem,
  onSearch,
  className,
  placeholder = 'İsim veya telefonla ara…',
}: {
  /** Yerel mod: aranacak liste. onSearch verilirse yalnızca seçili kaydı çözmek için kullanılır. */
  items: CustomerPickerItem[]
  value: string
  disabled?: boolean
  onChange: (id: string) => void
  /** Seçilen kaydın tamamı (id+ad+telefon) — sunucu aramasında parent listede olmayabilir. */
  onSelectItem?: (item: CustomerPickerItem) => void
  /**
   * Sunucu-taraflı arama — verilirse liste istemcide filtrelenmez; her sorgu
   * (debounce'lu) sunucudan ilk sayfayı getirir. Sınırsız müşteri ölçeği için.
   */
  onSearch?: (query: string) => Promise<CustomerPickerItem[]>
  /** Input alanının stil sınıfı — verilmezse panel varsayılanı kullanılır. */
  className?: string
  placeholder?: string
}) {
  const [openList, setOpenList] = useState(false)
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<CustomerPickerItem[] | null>(null)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchSeq = useRef(0)

  // Sunucu araması: liste açıkken sorgu değiştikçe debounce'lu fetch.
  useEffect(() => {
    if (!onSearch || !openList) return
    const seq = ++searchSeq.current
    setRemoteLoading(true)
    const t = setTimeout(() => {
      onSearch(query.trim())
        .then((rows) => {
          if (searchSeq.current === seq) setRemote(rows)
        })
        .catch(() => {
          if (searchSeq.current === seq) setRemote([])
        })
        .finally(() => {
          if (searchSeq.current === seq) setRemoteLoading(false)
        })
    }, query.trim() ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, openList, Boolean(onSearch)])

  const fieldCls =
    className ||
    'min-h-11 w-full rounded-xl border border-[#efe1e7] bg-white px-4 py-3 text-sm text-[#4a3a44] shadow-sm outline-none transition-all hover:border-[#efbfd0] focus:border-[#e9a6bf] focus:ring-2 focus:ring-[#f0aac2]/50'

  // Sunucu aramasında seçilen kayıt parent'ın items listesinde olmayabilir — yerelde tut.
  const [lastPicked, setLastPicked] = useState<CustomerPickerItem | null>(null)
  const selected = useMemo(
    () =>
      items.find((c) => c.id === value) ||
      (remote || []).find((c) => c.id === value) ||
      (lastPicked && lastPicked.id === value ? lastPicked : undefined),
    [items, remote, lastPicked, value],
  )

  const filtered = useMemo(() => {
    if (onSearch) return remote || []
    const q = trLower(query.trim())
    if (!q) return items.slice(0, PICKER_LIMIT)
    const digits = q.replace(/\D/g, '')
    const out: CustomerPickerItem[] = []
    for (const c of items) {
      const nameHit = trLower(c.name || '').includes(q)
      const phoneHit = digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits)
      if (nameHit || phoneHit) {
        out.push(c)
        if (out.length >= PICKER_LIMIT) break
      }
    }
    return out
  }, [items, query, onSearch, remote])

  // Dışarı tıklanınca listeyi kapat.
  useEffect(() => {
    if (!openList) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenList(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openList])

  const selectedLabel = selected ? `${selected.name}${selected.phone ? ` · ${selected.phone}` : ''}` : ''

  if (disabled) {
    return <div className={`${fieldCls} cursor-not-allowed opacity-60`}>{selectedLabel || '— Müşteri seç —'}</div>
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#c85776]/[0.55]" strokeWidth={2} />
        <input
          type="text"
          className={`${fieldCls} pl-9 ${selected && !openList ? 'font-medium' : ''}`}
          placeholder={placeholder}
          value={openList ? query : selectedLabel}
          onFocus={() => {
            setQuery('')
            setOpenList(true)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!openList) setOpenList(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpenList(false)
            if (e.key === 'Enter' && openList && filtered.length > 0) {
              e.preventDefault()
              setLastPicked(filtered[0])
              onChange(filtered[0].id)
              onSelectItem?.(filtered[0])
              setOpenList(false)
            }
          }}
        />
        {selected && !openList && (
          <button
            type="button"
            aria-label="Seçimi temizle"
            onClick={() => onChange('')}
            className="absolute right-3 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-[#9d7386] transition-colors hover:bg-[#fbe5eb] hover:text-[#c85776]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {openList && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-[#efe1e7] bg-white shadow-[0_24px_60px_-24px_rgba(120,71,88,0.45)]">
          <div className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {onSearch && remoteLoading && filtered.length === 0 ? (
              <div className="px-4 py-5 text-center text-[12px] text-[#705a66]">Aranıyor…</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-5 text-center text-[12px] text-[#705a66]">Eşleşen müşteri bulunamadı.</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setLastPicked(c)
                    onChange(c.id)
                    onSelectItem?.(c)
                    setOpenList(false)
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#fff4f8] ${
                    c.id === value ? 'bg-[#fdf4f8]' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-[#4a3a44]">{c.name}</span>
                    {c.phone && <span className="mt-0.5 block text-[11px] font-mono text-[#705a66]">{c.phone}</span>}
                  </span>
                  {c.id === value && <Check className="h-4 w-4 shrink-0 text-[#c85776]" strokeWidth={2.2} />}
                </button>
              ))
            )}
          </div>
          <div className="border-t border-[#f4e8ed] bg-[#fffafc] px-4 py-1.5 text-[10px] text-[#9d7386]">
            {onSearch
              ? remoteLoading
                ? 'Aranıyor…'
                : query.trim()
                  ? `${filtered.length}${filtered.length >= PICKER_LIMIT ? '+' : ''} eşleşme`
                  : `İlk ${filtered.length} kayıt — daraltmak için yazın`
              : query.trim()
                ? `${filtered.length}${filtered.length >= PICKER_LIMIT ? '+' : ''} eşleşme`
                : `İlk ${Math.min(items.length, PICKER_LIMIT)} kayıt gösteriliyor — daraltmak için yazın (toplam ${items.length})`}
          </div>
        </div>
      )}
    </div>
  )
}
