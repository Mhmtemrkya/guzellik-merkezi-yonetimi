# WhatsApp / SMS / Mail — Ne Olacak (Mesajlaşma Altyapısı Planı)

> Not (16 Haziran 2026): Bu dosya, mesajlaşma altyapısının nasıl olması gerektiğini ve WhatsApp'ı
> kurum panelinden platform paneline taşıma planını tutar. Uygulamaya geçmeden önce aşağıdaki
> **AÇIK KARAR** netleşmeli.

## 1) Mantık / Model (hedef)
- Mesajlaşma altyapısı (SMS göndereni, SMTP/e-posta, **WhatsApp Meta numarası/token**) **PLATFORMA** aittir.
- Bağlantıları **platform (biz)** kurar. Kurumlar randevu hatırlatması vb. yaptığında **bizim SMS / mail / WhatsApp numaramızı** kullanır.
- Kurumlar **paket kotalarından** tüketir (SMS / WhatsApp / Mail aylık kota).
- Özet: **tek merkezi altyapı (platform) + kurum bazlı kota.**

## 2) Mevcut durum
| Kanal | Nerede tutuluyor | Modele uygun mu? |
|------|------------------|------------------|
| SMS + E-posta | `PlatformIntegrationSettings` (platform singleton, sadece Platform Admin; "tüm kurumlar bu merkezi altyapıdan gönderir") | ✅ Doğru |
| **WhatsApp** | `WhatsAppSettings` — **HER KURUMA AYRI**. Kurum yöneticisi → Ayarlar → `WhatsAppSettingsCard`: Telefon No ID, Erişim Token, Business Account ID, Verify Token, Webhook URL, şablon, aç/kapa. Gönderim kurumun numarasını kullanıyor (`settings.HasCredentials`); webhook tenant'ı PhoneNumberId/VerifyToken ile çözüyor. | ❌ Aykırı |
| Kota | WhatsApp gönderiminde `IsFeatureAllowedAsync(NotificationsWhatsApp)` + `CheckLimitAsync("whatsapp")` (WhatsAppService.SendReminderAsync, ~satır 66-70) | ✅ Zaten çalışıyor |

**Sorun:** WhatsApp, SMS/e-posta gibi platforma değil kuruma bağlı → her kurum kendi Meta numarasını giriyor. Olması gereken: WhatsApp da platformda.

## 3) Yapılacaklar (plan)

### Backend
1. `PlatformIntegrationSettings`'e WhatsApp alanları ekle: `WhatsAppEnabled`, `WhatsAppPhoneNumberId`, `WhatsAppAccessTokenEncrypted`, `WhatsAppBusinessAccountId`, `WhatsAppVerifyToken`, `WhatsAppProvider`. + EF migration.
2. `WhatsAppService.SendReminderAsync`: canlı/simülasyon kararı **platform kimliğine** göre (platform configured + tenant enabled + kota OK). Tenant `HasCredentials` yerine platform kimliği kullanılır.
3. **Webhook (tek paylaşılan numara):**
   - Verify token = **platform** verify token.
   - Gelen mesaj tenant çözümü: gönderenin (müşteri) telefonundan **son giden `WhatsAppMessage` (Outbound)** kaydına eşle → `TenantId` + `AppointmentId`. (PhoneNumberId ile per-tenant çözüm kalkar.)
4. `WhatsAppSettings` (per-tenant): yalnızca **Enabled + ReminderTemplate** kalır (bkz. AÇIK KARAR). Kimlik alanları kurum kontrolünden çıkar.

### Platform paneli
- WhatsApp bölümü **platform mesajlaşma sayfasına** (`PlatformMessagingSettings`, `/platform/...`) eklenir — SMS/e-posta yanına.

### Kurum paneli
- `WhatsAppSettingsCard`'tan numara/token/business/verify/webhook alanları **kaldırılır**.

## 4) AÇIK KARAR (henüz seçilmedi)
**WhatsApp platforma taşınınca kurum (kurum yöneticisi) tarafında ne kalsın?**
- **A) Aç/kapa + mesaj şablonu kalsın** *(önerilen)* — Kurum WhatsApp hatırlatmayı kendi açar/kapatır ve metni özelleştirir; numara/token platformda, gönderim bizim numaramızdan, kurumun paket kotasından düşer.
- **B) Hiçbir şey kalmasın** — WhatsApp tamamen platformda (şablon da platform varsayılanı); kurum ayarlarındaki WhatsApp kartı tamamen kaldırılır. SMS/e-posta ile birebir aynı mantık.

## 5) Kota (zaten çalışıyor)
Paket içinde SMS/WhatsApp/Mail aylık kota var ve gönderimde düşülüyor. Altyapı platforma taşınınca model tam oturur: **bizim numaramız + kurumun kotası.**
