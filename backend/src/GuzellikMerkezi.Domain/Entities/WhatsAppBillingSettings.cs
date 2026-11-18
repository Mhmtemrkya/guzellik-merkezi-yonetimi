using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Platform geneli (tenant'sız) MESAJ KREDİSİ faturalama ayarları — tek satır (singleton). Yalnızca
/// PlatformAdmin yönetir. Kur, SMS kredi maliyeti ve genel anahtarlar burada; WhatsApp kategori
/// maliyetleri <see cref="WhatsAppPricingRule"/>'da.
/// </summary>
public sealed class WhatsAppBillingSettings : Entity
{
    public WhatsAppBillingSettings() { }

    /// <summary>Faturalama açık mı? Kapalıyken kredi düşülmez (tüm gönderim ücretsiz sayılır — pilot/geçiş dönemi).</summary>
    public bool BillingEnabled { get; private set; } = true;

    /// <summary>Yalnızca kurum kendi bakiyesi/kotasıyla sınırlı olmasın; canlı gönderim gerçekten faturalanır.</summary>
    public bool ChargeSimulated { get; private set; }

    /// <summary>Gösterim ve tahmini Meta maliyeti hesabı için güncel USD/₺ kuru.</summary>
    public decimal UsdTryRate { get; private set; } = 40m;

    /// <summary>Kurumun kullanılabilir kredisi bu miktarın altına inince "düşük bakiye" uyarısı.</summary>
    public decimal LowBalanceThresholdCredits { get; private set; } = 350m;

    /// <summary>Yeni kurumlar için varsayılan aylık kredi harcama tavanı. Kurum override edebilir; null = sınırsız.</summary>
    public decimal? DefaultMonthlySpendCapCredits { get; private set; } = 3500m;

    /// <summary>
    /// Bir SMS PARÇASININ kredi maliyeti. Türkçe karakter için SMS Unicode gider (datacoding=2):
    /// 70 karaktere kadar 1 parça, üstü 67'lik parçalar. Mesajın kredisi = parça × bu değer.
    /// </summary>
    public decimal SmsCreditsPerPart { get; private set; } = 2m;

    /// <summary>
    /// Paket DIŞI (özel miktarlı) kredi alımında 1 kredinin ₺ fiyatı. Paketler kendi fiyatını taşır;
    /// bu değer yalnız serbest miktar ve "≈ ₺" gösterimi içindir.
    /// </summary>
    public decimal CreditUnitPriceTry { get; private set; } = 0.15m;

    /// <summary>
    /// SMS KREDİSİNİN paket dışı birim fiyatı (₺, 18 Kas 2026: SMS ve WhatsApp kredisi ayrı, fiyatları farklı
    /// olabilir). Geçişte WhatsApp birim fiyatıyla başlatıldı; platform ayrıca belirler. <see cref="CreditUnitPriceTry"/>
    /// artık YALNIZ WhatsApp kredisinindir.
    /// </summary>
    public decimal SmsCreditUnitPriceTry { get; private set; } = 0.15m;

    /// <summary>
    /// Kurumun kredi satın alma talepleri otomatik onaylansın mı? Varsayılan KAPALI — her yükleme platform
    /// onayından geçer (fatura denetimi). İleride ödeme ağ geçidi bağlanınca açılabilir.
    /// </summary>
    public bool AutoApproveTopUps { get; private set; }

    // ---- ESKİ ₺ ALANLAR (12 Kas 2026 kredi dönüşümü öncesi, salt-okunur) ----

    /// <summary>Dönüşüm öncesi ₺ düşük bakiye eşiği. Faturalama OKUMAZ.</summary>
    public decimal LowBalanceThresholdTry { get; private set; }

    /// <summary>Dönüşüm öncesi ₺ varsayılan tavan. Faturalama OKUMAZ.</summary>
    public decimal? DefaultMonthlySpendCapTry { get; private set; }

    public bool Configured => UsdTryRate > 0;

    public void Update(
        bool billingEnabled,
        bool chargeSimulated,
        decimal usdTryRate,
        decimal lowBalanceThresholdCredits,
        decimal? defaultMonthlySpendCapCredits,
        bool autoApproveTopUps,
        decimal smsCreditsPerPart,
        decimal creditUnitPriceTry,
        decimal? smsCreditUnitPriceTry = null)
    {
        if (smsCreditUnitPriceTry is <= 0) throw new DomainException("SMS kredisi birim fiyatı pozitif olmalı.");
        if (usdTryRate <= 0) throw new DomainException("USD/₺ kuru pozitif olmalı.");
        if (lowBalanceThresholdCredits < 0) throw new DomainException("Düşük bakiye eşiği negatif olamaz.");
        if (defaultMonthlySpendCapCredits is < 0) throw new DomainException("Harcama tavanı negatif olamaz.");
        if (smsCreditsPerPart < 0) throw new DomainException("SMS kredi maliyeti negatif olamaz.");
        if (creditUnitPriceTry <= 0) throw new DomainException("Kredi birim fiyatı pozitif olmalı.");
        BillingEnabled = billingEnabled;
        ChargeSimulated = chargeSimulated;
        UsdTryRate = decimal.Round(usdTryRate, 4);
        LowBalanceThresholdCredits = decimal.Round(lowBalanceThresholdCredits, 2);
        DefaultMonthlySpendCapCredits = defaultMonthlySpendCapCredits.HasValue ? decimal.Round(defaultMonthlySpendCapCredits.Value, 2) : null;
        AutoApproveTopUps = autoApproveTopUps;
        SmsCreditsPerPart = decimal.Round(smsCreditsPerPart, 2);
        CreditUnitPriceTry = decimal.Round(creditUnitPriceTry, 4);
        // Alanı göndermeyen eski istemci (tam gövde PUT) SMS fiyatını SIFIRLAMAZ: null = korunur.
        if (smsCreditUnitPriceTry is { } smsPrice) SmsCreditUnitPriceTry = decimal.Round(smsPrice, 4);
        Touch();
    }
}
