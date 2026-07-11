# BeautyAssist Flutter Mobil Uygulama Briefi

Bu PDF web uygulaması dosyaları incelenerek hazırlanmıştır. Kaynak: `/home/kaya/projects/guzellik-frontend`.

## Renkler
- #160f13 ana arka plan
- #24171d kart/hover yüzeyi
- #fff2df krem yazı
- #d7a373 altın vurgu
- #f2b6c8 pudra vurgu
- #a96b45 bakır

## Admin

- **Dashboard** `/admin`: Kurum yöneticisi ana ekranı: günlük randevu, aylık tahsilat, toplam alacak, aktif müşteri, kritik stok, randevu durumu ve onay özeti. Stat kartları, bugünkü randevular, onay bekleyen işlemler, hızlı özetler.

- **Müşteriler** `/admin/musteriler`: Müşteri kartı içinde paket, ödeme geçmişi, kalan borç, taksit ve seans takibi. Yeni müşteri, kart düzenleme, ödeme alma, yeniden taksitlendirme, randevu bağlama.

- **Paket & Hizmet** `/admin/paketler`: Önce hizmet ekleme, sonra seçili hizmetlerle seanslı/taksitli paket oluşturma. Hizmet ekle, çoklu hizmet seç, paket oluştur, paket/hizmet düzenle. Mobilde multi-select dropdown zorunlu.

- **Randevular** `/admin/randevular`: Aylık çizelge üzerinden müşteri, hizmet, personel ve seans durum takibi. Takvim, günlük slotlar, randevu oluştur/düzenle, durum: tamamlandı/devam/bekliyor.

- **Günlük Kasa** `/admin/kasa`: Günlük gelir-gider ve tahsilat hareketleri. Nakit/kart/havale, işlem tipi, tutar, hedef, personel, onay notu.

- **Ön Muhasebe** `/admin/on-muhasebe`: Kasa, gelir-gider, cari, geciken ödeme, ödeme çizelgesi, tahsilat, prim, muhasebeci raporu. Ödeme al, yeniden taksitlendir, gelir/gider ekle, cari ekstre, toplu bildirim, dışa aktar.

- **Onay Bekleyenler** `/admin/onaylar`: Personel işlemlerinin yönetici onayı. Onayla/reddet, red sebebi, onay notu, tutar, talep eden.

- **Personel & Roller** `/admin/personel`: Personel listesi, rol, departman, iletişim, durum, performans. Personel ekle, profil düzenle, rol/yetki kurgusu.

- **Bildirimler** `/admin/bildirimler`: Randevu, ödeme, kalan seans ve yönetici onay bildirimleri. WhatsApp/SMS/E-posta kanalı, hedef grup, tetikleyici, kuyruk ve durum.

- **Raporlar** `/admin/raporlar`: Tahsilat, açık alacak, geciken ödeme, paket ve personel performans raporları. Grafikler, PDF/Excel çıktı, KPI kartları.

- **Stok & Ürün** `/admin/stok`: Premium stok: ürün kartı, stok giriş/çıkış, tedarikçi, depo/raf, minimum stok. Ürün ekle, stok gir/çık, sayım, barkod, sipariş, Excel transferi.

- **Ayarlar** `/admin/ayarlar`: Kurum bilgileri, abonelik, finans kuralları, yetkiler ve veri ayarları. Kurum profili, abonelik, finans, veri ve ek hizmet ayarları.

## Personel

- **Personel Dashboard** `/personel`: Personelin günlük operasyon ekranı. Bugünkü randevular, aylık seans, performans, onay bekleyenler, hızlı seans tamamlama ve müşteri notu.

- **Müşterilerim** `/personel/musteriler`: Personelin hizmet verdiği müşteriler. Müşteri listesi, kalan seans, paket durumu, not ekleme, paket satış talebi.

- **Randevularım** `/personel/randevular`: Atanan randevular ve seans akışı. Günlük çizelge, randevu talebi, seansı tamamlama, erteleme, not.

- **Seanslarım** `/personel/seanslar`: Paket içindeki seansların kullanımı. Seans tamamlama, yeni seans/randevu talebi, kalan seans, dışa aktar.

- **Paket Satışı** `/personel/paketler`: Personelin paket satış talebi oluşturması. Müşteri, seçilen hizmetler, peşinat, taksit sayısı, yönetici onayı.

- **Kasa / Tahsilat** `/personel/kasa`: Personel ödeme/tahsilat talebi. Müşteri, tutar, yöntem, açıklama, onay durumu, kendi kasa özeti.

- **Stok Kullanımı** `/personel/stok`: Personel stok sayımı yapmaz; kullanım ve talep kaydı oluşturur. Sarf çıkışı, stok talebi, ürün havuzu, hareketlerim.

- **Performansım** `/personel/raporlar`: Kişisel performans ve rapor ekranı. Seans, satış, onay, skor, haftalık dağılım, rapor filtresi/dışa aktar.

- **Bildirimlerim** `/personel/bildirimler`: Kişisel bildirim akışı. Randevu hatırlatma, onay sonuçları, stok talepleri, okundu işaretleme.

- **İşlem Geçmişim** `/personel/loglar`: Personelin yaptığı işlemler ve onay durumları. Onaylı/bekliyor/reddedildi, filtre, dışa aktar, düzeltme talebi.

- **Profilim** `/personel/profil`: Kişisel bilgiler, çalışma saatleri, yetki görüntüleme, güvenlik. Profil düzenleme, parola, çalışma saatleri, bildirim tercihleri, yetki talebi.

## Platform

- **Platform Overview** `/platform`: BeautyAssist tenant yönetimi. Toplam kurum, MRR, toplam kullanıcı, uptime, kurum tablosu, durum etiketleri.

- **Tüm Kurumlar** `/platform/kurumlar`: Platform genelinde kurum listesi. Şu an ComingSoon; mobilde kurum kartları, plan, durum, kullanıcı sayısı planlanmalı.

- **Sağlık Uyarıları** `/platform/uyarilar`: Kritik kurum/sistem uyarıları. Şu an ComingSoon; mobilde kritik uyarı listesi ve filtreler planlanmalı.

- **MRR & Abonelik** `/platform/finans`: Gelir, churn ve abonelik metrikleri. Şu an ComingSoon; mobilde finans KPI ve trend grafikleri planlanmalı.

- **Faturalama** `/platform/fatura`: Kurum faturaları. Şu an ComingSoon; mobilde fatura listesi, durum ve ödeme takibi planlanmalı.

- **Sistem Ayarları** `/platform/sistem`: Global ayarlar ve plan tanımları. Şu an ComingSoon; mobilde sadece yetkili erişimle ayar formları planlanmalı.
