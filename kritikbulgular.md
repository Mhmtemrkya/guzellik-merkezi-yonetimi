# Kritik Bulgular

İnceleme tarihi: 18 Haziran 2026

## Mevcut çalışma durumu

- Backend `http://localhost:5019` adresinde çalışıyor.
- Frontend proxy hattı `http://localhost:3000/api/proxy` üzerinden backend'e ulaşıyor.
- `/health/live` ve `/health/ready` kontrolleri HTTP `200` dönüyor.
- Backend build sonucu: 0 hata, 0 uyarı.
- Backend test sonucu: 18/18 başarılı.
- Frontend TypeScript kontrolü başarılı.
- Canlı backend logları:
  - `backend/api-live.stdout.log`
  - `backend/api-live.stderr.log`

## Mimari özet

- Backend: .NET 10, Clean Architecture, EF Core ve MySQL.
- Backend kapsamı: 33 entity, 30 servis ve yaklaşık 164 Minimal API endpoint.
- Frontend: Next.js 16 App Router.
- Frontend kapsamı: 38 sayfa; merkezi API client ve Auth, Feature, Branch context yapıları.
- Tenant ve şube izolasyonu ağırlıklı olarak EF Core global query filter ve request context üzerinden uygulanıyor.

## Kritik bulgular

### 1. Backend rol ve izin kontrolleri yetersiz

Önem: Kritik

Admin endpointlerinin çoğu yalnızca `RequireAuthorization()` ile korunuyor. Personel izinleri frontend menü ve rota görünürlüğünde kullanılıyor fakat backend endpointlerinde zorunlu olarak doğrulanmıyor.

Sonuçları:

- Kullanıcı, arayüzde gizli olan bir endpointi doğrudan çağırabilir.
- `Customers`, `Accounting`, `Stock`, `Logs` gibi personel izinleri gerçek güvenlik sınırı oluşturmuyor.
- Personel, onay endpointlerinde rol kontrolü bulunmadığı için kendi bekleyen işlemini onaylamayı deneyebilir.

İlgili alanlar:

- `backend/src/GuzellikMerkezi.Api/Endpoints/PendingOperationEndpoints.cs`
- `backend/src/GuzellikMerkezi.Api/Endpoints/*`
- `backend/src/GuzellikMerkezi.Domain/Permissions.cs`

Öneri:

- Policy-based authorization eklenmeli.
- Endpointler gerekli rol ve permission claim'leriyle korunmalı.
- Onaylama/reddetme yalnızca `InstitutionOwner` veya açıkça yetkilendirilmiş yönetici rolüne açılmalı.
- Personel yalnızca kendi gönderdiği bekleyen işlemi görüntüleyebilmeli ve iptal edebilmeli.

### 2. `X-Branch-Id` başlığı güvenilir kabul ediliyor

Önem: Kritik

`TenantResolutionMiddleware`, istemciden gelen `X-Branch-Id` değerini JWT içindeki şubenin önüne geçiriyor. Gönderilen şubenin aynı tenant'a ait olduğu ve kullanıcının bu şubeye erişebildiği doğrulanmıyor.

Sonuçları:

- Şube kapsamlı bir personel aynı kurum içindeki başka bir şubeyi hedefleyebilir.
- EF global şube filtresi saldırganın gönderdiği şube kimliğiyle çalışabilir.

İlgili dosya:

- `backend/src/GuzellikMerkezi.Api/Middleware/TenantResolutionMiddleware.cs`

Öneri:

- `Staff` ve şube kapsamlı kullanıcılar için şube JWT claim'ine sabitlenmeli.
- Kurum sahibi şube değiştirebiliyorsa seçilen şubenin kendi tenant'ına ait olduğu veritabanından doğrulanmalı.
- Şube erişimi tek bir merkezi authorization servisi üzerinden uygulanmalı.

### 3. Alan şifreleme ile SQL arama ve sıralama birbiriyle uyumsuz

Önem: Kritik

Müşteri adı, telefon, personel adı ve benzeri alanlar rastgele nonce kullanan AES-GCM ile şifreleniyor. Buna rağmen bu alanlarda SQL `Contains`, `OrderBy` ve index işlemleri uygulanıyor.

Sonuçları:

- Müşteri, personel, hizmet ve hesap aramaları güvenilir çalışmaz.
- Şifreli değer üzerinden sıralama alfabetik sonuç üretmez.
- Telefon indexi gerçek telefon eşitliği veya mükerrerlik kontrolü sağlayamaz.
- Aynı açık metin her kayıtta farklı şifreli değer ürettiğinden eşitlik sorgusu yapılamaz.

İlgili alanlar:

- `backend/src/GuzellikMerkezi.Infrastructure/Persistence/GuzellikDbContext.cs`
- `backend/src/GuzellikMerkezi.Infrastructure/Security/AesGcmEncryptionService.cs`
- `backend/src/GuzellikMerkezi.Infrastructure/Services/CustomerService.cs`
- `backend/src/GuzellikMerkezi.Infrastructure/Services/StaffService.cs`

Öneri:

- Aranabilir alanlar için normalize edilmiş HMAC/blind-index kolonları eklenmeli.
- Liste sıralaması için güvenlik ve iş gereksinimine göre ayrı bir strateji belirlenmeli.
- Şifreli kolonların uzunlukları gerçek ciphertext uzunluğuna göre düzenlenmeli.
- Mevcut arama davranışı MySQL entegrasyon testleriyle doğrulanmalı.

### 4. FluentValidation gerçek API pipeline'ında çalışmıyor

Önem: Yüksek

Validator sınıfları DI container'a kaydediliyor ve unit testleri bulunuyor. Ancak Minimal API endpointlerinde validator çağrısı veya otomatik validation filter bulunmuyor.

Sonuçları:

- Unit testte geçersiz sayılan payload gerçek endpointten servise ulaşabilir.
- Bazı hatalar domain veya veritabanı seviyesine kadar ilerleyebilir.
- Endpointler arasında farklı validation davranışı oluşabilir.

İlgili alanlar:

- `backend/src/GuzellikMerkezi.Application/Validation/RequestValidators.cs`
- `backend/src/GuzellikMerkezi.Application/DependencyInjection.cs`

Öneri:

- Minimal API için ortak `ValidationFilter<T>` eklenmeli.
- İstek DTO'su alan tüm endpointlere filter otomatik uygulanmalı.
- Validation hataları standart `ApiResponse` zarfıyla dönmeli.

### 5. Başarılı GET istekleri audit tablosunu sürekli büyütüyor

Önem: Yüksek

`ActivityAuditMiddleware`, başarılı admin `GET` isteklerini de `View` aksiyonu olarak kaydediyor. Frontend periyodik feature kontrolü ve çok sayıda dashboard sorgusu yaptığı için yalnızca sayfayı açık tutmak bile sürekli audit insertleri oluşturuyor.

Sonuçları:

- Audit tablosu hızla büyür.
- Her okuma isteği ek bir veritabanı yazmasına dönüşür.
- Dashboard sorguları daha fazla sorgu ve disk I/O üretir.
- Gerçek güvenlik olayları gürültü içinde kaybolabilir.

İlgili alanlar:

- `backend/src/GuzellikMerkezi.Api/Middleware/ActivityAuditMiddleware.cs`
- `Frontend/components/dashboard/FeatureContext.tsx`

Öneri:

- Genel GET istekleri audit kapsamından çıkarılmalı.
- Yalnızca hassas görüntülemeler gerekiyorsa açık allow-list kullanılmalı.
- Audit saklama ve arşivleme politikası belirlenmeli.

### 6. Refresh-token rotasyonu atomik değil

Önem: Yüksek

Refresh akışı tokenı önce salt okunur yüklüyor, ardından ayrı bir `ExecuteUpdateAsync` ile iptal edip yeni token ekliyor. İki eşzamanlı istek aynı aktif tokenı okuyabilir ve ikisi de yeni token üretebilir.

Sonuçları:

- Tek refresh token üzerinden birden fazla geçerli token zinciri oluşabilir.
- Token reuse tespiti yapılamaz.
- Çoklu sekme veya saldırı senaryosunda oturum güvenliği zayıflar.

İlgili dosya:

- `backend/src/GuzellikMerkezi.Infrastructure/Services/AuthService.cs`

Öneri:

- Koşullu update kullanılmalı: yalnızca `RevokedAtUtc == null` iken güncelle ve etkilenen satır sayısını doğrula.
- Eski token iptali ve yeni token insert işlemi transaction içinde yürütülmeli.
- Reuse tespiti ve token ailesi iptali eklenmeli.
- Eşzamanlı refresh entegrasyon testi yazılmalı.

### 7. Personel onay kuyruğu hatayı başarı olarak gizleyebilir

Önem: Yüksek

`StaffApprovalGateMiddleware`, pending operation oluşturma işlemi başarısız olsa bile HTTP `200` ve `pendingApproval = true` döndürüyor. Sadece `pendingOperationId` boş kalıyor.

Sonuçları:

- Kullanıcı işlemin onaya gönderildiğini düşünür fakat kayıt oluşmamış olabilir.
- Operasyon sessizce kaybolabilir.

İlgili dosya:

- `backend/src/GuzellikMerkezi.Api/Middleware/StaffApprovalGateMiddleware.cs`

Öneri:

- `CreateAsync` başarısızsa gerçek hata kodu ve mesajı dönülmeli.
- Başarı cevabı yalnızca pending operation kalıcı olarak oluşturulduktan sonra üretilmeli.

### 8. Bildirim gönderimleri gerçek durumu yansıtmıyor

Önem: Yüksek

SMS ve e-posta bildirimleri gerçek sağlayıcı çağrısı yapılmadan doğrudan `Sent` olarak kaydediliyor. E-posta kotası tanımlı olmasına rağmen gönderim sırasında kontrol edilmiyor.

Sonuçları:

- Arayüz ve raporlar gönderilmeyen mesajı gönderilmiş gösterir.
- Paket kotaları yanlış hesaplanır.
- Platform kullanım metrikleri gerçeği yansıtmaz.

İlgili alanlar:

- `backend/src/GuzellikMerkezi.Infrastructure/Services/NotificationService.cs`
- `backend/src/GuzellikMerkezi.Infrastructure/Services/UsageService.cs`
- `backend/src/GuzellikMerkezi.Infrastructure/Services/PlatformMessagingService.cs`

Öneri:

- Gerçek provider sonucu gelmeden `Sent` durumuna geçilmemeli.
- `Queued`, `Sent`, `Failed` geçişleri açık şekilde yönetilmeli.
- SMS, e-posta ve WhatsApp kotaları aynı merkezi mekanizmadan uygulanmalı.

### 9. Development veritabanı parolası kaynak dosyada tutuluyor

Önem: Yüksek

Development MySQL bağlantı bilgisi ve parolası `appsettings.Development.json` içinde açık olarak bulunuyor.

Sonuçları:

- Dosya paylaşılır veya repository'ye gönderilirse parola açığa çıkar.
- Aynı parolanın başka ortamlarda kullanılması daha büyük risk oluşturur.

İlgili dosya:

- `backend/src/GuzellikMerkezi.Api/appsettings.Development.json`

Öneri:

- Parola hemen değiştirilip user-secrets veya environment variable'a taşınmalı.
- Dosyada yalnızca güvenli placeholder bırakılmalı.
- Secret tarama kontrolü eklenmeli.

### 10. Planı olmayan tenant için özellik ve limit kontrolleri açık kalıyor

Önem: Orta/Yüksek

Feature ve kullanım servisleri plan bulunmadığında işlemleri serbest bırakıyor.

Sonuçları:

- Plan ataması unutulan tenant tüm ücretli özellikleri veya limitsiz kullanımı elde edebilir.
- Hatalı seed/migration sonrası fail-open davranışı oluşur.

İlgili alanlar:

- `backend/src/GuzellikMerkezi.Infrastructure/Services/FeatureService.cs`
- `backend/src/GuzellikMerkezi.Infrastructure/Services/UsageService.cs`

Öneri:

- Production davranışı fail-closed olmalı.
- Plansız tenant yalnızca paket seçimi ve zorunlu self-service endpointlerine ulaşabilmeli.

### 11. Platform kullanım özeti N+1 sorgu üretiyor

Önem: Orta

Platform özeti her tenant için kullanım metriklerini ayrı ayrı hesaplıyor. Her hesaplama şube, personel, müşteri, randevu ve mesaj tablolarına ayrı count sorguları gönderiyor.

Sonuçları:

- Tenant sayısı arttıkça sorgu sayısı doğrusal ve yüksek katsayıyla büyür.
- Platform dashboard yanıt süresi ve MySQL yükü artar.

İlgili dosya:

- `backend/src/GuzellikMerkezi.Infrastructure/Services/UsageService.cs`

Öneri:

- Tenant bazlı toplu `GROUP BY` sorguları kullanılmalı.
- Gerekirse periyodik kullanım snapshot tablosu oluşturulmalı.

### 12. Test kapsamı kritik akışlar için yetersiz

Önem: Yüksek

Mevcut 18 test başarılı fakat kapsam ağırlıklı olarak domain, validator ve birkaç infrastructure senaryosuyla sınırlı.

Eksik başlıca testler:

- MySQL ile gerçek entegrasyon testleri.
- Tenant ve şube izolasyonu.
- Endpoint rol/permission authorization.
- Pending operation approve/reject yetkileri.
- Eşzamanlı refresh-token rotasyonu.
- Alan şifreleme sonrası arama ve sıralama.
- Notification provider ve kota davranışı.
- API health/login/CRUD smoke testleri.

## Başlangıç sırası

1. Backend permission/role politikalarını ve pending-operation yetkilerini düzelt.
2. `X-Branch-Id` doğrulamasını güvenli hale getir.
3. Şifreli ve aranabilir alanlar için veri modelini yeniden tasarla.
4. FluentValidation endpoint filter ekle.
5. GET audit gürültüsünü durdur.
6. Refresh-token rotasyonunu atomik hale getir.
7. Notification durum ve kota modelini düzelt.
8. Secret'ları kaynak koddan çıkar.
9. Kritik akışlar için MySQL/API entegrasyon testleri ekle.

## Not

Bu belge inceleme bulgularını kayıt altına alır. Henüz kaynak kod üzerinde bu maddelere yönelik bir düzeltme uygulanmamıştır.
