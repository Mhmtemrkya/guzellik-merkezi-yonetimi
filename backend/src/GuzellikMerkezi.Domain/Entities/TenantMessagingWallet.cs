using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kuruma ait ön ödemeli WhatsApp kontör cüzdanı (tek satır / tenant). Bakiye ₺ tutulur; gönderim anında
/// birim fiyat REZERVE edilir (Balance→Reserved), teslim onayında KESİNLEŞİR (Reserved düşülür), başarısızlıkta
/// İADE edilir (Reserved→Balance). Böylece bakiye 0'ken taşma olmaz ve başarısız mesaja para ödenmez.
/// Available = Balance - Reserved: yeni gönderim için gerçekten kullanılabilir tutar.
/// </summary>
public sealed class TenantMessagingWallet : Entity
{
    private TenantMessagingWallet() { }

    public TenantMessagingWallet(Guid tenantId)
    {
        TenantId = tenantId;
    }

    public Guid TenantId { get; private set; }

    /// <summary>Toplam kullanılabilir bakiye (rezerve dahil değil — Available = Balance - Reserved).</summary>
    public decimal BalanceTry { get; private set; }

    /// <summary>Gönderilmiş ama teslim onayı beklenen mesajlar için ayrılan (kilitli) tutar.</summary>
    public decimal ReservedTry { get; private set; }

    /// <summary>Bugüne dek yüklenen toplam kontör (rapor).</summary>
    public decimal LifetimeTopUpTry { get; private set; }

    /// <summary>Bugüne dek harcanan (kesinleşen) toplam kontör (rapor).</summary>
    public decimal LifetimeSpentTry { get; private set; }

    /// <summary>Yeni gönderim için gerçekten kullanılabilir tutar.</summary>
    public decimal AvailableTry => decimal.Round(BalanceTry - ReservedTry, 4);

    /// <summary>Kontör ekle (yükleme veya platform manuel artırımı).</summary>
    public void TopUp(decimal amountTry)
    {
        if (amountTry <= 0) throw new DomainException("Yüklenecek tutar pozitif olmalı.");
        BalanceTry = decimal.Round(BalanceTry + amountTry, 4);
        LifetimeTopUpTry = decimal.Round(LifetimeTopUpTry + amountTry, 4);
        Touch();
    }

    /// <summary>Gönderim için tutarı rezerve et. Kullanılabilir bakiye yetmezse false döner (mesaj gönderilmez).</summary>
    public bool TryReserve(decimal amountTry)
    {
        if (amountTry <= 0) return true; // ücretsiz kategori
        if (AvailableTry + 0.0001m < amountTry) return false;
        ReservedTry = decimal.Round(ReservedTry + amountTry, 4);
        Touch();
        return true;
    }

    /// <summary>Teslim onayı: rezervasyonu kesinleştir (Balance ve Reserved birlikte düşer — para gitti).</summary>
    public void Capture(decimal amountTry)
    {
        if (amountTry <= 0) return;
        var amt = decimal.Round(amountTry, 4);
        ReservedTry = decimal.Round(Math.Max(0, ReservedTry - amt), 4);
        BalanceTry = decimal.Round(Math.Max(0, BalanceTry - amt), 4);
        LifetimeSpentTry = decimal.Round(LifetimeSpentTry + amt, 4);
        Touch();
    }

    /// <summary>Başarısızlık/iptal: rezervasyonu geri ver (Reserved düşer, Balance korunur).</summary>
    public void Refund(decimal amountTry)
    {
        if (amountTry <= 0) return;
        ReservedTry = decimal.Round(Math.Max(0, ReservedTry - decimal.Round(amountTry, 4)), 4);
        Touch();
    }

    /// <summary>Platform manuel düzeltme (+/-). Bakiye eksiye düşürülmez.</summary>
    public void Adjust(decimal deltaTry)
    {
        BalanceTry = decimal.Round(Math.Max(0, BalanceTry + deltaTry), 4);
        if (deltaTry > 0) LifetimeTopUpTry = decimal.Round(LifetimeTopUpTry + deltaTry, 4);
        Touch();
    }
}
