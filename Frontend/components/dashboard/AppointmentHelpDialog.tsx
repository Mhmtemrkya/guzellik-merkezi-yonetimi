'use client'

import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  Package,
  Plane,
  ReceiptText,
  Scissors,
  ShoppingBag,
  Timer,
  User,
  UserCog,
  X,
} from 'lucide-react'

/**
 * "Bu modal nasıl çalışır?" — randevu modalının kullanım kılavuzu.
 *
 * En çok sorulan şey ALTIN KURAL: randevu seanstan açılır, seans da satıştan doğar.
 * Bu yüzden kural en üstte, adımlardan önce duruyor.
 */
export default function AppointmentHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden rounded-3xl border border-[#efe1e7] bg-white !p-0 text-[#2b1e29] shadow-[0_44px_120px_-58px_rgba(120,71,88,0.72)] sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(96vw, 860px)', maxHeight: '92dvh' }}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#efe1e7] bg-gradient-to-b from-white to-[#fdf9fb] px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#f3d7e0] bg-gradient-to-br from-[#fff4f8] to-[#ffdfe9] text-[#8e3f5b]">
              <CalendarClock className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="font-display text-[20px] font-extrabold leading-none tracking-[-0.03em] text-[#2b1e29]">
                Bu modal nasıl çalışır?
              </DialogTitle>
              <DialogDescription className="mt-1.5 text-[12.5px] leading-snug text-[#705a66]">
                Randevu açmanın sırası, kuralları ve sık takılınan noktalar.
              </DialogDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Kapat"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#efe1e7] bg-white text-[#705a66] transition-colors hover:border-[#e8c2d1] hover:text-[#2b1e29]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-auto space-y-6 overflow-y-auto px-6 py-6">
          {/* ALTIN KURAL */}
          <section className="rounded-2xl border border-[#e8c2d1] bg-[#fff6f9] p-4">
            <h3 className="flex items-center gap-2 font-display text-[14px] font-extrabold tracking-[-0.01em] text-[#8e3f5b]">
              <ShoppingBag className="h-4 w-4" strokeWidth={2} />
              Altın kural: önce satış, sonra randevu
            </h3>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#4a3a44]">
              Bu ekran <strong>sıfırdan hizmet satmaz</strong>. Randevu, müşterinin daha önce{' '}
              <strong>satın aldığı seanslardan</strong> açılır. Yani sıra şudur:
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {[
                { icon: ShoppingBag, label: 'Hizmet / paket satılır' },
                { icon: Package, label: 'Seans hakkı oluşur' },
                { icon: CalendarClock, label: 'Seanstan randevu açılır' },
                { icon: CheckCircle2, label: 'Tamamlanınca 1 seans düşer' },
              ].map((s, i, arr) => (
                <span key={s.label} className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e8c2d1] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#8e3f5b]">
                    <s.icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                    {s.label}
                  </span>
                  {i < arr.length - 1 && <span className="text-[#c7768f]">→</span>}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-[#4a3a44]">
              Müşterinin seansı yoksa modalı kapatmana gerek yok: sağdaki panelden{' '}
              <strong>Hizmet sat</strong> ya da <strong>Paket sat</strong> de, satış biter bitmez seanslar
              2. adımda görünür.
            </p>
          </section>

          {/* ADIMLAR */}
          <section>
            <h3 className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-[#2b1e29]">
              Adım adım
            </h3>
            <ol className="mt-3 space-y-3">
              <HelpStep n={1} icon={User} title="Müşteri">
                Ad ya da telefonla ara. Kayıtlı değilse <strong>Yeni</strong> ile buradan ekle — kaydedince
                otomatik seçilir. Müşteri seçilince sağ panel dolar: borcu, satışları, kalan seansları ve
                geçmişi tek bakışta görünür.
              </HelpStep>
              <HelpStep n={2} icon={Scissors} title="İşlem">
                Yalnız <strong>satın alınmış ve seansı kalan</strong> işlemler listelenir. Kart üzerindeki
                sayı kalan seansı gösterir. Liste boşsa satış yapılmamış ya da seanslar bitmiştir.
              </HelpStep>
              <HelpStep n={3} icon={CalendarClock} title="Zaman ve personel">
                Tarih, saat, personel ve süreyi seç. Süre hizmetin varsayılanından gelir, gerekirse
                değiştir. Uygun olmayan personel seçersen hemen altında uyarı çıkar.
              </HelpStep>
              <HelpStep n={4} icon={ReceiptText} title="Not">
                İsteğe bağlı. Hassasiyet, özel istek, ödeme uyarısı gibi salon içi notlar — müşteri görmez.
              </HelpStep>
            </ol>
          </section>

          {/* SIK TAKILINAN NOKTALAR */}
          <section>
            <h3 className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-[#2b1e29]">
              Sık takılınan noktalar
            </h3>
            <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
              <HelpTip icon={Package} title="İşlem listesi boş">
                Müşteri o hizmeti satın almamış ya da seansları bitmiş. Sağ panelden sat, liste anında
                tazelenir.
              </HelpTip>
              <HelpTip icon={UserCog} title="Personel seçilemiyor">
                Personel o hizmet kategorisinde yetkili değildir. Başka personel seç ya da personel
                kartından yetki ver.
              </HelpTip>
              <HelpTip icon={Plane} title="Personel izinli / saat kapalı">
                O gün ya da o saat aralığı randevuya kapatılmıştır. Farklı saat, gün veya personel seç.
              </HelpTip>
              <HelpTip icon={Hourglass} title="Saat dolu">
                Bir personelin aynı aralıkta en fazla 2 randevusu olabilir. Dolu saatte modal seni{' '}
                <strong>bekleme listesine</strong> eklemeyi önerir; yer açılınca müşteriye WhatsApp&apos;tan
                teklif gider.
              </HelpTip>
              <HelpTip icon={Banknote} title="Müşterinin borcu var">
                Sağ panelden <strong>Tahsilat al</strong> ile randevudan çıkmadan tahsil edebilirsin; ödeme
                en eski vadeden başlayarak taksitlere dağıtılır.
              </HelpTip>
              <HelpTip icon={Timer} title="Seans ne zaman düşer?">
                Randevu açılınca değil, <strong>Tamamlandı</strong> yapılınca. İptal edilen randevu seansı
                tüketmez.
              </HelpTip>
            </ul>
          </section>

          {/* PERSONEL NOTU */}
          <section className="rounded-2xl border border-dashed border-[#e8d5de] bg-[#fdf9fb] p-4">
            <h3 className="font-display text-[13.5px] font-extrabold tracking-[-0.01em] text-[#2b1e29]">
              Personel olarak açıyorsan
            </h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#4a3a44]">
              Randevu <strong>taslak</strong> olarak kaydedilir ve kurum yöneticisinin onayına düşer.
              Yalnızca kendi takvimine randevu açabilirsin.
            </p>
          </section>
        </div>

        <footer className="flex shrink-0 justify-end border-t border-[#efe1e7] bg-white px-6 py-3.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-xl bg-[#8e3f5b] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#7c3450]"
          >
            Anladım
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

function HelpStep({
  n,
  icon: Icon,
  title,
  children,
}: {
  n: number
  icon: typeof User
  title: string
  children: ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#e8c2d1] bg-[#fff4f8] text-[12.5px] font-bold text-[#8e3f5b]">
        {n}
      </span>
      <div className="min-w-0 pt-0.5">
        <div className="flex items-center gap-1.5">
          <Icon className="h-4 w-4 shrink-0 text-[#c7768f]" strokeWidth={1.9} />
          <h4 className="text-[13px] font-bold text-[#2b1e29]">{title}</h4>
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#4a3a44]">{children}</p>
      </div>
    </li>
  )
}

function HelpTip({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof User
  title: string
  children: ReactNode
}) {
  return (
    <li className="rounded-2xl border border-[#efe1e7] bg-white p-3.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0 text-[#c7768f]" strokeWidth={1.9} />
        <h4 className="text-[12.5px] font-bold text-[#2b1e29]">{title}</h4>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-[#4a3a44]">{children}</p>
    </li>
  )
}
