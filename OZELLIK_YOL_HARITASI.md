# BeautyAssist — Özellik Yol Haritası ve Derin Analiz

> Bu belge, mevcut sisteme eklenebilecek özelliklerin **fazlara bölünmüş, derin analizli** planıdır.
> Her özellik için: değer, mevcut altyapı bağı, veri modeli, API uçları, frontend, efor, bağımlılık ve
> dış entegrasyon gereksinimi belirtilmiştir. Uygulama **faz faz, uçtan uca çalışır** biçimde ilerler.

İşaretler: 🟢 düşük efor · 🟡 orta · 🔴 yüksek · 🔌 dış entegrasyon gerektirir (anahtar/sözleşme)

---

## Mevcut sistem (kısa özet)

Çok kiracılı (multi-tenant) güzellik merkezi yönetimi. Hâlihazırda: şube kapsamı, randevu + onay/taslak akışı,
adisyon, cari/taksit tahsilat dağıtımı, prim, personel çizelge + izin, WhatsApp 2 yönlü hatırlatma,
platform SMS/e-posta, paket gating + kota, sadakat puanı, kara liste/pasif müşteri, QR puanlama,
tedavi günlüğü, konsültasyon/anamnez, raporlar (Excel/PDF), dashboard + paket raporu.

Mimari notlar (uygulamada uyulacak):

- **Şema değişikliği = yeni EF migration** (ham SQL bootstrap yok; `MigrateDatabaseAsync` uygular).
- Operasyonel veri **X-Branch-Id** + EF global query filter ile şubeye göre süzülür.
- Personel yazma istekleri **StaffApprovalGate** ile taslağa düşer; yönetici onayında uygulanır.
- DTO alanı eklerken **hem `ToDto` hem explicit `.Select` projeksiyonları** güncellenmeli.
- Paket özelliği gating: `IsFeatureAllowedAsync` (409) + frontend `FeatureGate`.

---

## FAZ 1 — Hızlı kazanım, yüksek değer, bağımsız modüller

### 1.1 Hediye Çeki & Kupon Kodu 🟡 ✅ TAMAMLANDI (uçtan uca, canlı doğrulandı)

- **Değer:** Satış/pazarlama kaldıracı; hediye kartı bakiyesi ve indirim kuponu (yüzde/tutar).
- **Altyapı bağı:** Adisyon/satış akışı, cari, sadakat puanı desenleri.
- **Veri modeli:** `GiftCard(Code, Kind[Percentage|FixedAmount|StoredValue], Value, Balance, ValidUntilUtc, MaxUses, UsedCount, IsActive, Note, CustomerId?)` — `Code` tenant içinde benzersiz.
- **API:** `GET/POST /api/admin/gift-cards`, `GET /gift-cards/validate?code=`, `POST /gift-cards/{id}/redeem`, `POST /gift-cards/{id}/deactivate`.
- **Frontend:** Yönetim sayfası (liste + oluştur + pasifleştir) + adisyon/satışta kod uygulama.
- **Efor:** 🟡 · **Dış entegrasyon:** yok · **Bağımlılık:** yok.

### 1.2 Gün Sonu Kasa Kapanışı / Z Raporu 🟡 ✅ TAMAMLANDI (uçtan uca, canlı doğrulandı)

- **Değer:** Kasiyer kasa sayımı, sistem-fiziki fark kontrolü, mutabakat; suistimal önleme.
- **Altyapı bağı:** Mevcut nakit akışı (`cashFlow`/`cashFlowSummary`).
- **Veri modeli:** `CashRegisterClosing(BranchId, BusinessDate, OpeningBalance, CountedCash, SystemCash, Difference, Note, ClosedByUserId, ClosedAtUtc)`.
- **API:** `GET /api/admin/cash/closing/today` (sistem nakdini hesapla), `POST /cash/closing`, `GET /cash/closing/history`.
- **Frontend:** Kasa sayfasına "Gün Sonu" sekmesi/kartı + geçmiş listesi.
- **Efor:** 🟡 · **Dış entegrasyon:** yok.

### 1.3 Bekleme Listesi (Waitlist) 🟡 ✅ TAMAMLANDI (uçtan uca, canlı doğrulandı)

- **Değer:** Dolu güne talep toplama; iptal olunca sıradakine teklif → no-show boşluğu gelire döner.
- **Altyapı bağı:** Randevu, WhatsApp/SMS bildirim.
- **Veri modeli:** `WaitlistEntry(CustomerId, ServiceDefinitionId?, StaffMemberId?, PreferredDate, Status[Waiting|Notified|Booked|Cancelled], Note, CreatedAtUtc)`.
- **API:** `GET/POST /api/admin/waitlist`, `POST /waitlist/{id}/notify`, `POST /waitlist/{id}/resolve`.
- **Frontend:** Randevular sayfasında "Bekleme Listesi" paneli + "listeye ekle".
- **Efor:** 🟡 · **Otomasyon (iptalde otomatik teklif):** sonraki adım.

### 1.4 Vadesi Geçen Taksit Otomatik Hatırlatma 🟢 ✅ TAMAMLANDI (motor zaten vardı; hedefleme bug'ı düzeltildi + manuel tetik)

- **Değer:** Gecikmiş tahsilatın otomatik nazik hatırlatması → tahsilat oranı artışı.
- **Altyapı bağı:** `overdueAmount` zaten hesaplanıyor; WhatsApp/SMS motoru hazır.
- **Veri modeli:** `Tenant.OverdueReminderEnabled`, `OverdueReminderTemplate`; gönderim için mevcut bildirim kuyruğu.
- **API:** Ayar uçları + arka plan görevi (mevcut `NotificationDispatchBackgroundService`'e kanca).
- **Frontend:** Ayarlar → tahsilat hatırlatma kartı.
- **Efor:** 🟢 · **Dış entegrasyon:** mevcut sağlayıcı (simülasyon modu var).

---

## FAZ 2 — Gelir modeli & müşteri tarafı

### 2.1 Üyelik / Abonelik Modeli (Membership) 🔴

- **Değer:** Tekrarlayan gelir; aylık sabit ücretle "sınırsız"/"ayda X hizmet".
- **Veri modeli:** `MembershipPlan(Name, Price, Period, IncludedServices/Quota)`, `CustomerMembership(CustomerId, PlanId, StartUtc, NextRenewalUtc, Status)`.
- **API:** Plan CRUD, müşteriye üyelik atama, yenileme, kota düşümü (randevu/adisyonda).
- **Bağımlılık:** Cari/adisyon; ideal olarak 2.2 (online ödeme) ile yenileme tahsilatı.
- **Efor:** 🔴 · **Dış entegrasyon:** yenileme için POS (opsiyonel).

### 2.2 Online Ödeme / Sanal POS 🔴🔌

- **Değer:** paket/üyelik online tahsilat → no-show ↓, nakit akışı ↑.
- **Entegrasyon:** iyzico veya PayTR (TR pazarı). Webhook ile cari/adisyona işleme.
- **Veri modeli:** `PaymentIntent/Transaction(Provider, ProviderRef, Amount, Status, CustomerId, RelatedType)`.
- **Bağımlılık:** Sağlayıcı hesabı + anahtar; webhook URL.
- **Efor:** 🔴 · **Dış entegrasyon:** 🔌 (sözleşme + anahtar gerekli).

### 2.3 Online Müşteri Randevu Portalı 🔴

- **Değer:** Müşteri 7/24 kendi randevusunu alır; telefon trafiği ↓.
- **Altyapı bağı:** "kalan seansı olan müşteri" kontrolü, personel müsaitlik + **izin/çizelge**, WhatsApp onay, QR.
- **Veri modeli:** Public booking token/oturum; mevcut randevu modeli.
- **API:** Public uçlar (müsaitlik sorgu, randevu oluştur), tenant slug bazlı.
- **Bağımlılık:** İdeal 2.2 (kapora). **Efor:** 🔴.

---

## FAZ 3 — Operasyon & İnsan Kaynakları

### 3.1 Personel Çalışma Saatleri Şablonu + Yetkinlik Matrisi 🟡

- **Değer:** Haftalık mesai şablonu + "kim hangi hizmeti/cihazı yapabilir" → randevu atamada filtre.
- **Altyapı bağı:** Çizelge/izin (yeni eklendi), `StaffMember.Specialties`, hizmetler.
- **Veri modeli:** `StaffWorkingHours(StaffId, Weekday, Start, End)`, `StaffServiceSkill(StaffId, ServiceDefinitionId)`.
- **Efor:** 🟡.

### 3.2 Bordro / Ay Sonu Hakediş Kapanışı 🟡

- **Değer:** Maaş + prim + avans/kesinti tek ekranda; dönem kapanışı.
- **Altyapı bağı:** Prim (komisyon) hesabı mevcut.
- **Veri modeli:** `PayrollPeriod`, `PayrollLine(StaffId, BaseSalary, Commission, Advance, Deduction, NetPay)`.
- **Efor:** 🟡.

### 3.3 Vardiya & Mesai (giriş-çıkış) Takibi 🟡 · 3.4 Cihaz Bakım/Kalibrasyon Takvimi 🟢

- Personel giriş-çıkış kaydı; cihaz periyodik bakım uyarısı.

### 3.5 Hizmet → Sarf Reçetesi & Otomatik Stok Düşümü 🟡

- **Değer:** Hizmet tamamlanınca stok otomatik düşer → envanter/kâr gerçekçi.
- **Veri modeli:** `ServiceConsumable(ServiceDefinitionId, ProductId, Quantity)`; tamamlanma kancası.
- **Altyapı bağı:** Stok + hizmet + adisyon. **Efor:** 🟡.

### 3.6 Paket Seans Serisi Otomatik Planlama 🟡 · 3.7 Oda/Cihaz Bazlı Planlama 🔴

- 8 seanslık paketi haftalara yay; paylaşılan ekipman çakışma kontrolü (çizelge kaynak bazlı).

---

## FAZ 4 — Pazarlama & CRM

### 4.1 Yaşam Döngüsü Pazarlama Otomasyonu 🟡 ✅ TAMAMLANDI (doğum günü zaten vardı + WinBack/geri kazanım eklendi)

- **Değer:** Doğum günü, ilk ziyaret teşekkürü, win-back (pasif müşteri) otomatik mesaj.
- **Altyapı bağı:** SMS/WhatsApp/e-posta motoru + pasif müşteri tespiti hazır.
- **Veri modeli:** `MarketingAutomation(Trigger, Template, Channel, Active)`; arka plan tarayıcı.
- **Efor:** 🟡.

### 4.2 Yüksek Puan → Google/Instagram Yorum Yönlendirme 🟢

- QR puanlamada 5★ verene otomatik yorum yönlendirme linki.

### 4.3 RFM Segmentasyon & 4.4 Referans (Getir-Kazan) 🟡

- Müşteri segmentleri; referansla gelen müşteriye sadakat puanı.

---

## FAZ 5 — Finans & Muhasebe Derinliği

### 5.1 Tedarikçi & Satın Alma (PO) 🟡 · 5.2 KDV/Vergi Raporları 🟢

- Stok girişini tedarikçi cariyle bağla; KDV özet raporları.

### 5.3 e-Fatura / e-Arşiv (GİB) 🔴🔌

- Resmi fatura entegrasyonu (entegratör anahtarı gerekir). **Dış entegrasyon:** 🔌.

### 5.4 Çoklu Kasa/Banka Hesabı 🟡

- Birden çok kasa/banka; hesaplar arası transfer.

---

## FAZ 6 — Akıllı (AI) Katman

### 6.1 WhatsApp LLM Otomatik Yanıt + Randevu 🟡🔌

- Mevcut Türkçe niyet motorunu Claude'a taşı; müşteri yazarak randevu alsın.

### 6.2 No-show / Churn Tahmini 🟡

- Pasif müşteri tespitini olasılık skoruna çevir.

### 6.3 Konsültasyondan Tedavi/Paket Önerisi 🟡🔌 · 6.4 Kampanya Metni Üretimi 🟢🔌

- Kontrendikasyon motorunun üstüne öneri; pazarlama metni üretimi.

---

## FAZ 7 — Platform / SaaS Tarafı

### 7.1 Self-servis Kayıt + Deneme Süresi 🟡 · 7.2 Abonelik Faturalama Otomasyonu 🔴

- Yeni kurum kendi hesabını açar; ödeme gelmezse otomatik askıya alma (fatura sayfası mevcut).

### 7.3 Marka/Tema Özelleştirme 🟡 · 7.4 API/Webhook 🟡

- Kuruma özel logo/renk; 3. parti entegrasyon için public API.

---

## FAZ 8 — Güvenlik & KVKK

### 8.1 Dijital Açık Rıza + Veri Silme/İhraç Talebi 🟡

- `kvkkConsent` üstüne imzalı onay metni + "verilerimi sil/dışa aktar" akışı.

### 8.2 2FA 🟡 · 8.3 Zengin Denetim Log Görünümü 🟢

- İki adımlı doğrulama; audit log filtreli görünüm + dışa aktarma.

---

## Uygulama sırası (öneri)

1. **Faz 1** (bağımsız, hızlı değer) → 2. **Faz 4.1/4.2** (otomasyon, altyapı hazır) →
2. **Faz 3.5 + 3.1** (operasyon) → 4. **Faz 2** (gelir modeli, POS sözleşmesi gerektirir) →
3. **Faz 6** (AI) → 6. **Faz 5/7/8**.

Dış entegrasyon (🔌) gerektirenler, anahtar/sözleşme hazır olduğunda devreye alınır; o ana kadar
**simülasyon modu** ile geliştirilir (WhatsApp/SMS'te zaten bu desen var).
