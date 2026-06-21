# Güzellik Merkezi Yönetimi — Backend TODO

> Bu plan Claude Opus (`claude -p --model opus --effort max`) ile ürettirildi; ardından Hermes/GPT 5.5 ile ilk Clean Architecture MVP dilimi yazıldı ve Windows dotnet ile doğrulandı.

## Proje konumu

- Root: `/mnt/c/Users/KAYA/Desktop/Güzellik Merkezi Yönetimi`
- Frontend: `/mnt/c/Users/KAYA/Desktop/Güzellik Merkezi Yönetimi/Frontend`
- Backend: `/mnt/c/Users/KAYA/Desktop/Güzellik Merkezi Yönetimi/backend`
- WSL symlink: `/home/kaya/projects/guzellik-backend`
- Solution: `backend/GuzellikMerkeziYonetimi.slnx`

## Mimari ilkeler

- Bağımlılık yönü: `Api -> Infrastructure -> Application -> Domain`.
- Domain saf kalacak; EF/Core, HTTP, validation attribute ve dış servis bağımlılığı yok.
- Application DTO/use-case contract/validation/abstraction katmanı olacak.
- Infrastructure EF Core MySQL, JWT, password hashing, repository/service implementasyonları ve seed/migration katmanı olacak.
- API Minimal API endpoint grupları, CORS, auth, tenant middleware, error envelope ve OpenAPI/Scalar wiring katmanı olacak.
- Multi-tenant güvenlik: tenant/branch scoped veriler `TenantId` + gerekiyorsa `BranchId` taşır.
- Platform admin dışındaki hiçbir sorgu global veri dönmemeli.
- Soft delete tüm mutable business entity’lerde query filter ile uygulanmalı.
- Entity dışına response olarak domain sızdırılmamalı; DTO dönülecek.
- UTC zaman kullanılacak.

## Non-goals — İlk MVP dışında

- Gerçek ödeme/faturalama entegrasyonu.
- Gerçek e-posta/SMS/WhatsApp gönderimi.
- BI/raporlama read-model ayrımı.
- Event sourcing.
- Production migration/deploy çalıştırma.

## Tamamlanan ilk MVP dilimi

- [x] Backend root ana dizinde korundu; `Frontend/backend` kullanılmadı.
- [x] `Application/Class1.cs`, `Infrastructure/Class1.cs`, `Tests/UnitTest1.cs` temizlendi.
- [x] WeatherForecast template endpointi kaldırıldı.
- [x] .NET 10 + MySQL provider kararı verildi: Pomelo 9 kaldırıldı, `MySql.EntityFrameworkCore 10.0.7` kullanıldı.
- [x] EF Core paketleri provider ile hizalandı: `Microsoft.EntityFrameworkCore 10.0.7`, `Design 10.0.7`.
- [x] Domain genişletildi:
  - `Tenant`, `Branch`, `TenantUser`
  - `Customer`
  - `StaffMember`
  - `ServiceDefinition`
  - `Appointment`
  - `RefreshToken`
  - `AuditLog`
  - `AppointmentStatus`, `Gender`, `Permission`
  - `RolePermissions`
  - `DomainException`, `BusinessRuleException`
- [x] Application katmanı yazıldı:
  - `Result`, `Error`, `PagedResult`, `ApiResponse`
  - `ICurrentUser`, `ITenantContext`, `IDateTimeProvider`, `IPasswordHasher`, `ITokenService`, `IUnitOfWork`
  - Auth DTO/service contract
  - Tenant/Branch/Customer/Staff/Service/Appointment DTO ve servis kontratları
  - FluentValidation validators
- [x] Infrastructure katmanı yazıldı:
  - `GuzellikDbContext`
  - EF mapping, index, enum conversion, decimal precision
  - tenant/soft-delete global query filters
  - `TenantContext`
  - PBKDF2 `PasswordHasher`
  - JWT `JwtTokenService`
  - Auth/Tenant/Branch/Customer/Staff/Service/Appointment servis implementasyonları
- [x] API katmanı yazıldı:
  - `ExceptionHandlingMiddleware`
  - `TenantResolutionMiddleware`
  - `HttpCurrentUser`
  - JWT auth wiring
  - frontend CORS policy
  - OpenAPI/Scalar development wiring
  - `/health/live`, `/health/ready`
  - `/api/auth/*`
  - `/api/platform/tenants`
  - `/api/admin/branches`
  - `/api/admin/customers`
  - `/api/admin/staff`
  - `/api/admin/services`
  - `/api/admin/appointments`
- [x] Testler eklendi:
  - domain tenant/branch/access tests
  - appointment status/overlap/UTC tests
  - role permission tests
  - application validator tests
- [x] Windows dotnet doğrulaması:
  - restore başarılı
  - build: 0 hata, 0 uyarı
  - test: 10/10 başarılı

## Faz 1 — Build/runtime sertleştirme

- [ ] API runtime smoke testini Windows host üzerinde başlatıp `/health/live` ve OpenAPI/Scalar sayfasını tarayıcı/curl ile doğrula.
- [ ] `GET /health/ready` için local MySQL bağlantı dizesini gerçek development DB’ye bağla.
- [ ] `Jwt:SigningKey` değerini user-secrets/env’e taşı; development placeholder dosyada kalsa da production configte kullanılmamalı.
- [ ] `appsettings.Production.json` taslağı oluştur; secret içermesin.
- [ ] `Directory.Build.props` içine analyzer/format kararlarını ekle:
  - nullable enabled
  - implicit usings enabled
  - warnings strategy
  - optional code analysis rules
- [ ] `.gitignore` varsa `bin/`, `obj/`, `.vs/`, `*.user` kurallarını doğrula.

## Faz 2 — Migration ve seed

- [ ] MySQL local development DB oluştur:
  - database: `guzellik_merkezi_dev`
  - user/password development secret ile
- [ ] `dotnet ef` tool sürümünü EF provider ile hizala.
- [ ] `GuzellikDbContext` için design-time factory gerekiyorsa ekle:
  - `src/GuzellikMerkezi.Infrastructure/Persistence/GuzellikDbContextFactory.cs`
- [ ] Initial migration oluştur:
  - `dotnet ef migrations add InitialCreate --project src/GuzellikMerkezi.Infrastructure --startup-project src/GuzellikMerkezi.Api`
- [ ] Migration SQL çıktısını incele:
  - tenant/branch FK’leri
  - enum string kolonları
  - decimal precision
  - refresh token unique index
  - audit log JSON column
- [ ] `DbSeeder` ekle:
  - platform admin tenant/user
  - demo tenant
  - demo default branch
  - demo hizmetler
  - demo personel
  - demo müşteri
  - demo randevu
- [ ] Seed idempotent olsun; tekrar çalışınca duplicate üretmesin.

## Faz 3 — Auth/authorization derinleştirme

- [ ] Platform admin login akışını tenant seçimsiz netleştir.
- [ ] Institution owner/branch manager/staff için tenant/branch seçimini zorunlu kıl.
- [ ] `RequiresPermission` attribute/endpoint filter ekle.
- [ ] `IPermissionChecker` ve policy-based authorization implement et.
- [ ] Branch scoped personel için sadece kendi branch verilerini dönen filtre ekle.
- [ ] Refresh token rotation testlerini artır.
- [ ] Logout ile refresh token revoke testleri ekle.
- [ ] Login brute-force/rate-limit için API rate limiting ekle.

## Faz 4 — Endpoint contract iyileştirme

- [ ] Tüm endpointlerde FluentValidation otomatik çalışsın:
  - minimal API endpoint filter veya custom `ValidationFilter<T>`
- [ ] Tüm hata cevapları tek zarfla dönsün:
  - `ApiResponse<T>`
  - `traceId`
  - `code`
  - `message`
- [ ] `GET /api/meta/enums` ekle:
  - roles
  - permissions
  - appointment statuses
  - tenant statuses
  - gender values
- [ ] Pagination contract frontend için sabitlenmeli:
  - `items`
  - `totalCount`
  - `page`
  - `pageSize`
  - `totalPages`
- [ ] OpenAPI security scheme’e Bearer JWT ekle.
- [ ] OpenAPI schema dosyasını frontend client üretimi için export et.

## Faz 5 — Business modülleri

### Customers
- [ ] Duplicate müşteri kontrolü: tenant + branch + phone/email.
- [ ] KVKK consent tarihçesi gerekiyorsa ayrı value object/entity.
- [ ] Müşteri notlarını audit log’a bağla.

### Staff
- [ ] Staff çalışma saatleri entity’si:
  - `StaffWorkingHour`
  - gün/saat aralığı
  - mola/izin blokları
- [ ] Staff uzmanlık/hizmet eşleşmesi:
  - `StaffServiceDefinition`
- [ ] Staff tenant user link akışı.

### Services
- [ ] Hizmet kategori yönetimi.
- [ ] Şube özel fiyat/süre override tasarımı.
- [ ] Pasif hizmet randevu oluştururken engellensin.

### Appointments
- [ ] Randevu çakışma kontrolü branch + staff + çalışma saati ile güçlendir.
- [ ] Randevu status transition matrix testlerini genişlet.
- [ ] Appointment cancellation policy ve no-show policy netleştir.
- [ ] Takvim range sorguları için index/performance kontrolü.

## Faz 6 — Kasa, paket, stok, audit

- [ ] `Package` entity.
- [ ] `CustomerPackage` entity.
- [ ] `CashTransaction` entity:
  - income/expense
  - payment method
  - related customer/appointment/package
- [ ] `InventoryProduct` entity:
  - stock
  - min stock
  - cost/sale price
- [ ] `InventoryMovement` entity.
- [ ] Audit log interceptor veya save pipeline ile eski/yeni değer JSON yazımı.
- [ ] Platform/admin audit log endpointleri.

## Faz 7 — Test ve kalite kapıları

- [ ] Domain testleri genişlet:
  - customer validation
  - staff commission bounds
  - service pricing
  - appointment transition matrix
- [ ] Application validator tests genişlet.
- [ ] Infrastructure integration tests:
  - Testcontainers MySQL veya local test DB stratejisi
  - tenant isolation
  - soft delete invisibility
  - refresh token rotation
- [ ] API smoke/integration tests:
  - health
  - login-scope
  - login/refresh/logout
  - tenant CRUD
  - branch/customer/staff/service/appointment CRUD
- [ ] CI script:
  - restore
  - build
  - test
  - optional format/analyzer

## Faz 8 — Frontend entegrasyonu

- [ ] Frontend mock login kurum/şube akışını `/api/auth/login-scope` ve `/api/auth/login` endpointlerine bağla.
- [ ] Platform kurumlar sayfasını `/api/platform/tenants` endpointlerine bağla.
- [ ] Admin dashboard için backend metric endpointleri ekle.
- [ ] Randevu/müşteri/personel/hizmet sayfalarını API’ye bağla.
- [ ] Loading/error/empty state response contractlarını frontend ile eşleştir.
- [ ] Türkçe karakterlerin JSON/OpenAPI/client tarafında bozulmadığını doğrula.

## Faz 9 — Deploy hazırlığı (onay almadan çalıştırma yok)

- [ ] Production config taslağı.
- [ ] MySQL database/user oluşturma dokümanı.
- [ ] Migration script üretme dokümanı.
- [ ] systemd service taslağı.
- [ ] Nginx reverse proxy taslağı.
- [ ] HTTPS/Certbot aşaması.
- [ ] Log dizinleri ve dosya izinleri.
- [ ] Backup/restore planı.

## Doğrulama komutu

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '& { Set-Location -LiteralPath "C:\Users\KAYA\Desktop\Güzellik Merkezi Yönetimi\backend"; dotnet restore .\GuzellikMerkeziYonetimi.slnx; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; dotnet build .\GuzellikMerkeziYonetimi.slnx -v:minimal; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; dotnet test .\GuzellikMerkeziYonetimi.slnx -v:minimal --no-build; exit $LASTEXITCODE }'
```
