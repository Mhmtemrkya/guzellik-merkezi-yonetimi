# Güzellik Merkezi Yönetimi Backend

.NET 10 + MySQL tabanlı Clean Architecture backend.

## Katmanlar

- `GuzellikMerkezi.Domain`: Saf domain entity, enum, business rule ve exception katmanı.
- `GuzellikMerkezi.Application`: DTO, Result modeli, validator, current user/tenant/token/password abstractions ve use-case servis kontratları.
- `GuzellikMerkezi.Infrastructure`: EF Core MySQL `GuzellikDbContext`, tenant/soft-delete filtreleri, JWT, PBKDF2 password hashing, auth ve CRUD servis implementasyonları.
- `GuzellikMerkezi.Api`: Minimal API endpoint grupları, JWT auth, CORS, exception middleware, tenant resolution, OpenAPI/Scalar.
- `GuzellikMerkezi.Tests`: Domain ve application validator testleri.

## Önemli kararlar

- Hedef TFM: `net10.0`.
- MySQL provider: `MySql.EntityFrameworkCore` `10.0.7`.
- EF Core paketleri provider ile uyumlu olacak şekilde `10.0.7` hizasına çekildi.
- Pomelo `9.0.0` kaldırıldı; .NET 10/EF 10 ile major mismatch riski bu şekilde kapatıldı.
- Tenant izolasyonu `TenantId` üzerinden; platform admin bypass `ITenantContext.IsPlatformAdmin` ile kontrollü.
- Soft delete: `Entity.IsDeleted` + EF global query filter.
- Auth: JWT access token + hash’li refresh token modeli.
- Password hashing: PBKDF2 + salt + sabit zamanlı doğrulama.

## Endpoint grupları

- `GET /health/live`
- `GET /health/ready`
- `POST /api/auth/login-scope`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `/api/platform/tenants`
- `/api/admin/branches`
- `/api/admin/customers`
- `/api/admin/staff`
- `/api/admin/services`
- `/api/admin/appointments`

## Windows komutları

Backend klasörü:

```cmd
cd /d "C:\Users\KAYA\Desktop\Güzellik Merkezi Yönetimi\backend"
```

Restore/build/test:

```cmd
dotnet restore .\GuzellikMerkeziYonetimi.slnx
dotnet build .\GuzellikMerkeziYonetimi.slnx -v:minimal
dotnet test .\GuzellikMerkeziYonetimi.slnx -v:minimal --no-build
```

WSL’den Windows dotnet ile tek komut:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '& { Set-Location -LiteralPath "C:\Users\KAYA\Desktop\Güzellik Merkezi Yönetimi\backend"; dotnet restore .\GuzellikMerkeziYonetimi.slnx; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; dotnet build .\GuzellikMerkeziYonetimi.slnx -v:minimal; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; dotnet test .\GuzellikMerkeziYonetimi.slnx -v:minimal --no-build; exit $LASTEXITCODE }'
```

## Configuration

`src/GuzellikMerkezi.Api/appsettings.json` içinde development placeholder değerleri var:

- `ConnectionStrings:DefaultConnection`
- `Jwt:Issuer`
- `Jwt:Audience`
- `Jwt:SigningKey`
- `Cors:AllowedOrigins`

Production’da connection string ve JWT signing key dosyaya yazılmamalı; environment variable/user-secrets/secret manager ile verilmeli.

## Doğrulanan durum

- `dotnet restore`: başarılı.
- `dotnet build`: 0 hata, 0 uyarı.
- `dotnet test`: 10/10 başarılı.
