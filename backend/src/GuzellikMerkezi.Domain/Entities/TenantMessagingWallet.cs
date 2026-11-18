using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kuruma ait ön ödemeli MESAJ KREDİSİ cüzdanı (tek satır / tenant). Gönderim anında mesajın kredi maliyeti
/// REZERVE edilir (Balance→Reserved), teslim/kabul onayında KESİNLEŞİR (Reserved düşülür), başarısızlıkta İADE
/// edilir (Reserved→Balance). Böylece bakiye 0'ken taşma olmaz ve başarısız mesaja kredi harcanmaz.
///
/// <para>
/// İKİ KANAL (18 Kas 2026): WhatsApp ve SMS kredisi AYRI bakiyelerdir — biri diğerinden harcamaz. Her işlem
/// kanalı ZORUNLU parametre olarak alır: SMS'ten ayrılan kredi WhatsApp'a iade edilseydi sessiz bir para
/// sızıntısı olurdu. WhatsApp alanları ayrımdan önceki ortak bakiyenin devamıdır (<c>BalanceCredits</c> …);
/// SMS alanları yenidir (<c>SmsBalanceCredits</c> …).
/// </para>
/// <para>
/// BİRİM GEÇİŞİ (12 Kas 2026): cüzdan eskiden ₺ "kontör" tutuyordu. <c>*Try</c> alanları dönüşüm
/// ÖNCESİ değerlerin donmuş kopyasıdır (denetim izi) — hiçbir yol onları artık değiştirmez.
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

    // ---- WHATSAPP KREDİSİ (ayrımdan önceki ortak bakiyenin devamı) ----

    /// <summary>WhatsApp: toplam kredi (rezerve dahil).</summary>
    public decimal BalanceCredits { get; private set; }

    /// <summary>WhatsApp: teslim onayı beklenen mesajlar için ayrılan kredi.</summary>
    public decimal ReservedCredits { get; private set; }

    /// <summary>WhatsApp: bugüne dek yüklenen toplam kredi (ayrımdan önceki ortak yüklemeler dahil).</summary>
    public decimal LifetimeTopUpCredits { get; private set; }

    /// <summary>WhatsApp: bugüne dek harcanan kredi (ayrımdan önceki SMS harcamaları dahil).</summary>
    public decimal LifetimeSpentCredits { get; private set; }

    // ---- SMS KREDİSİ (18 Kas 2026) ----

    public decimal SmsBalanceCredits { get; private set; }

    public decimal SmsReservedCredits { get; private set; }

    public decimal SmsLifetimeTopUpCredits { get; private set; }

    public decimal SmsLifetimeSpentCredits { get; private set; }

    // ---- ESKİ ₺ KONTÖR ALANLARI (dönüşüm öncesi değer, salt-okunur denetim izi) ----

    /// <summary>Dönüşüm öncesi ₺ bakiye. Yeni kod OKUMAZ ve YAZMAZ.</summary>
    public decimal BalanceTry { get; private set; }

    /// <summary>Dönüşüm öncesi ₺ rezerve. Yeni kod OKUMAZ ve YAZMAZ.</summary>
    public decimal ReservedTry { get; private set; }

    /// <summary>Dönüşüm öncesi toplam ₺ yükleme. Yeni kod OKUMAZ ve YAZMAZ.</summary>
    public decimal LifetimeTopUpTry { get; private set; }

    /// <summary>Dönüşüm öncesi toplam ₺ harcama. Yeni kod OKUMAZ ve YAZMAZ.</summary>
    public decimal LifetimeSpentTry { get; private set; }

    public decimal BalanceFor(CreditChannel channel) => channel == CreditChannel.Sms ? SmsBalanceCredits : BalanceCredits;

    public decimal ReservedFor(CreditChannel channel) => channel == CreditChannel.Sms ? SmsReservedCredits : ReservedCredits;

    public decimal LifetimeTopUpFor(CreditChannel channel) => channel == CreditChannel.Sms ? SmsLifetimeTopUpCredits : LifetimeTopUpCredits;

    public decimal LifetimeSpentFor(CreditChannel channel) => channel == CreditChannel.Sms ? SmsLifetimeSpentCredits : LifetimeSpentCredits;

    /// <summary>Kanalın yeni gönderim için gerçekten kullanılabilir kredisi.</summary>
    public decimal AvailableFor(CreditChannel channel) => decimal.Round(BalanceFor(channel) - ReservedFor(channel), 4);

    /// <summary>Kredi ekle (satın alma onayı veya platform manuel artırımı).</summary>
    public void TopUp(CreditChannel channel, decimal credits)
    {
        if (credits <= 0) throw new DomainException("Yüklenecek kredi pozitif olmalı.");
        Set(channel, BalanceFor(channel) + credits, ReservedFor(channel), LifetimeTopUpFor(channel) + credits, LifetimeSpentFor(channel));
    }

    /// <summary>Gönderim için krediyi rezerve et. Kullanılabilir kredi yetmezse false döner (mesaj gönderilmez).</summary>
    public bool TryReserve(CreditChannel channel, decimal credits)
    {
        if (credits <= 0) return true; // ücretsiz kategori
        if (AvailableFor(channel) + 0.0001m < credits) return false;
        Set(channel, BalanceFor(channel), ReservedFor(channel) + credits, LifetimeTopUpFor(channel), LifetimeSpentFor(channel));
        return true;
    }

    /// <summary>Teslim/kabul onayı: rezervasyonu kesinleştir (Balance ve Reserved birlikte düşer — kredi harcandı).</summary>
    public void Capture(CreditChannel channel, decimal credits)
    {
        if (credits <= 0) return;
        var amt = decimal.Round(credits, 4);
        Set(channel,
            Math.Max(0, BalanceFor(channel) - amt),
            Math.Max(0, ReservedFor(channel) - amt),
            LifetimeTopUpFor(channel),
            LifetimeSpentFor(channel) + amt);
    }

    /// <summary>Başarısızlık/iptal: rezervasyonu geri ver (Reserved düşer, Balance korunur).</summary>
    public void Refund(CreditChannel channel, decimal credits)
    {
        if (credits <= 0) return;
        Set(channel, BalanceFor(channel), Math.Max(0, ReservedFor(channel) - decimal.Round(credits, 4)), LifetimeTopUpFor(channel), LifetimeSpentFor(channel));
    }

    /// <summary>Platform manuel düzeltme (+/-). Bakiye eksiye düşürülmez.</summary>
    public void Adjust(CreditChannel channel, decimal deltaCredits)
    {
        Set(channel,
            Math.Max(0, BalanceFor(channel) + deltaCredits),
            ReservedFor(channel),
            LifetimeTopUpFor(channel) + (deltaCredits > 0 ? deltaCredits : 0),
            LifetimeSpentFor(channel));
    }

    private void Set(CreditChannel channel, decimal balance, decimal reserved, decimal lifetimeTopUp, decimal lifetimeSpent)
    {
        balance = decimal.Round(balance, 4);
        reserved = decimal.Round(reserved, 4);
        lifetimeTopUp = decimal.Round(lifetimeTopUp, 4);
        lifetimeSpent = decimal.Round(lifetimeSpent, 4);
        if (channel == CreditChannel.Sms)
        {
            SmsBalanceCredits = balance;
            SmsReservedCredits = reserved;
            SmsLifetimeTopUpCredits = lifetimeTopUp;
            SmsLifetimeSpentCredits = lifetimeSpent;
        }
        else
        {
            BalanceCredits = balance;
            ReservedCredits = reserved;
            LifetimeTopUpCredits = lifetimeTopUp;
            LifetimeSpentCredits = lifetimeSpent;
        }
        Touch();
    }
}
