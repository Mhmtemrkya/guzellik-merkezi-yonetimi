'use client'
import Topbar from '@/components/dashboard/Topbar'
import { Construction } from 'lucide-react'

interface ComingSoonProps {
  title?: string
  subtitle?: string
  breadcrumbs?: string[]
}

export default function ComingSoon({
  title = 'Yakında',
  subtitle = 'Bu modül hazırlanıyor',
  breadcrumbs = [],
}: ComingSoonProps) {
  return (
    <>
      <Topbar title={title} subtitle={subtitle} breadcrumbs={breadcrumbs} />
      <div className="p-12 lg:p-20">
        <div className="max-w-2xl mx-auto text-center border border-[#ead8df]/70 p-12 lg:p-16">
          <div className="inline-flex items-center justify-center w-14 h-14 border border-[#ead8df]/70 mb-7">
            <Construction className="w-5 h-5" strokeWidth={1.3} />
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#352432]/50 mb-3">
            modül · yapım aşamasında
          </div>
          <h2 className="font-display text-4xl lg:text-5xl tracking-tight leading-[0.95]">
            {title} <span className="text-[#c85776]">yakında</span> aktif olacak.
          </h2>
          <p className="mt-5 text-sm text-[#352432]/55 max-w-md mx-auto leading-relaxed">
            Bu modül gerçek API bağlantıları ile birlikte yayına alınacak. Şu an MVP versiyonunda yalnızca Dashboard, Personel & Roller, Log Kayıtları modgüleri tam aktif.
          </p>
          <div className="mt-8 inline-flex gap-2 items-center text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">
            <span className="w-1.5 h-1.5 rounded-full bg-[#fff4f8] animate-pulse" />
            geliştirme · q2 2026
          </div>
        </div>
      </div>
    </>
  )
}
