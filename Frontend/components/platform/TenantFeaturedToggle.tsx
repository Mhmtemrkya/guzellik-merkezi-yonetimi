'use client'

import { useEffect, useState } from 'react'
import { Crown, Loader2 } from 'lucide-react'
import { platformApi } from '@/lib/apiClient'

/**
 * Platform admin: kuruma "Premium / Öne Çıkan" etiketi verir/kaldırır.
 * Etiketli salonlar /salonlar listesinde en üstte sıralanır ve kartlarında
 * "Öne Çıkan" rozeti + salon sayfasında "Premium Salon" çipi görünür.
 */
export default function TenantFeaturedToggle({ tenantId }: { tenantId: string }) {
  const [featured, setFeatured] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void platformApi
      .tenantFeatured(tenantId)
      .then((r) => {
        if (!cancelled) setFeatured(Boolean(r?.isFeatured))
      })
      .catch(() => {
        if (!cancelled) setFeatured(false)
      })
    return () => {
      cancelled = true
    }
  }, [tenantId])

  const toggle = async (): Promise<void> => {
    if (featured === null || busy) return
    setBusy(true)
    try {
      const r = await platformApi.setTenantFeatured(tenantId, !featured)
      setFeatured(Boolean(r?.isFeatured))
    } catch {
      /* durum değişmediyse buton eski halinde kalır */
    } finally {
      setBusy(false)
    }
  }

  const active = featured === true
  return (
    <button
      type="button"
      disabled={featured === null || busy}
      onClick={() => void toggle()}
      title={active ? 'Premium etiketi kaldır' : 'Premium / Öne Çıkan etiketi ver'}
      className={`inline-flex w-full items-center justify-center gap-1.5 rounded-[11px] px-2 py-2 text-[9px] font-mono tracking-widest transition-colors disabled:opacity-60 ${
        active
          ? 'border border-[#e8c15a] bg-[#fdf6e3] text-[#a07714] hover:bg-[#faedc8]'
          : 'border border-[#ead8df] bg-white/70 text-[#7c6170] hover:border-[#e8c15a] hover:bg-[#fdf6e3] hover:text-[#a07714]'
      }`}
    >
      {busy || featured === null ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Crown className="h-3 w-3" style={active ? { fill: '#e8c15a' } : undefined} />
      )}
      {active ? 'PREMIUM ✓' : 'PREMIUM VER'}
    </button>
  )
}
