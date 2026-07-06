# Mobil (Personel) ↔ Web Parite Denetimi — Sonuç

Hedef: Mobil personel/yönetim rolünün web ile **fonksiyonel paritesi** (web'de personelin yaptığı her aksiyon mobilde de var). Web'in analitik dashboard'ları "fonksiyonel eşdeğer" sayılır; piksel-birebir hedeflenmedi.

> Not: İlk taslak satır sayısına bakarak yanlış "eksik" işaretlemişti. Aşağıdaki tablo **kod okunarak** doğrulanmıştır.

Durum: 🟢 tam · 🟡 fonksiyonel eşdeğer (dashboard derinliği farkı) · 🔧 bu turda kapatıldı

| Modül | Durum | Not |
|---|---|---|
| Müşteriler | 🔧🟢 | CRUD + karaliste aksiyonu vardı; **TC (online giriş) alanı eklendi**. Pasif/karaliste filtre-sekmeleri web'de var (analitik), mobilde liste+durum rozeti yeterli. |
| Randevular | 🔧🟢 | Takvim, oluştur/ertele/durum/not/iptal vardı; **"Tamamlandı"da puanlama linki üretimi eklendi** (web ile aynı). |
| Stok | 🟢 | Ürün CRUD + **stok hareketi ekle** (giriş/çıkış) mevcut. |
| Paketler | 🟢 | Paket + kalem formu mevcut. |
| Kasa | 🟢 | Cari, cashflow, gider mevcut. |
| Kasa Kapanış | 🟡 | Oluştur + sil mevcut. Web'deki "önizleme" mobilde yok (oluştururken sunucu hesaplar) — fonksiyonel eşdeğer. |
| Ön Muhasebe | 🟢 | Adisyon/cari/tahsilat/gider akışı mevcut (1400+ satır özel ekran). |
| Bekleme Listesi | 🟢 | Ekle/durum/sil mevcut. |
| Hediye Çek | 🟢 | Oluştur/sil/aktiflik/**kullan-bakiye düş** mevcut. |
| Personel | 🟢 | CRUD + **şifre sıfırla** + **şube transfer** + giriş bilgisi gösterimi mevcut. |
| Bildirimler | 🔧🟢 | Şablon CRUD + gönder vardı; **"Ödeme hatırlatmalarını çalıştır" eklendi**. Loglar `/notification-logs` ile erişilebilir. |
| Onaylar | 🟢 | Onayla/reddet mevcut. |
| Seanslar | 🟢 | Müşteri seans görünümü mevcut. |
| Raporlar | 🟡 | Temel rapor mevcut; web'in grafik derinliği daha fazla (analitik, fonksiyonel eşdeğer). |
| Ayarlar | 🟢 | Kurum + WhatsApp ayarları mevcut. |
| Şube/Kampanya/Komisyon/Hizmet/Kategoriler/WhatsApp/İzin | 🟢 | Mevcut. |

## Bu turda kapatılan gerçek eksikler
1. **Müşteri TC alanı** (mobil) — online randevu girişini açan alan eklendi.
2. **Bildirim: ödeme hatırlatmalarını çalıştır** — header aksiyonu eklendi.
3. **Randevu: puanlama linki** — "Tamamlandı"da otomatik üretim eklendi (web ile aynı).

## Kalan (bloklamayan, dashboard-düzeyi) farklar
- Müşteriler: pasif/karaliste **filtre sekmeleri** (web analitik görünümü).
- Kasa kapanış: oluşturmadan önce **önizleme** ekranı.
- Raporlar: ek **grafik/analiz derinliği**.

Bunlar personelin yapabildiği bir aksiyonu engellemez; istenirse ayrıca eklenebilir.
