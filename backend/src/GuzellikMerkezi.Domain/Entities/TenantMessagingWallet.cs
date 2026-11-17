using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kuruma ait ön ödemeli MESAJ KREDİSİ cüzdanı (tek satır / tenant). WhatsApp ve SMS aynı bakiyeden
/// harcar. Gönderim anında mesajın kredi maliyeti REZERVE edilir (Balance→Reserved), teslim/kabul
/// onayında KESİNLEŞİR (Reserved düşülür), başarısızlıkta İADE edilir (Reserved→Balance). Böylece
/// bakiye 0'ken taşma olmaz ve başarısız mesaja kredi harcanmaz.
/// AvailableCredits = BalanceCredits - ReservedCredits: yeni gönderim için gerçekten kullanılabilir kredi.
///
/// <para>
/// BİRİM GEÇİŞİ (12 Kas 2026): cüzdan eskiden ₺ "kontör" tutuyordu. <c>*Try</c> alanları dönüşüm
/// ÖNCESİ değerlerin donmuş kopyasıdır (denetim izi) — hiçbir yol onları artık değiştirmez. Bakiye
/// yalnız <c>*Credits</c> alanlarından okunur ve yazılır.
/// </para>
/// </summary>
public sealed class TenantMessagingWallet : Entity
{
    private TenantMessagingWallet() { }

    public TenantMessagingWallet(Guid tenantId)
    {
        TenantId = tenantId;
    }

    public Guid TenantId { get; private set; }

    /// <summary>Toplam kredi (rezerve dahil — AvailableCredits = BalanceCredits - ReservedCredits).</summary>
    public decimal BalanceCredits { get; private set; }

    /// <summary>Gönderilmiş ama teslim/kabul onayı beklenen mesajlar için ayrılan (kilitli) kredi.</summary>
    public decimal ReservedCredits { get; private set; }

    /// <summary>Bugüne dek yüklenen toplam kredi (rapor).</summary>
    public decimal LifetimeTopUpCredits { get; private set; }

    /// <summary>Bugüne dek harcanan (kesinleşen) toplam kredi (rapor).</summary>
    public decimal LifetimeSpentCredits { get; private set; }

    /// <summary>Yeni gönderim için gerçekten kullanılabilir kredi.</summary>
    public decimal AvailableCredits => decimal.Round(BalanceCredits - ReservedCredits, 4);

    // ---- ESKİ ₺ KONTÖR ALANLARI (dönüşüm öncesi değer, salt-okunur denetim izi) ----

    /// <summary>Dönüşüm öncesi ₺ bakiye. Yeni kod OKUMAZ ve YAZMAZ.</summary>
    public decimal BalanceTry { get; private set; }

    /// <summary>Dönüşüm öncesi ₺ rezerve. Yeni kod OKUMAZ ve YAZMAZ.</summary>
    public decimal ReservedTry { get; private set; }

    /// <summary>Dönüşüm öncesi toplam ₺ yükleme. Yeni kod OKUMAZ ve YAZMAZ.</summary>
    public decimal LifetimeTopUpTry { get; private set; }

    /// <summary>Dönüşüm öncesi toplam ₺ harcama. Yeni kod OKUMAZ ve YAZMAZ.</summary>
    public decimal LifetimeSpentTry { get; private set; }

    /// <summary>Kredi ekle (satın alma onayı veya platform manuel artırımı).</summary>
    public void TopUp(decimal credits)
    {
        if (credits <= 0) throw new DomainException("Yüklenecek kredi pozitif olmalı.");
        BalanceCredits = decimal.Round(BalanceCredits + credits, 4);
        LifetimeTopUpCredits = decimal.Round(LifetimeTopUpCredits + credits, 4);
        Touch();
    }

    /// <summary>Gönderim için krediyi rezerve et. Kullanılabilir kredi yetmezse false döner (mesaj gönderilmez).</summary>
    public bool TryReserve(decimal credits)
    {
        if (credits <= 0) return true; // ücretsiz kategori
        if (AvailableCredits + 0.0001m < credits) return false;
        ReservedCredits = decimal.Round(ReservedCredits + credits, 4);
        Touch();
        return true;
    }

    /// <summary>Teslim/kabul onayı: rezervasyonu kesinleştir (Balance ve Reserved birlikte düşer — kredi harcandı).</summary>
    public void Capture(decimal credits)
    {
        if (credits <= 0) return;
        var amt = decimal.Round(credits, 4);
        ReservedCredits = decimal.Round(Math.Max(0, ReservedCredits - amt), 4);
        BalanceCredits = decimal.Round(Math.Max(0, BalanceCredits - amt), 4);
        LifetimeSpentCredits = decimal.Round(LifetimeSpentCredits + amt, 4);
        Touch();
    }

    /// <summary>Başarısızlık/iptal: rezervasyonu geri ver (Reserved düşer, Balance korunur).</summary>
    public void Refund(decimal credits)
    {
        if (credits <= 0) return;
        ReservedCredits = decimal.Round(Math.Max(0, ReservedCredits - decimal.Round(credits, 4)), 4);
        Touch();
    }

    /// <summary>Platform manuel düzeltme (+/-). Bakiye eksiye düşürülmez.</summary>
    public void Adjust(decimal deltaCredits)
    {
        BalanceCredits = decimal.Round(Math.Max(0, BalanceCredits + deltaCredits), 4);
        if (deltaCredits > 0) LifetimeTopUpCredits = decimal.Round(LifetimeTopUpCredits + deltaCredits, 4);
        Touch();
    }
}
