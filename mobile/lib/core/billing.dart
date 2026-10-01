/// PAKET SATIŞI AÇIK MI? (`--dart-define=BILLING_ENABLED=true`, varsayılan KAPALI)
///
/// Şimdilik kurumlar kayıt olup ücretsiz kullanır: "Paketim" ekranı, Ayarlar'daki paket kartı
/// ve dashboard'daki deneme/abonelik bandı GİZLİDİR. Kod silinmedi, yalnız bu bayrağın
/// arkasına alındı. Web karşılığı `NEXT_PUBLIC_BILLING_ENABLED`, backend karşılığı
/// `Billing:FreeMode` — üçü birlikte çevrilmelidir.
const bool kBillingEnabled = bool.fromEnvironment('BILLING_ENABLED');
