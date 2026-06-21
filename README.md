# Güzellik Merkezi Yönetimi

Güzellik merkezi için backend, frontend ve doğrulama araçlarını içeren yönetim sistemi monoreposu.

## Klasörler

- `backend/`: .NET API, domain, application, infrastructure ve test projeleri.
- `Frontend/`: Next.js frontend uygulaması.
- `tools/browser-use/`: Browser-use tabanlı kontrol/QA araçları.
- `Görseller/`, `ayarlar sayfası/`: ürün ve arayüz görselleri.

## Yerel kurulum notları

Bu depoda gerçek gizli anahtarlar, `.env`, `.mcp.json`, log dosyaları ve yerel `appsettings*.json` dosyaları Git'e eklenmez.

Başlangıç için örnek dosyaları kopyalayın:

```bash
cp Frontend/.env.example Frontend/.env
cp tools/browser-use/.env.example tools/browser-use/.env
cp .mcp.example.json .mcp.json
cp backend/src/GuzellikMerkezi.Api/appsettings.example.json backend/src/GuzellikMerkezi.Api/appsettings.json
cp backend/src/GuzellikMerkezi.Api/appsettings.Development.example.json backend/src/GuzellikMerkezi.Api/appsettings.Development.json
```

Sonra değerleri kendi geliştirme ortamınıza göre doldurun.
