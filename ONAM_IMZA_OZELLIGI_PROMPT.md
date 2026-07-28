# Onam Formu + Tablet Dijital İmza — Uygulama Promptu

> Bu dosya, özelliği **başka bir projede sıfırdan** kurdurmak için hazırlanmış bir yönergedir.
> Aşağıdaki metnin tamamını yapay zekâ ajanına yapıştır. Kendi yığınını (dil/çatı/veritabanı)
> "Uyarlama" bölümünde belirt.
>
> Metin, aynı özelliği gerçek bir üründe uçtan uca kurarken karşılaşılan hataların üzerine
> yazılmıştır; "Zorunlu kurallar" bölümündeki her madde, **yaşanmış bir hatanın karşılığıdır**.
> O bölümü kısaltma.

---

## 1. Görev

Bir hizmet işletmesi (güzellik merkezi / klinik / stüdyo) için **onam (rıza) formu** sistemi kur.
Personel bilgisayardan formu hazırlar, tek dokunuşla salondaki **tablete gönderir**; müşteri
tablette formu okur, onay maddelerini işaretler, **parmağıyla imzalar**; imza anında personelin
ekranına düşer ve belge **logolu PDF** olarak müşterinin dosyasına eklenir.

Randevu/işlem "Tamamlandı" yapılırken, o işleme bağlı formlar imzalı mı diye kontrol edilir;
eksikse uyarı çıkar.

---

## 2. Akış (birebir bu sırayla çalışmalı)

1. Yönetici, **Ayarlar**'da onam formu şablonu yazar: başlık, metin, müşterinin işaretleyeceği
   onay maddeleri, imza zorunlu mu, **hangi hizmetlerde zorunlu olduğu**.
2. Personel müşteri kartından (ya da randevudan) formu açar → sistem şablondan bir **müşteri kaydı**
   üretir (durum: `Draft`). Personel isterse uygulama notu yazar (doz, bölge, uyarı).
3. Personel **"Tablete Aktar"** der, hedef tabletin adını seçer/yazar (ör. `Kabin 1`).
   Sistem **tek kullanımlık imza oturumu** açar (durum: `AwaitingSignature`).
4. O ada sahip tablet, formu birkaç saniye içinde ekranına alır.
5. Müşteri metni okur, **tüm** onay maddelerini işaretler, imza alanına imzasını atar,
   "Onaylıyorum ve İmzalıyorum" der.
6. Kayıt `Signed` olur: imza görseli, tarih-saat, imzalayan adı, cihaz ve IP bilgisi saklanır.
   Oturum anahtarı **silinir**.
7. Personelin ekranına **"Form imzalandı"** bildirimi düşer.
8. İmzalı belge **logolu PDF** olarak indirilebilir/paylaşılabilir.
9. İşlem/randevu tamamlanırken eksik form varsa personele uyarı gösterilir.

---

## 3. Veri modeli

Üç tablo kur.

### 3.1 `consent_form_templates` — şablon (kurumun yazdığı metin)

| Alan | Tip | Not |
|---|---|---|
| `Id` | uuid | |
| `TenantId` | uuid | çok kiracılıysa |
| `Title` | varchar(200) | zorunlu |
| `Body` | **LONGTEXT** | form metni; yer tutucu içerir |
| `CheckItemsJson` | **LONGTEXT** | onay maddeleri, JSON string dizisi |
| `RequiresSignature` | bool | `false` = yalnız bilgilendirme, imza istenmez |
| `IsActive` | bool | |
| `SortOrder` | int | |
| soft-delete + zaman damgaları | | |

**Yer tutucular:** metinde `{{musteri}}`, `{{hizmet}}`, `{{kurum}}`, `{{personel}}`, `{{tarih}}`
kullanılabilir.

### 3.2 `service_consent_forms` — hizmet ↔ şablon bağı

`Id`, `TenantId`, `ServiceId`, `TemplateId`. Çoka-çok: bir hizmete N form, bir form N hizmete.
`(TenantId, ServiceId)` ve `(TenantId, TemplateId)` indeksli olsun.

### 3.3 `customer_consent_forms` — müşteri kaydı (imzalanan belge)

| Alan | Tip | Not |
|---|---|---|
| `Id`, `TenantId`, `BranchId?` | | |
| `CustomerId` | uuid | |
| `AppointmentId?` | uuid | randevudan açıldıysa |
| `TemplateId?` | uuid | şablon silinse de kayıt yaşar → **nullable / SET NULL** |
| **`Title`, `Body`, `CheckItemsJson`, `RequiresSignature`** | | **şablondan KOPYALANIR** |
| `CustomerName` | şifreli | belgeye basılacak ad (PII) |
| `ServiceId?`, `ServiceName?` | | |
| `StaffId?`, `StaffName?` | şifreli | uygulayan |
| `StaffNotes?` | şifreli | doz/bölge/uyarı |
| `Status` | enum | `Draft` / `AwaitingSignature` / `Signed` / `Cancelled` |
| `SessionToken?` | uuid | **tek kullanımlık**; imzadan sonra `null` |
| `StationName?` | varchar(120) | **şifrelenmez** (sorgu bu alanla yapılır) |
| `SessionExpiresAtUtc?` | datetime | varsayılan +30 dk |
| `CheckedItemsJson?` | LONGTEXT | müşterinin işaretledikleri |
| `SignatureImage?` | **LONGTEXT** | base64 PNG |
| `SignedAtUtc?`, `SignerName?` (şifreli), `SignerDevice?`, `SignerIp?` | | |

**İndeksler:** `(TenantId, CustomerId)`, `(TenantId, Status, StationName)` ← tablet yoklaması bunu
kullanır, `(SessionToken)`.

---

## 4. API uçları

**Şablon yönetimi** (yönetici):
```
GET    /consent-templates
POST   /consent-templates
PUT    /consent-templates/{id}
DELETE /consent-templates/{id}
```

**İmza akışı** (personel + tablet):
```
GET    /consent/customers/{customerId}            → müşterinin kayıtları
GET    /consent/customers/{customerId}/status     → eksik/tamam özeti
GET    /consent/appointments/{id}/status          → randevu kapısı için
POST   /consent/forms                             → şablondan müşteri kaydı aç
PUT    /consent/forms/{id}                        → personel notunu güncelle
DELETE /consent/forms/{id}                        → iptal
POST   /consent/forms/{id}/session                → "Tablete Aktar"
DELETE /consent/forms/{id}/session                → gönderimi geri al
GET    /consent/station/pending?station=Kabin 1   → tablet yoklaması
POST   /consent/session/{token}/sign              → imzala
```

`status` yanıtı: `{ complete, requiredCount, signedCount, requirements[] }`.
`requirements[]` her biri: `{ templateId, title, requiresSignature, formId?, status?, signedAtUtc?, serviceName? }`.

---

## 5. ZORUNLU KURALLAR (her madde yaşanmış bir hatadır — atlama)

### Belge bütünlüğü

1. **Şablon metni müşteri kaydına kopyalanır.** Kayıt şablona referansla değil, **kendi
   metniyle** yaşar. Şablon sonradan değişirse imzalanmış belge değişmemelidir — imzalanan
   metin neyse o kalmalı.

2. **Yer tutucular SUNUCUDA, kayıt oluşturulurken doldurulur.** İstemciye bırakma.
   *Neden:* metni gösteren her yüzey (tablet, PDF, önizleme, personel ekranı) ayrı ayrı
   kurum/hizmet/müşteri bilgisini taşımak zorunda kalır; **bir yerde unutulur** ve müşteri
   `"..................... bünyesinde"` yazan bir belge imzalar. Karşılığı olmayan alan için
   noktalı boşluk bırak (elle doldurulabilsin).

3. **Şablon silinince imzalı kayıtlar SİLİNMEZ.** Yalnız şablon ve hizmet bağları kalkar.
   İmzalı belge hukuki kayıttır.

4. **İmzalı kayıt değiştirilemez.** Güncelleme / iptal / yeniden imza denemesi → `409`.

5. **Belgeye e-posta basma.** "Uygulayan" adı: personel kaydı adı → kullanıcı ad soyadı →
   *hiç yazma*. Giriş e-postasına düşmek hem çirkin hem gereksiz bilgi ifşasıdır.

### İmza oturumu güvenliği

6. **Oturum anahtarı tek kullanımlıktır.** İmzadan sonra `null`'la. Aynı bağlantıyla ikinci
   imza denemesi `404` dönmeli.

7. **Süre sınırı var** (varsayılan 30 dk). Süresi dolan oturumla imza `409`.

8. **Aynı tablete yeni form gönderilince, o tablette bekleyen eski formların oturumu kapatılır.**
   Yoksa sırada kalmış eski bir form yanlış müşteriye imzalatılır.

9. **Tablet yalnız kendi adına gönderilen formu görür.** Yoklama sorgusu istasyon adıyla
   süzülmeli; başka istasyon o formu görmemeli (bunu teste yaz).

10. **Zorunlu onay maddelerinin tamamı işaretlenmeden imza kabul edilmez — SUNUCUDA doğrula.**
    İstemci doğrulaması yeterli değil. Eksikse `400` ve eksik maddeleri mesajda say.

11. **`RequiresSignature` ise imza görseli boşken kayıt kabul edilmez** (`409`).

### Yetki

12. **İmza uçlarını personel onay/kuyruk mekanizmasının DIŞINDA tut.** Projede "personelin
    yazma işlemleri yönetici onayına düşer" gibi bir kapı varsa, imza akışı ona takılırsa form
    tablete hiç düşmez, imza hiç alınamaz. Şablon yönetimi kapının içinde kalabilir.

13. **Müşteri rolündeki oturumlar bu uçlara erişememeli.** Müşteri portalı varsa, portal
    kullanıcısı bu uçları çağırıp *başka* müşterilerin belgelerini okuyabilir. Rol beyaz listesi
    kullan (kara liste değil — yeni rol eklenince sessizce açılır).

14. **Paket/plan kapısı varsa YALNIZ YAZMA yollarına koy.** Okuma serbest kalmalı: paket düşse
    bile daha önce imzalanmış belgeler görüntülenebilmeli.

### Veritabanı

15. **`Body`, `CheckItemsJson`, `CheckedItemsJson`, `SignatureImage` → LONGTEXT.** Base64 imza ve
    uzun metin dar `VARCHAR`'a sığmaz; üretimde "Data too long" ile patlar.

16. **PII alanlarını şifrele** (müşteri adı, imzalayan adı, personel adı/notu) — ama
    **`StationName`'i şifreleme**: tablet yoklaması bu kolonla `WHERE` yapıyor, şifreliyse
    eşleşme çalışmaz.

### İş akışı

17. **Tamamlama kapısı YUMUŞAK olsun.** Eksik form varsa uyar, formları açma imkânı ver, ama
    **"İmzasız devam et"** seçeneğini bırak. Sert engel salonun işini durdurur; imzasız işlem
    yapıldığını *görünür kılmak* yeterlidir.

18. **Uyarı şeridi sessiz olsun.** Hiç şablon tanımlanmamışsa ya da eksik yoksa **hiçbir şey
    çizme**. Özelliği kullanmayan kurumu rahatsız etme.

19. **İmzasız tamamlanan işlem görünür kalsın:** müşteri kartı, cari/hesap ekranı ve
    adisyon/fatura ekranında aynı uyarı şeridi dursun.

---

## 6. Ekranlar

### 6.1 Ayarlar › Onam Formları (yönetici)

- Şablon listesi: başlık, onay maddesi sayısı, bağlı hizmetler, aktif/pasif.
- Yeni form: **boş sayfa verme**, doldurulabilir bir iskelet metin + 4 hazır onay maddesiyle başlat.
- Düzenleyici: başlık, metin (mono yazı tipi, ~14 satır), onay maddeleri (ekle/sil),
  "imza zorunlu" + "aktif" anahtarları, **hizmet seçimi** (kategoriye göre gruplanmış çipler).
- **PDF önizleme** butonu (boş form, ıslak imza çizgisiyle).
- Yer tutucu listesi ekranda yazılı olsun.

### 6.2 Hizmet formu

"Onam formları" bölümü: kurumun formları çip olarak listelenir, seçilenler o hizmete bağlanır.
Hiç form yoksa "Ayarlar › Onam Formları"na yönlendiren not göster.

### 6.3 Onam Merkezi (personel — modal/sayfa)

Müşteri kartından, randevudan, cari ve adisyondan açılır.

- Üstte özet: `3/4 form imzalı` + eksikse sarı, tamamsa yeşil şerit.
- Gerekli formların listesi; her satırda durum rozeti (`Hazırlanıyor` / `İmza bekleniyor` /
  `İmzalandı`) ve duruma göre buton:
  - imzalanmamış → **Formu doldur**
  - imza bekliyor → tablet adı + **Geri al**
  - imzalı → **PDF indir** + **Yeniden al**
- "Formu doldur" açılınca: metin önizlemesi, müşterinin işaretleyeceği maddeler (salt okunur),
  **uygulama notu** kutusu, **tablet adı** kutusu, **Tablete Aktar** butonu.
- İmza bekleyen form varken **2,5–3 sn'de bir yokla**; imza gelince yeşil **"Form imzalandı"**
  şeridi göster.
- Altta: bu işleme ait olmayan diğer imzalı formlar (PDF erişimiyle).

### 6.4 Tablet İmza İstasyonu (ayrı sayfa/ekran)

- **İlk açılış:** "Bu tablete bir ad verin (ör. Kabin 1)" — ad cihazda **kalıcı** saklanır.
- **Bekleme hâli:** nabız gibi animasyonlu ikon + "Form bekleniyor" + **tablet adının görünür
  olduğu bir kart** (personel bilgisayarda bu adı yazacak) + **"Değiştir"** butonu.
- **Adı değiştirme:** üst çubukta da bulunsun; ekranda imza bekleyen form varken **onay sor**
  (müşterinin yarım imzası gitmesin), eski adı giriş kutusuna ön-doldur.
- **Form geldiğinde:** başlık, müşteri/işlem/uygulayan çipleri, kaydırılabilir metin, uygulama
  notu, büyük dokunmatik onay kutuları, imza alanı, imzalayan ad kutusu.
- **Buton kilidi:** tüm maddeler işaretlenmeden ve imza atılmadan aktifleşmesin; altında
  "Devam etmek için tüm onay maddelerini işaretleyin." gibi yönlendirme yaz.
- **İmza sonrası:** tam ekran "Formunuz imzalandı" teşekkür ekranı (~6 sn), sonra bekleme hâline dön.
- Üstte **bağlantı göstergesi** (Bağlı / Bekleniyor).
- Aynı form tekrar yoklanınca ekranı **sıfırlama** — müşteri imza atıyor olabilir.

### 6.5 Uyarı şeridi (ortak bileşen)

`customerId` (+ opsiyonel `appointmentId`) alır, durumu çeker, eksikse sarı şerit çizer:
*"2 onam formu imzasız — görüntülemek için tıklayın"*. Tıklayınca Onam Merkezi açılır.
`showWhenComplete` bayrağıyla tamam durumunda yeşil de gösterilebilir.

### 6.6 Tamamlama kapısı

İşlem/randevu "Tamamlandı" akışının **ilk adımı** olsun (ödemeden önce):
eksik form sayısı + hangi formlar + **[Onam formlarını görüntüle]** + **[İmzasız devam et]**.
Formlar imzalanınca kapı kendini yeniden değerlendirip geçmeli.

---

## 7. İmza alanı (teknik)

- **Pointer/unified event** kullan (fare + dokunma + kalem tek API).
- Çizim yüzeyini **devicePixelRatio** ile ölçekle — yoksa tablette imza bulanık çıkar (2–3× sınırla).
- Dışa aktarırken **beyaz zemin bas**: şeffaf PNG bazı PDF görüntüleyicilerde siyah çıkar.
- Tek dokunuşla nokta bırakılabilsin (çok kısa imza).
- Yeniden boyutlanmada mevcut çizimi koru.
- **Temizle** butonu; boşken pasif.
- Boşken alanın üstünde "Parmağınızla buraya imzalayın" ipucu göster.
- Çıktı: `data:image/png;base64,...`

---

## 8. PDF

- Üstte kurum **logosu** + kurum adı + form başlığı, marka renginde ince ayraç.
- Bağlam kutusu: Müşteri / İşlem / Uygulayan.
- Metin biçimleme: `1. BAŞLIK` → başlık, `•` / `-` → madde imi, diğer → paragraf.
- **Onay maddeleri**: işaretliler `[X]` ve vurgulu renkte, işaretsizler `[ ]`.
- Uygulama notları bölümü.
- **İmza bloğu**: imza görseli + altında çizgi + "Müşteri imzası"; yanında tarih-saat ve
  "Dijital olarak tablet üzerinden imzalanmıştır." notu.
- İmza yoksa (şablon önizlemesi) ıslak imza için boş çizgiler.
- Alt bilgi: kurum · form adı · sayfa numarası.
- **Türkçe karakter uyumlu font göm** (varsayılan PDF fontları `ğ ş ı İ` basmaz).
- Dosya adı: `{Müşteri}-{FormAdı}-{tarih}.pdf`

---

## 9. Tablet eşleştirme mantığı

Fiziksel eşleştirme (QR/Bluetooth/kod) **yok**. Tablet, sisteme giriş yapmış ikinci bir ekrandır;
eşleşme **isimle** olur ve tüm iletişim sunucu üzerinden yürür.

- Tablet adı cihazda kalıcı saklanır, bir kez girilir.
- Aktarım tablete değil sunucuya yapılır; tablet 2,5–3 sn'de bir kendi payına düşeni sorar.
- **Neden yoklama (polling), soket değil:** salon içi tek/birkaç tablet için kalıcı soket
  altyapısı gereksiz karmaşıklık; kısa yoklama hem anında hissettirir hem ağ kesintisinden
  kendiliğinden toparlar.
- Aynı Wi-Fi şart değil; tablet sunucuya erişebiliyorsa yeter.
- Tablet o ekranda kalmalı → **kiosk / rehberli erişim modunu öner**.

**İsim eşleşmesi:** baştaki-sondaki boşluk ve büyük/küçük harf farkını **tolere et**
(`kabin 1` = `KABIN 1`). Ortadaki boşluk farkı (`Kabin1` ≠ `Kabin 1`) yazım hatası riskidir.
**Tercih edilen çözüm:** tabletleri sunucuya kaydettir ve personel ekranında serbest metin yerine
**açık olan tabletlerin açılır listesini** göster; ayrıca "Kabin 1 çevrimdışı" uyarısı ver.

---

## 10. Kabul testleri (uçtan uca çalıştır, hepsi geçmeli)

**Şablon**
1. Şablon oluşur, onay maddeleri geri döner.
2. Şablon hizmete bağlanınca o hizmetin randevusu için durum "eksik" der.

**Müşteri kaydı**
3. Form `Draft` durumda oluşur.
4. Şablon metni kayda kopyalanır.
5. **Yer tutucuların tamamı doldurulmuş gelir** (`{{...}}` ve noktalı boşluk kalmaz).
6. `staffName` e-posta **değildir**.
7. Personel notu kaydedilir.

**Tablete aktarma**
8. Durum `AwaitingSignature` olur.
9. Oturum anahtarı üretilir, istasyon adı yazılır.
10. Tablet kendi adıyla formu görür.
11. **Başka istasyon adı o formu GÖRMEZ.**
12. Aynı tablete yeni form gönderilince eskisinin oturumu kapanır.

**İmza**
13. Eksik onay maddesiyle imza → `400`.
14. İmza görseli olmadan (imza zorunluyken) → `409`.
15. Geçerli imza → `Signed`; imza görseli, tarih ve işaretlenen maddeler saklanır.
16. **Oturum anahtarı temizlenir.**
17. Kullanılmış anahtarla ikinci imza → `404`.
18. Süresi dolmuş oturumla imza → `409`.

**Sonrası**
19. Randevu kapısı artık "tamam" der.
20. Müşteri durum ve liste uçları kaydı döner.
21. İmzalı formu güncelleme → `409`.
22. **Şablon silinse de imzalı kayıt durur.**
23. Müşteri rolündeki oturum bu uçlara erişemez (`403`).
24. Paket kapalıyken yazma `409`, **okuma çalışır**.

---

## 11. Uyarlama

Ajana kendi yığınını bildir. Referans uygulama:

- **Backend:** .NET minimal API + EF Core + MySQL, katmanlı (Domain / Application / Infrastructure / Api),
  `Result<T>` dönen servisler, soft-delete + kiracı global query filter.
- **Web:** Next.js (App Router) + TypeScript + Tailwind + framer-motion; imza `<canvas>` +
  Pointer Events; PDF `pdfmake`.
- **Mobil:** Flutter; imza `CustomPaint` + `PictureRecorder`; PDF `pdf` + `printing` paketleri.

Farklı yığında ilkeler aynı kalır; yalnız aşağıdakileri karşılığıyla değiştir:
LONGTEXT ↔ `text`/`clob`, alan şifreleme ↔ projedeki mekanizma, paket/özellik kapısı ↔ projedeki
yetkilendirme, yoklama aralığı ↔ 2–3 sn.

**Bitirmeden önce:** şema değişikliği için migration üret, derleme/tip kontrolü ve linter'ı temiz
bırak, 10. bölümdeki testleri gerçek API'ye karşı çalıştır ve sonucu raporla.
