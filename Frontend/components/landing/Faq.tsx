'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { HelpCircle, Plus } from 'lucide-react'
import { useState } from 'react'

interface FaqEntry {
  q: string
  a: string
}

const items: FaqEntry[] = [
  {
    q: 'Excel’den geçiş zor mu? Verilerimizi nasıl aktarırsınız?',
    a: 'Excel veri aktarımı bir ek hizmettir. Mevcut müşteri, borç, paket, taksit ve seans kayıtları sisteme aktarılır. Kurulum sırasında firma hesabı, kullanıcılar, hizmetler ve örnek paketler hazır olarak teslim edilir.',
  },
  {
    q: 'Düzensiz ödeme yapan müşteri olursa ne olur?',
    a: 'Sistem her tahsilatı geçmişe işler ve kalan borcu otomatik hesaplar. İsterseniz kalan borcu yeniden taksitlendirebilirsiniz; eski ödemeler asla silinmez.',
  },
  {
    q: 'Bir paket içinde birden fazla hizmet ve farklı seans sayısı olabilir mi?',
    a: 'Evet. Örnek: 8 seans lazer + 4 seans cilt bakımı + 2 seans tüy sarartma. Her hizmet için ayrı seans takibi yapılır — toplam, kullanılan ve kalan otomatik düşer.',
  },
  {
    q: 'Randevu tamamlandığında seans otomatik düşer mi?',
    a: 'Evet. Randevu “Tamamlandı” olarak işaretlendiğinde ilgili paketin ilgili hizmet seansı düşer. Bekliyor, Geldi, Tamamlandı, Ertelendi, İptal, Gelmedi durumları kullanılabilir.',
  },
  {
    q: 'Personel bazlı yetki ve prim raporu var mı?',
    a: 'Profesyonel ve Premium paketlerde personel bazlı randevu yönetimi, performans ve prim raporları bulunur. Premium pakette gelişmiş yetkilendirme ve yönetici dashboard’u eklenir.',
  },
  {
    q: 'Çok şubeli yönetim destekleniyor mu?',
    a: 'Çoklu şube desteği Premium pakette gelir. Kurumsal pakette markaya özel domain, özel kurulum, kaynak kod devri ve özel modüller opsiyonu sunulur.',
  },
  {
    q: 'E-fatura ve mobil uygulama var mı?',
    a: 'MVP odak; paket, taksit, ödeme, seans ve randevu akışının kusursuz çalışmasıdır. E-fatura ve mobil uygulama ilk aşamada şart değildir; sonraki sürümlerde planlanmaktadır.',
  },
]

interface ItemProps {
  item: FaqEntry
  isOpen: boolean
  onToggle: () => void
  i: number
}

function Item({ item, isOpen, onToggle, i }: ItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.55, delay: i * 0.04 }}
      className={`overflow-hidden rounded-3xl border backdrop-blur-xl transition-all ${
        isOpen
          ? 'border-[#f0aac2]/45 bg-gradient-to-br from-[#3a1a2a]/55 via-[#160b12]/55 to-transparent shadow-[0_24px_70px_rgba(240,170,194,0.18)]'
          : 'border-[#fff4f8]/12 bg-[#160b12]/55 hover:border-[#f0aac2]/30'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
        data-cursor={isOpen ? 'KAPAT' : 'AÇ'}
      >
        <span className="font-display text-[15px] text-[#fff4f8] sm:text-base">{item.q}</span>
        <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.4 }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#fff4f8]/16 bg-[#fff4f8]/5 text-[#ffd3df]">
          <Plus className="h-3.5 w-3.5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="px-6 pb-5 text-[14px] leading-relaxed text-[#fff4f8]/76">{item.a}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function Faq() {
  const [openIdx, setOpenIdx] = useState<number>(0)

  return (
    <section id="faq" className="relative bg-[#160b12] py-28">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(240,170,194,0.12),transparent_50%)]" />

      <div className="relative mx-auto max-w-4xl px-5 sm:px-8 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7 }}
          className="mb-10 text-center"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/55 px-4 py-2 text-[10px] uppercase tracking-[0.26em] text-[#ffd3df] backdrop-blur-xl">
            <HelpCircle className="h-3.5 w-3.5" /> Sık sorulanlar
          </div>
          <h2 className="hero-title text-[clamp(2.2rem,4.4vw,4.4rem)] leading-[0.92] tracking-[-0.04em] text-[#fff4f8]">
            Aklınızdaki sorulara <span className="beautyassist-text-gradient">net cevaplar.</span>
          </h2>
        </motion.div>

        <div className="space-y-3">
          {items.map((item, i) => (
            <Item key={i} item={item} i={i} isOpen={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  )
}
