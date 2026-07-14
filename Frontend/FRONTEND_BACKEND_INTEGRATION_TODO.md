# BeautyAsist Frontend → Backend Entegrasyon TODO

Çalışma dizinleri:
- Frontend: `/home/kaya/projects/guzellik-frontend`
- Backend: `/home/kaya/projects/guzellik-backend`
- Windows backend: `C:\Users\KAYA\Desktop\Güzellik Merkezi Yönetimi\backend`

> Not: Claude Code terminal çalıştırma izni bu oturumda kullanıcı tarafından reddedildiği için bu dosya Claude-ready uygulama planı olarak Hermes/GPT 5.5 tarafından yazıldı. Claude tekrar açılırsa bu dosyadaki sırayla ilerlemeli.

## Backend mevcut sözleşme

### Auth
- `POST /api/auth/login-scope`
  - Body: `{ email, role }`
  - Kullanım: admin/personel için e-posta + rol ile erişebileceği tenant/branch listesini getir.
- `POST /api/auth/login`
  - Body: `{ email, password, role, tenantId?, branchId? }`
  - Dönen: `{ accessToken, refreshToken, expiresAtUtc, user }`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Platform
- `GET /api/platform/tenants?page&pageSize&search`
- `GET /api/platform/tenants/{id}`
- `POST /api/platform/tenants`
- `PUT /api/platform/tenants/{id}`
- `POST /api/platform/tenants/{id}/access`

### Admin / tenant kapsamlı
- `GET/POST/PUT /api/admin/branches`
- `GET/POST/PUT/DELETE /api/admin/customers`
- `GET/POST/PUT/DELETE /api/admin/staff`
- `GET/POST/PUT/DELETE /api/admin/services`
- `GET/POST/DELETE /api/admin/appointments`
- `PATCH /api/admin/appointments/{id}/schedule`
- `PATCH /api/admin/appointments/{id}/status`

Tüm admin çağrıları JWT ister. Platform Admin tenantId query ile tenant seçebilir; kurum/personel rolünde tenant claim’den gelir.

## Frontend hedef mimari

1. `lib/apiClient.ts`
   - `NEXT_PUBLIC_API_BASE_URL` kullan.
   - `ApiResponse<T>` unwrap et.
   - JWT Authorization header ekle.
   - 401 durumunda session temizleme için merkezi hata üret.
   - Liste endpointlerinde default `page=1&pageSize=100` kullan.

2. `components/dashboard/AuthContext.tsx`
   - `accessToken`, `refreshToken`, `expiresAtUtc`, `user`, `scope` localStorage’da sakla.
   - `loginScope`, `login`, `logout`, `refresh`, `hydrate` metotlarını ver.
   - Role mapping:
     - `admin` → `InstitutionOwner`
     - `personel` → `Staff`
     - `platform` → `PlatformAdmin`

3. `components/dashboard/BranchContext.tsx`
   - Login scope’tan gelen tenant/branch listesini kullan.
   - Mock `LOGIN_KURUMLAR` sadece auth yokken görsel fallback olsun.
   - Branch switcher gerçek branch id ile çalışsın.

4. `app/login/page.tsx`
   - Mock e-posta/kurum filtre yerine `loginScope` çağır.
   - Login submit gerçek `/api/auth/login` çağırmalı.
   - Hata/loading UI görünür olmalı.
   - Başarılı login sonrası role göre `/admin`, `/personel`, `/platform` yönlendir.

5. Layoutlar
   - `app/admin/layout.tsx`, `app/personel/layout.tsx`, `app/platform/layout.tsx`
   - Sidebar user bilgisini auth context’ten al.
   - Logout linki session temizlemeli.

6. Panel entegrasyonu önceliği
   - `app/platform/page.tsx` ve `app/platform/kurumlar/page.tsx` → tenants API.
   - `app/admin/page.tsx` → customers/staff/services/appointments/branches dashboard özetleri.
   - `app/admin/musteriler/page.tsx` → customers API.
   - `app/admin/personel/page.tsx` → staff API.
   - `app/admin/paketler/page.tsx` → services API; paket satış backend modülü yoksa sayfada “paket satış backend kapsamı bekliyor” uyarısı göster.
   - `app/admin/randevular/page.tsx` → appointments API.

7. Backend açıkları / sonraki modüller
   - Paket satışı, seans düşümü, ödeme/taksit/cari, stok, kasa, audit log endpointleri henüz backend’de yok.
   - Bu paneller mock göstermemeli; “backend modülü henüz bağlanmadı” gerçek durum kartı göstermeli.
   - Sonraki backend fazında: packages, customer-packages, payments, installments, cash-ledger, inventory-products, stock-movements, audit-log query endpointleri.

## Kabul kriterleri
- `npm run build` başarılı.
- `dotnet test` başarılı.
- Backend çalışırken login → scope → panel data gerçek API’den gelir.
- Backend kapalıyken paneller sessiz mock’a düşmez; kullanıcıya bağlantı hatası gösterir.
- Türkçe karakterler korunur: “Canlı”, “Ders Programı” benzeri ASCII fallback yok.
