using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Platform geneli (tenant'sız) WhatsApp faturalama ayarları — tek satır (singleton). Yalnızca PlatformAdmin
/// yönetir. Kur ve genel anahtarlar burada; kategori fiyatları <see cref="WhatsAppPricingRule"/>'da.
/// </summary>
public sealed class WhatsAppBillingSettings : Entity
{
    public WhatsAppBillingSettings() { }

    /// <summary>Faturalama açık mı? Kapalıyken kontör düşülmez (tüm gönderim ücretsiz sayılır — pilot/geçiş dönemi).</summary>
    public bool BillingEnabled { get; private set; } = true;

    /// <summary>Yalnızca kurum kendi bakiyesi/kotasıyla sınırlı olmasın; canlı gönderim gerçekten faturalanır.</summary>
    public bool ChargeSimulated { get; private set; }

    /// <summary>Gösterim ve tahmini Meta maliyeti hesabı için güncel USD/₺ kuru.</summary>
    public decimal UsdTryRate { get; private set; } = 40m;

    /// <summary>Kurum bakiyesi bu tutarın altına inince "düşük bakiye" uyarısı (₺).</summary>
    public decimal LowBalanceThresholdTry { get; private set; } = 50m;

    /// <summary>Yeni kurumlar için varsayılan aylık kontör harcama tavanı (₺). Kurum override edebilir; null = sınırsız.</summary>
    public decimal? DefaultMonthlySpendCapTry { get; private set; } = 500m;

    /// <summary>
    /// Kurumun kontör satın alma talepleri otomatik onaylansın mı? Varsayılan KAPALI — her yükleme platform
    /// onayından geçer (fatura denetimi). İleride ödeme ağ geçidi bağlanınca açılabilir.
    /// </summary>
    public bool AutoApproveTopUps { get; private set; }

    public bool Configured => UsdTryRate > 0;

    public void Update(bool billingEnabled, bool chargeSimulated, decimal usdTryRate, decimal lowBalanceThresholdTry, decimal? defaultMonthlySpendCapTry, bool autoApproveTopUps)
    {
        if (usdTryRate <= 0) throw new DomainException("USD/₺ kuru pozitif olmalı.");
        if (lowBalanceThresholdTry < 0) throw new DomainException("Düşük bakiye eşiği negatif olamaz.");
        if (defaultMonthlySpendCapTry is < 0) throw new DomainException("Harcama tavanı negatif olamaz.");
        BillingEnabled = billingEnabled;
        ChargeSimulated = chargeSimulated;
        UsdTryRate = decimal.Round(usdTryRate, 4);
        LowBalanceThresholdTry = decimal.Round(lowBalanceThresholdTry, 2);
        DefaultMonthlySpendCapTry = defaultMonthlySpendCapTry.HasValue ? decimal.Round(defaultMonthlySpendCapTry.Value, 2) : null;
        AutoApproveTopUps = autoApproveTopUps;
        Touch();
    }
}
