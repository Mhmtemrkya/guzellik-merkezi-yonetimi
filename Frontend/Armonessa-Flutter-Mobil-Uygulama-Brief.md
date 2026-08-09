# BeautyAsist Flutter Mobil Uygulama Briefi

Bu PDF web uygulaması dosyaları incelenerek hazırlanmıştır. Kaynak: `/home/kaya/projects/guzellik-frontend`.

## Renkler
- #160f13 ana arka plan
- #24171d kart/hover yüzeyi
- #fff2df krem yazı
- #d7a373 altın vurgu
- #f2b6c8 pudra vurgu
- #a96b45 bakır

## Admin

- **Dashboard** `/panel`: Kurum yöneticisi ana ekranı: günlük randevu, aylık tahsilat, toplam alacak, aktif müşteri, kritik stok, randevu durumu ve onay özeti. Stat kartları, bugünkü randevular, onay bekleyen işlemler, hızlı özetler.

- **Müşteriler** `/panel/musteriler`: Müşteri kartı içinde paket, ödeme geçmişi, kalan borç, taksit ve seans takibi. Yeni müşteri, kart düzenleme, ödeme alma, yeniden taksitlendirme, randevu bağlama.

- **Paket & Hizmet** `/panel/paketler`: Önce hizmet ekleme, sonra seçili hizmetlerle seanslı/taksitli paket oluşturma. Hizmet ekle, çoklu hizmet seç, paket oluştur, paket/hizmet düzenle. Mobilde multi-select dropdown zorunlu.

- **Randevular** `/panel/randevular`: Aylık çizelge üzerinden müşteri, hizmet, personel ve seans durum takibi. Takvim, günlük slotlar, randevu oluştur/düzenle, durum: tamamlandı/devam/bekliyor.

- **Günlük Kasa** `/panel/kasa`: Günlük gelir-gider ve tahsilat hareketleri. Nakit/kart/havale, işlem tipi, tutar, hedef, personel, onay notu.

- **Ön Muhasebe** `/panel/on-muhasebe`: Kasa, gelir-gider, cari, geciken ödeme, ödeme çizelgesi, tahsilat, prim, muhasebeci raporu. Ödeme al, yeniden taksitlendir, gelir/gider ekle, cari ekstre, toplu bildirim, dışa aktar.

- **Onay Bekleyenler** `/panel/onaylar`: Personel işlemlerinin yönetici onayı. Onayla/reddet, red sebebi, onay notu, tutar, talep eden.

- **Personel & Roller** `/panel/ekip`: Personel listesi, rol, departman, iletişim, durum, performans. Personel ekle, profil düzenle, rol/yetki kurgusu.

- **Bildirimler** `/panel/bildirimler`: Randevu, ödeme, kalan seans ve yönetici onay bildirimleri. WhatsApp/SMS/E-posta kanalı, hedef grup, tetikleyici, kuyruk ve durum.

- **Raporlar** `/panel/raporlar`: Tahsilat, açık alacak, geciken ödeme, paket ve personel performans raporları. Grafikler, PDF/Excel çıktı, KPI kartları.

- **Stok & Ürün** `/panel/stok`: Premium stok: ürün kartı, stok giriş/çıkış, tedarikçi, depo/raf, minimum stok. Ürün ekle, stok gir/çık, sayım, barkod, sipariş, Excel transferi.

- **Ayarlar** `/panel/ayarlar`: Kurum bilgileri, abonelik, finans kuralları, yetkiler ve veri ayarları. Kurum profili, abonelik, finans, veri ve ek hizmet ayarları.

## Personel

- **Personel Dashboard** `/ekip`: Personelin günlük operasyon ekranı. Bugünkü randevular, aylık seans, performans, onay bekleyenler, hızlı seans tamamlama ve müşteri notu.

- **Müşterilerim** `/ekip/musteriler`: Personelin hizmet verdiği müşteriler. Müşteri listesi, kalan seans, paket durumu, not ekleme, paket satış talebi.

- **Randevularım** `/ekip/randevular`: Atanan randevular ve seans akışı. Günlük çizelge, randevu talebi, seansı tamamlama, erteleme, not.

- **Seanslarım** `/ekip/seanslar`: Paket içindeki seansların kullanımı. Seans tamamlama, yeni seans/randevu talebi, kalan seans, dışa aktar.

- **Paket Satışı** `/ekip/paketler`: Personelin paket satış talebi oluşturması. Müşteri, seçilen hizmetler, peşinat, taksit sayısı, yönetici onayı.

- **Kasa / Tahsilat** `/ekip/kasa`: Personel ödeme/tahsilat talebi. Müşteri, tutar, yöntem, açıklama, onay durumu, kendi kasa özeti.

- **Stok Kullanımı** `/ekip/stok`: Personel stok sayımı yapmaz; kullanım ve talep kaydı oluşturur. Sarf çıkışı, stok talebi, ürün havuzu, hareketlerim.

- **Performansım** `/ekip/raporlar`: Kişisel performans ve rapor ekranı. Seans, satış, onay, skor, haftalık dağılım, rapor filtresi/dışa aktar.

- **Bildirimlerim** `/ekip/bildirimler`: Kişisel bildirim akışı. Randevu hatırlatma, onay sonuçları, stok talepleri, okundu işaretleme.

- **İşlem Geçmişim** `/ekip/loglar`: Personelin yaptığı işlemler ve onay durumları. Onaylı/bekliyor/reddedildi, filtre, dışa aktar, düzeltme talebi.

- **Profilim** `/ekip/profil`: Kişisel bilgiler, çalışma saatleri, yetki görüntüleme, güvenlik. Profil düzenleme, parola, çalışma saatleri, bildirim tercihleri, yetki talebi.

## Platform

- **Platform Overview** `/platform`: BeautyAsist tenant yönetimi. Toplam kurum, MRR, toplam kullanıcı, uptime, kurum tablosu, durum etiketleri.

- **Tüm Kurumlar** `/platform/kurumlar`: Platform genelinde kurum listesi. Şu an ComingSoon; mobilde kurum kartları, plan, durum, kullanıcı sayısı planlanmalı.

- **Sağlık Uyarıları** `/platform/uyarilar`: Kritik kurum/sistem uyarıları. Şu an ComingSoon; mobilde kritik uyarı listesi ve filtreler planlanmalı.

- **MRR & Abonelik** `/platform/finans`: Gelir, churn ve abonelik metrikleri. Şu an ComingSoon; mobilde finans KPI ve trend grafikleri planlanmalı.

- **Faturalama** `/platform/fatura`: Kurum faturaları. Şu an ComingSoon; mobilde fatura listesi, durum ve ödeme takibi planlanmalı.

- **Sistem Ayarları** `/platform/sistem`: Global ayarlar ve plan tanımları. Şu an ComingSoon; mobilde sadece yetkili erişimle ayar formları planlanmalı.
