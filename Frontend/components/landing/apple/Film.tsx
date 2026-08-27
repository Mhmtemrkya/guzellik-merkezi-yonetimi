'use client'

/**
 * "BİR GÜN" — sayfanın saati.
 *
 * Bu bölümün KENDİ videosu yoktur. Arkasında sayfanın tamamına yayılan tek kesintisiz çekim
 * akar (bkz. JourneyBackdrop) ve kaydırma onu sürer: yukarıda şafak, aşağıda gece. Buradaki
 * yedi sahne o ışığın üstüne yazılmış saatlerdir — okuyucu ilerledikçe hem metindeki saat
 * hem görüntüdeki ışık birlikte ilerler.
 *
 * HER SAHNE PANELDE GERÇEKTEN VAR OLAN BİR SAYFAYA BAĞLIDIR. `panel` alanı `app/panel/<rota>`
 * altındaki gerçek dizinin adıdır; vitrinde olmayan bir özellik vaat edilmez. Yeni bir sahne
 * eklenecekse önce o rotanın var olduğu doğrulanmalıdır.
 *
 * İÇERİK HAREKETE BAĞLI DEĞİLDİR: sahnelerin metni normal akışta durur ve JavaScript
 * çalışmasa da tamamı okunur. `cine-beat` yalnız giriş/çıkış sönümlemesidir ve `@supports`
 * ile korunur; desteklenmeyen tarayıcıda bütün sahneler tam görünür kalır.
 */

interface Beat {
  time: string
  title: string
  body: string
  /** Panelde karşılık gelen sayfanın adı — kullanıcıya gösterilir. */
  chip: string
  /** `app/panel/<rota>` — gerçekten var olan dizin. */
  panel: string
}

const BEATS: Beat[] = [
  {
    time: '08:40',
    title: 'Gün, siz kapıyı açmadan planlanmış.',
    body: 'Günlük ajanda, haftalık ve aylık takvim hazır. Uzman, oda ve saat çakışması engellenir; personelin açtığı randevu taslağa düşer, siz onaylayana kadar kesinleşmez.',
    chip: 'Randevular',
    panel: 'randevular',
  },
  {
    time: '09:15',
    title: 'Kapıdan giren danışanı tanıyorsunuz.',
    body: 'Paket, borç, kalan seans, not, konsültasyon ve onam formu ile önce/sonra fotoğrafları tek danışan kartında toplanır. Karşılama “kimdiniz?” ile değil, adıyla başlar.',
    chip: 'Müşteriler',
    panel: 'musteriler',
  },
  {
    time: '11:00',
    title: 'Bakım biterken seans kendiliğinden düşer.',
    body: 'Randevu tamamlanınca doğru paketten otomatik seans düşülür. Elle çetele tutmak, “kaç seansı kalmıştı?” diye aramak yok.',
    chip: 'Paket & hizmet',
    panel: 'paket',
  },
  {
    time: '13:30',
    title: 'İptal olan saat boş kalmaz.',
    body: 'Boşalan slot bekleme listesindekilere WhatsApp’tan teklif olarak gider; ilk “Evet” yanıtı saati alır ve randevu kendiliğinden kurulur.',
    chip: 'Bekleme listesi',
    panel: 'bekleme-listesi',
  },
  {
    time: '17:45',
    title: 'Tek fişte hizmet, ürün ve paket.',
    body: 'Adisyon onaylanınca stoktan düşer, personel primi tahakkuk eder, sadakat puanı işlenir ve tahsilat cari hesaba yazılır.',
    chip: 'Ön muhasebe',
    panel: 'on-muhasebe',
  },
  {
    time: '19:30',
    title: 'Onay kutusundan geçmeyen kayıt değişmez.',
    body: 'Personelin yazma işlemleri taslağa düşer, yönetici onayıyla uygulanır. Her adım denetim kaydına yazılır; ay sonunda kimin ne yaptığı tartışma konusu olmaz.',
    chip: 'Onaylar',
    panel: 'onaylar',
  },
  {
    time: '20:10',
    title: 'Kasa sayılır, gün kilitlenir.',
    body: 'Nakit, kart ve havale ayrı ayrı toplanır. Gün sonu kapanışı sayımla doğrulanır ve kilitlenir; aylık rapor kendiliğinden birikir.',
    chip: 'Gün sonu kasası',
    panel: 'kasa-kapanis',
  },
]

export default function Film() {
  return (
    <section id="bir-gun" aria-labelledby="bir-gun-baslik" className="relative scroll-mt-24">
      <div className="mx-auto max-w-[1200px] px-5 pb-4 pt-28 sm:px-8 sm:pt-36">
        <div className="material-dark material-thick max-w-[62ch] rounded-[24px] p-7 sm:p-9">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#FFB6CC]">Bir gün</p>
          <h2 id="bir-gun-baslik" className="display-lg balance mt-4 text-white">
            Merkezinizin bir günü, saat saat.
          </h2>
          <p className="on-material balance mt-5 text-[16.5px] leading-relaxed text-white">
            Aşağıdaki her sahne panelde açıp kullandığınız bir sayfaya karşılık gelir. Kaydırdıkça
            arkadaki ışık da sizinle birlikte sabahtan geceye ilerler.
          </p>
        </div>
      </div>

      <ol>
        {BEATS.map((beat, i) => (
          <li key={beat.time} className="flex min-h-[92svh] items-end">
            <div className="mx-auto w-full max-w-[1200px] px-5 pb-16 pt-24 sm:px-8 sm:pb-20">
              <div className="cine-beat material-dark material-thick max-w-[54ch] rounded-[24px] p-7 sm:p-9">
                <div className="flex items-center gap-3.5">
                  <span className="font-display text-[34px] leading-none tracking-[-0.03em] text-[#FFB6CC] sm:text-[42px]">
                    {beat.time}
                  </span>
                  <span aria-hidden className="h-px w-10 bg-white/45" />
                  <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-white/85">
                    {i + 1} / {BEATS.length}
                  </span>
                </div>

                <h3 className="display-md balance mt-5 text-white">{beat.title}</h3>
                <p className="on-material mt-4 text-[16px] leading-relaxed text-white">{beat.body}</p>

                {/* Rozet, panelde hangi sayfanın açıldığını söyler — vitrin ile ürün birebir eşleşir. */}
                <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/10 px-4 py-2 text-[13px] font-medium text-white">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#FFB6CC]" />
                  Panel · {beat.chip}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
