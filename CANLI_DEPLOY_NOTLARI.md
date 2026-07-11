# Canlı (Production) Deploy Notları & Kritik Uyarılar

> Bu dosya, projeyi canlıya alırken **mutlaka** dikkat edilmesi gereken kalıcı notları içerir.
> Derinlemesine analiz: kök dizindeki `kritikbulgular.md` (18 Haz 2026) + bu seansta yapılan düzeltmeler.

---

## ⛔ ASLA YAPMA / KAYBETME

1. **Encryption master key'i (`Encryption:MasterKeyBase64`) bir kez belirleyip ASLA değiştirme, ASLA kaybetme.**
   - İsim, telefon, notlar, adres vb. alanlar AES-256-GCM ile bu anahtarla şifrelenir (`ENC:v1:...`).
   - Anahtar değişirse/kaybolursa **mevcut tüm şifreli veri çözülemez hale gelir** (geri dönüşü yok).
   - Prod'da güçlü, 32 byte base64 bir değer üret, **secret store / env değişkeninde sakla**, yedekle.
   - Anahtarı dosyaya/commit'e KOYMA.

2. **JWT imzalama anahtarını (`Jwt:SigningKey`) değiştirirsen tüm aktif oturumlar düşer.** Güçlü, gizli, ≥32 byte olmalı.
   - Not: Varsayılan dev anahtarlarıyla backend prod'da **bilerek açılmaz** (exception atar). Bu bir korumadır; deploy'da gerçek değerleri ver.

3. **`appsettings.Development.json` içindeki gerçek MySQL parolasını prod'a taşıma.** (Bkz. açık sorun #9.) Prod connection string'i env/secret ile ver.

---

## ✅ Deploy ÖNCESİ zorunlu adımlar

### Veritabanı
- [ ] **Encryption kolon migration'ını uygula:** `WidenEncryptedColumns` (`20260621214008`).
  - Schema prod'da otomatik migrate OLMAZ (sadece Development'ta). Elle uygula:
    - `dotnet ef database update -p backend/src/GuzellikMerkezi.Infrastructure -s backend/src/GuzellikMerkezi.Api`
    - veya script üret: `dotnet ef migrations script <önceki> WidenEncryptedColumns -i -o widen.sql` → kontrol et → prod'da çalıştır.
  - **Uygulanmadan** kurum/personel/müşteri oluşturma "Data too long for column" (500) vermeye devam eder.
- [ ] (Opsiyonel) Plan tablosu boşsa: `Database__SeedReferenceData=true` ile bir kez başlat, sonra kaldır. (Güvenli, idempotent; DDL/demo eklemez.)
- [ ] (Opsiyonel) **İlk kurulumda demo veriyi de istiyorsan** (yeni cihaz/sunucu veya canlı): `Database__SeedDemoData=true` ile bir kez başlat.
  - Bu bayrak tek hamlede: **DB oluşturur + EF migration uygular + demo seed eder** (kurum/şube/personel/müşteri/randevu…).
  - **Idempotent:** kurum zaten varsa hiçbir demo verisi eklemez ve mevcut şifrelere dokunmaz → tekrar tekrar açık kalsa da zarar vermez, yine de ilk kurulumdan sonra `false`'a almak en temizi.
  - ⚠️ **GÜVENLİK:** Demo hesaplar bilinen `Guzellik123!` parolasıyla gelir (platform/admin/personel/lotus `*@beautyassist.test`). Canlıda kullandıktan sonra bu hesapların **parolalarını derhal değiştir** ya da gereksizlerini sil. Gerçek/internete açık bir kurulumda demo seed yerine kendi ilk yönetici hesabını oluşturmayı tercih et.
  - Not: Bu bayrak açıkken şema migration'ları da **otomatik** uygulanır (yukarıdaki "elle migrate" adımının yerine geçer). Zayıf `Jwt:SigningKey`/`Encryption:MasterKeyBase64` ile prod'da seed çalışmaz — anahtar kontrolü seed'den ÖNCE çalışır ve uygulamayı durdurur (önce gerçek anahtarları ver).

### Backend env / config
- [ ] `Jwt:SigningKey` = güçlü gizli değer (env).
- [ ] `Encryption:MasterKeyBase64` = güçlü gizli değer (env) — **bir daha değiştirme** (yukarı bak).
- [ ] `ConnectionStrings__DefaultConnection` = prod DB (env/secret).
- [ ] **`ASPNETCORE_URLS` somut host ile verilmeli** (örn. `http://127.0.0.1:5019`). `http://+:PORT` veya `http://0.0.0.0:PORT` (Docker'da yaygın) verilirse personel onay replay'i kırılır*.
  - *Bu seansta `HttpApprovalReplayer`'a wildcard→127.0.0.1 normalizasyonu eklendi; yine de somut host vermek en güvenlisi.
- [ ] `Cors:AllowedOrigins` — yalnızca proxy mimarisi kullanılıyorsa önemsiz (tarayıcı backend'e doğrudan gitmez). Doğrudan erişim varsa gerçek domain(ler) yazılmalı.
- [ ] **`WhatsApp__AppSecret`** = Meta App Secret (env). WhatsApp webhook imza doğrulaması için. **Tanımsızsa canlıda gelen webhook'lar işlenmez** (fail-closed) — gerçek 2 yönlü hatırlatma kullanılıyorsa mutlaka ver. (Meta App Dashboard → Settings → Basic → App Secret.)
- [ ] **Reverse proxy arkasındaysan gerçek istemci IP'sini aç:** aynı sunucudaki nginx/IIS için ek ayar gerekmez; **cloud LB için** `ForwardedHeaders__TrustAll=true` (LB dış `X-Forwarded-For`'u ezmeli) **veya** `ForwardedHeaders__KnownProxies__0=<lb-ip>`. Yoksa login rate-limit ve audit/güvenlik logları proxy IP'sini görür (tüm kullanıcılar tek kovaya düşer).

### Frontend env
- [ ] `NEXT_PUBLIC_API_BASE_URL=/api/proxy` (değişmemeli).
- [ ] `BACKEND_API_BASE_URL=<backend iç adresi>` — **set edilmezse** proxy `BackendNotConfigured` döner (site backend'e ulaşamaz).
- [ ] `CORS_ALLOWED_ORIGINS=<gerçek public domain(ler)>` (credential'lı CORS'ta `*` kullanılmaz).

### Altyapı
- [ ] **HTTPS zorunlu.** Kopyalama butonları (`navigator.clipboard`) ve genel güvenlik secure-context gerektirir; HTTP'de mobil tarayıcıda kopyalama sessizce çalışmaz.
- [ ] WhatsApp gerçek modda kullanılacaksa `WhatsApp:PublicBaseUrl` public domaine ayarlanmalı (yoksa `http://localhost:5019`'a düşer → webhook/medya URL'leri yanlış).

---

## 🔐 Güvenlik denetimi düzeltmeleri (5 Tem 2026)

Pentest/güvenlik denetimi sonrası kapatılan açıklar:

- **WhatsApp webhook imza doğrulaması (YÜKSEK):** `/api/whatsapp/webhook` artık gelen gövdeyi işlemeden önce Meta imzasını (`X-Hub-Signature-256`, HMAC-SHA256, `WhatsApp:AppSecret`) doğruluyor. Öncesinde imzasız/sahte istekler gerçek randevuları iptal ettirebilir/onaylatabilirdi. Prod'da `WhatsApp__AppSecret` **zorunlu** (yoksa fail-closed).
- **Login brute-force freni (YÜKSEK):** `/api/auth/login` + `/api/auth/login-scope` artık IP başına 5 dk'da 15 denemeyle sınırlı (`auth-login` rate-limit). Öncesinde personel/admin parolaları sınırsız denemeye açıktı.
- **Gerçek istemci IP'si (ORTA):** `UseForwardedHeaders` eklendi (config'le; bkz. env checklist). Rate-limit + audit logları artık proxy değil gerçek IP'yi görebilir.
- **Ortam zorlaması kaldırıldı (ORTA):** ASPNETCORE_ENVIRONMENT zorla "Development" yapan kod artık yalnız `#if DEBUG`. Release/prod'da env verilmezse güvenli varsayılan (Production) → zayıf-anahtar fail-fast aktif, demo seed + Swagger kapalı.
- **Cari okuma izin kapısı (ORTA):** `/api/admin/accounts` (finansal/cari) artık personel için `Accounting` sayfa iznine tabi (öncesinde izinsiz personel de okuyabiliyordu).
- **Savunmasız bağımlılık (ORTA):** `Microsoft.OpenApi` 2.0.0 → 2.9.0 (NU1903 / GHSA-v5pm-xwqc-g5wc yüksek önem açığı kapatıldı). Backend 0 uyarı / 0 hata ile derleniyor.

## 🐞 Bu seansta DÜZELTİLENLER (özet)

- Şifreli kolon uzunlukları (longtext / indeksli olanlar varchar(512)) + `WidenEncryptedColumns` migration. (kritikbulgular #3 — uzunluk kısmı)
- FluentValidation `ValidationFilter<T>` pipeline'a bağlandı (Tenant/Branch/Customer/Staff/Service/Appointment). (kritikbulgular #4)
- PDF crash (`background:{canvas}` kaldırıldı), eksik credential'da PDF butonu kilidi, telefon uzunluk limitleri, proxy/CORS hardening, `/health` alias, seed gating, 3 derleme uyarısı.
- Timezone "Z" eksikliği için merkezi `parseUtc` (frontend `lib/datetime.ts`) — randevu/log saatleri her cihazda doğru.
- `ApprovalReplay` wildcard host normalizasyonu.
- Refresh-token rotasyonu atomik hale getirildi.
- Personel onay kuyruğu sessiz hata gizlemesi düzeltildi.
- Plansız tenant prod'da fail-closed (özellik + limit).
- Başarılı GET'ler artık audit'e yazılmıyor.
- `X-Branch-Id` tenant/erişim doğrulaması.
- Onay (approve/reject) uçları yalnızca yönetici rollerine; personel yalnızca kendi bekleyenlerini listeler.
- **#1 (kısmi):** Hassas + bağımsız alanlara personel izin kapısı (PermissionEndpointFilter): Loglar, Bildirimler, Giderler/Gider kategorileri (Muhasebe), Kasa akışı/kapanışı (Kasa).
- **#8 Bildirimler:** SMS/e-posta artık platform servisinden GERÇEK gönderiliyor (sağlayıcı yoksa simülasyon); durum gerçek sonuca göre (Sent/Failed); e-posta kotası da kontrol ediliyor.
- **#11 Platform kullanım özeti N+1 → GROUP BY** (sorgu sayısı tenant sayısından bağımsız).
- **#3 (kısmi):** Müşteri + personel ARAMASI düzeltildi — şifreli alanlarda SQL `.Contains()` çalışmadığından bellekte (çözülmüş değerde) filtreleme (bu repodaki yerleşik desen).

## ⏳ Hâlâ AÇIK (dedike çalışma gerektirir — bkz. kritikbulgular.md)

- **#3 (kalan) Alfabetik sıralama + ölçek:** Şifreli `FullName` SQL'de alfabetik sıralanamaz (ORDER BY ciphertext'e göre, deterministik ama alfabetik değil) ve büyük tenant'ta arama tüm satırları yükler. Tam çözüm: aranabilir/sıralanabilir alanlar için **HMAC blind-index + normalize sort-key** kolonları (ayrı tasarım + migration). Telefon eşitliği/mükerrer kontrolü de bu kapsamda.
- **#1 (kalan) Tam authz matrisi:** Cari (`/api/admin/accounts`) okuma kapısı 5 Tem 2026'da eklendi. Kalan: Müşteri/Randevu/Hizmet/Stok/Rapor/Komisyon uçlarının personel OKUMA izin kapısı, çapraz bağımlılıklar (ör. randevu oluştururken müşteri/hizmet/personel listesi okuma; adisyonda ürün listesi) nedeniyle "okuma vs yönetim" ayrımı gerektirir; frontend ile koordineli test edilmeli. Not: Staff yazma işlemleri zaten onay kapısı + aksiyon izniyle korunuyor; bu madde yalnız OKUMA sızıntısı içindir.
- **#9 Dev parolası:** `appsettings.Development.json` git'e GİRMEMİŞ (gitignore'lu) — repo/geçmiş riski yok. Yine de paylaşıldıysa döndür; prod'da farklı secret kullan.
