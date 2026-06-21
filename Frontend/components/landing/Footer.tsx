'use client'

import { ArrowUpRight } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="relative bg-[#0f070b] py-14 text-[#fff4f8]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f0aac2]/40 to-transparent" />
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-12">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl border border-[#f0aac2]/45 bg-gradient-to-br from-[#3a1a2a]/70 to-[#160b12]/70 text-xs font-bold shadow-[0_0_30px_rgba(240,170,194,0.25)]">
                ÖÖ
              </span>
              <div>
                <div className="text-[11px] uppercase tracking-[0.26em] text-[#fff4f8]/85">
                  Özlem Özge GMS
                </div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#fff4f8]/45">
                  Güzellik Merkezi Yönetim Sistemi
                </div>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-[12px] leading-relaxed text-[#fff4f8]/60">
              Paket, seans, taksit, randevu ve ön muhasebe — güzellik merkezleri için tek panel SaaS.
            </p>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-[#fff4f8]/45">Ürün</div>
            <ul className="mt-4 space-y-2 text-[13px] text-[#fff4f8]/78">
              <li><a className="hover:text-[#ffd3df]" href="#story" data-cursor="HİKAYE">Sinematik Hikaye</a></li>
              <li><a className="hover:text-[#ffd3df]" href="#modules" data-cursor="MODÜL">Ana Modüller</a></li>
              <li><a className="hover:text-[#ffd3df]" href="#flow" data-cursor="AKIŞ">Esnek Tahsilat</a></li>
              <li><a className="hover:text-[#ffd3df]" href="#pricing" data-cursor="FİYAT">Paketler</a></li>
              <li><a className="hover:text-[#ffd3df]" href="#faq" data-cursor="SSS">SSS</a></li>
            </ul>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-[#fff4f8]/45">İletişim</div>
            <ul className="mt-4 space-y-2 text-[13px] text-[#fff4f8]/78">
              <li><a className="inline-flex items-center gap-1 hover:text-[#ffd3df]" href="/login" data-cursor="DEMO">Demo paneline git <ArrowUpRight className="h-3 w-3" /></a></li>
              <li><span className="text-[#fff4f8]/55">destek@ozlemozge-gms.example</span></li>
              <li><span className="text-[#fff4f8]/55">Pzt – Cmt · 09:00 – 19:00</span></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-[#fff4f8]/8 pt-6 text-[11px] uppercase tracking-[0.2em] text-[#fff4f8]/45 sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Özlem Özge Güzellik Merkezi · Tüm hakları saklıdır.</span>
        </div>
      </div>
    </footer>
  )
}
