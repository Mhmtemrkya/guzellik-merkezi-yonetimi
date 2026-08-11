'use client'

import { useMemo } from 'react'
import { MessageSquareQuote, Star, Store, UserRound } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'

/**
 * Kurum yöneticisi panosunda "Müşteri Yorumları" kartı.
 *
 * Aynı yorumlar herkese açık vitrinde (/salonlar → /salon/[slug]) de görünür; ORADA müşteri adı
 * MASKELENİR (M*** Y***). Burada kurum kendi müşterisini gördüğü için ad açıktır — sunucu bu ucu
 * yalnız yöneticilere açar (personel 403 alır).
 *
 * Yorumda iki ayrı yıldız vardır: personel yıldızı (hizmeti veren kişi) ve salon yıldızı.
 */

interface ApiAdminReview {
  id?: string
  customerName?: string
  submittedAtUtc?: string
  comment?: string | null
  staffStars?: number
  salonStars?: number | null
  staffName?: string
  serviceName?: string | null
  branchName?: string | null
}

interface ApiAdminReviewSummary {
  totalCount?: number
  salonAverage?: number | null
  staffAverage?: number | null
  withCommentCount?: number
  recent?: ApiAdminReview[]
}

function Stars({ value, tone }: { value: number; tone: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} yıldız`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3 w-3 ${n <= value ? tone : 'text-[#DFD9DC]'}`}
          fill={n <= value ? 'currentColor' : 'none'}
          strokeWidth={1.4}
        />
      ))}
    </span>
  )
}

/** "2026-07-26T…" → "26 Tem" (aynı yıl) ya da "26 Tem 2025". */
function shortDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('tr-TR', sameYear ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CustomerReviewsCard({ tenantId }: { tenantId?: string }) {
  const { data, loading } = useApiQuery<ApiAdminReviewSummary>(
    () => adminApi.recentReviews<ApiAdminReviewSummary>(5, tenantId),
    [tenantId],
    { initialData: {} },
  )

  const reviews = useMemo(() => data?.recent ?? [], [data])
  const total = Number(data?.totalCount ?? 0)
  const salonAvg = data?.salonAverage ?? null
  const staffAvg = data?.staffAverage ?? null

  return (
    <div className="overflow-hidden rounded-[20px] border border-[#EAD8DF] bg-white shadow-[0_18px_42px_-34px_rgba(87,39,61,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEAEC] px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-[11px] bg-[#A5556E] text-white shadow-[0_10px_20px_-14px_rgba(42,32,39,0.8)]">
            <MessageSquareQuote className="h-4 w-4" strokeWidth={1.7} />
          </span>
          <div>
            <div className="font-display text-[14px] font-semibold text-[#2A2027]">Müşteri Yorumları</div>
            <div className="text-[11px] text-[#5A4B53]">
              Salona ve personele gelen değerlendirmeler{total > 0 ? ` · ${total} yorum` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {salonAvg != null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#E3C6D1] bg-[#F6DFE6] px-2.5 py-1 text-[11px] font-semibold text-[#7A3450]">
              <Store className="h-3 w-3" strokeWidth={2} /> Salon {salonAvg.toFixed(1)}
            </span>
          )}
          {staffAvg != null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#A5BFE0] bg-[#DCE7F5] px-2.5 py-1 text-[11px] font-semibold text-[#17406F]">
              <UserRound className="h-3 w-3" strokeWidth={2} /> Personel {staffAvg.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      <div className="divide-y divide-[#EFEAEC]">
        {loading && reviews.length === 0 && (
          <div className="px-5 py-8 text-center text-[12px] text-[#5A4B53]">Yorumlar yükleniyor…</div>
        )}

        {!loading && reviews.length === 0 && (
          <div className="px-5 py-8 text-center text-[12px] text-[#5A4B53]">
            Henüz müşteri yorumu yok. Randevu tamamlandığında müşteriye değerlendirme bağlantısı gider.
          </div>
        )}

        {reviews.map((r, i) => (
          <div key={r.id || i} className="px-5 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 truncate text-[13px] font-semibold text-[#2A2027]">
                {r.customerName || 'Müşteri'}
              </span>
              <span className="flex shrink-0 items-center gap-2.5">
                {r.salonStars != null && (
                  <span className="inline-flex items-center gap-1" title="Salon puanı">
                    <Store className="h-3 w-3 text-[#A5556E]" strokeWidth={2} />
                    <Stars value={r.salonStars} tone="text-[#A5556E]" />
                  </span>
                )}
                <span className="inline-flex items-center gap-1" title="Personel puanı">
                  <UserRound className="h-3 w-3 text-[#1E4E8C]" strokeWidth={2} />
                  <Stars value={Number(r.staffStars ?? 0)} tone="text-[#1E4E8C]" />
                </span>
              </span>
            </div>

            {r.comment && (
              <p className="mt-1.5 text-[12px] leading-relaxed text-[#3E343A]">“{r.comment}”</p>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px] text-[#5A4B53]">
              {r.staffName && <span className="font-semibold text-[#8C4460]">{r.staffName}</span>}
              {r.serviceName && <span>· {r.serviceName}</span>}
              {r.branchName && <span>· {r.branchName}</span>}
              <span className="ml-auto shrink-0">{shortDate(r.submittedAtUtc)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
