'use client'

import { useState } from 'react'
import { parseUtc } from '@/lib/datetime'
import { MessageCircleQuestion } from 'lucide-react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import MaydiMascot from '@/components/assistant/MaydiMascot'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { fetchUnansweredQuestions, type AssistantUnanswered } from '@/lib/assistantApi'

const PORTAL_LABELS: Record<string, string> = {
  owner: 'Kurum sahibi',
  branch: 'Şube yöneticisi',
  staff: 'Personel',
  customer: 'Müşteri',
}

const RANGES = [7, 30, 90] as const

/**
 * MAYDİ SORULARI — Maydi'nin cevaplayamadığı sorular (aynı soru sayıyla gruplanır). Kurum sahibi tüm kurumu,
 * şube yöneticisi yalnız kendi şubesini görür (sunucu kuralı). Sık sorulan bir soru, yardım kataloğuna yeni
 * makale eklenmesi gerektiğini gösterir. Soru metni kurumun kendi veritabanındandır; buluta gönderilmez.
 */
export default function MaydiQuestionsPage() {
  const { selectedBranch } = useBranch()
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const { data, loading, error } = useApiQuery<AssistantUnanswered[]>(
    () => fetchUnansweredQuestions(days),
    [days, selectedBranch?.id],
    { initialData: [] },
  )
  const rows = data ?? []

  return (
    <>
      <Topbar
        title="Maydi Soruları"
        subtitle={`Maydi'nin cevaplayamadığı sorular · son ${days} gün`}
        breadcrumbs={['Admin', 'Yönetim', 'Maydi Soruları']}
      />
      <div className="mx-auto w-full max-w-5xl px-4 py-5 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[20px] border border-[#EAD8DF] bg-white/85 p-4">
          <MaydiMascot size={56} mood="guiding" animated={false} />
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-[#5A4B53]">
            Burada, Maydi&apos;ye sorulup yardım kataloğunda karşılığı bulunamayan sorular listelenir. Sık sorulan bir soru,
            yeni bir yardım makalesi eklenmesi gerektiğini gösterir.
          </p>
          <div className="flex gap-1 rounded-xl border border-[#EAD8DF] bg-[#F7F6F6] p-1">
            {RANGES.map((range) => (
              <button key={range} type="button" onClick={() => setDays(range)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${days === range ? 'bg-[#8e3f5b] text-white' : 'text-[#5A4B53]'}`}>
                {range} gün
              </button>
            ))}
          </div>
        </div>

        <ApiStateNotice loading={loading && rows.length === 0} error={error} empty={!loading && !error && rows.length === 0}
          emptyMessage="Bu dönemde cevaplanamayan soru yok." />

        {rows.length > 0 && (
          <div className="overflow-hidden rounded-[20px] border border-[#EAD8DF] bg-white">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-[#fff5f8] text-[11px] uppercase tracking-wide text-[#74616A]">
                <tr>
                  <th className="px-4 py-2.5">Soru</th>
                  <th className="px-4 py-2.5">Soran</th>
                  <th className="px-4 py-2.5 text-right">Sayı</th>
                  <th className="hidden px-4 py-2.5 sm:table-cell">Son soruluş</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.question}-${row.lastAskedAtUtc}`} className="border-t border-[#f6edf1]">
                    <td className="px-4 py-2.5 text-[#2A2027]">
                      <span className="inline-flex items-start gap-2"><MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C85776]" />{row.question}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[#5A4B53]">{PORTAL_LABELS[row.portal] ?? row.portal}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#8e3f5b]">{row.count}</td>
                    <td className="hidden px-4 py-2.5 text-[#74616A] sm:table-cell">
                      {parseUtc(row.lastAskedAtUtc)?.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
