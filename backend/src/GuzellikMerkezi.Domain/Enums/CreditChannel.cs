namespace GuzellikMerkezi.Domain.Enums;

/// <summary>
/// MESAJ KREDİSİNİN KANALI (kullanıcı kararı 18 Kas 2026: "SMS ayrı, WhatsApp ayrı kredi; fiyatları farklı olabilir,
/// farklı kredi yiyebilirler"). Her kanalın kendi bakiyesi, paketleri ve birim fiyatı vardır; bir kanalın kredisi
/// diğerinde harcanmaz. Ayrımdan önceki ortak bakiye WhatsApp kanalında kaldı (birimi aynı: 1 kredi = 1 WhatsApp
/// hatırlatma); SMS bakiyesi sıfırdan başladı.
/// <para>Veritabanında METİN olarak saklanır; eski satırların varsayılanı <see cref="WhatsApp"/>'tır.</para>
/// </summary>
public enum CreditChannel
{
    WhatsApp = 0,
    Sms = 1,
}

public static class CreditChannelExtensions
{
    /// <summary>Defter satırının (WalletTransaction) kanal alanı.</summary>
    public static NotificationChannel ToNotificationChannel(this CreditChannel channel) =>
        channel == CreditChannel.Sms ? NotificationChannel.Sms : NotificationChannel.WhatsApp;

    /// <summary>Kullanıcıya görünen ad: "SMS kredisi" / "WhatsApp kredisi".</summary>
    public static string Label(this CreditChannel channel) =>
        channel == CreditChannel.Sms ? "SMS kredisi" : "WhatsApp kredisi";
}
