using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Bildirim gönderim kaydı. Her tek alıcı için bir satır. Gerçek SMS/WhatsApp provider'a
/// gönderim tetiklenmediği için MVP'de Status=Sent doğrudan yazılır; provider entegrasyonu
/// eklendiğinde Queued → Sent / Failed akışı bu kayıt üzerinde işler.
/// </summary>
public sealed class NotificationLog : Entity
{
    private NotificationLog() { }

    public NotificationLog(
        Guid tenantId,
        Guid? branchId,
        Guid? templateId,
        Guid? customerId,
        NotificationChannel channel,
        string recipient,
        string body,
        NotificationLogStatus status,
        string? errorMessage = null,
        string? dedupeKey = null,
        string? purpose = null)
    {
        DedupeKey = string.IsNullOrWhiteSpace(dedupeKey) ? null : dedupeKey.Trim();
        Purpose = string.IsNullOrWhiteSpace(purpose) ? null : purpose.Trim();
        TenantId = tenantId;
        BranchId = branchId;
        TemplateId = templateId;
        CustomerId = customerId;
        Channel = channel;
        Recipient = (recipient ?? string.Empty).Trim();
        Body = (body ?? string.Empty).Trim();
        Status = status;
        ErrorMessage = string.IsNullOrWhiteSpace(errorMessage) ? null : errorMessage.Trim();
        SentAtUtc = status == NotificationLogStatus.Sent ? DateTime.UtcNow : null;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    public Guid? TemplateId { get; private set; }
    public NotificationTemplate? Template { get; private set; }

    public Guid? CustomerId { get; private set; }
    public Customer? Customer { get; private set; }

    public NotificationChannel Channel { get; private set; }
    /// <summary>Telefon numarası / e-posta adresi.</summary>
    public string Recipient { get; private set; } = string.Empty;
    /// <summary>Token'ları doldurulmuş gerçek mesaj.</summary>
    public string Body { get; private set; } = string.Empty;
    public NotificationLogStatus Status { get; private set; }
    public string? ErrorMessage { get; private set; }
    public DateTime? SentAtUtc { get; private set; }

    /// <summary>
    /// OTOMATİK GÖNDERİMİN TEKİLLEŞTİRME ANAHTARI — "şablon + müşteri + zaman kovası".
    ///
    /// <para>
    /// Otomatik bildirim taraması eskiden "bu pencerede log var mı?" diye sorup sonra sağlayıcıya
    /// gidiyordu. Sağlayıcı mesajı GÖNDERDİKTEN sonra süreç çökerse (ya da kayıt yazılamazsa) log
    /// satırı hiç oluşmuyor, bir sonraki tarama aynı müşteriye AYNI mesajı tekrar gönderiyordu.
    /// Artık satır sağlayıcı çağrısından ÖNCE (Queued olarak) yazılır ve bu anahtar üzerindeki
    /// benzersiz indeks ikinci denemeyi eler — iki backend örneği aynı anda tarasa bile.
    /// </para>
    /// <para>Elle gönderimlerde boştur: yönetici aynı mesajı bilerek tekrar gönderebilmelidir.</para>
    /// </summary>
    public string? DedupeKey { get; private set; }

    /// <summary>
    /// Şablonsuz SİSTEM mesajının amacı (ör. "rating-link", "waitlist-activated", "kvkk-info",
    /// "gift-card"). Şablondan gelen gönderimde null — geçmişte şablon adı gösterilir.
    /// </summary>
    public string? Purpose { get; private set; }

    // ---- SMS ÜCRETİ (mesaj kredisi) ----
    // SMS'in teslim webhook'u yok: kredi gönderimden ÖNCE rezerve edilir, sağlayıcı kabul edince
    // kesinleşir, reddedince iade edilir. Rezervasyon bu satıra bağlıdır ki süreç arada çökerse
    // süpürme hangi kredinin askıda kaldığını bulabilsin.

    /// <summary>Ücretin kaynağı: kota / kredi cüzdanı / simülasyon. Eski satırlar None.</summary>
    public WhatsAppBillingSource BillingSource { get; private set; } = WhatsAppBillingSource.None;

    /// <summary>Bu mesaj için krediden rezerve edilen/kesilen miktar. Kota veya iade sonrası 0.</summary>
    public decimal ChargedCredits { get; private set; }

    /// <summary>SMS parça sayısı (Unicode: 70 karaktere kadar 1, üstü 67'lik parçalar).</summary>
    public int SmsParts { get; private set; }

    /// <summary>Kredi rezervasyonunun kesinleştiği an. Doluysa süpürme bu satıra dokunmaz.</summary>
    public DateTime? ChargeCapturedAtUtc { get; private set; }

    // ÜCRET METOTLARI Touch() ÇAĞIRMAZ — BİLEREK.
    //
    // UpdatedAtUtc bu tabloda "sağlayıcıya gidildi" damgasıdır (bkz. MarkDispatching): kurtarma,
    // damgalı bayat satırı "sonucu bilinmiyor" sayıp TEKRAR GÖNDERMEZ, damgasızı devralıp gönderir.
    // Rezervasyon sağlayıcı çağrısından ÖNCE yazıldığı için burada damga basılsaydı, rezervasyonla
    // gönderim arasında çöken satır hiç gidilmemişken "gidildi" görünür ve mesaj bir daha HİÇ
    // gönderilmezdi.

    /// <summary>Faturalama kararını satıra işler (cüzdan rezervasyonuyla AYNI kayıtta yazılmalı).</summary>
    public void AttachCharge(WhatsAppBillingSource source, decimal credits, int smsParts)
    {
        BillingSource = source;
        ChargedCredits = decimal.Round(Math.Max(0m, credits), 4);
        SmsParts = Math.Max(0, smsParts);
        ChargeCapturedAtUtc = null;
    }

    /// <summary>Kredi kesinleşti (sağlayıcı mesajı kabul etti).</summary>
    public void MarkChargeCaptured(DateTime nowUtc) => ChargeCapturedAtUtc = nowUtc;

    /// <summary>Kredi iade edildi — tekrar iade edilmesin ve aylık harcamadan düşsün.</summary>
    public void ClearCharge()
    {
        ChargedCredits = 0m;
        BillingSource = WhatsAppBillingSource.None;
        ChargeCapturedAtUtc = null;
    }

    /// <summary>
    /// SAĞLAYICI ÇAĞRISI BAŞLIYOR — dış etkiden ÖNCE bırakılan iz.
    /// </summary>
    /// <remarks>
    /// Durum <c>Queued</c> KALIR; değişen tek şey <see cref="Entity.UpdatedAtUtc"/> damgasıdır ve
    /// anlamı tektir: <b>bu satır için sağlayıcıya gidildi.</b>
    /// <para>
    /// Damga olmadan, bayatlamış bir <c>Queued</c> satır BİRBİRİNE ZIT iki durumu aynı anda
    /// anlatıyordu: "sağlayıcıya hiç gidilmedi" (tekrar göndermek DOĞRU — mesaj hiç ulaşmadı) ve
    /// "sağlayıcı mesajı aldı ama sonuç yazılamadan süreç çöktü" (tekrar göndermek müşteriye
    /// İKİNCİ mesaj demek). Kurtarma ikisini ayırt edemediği için körlemesine tekrar gönderiyordu.
    /// </para>
    /// </remarks>
    public void MarkDispatching() => Touch();

    public void MarkSent()
    {
        Status = NotificationLogStatus.Sent;
        SentAtUtc = DateTime.UtcNow;
        ErrorMessage = null;
        Touch();
    }

    public void MarkFailed(string error)
    {
        Status = NotificationLogStatus.Failed;
        ErrorMessage = string.IsNullOrWhiteSpace(error) ? "Bilinmeyen hata" : error.Trim();
        Touch();
    }
}
