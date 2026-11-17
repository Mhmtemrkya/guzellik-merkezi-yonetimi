using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Maydanoz'da (maydanozasist.com) alınacak bir ödemenin BeautyAsist'teki kaydı.
/// <para>
/// Kullanıcı 17 Kas 2026: "ödemeler Maydanoz'dan olacak". iyzico yalnız Maydanoz'a bağlıdır;
/// BeautyAsist tutarı hesaplar (teklif), bu satırı açar ve kurumu
/// <c>maydanozasist.com/odeme/asist/beauty/{PublicRef}</c> adresine yönlendirir. Maydanoz tutarı,
/// açıklamayı ve dönüş adresini İMZALI bağlayıcıdan BURADAN okur (tarayıcıdan değil), tahsil eder
/// ve sonucu yine imzalı bağlayıcıyla bildirir (<see cref="RecordPaid"/>).
/// </para>
/// <para>
/// Ödemenin "alındı" sayılmasına bu satır karar VERMEZ: abonelik/kredi yolu sonucu her zamanki gibi
/// ödeme sağlayıcısından (burada: bu satırı okuyan <c>MaydanozPaymentGateway</c>) okur ve tutar,
/// para birimi, sağlayıcı ve ödeme kimliği değişmezlerini kendisi uygular.
/// </para>
/// </summary>
public sealed class ExternalCheckout : Entity
{
    public const string StatusPending = "Pending";
    public const string StatusPaid = "Paid";

    public const string KindSubscription = "Subscription";
    public const string KindCredit = "Credit";

    /// <summary>Ödeme sayfası bu süreden sonra açılmaz (yeni ödeme panelden başlatılır).</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);

    private ExternalCheckout() { }

    public ExternalCheckout(string publicRef, string conversationId, string kind, Guid tenantId, decimal amountTry,
        string description, string callbackUrl, DateTime nowUtc)
    {
        if (string.IsNullOrWhiteSpace(publicRef) || publicRef.Length != 32) throw new DomainException("Ödeme anahtarı geçersiz.");
        if (string.IsNullOrWhiteSpace(conversationId)) throw new DomainException("İşlem anahtarı zorunlu.");
        if (kind is not (KindSubscription or KindCredit)) throw new DomainException("Ödeme türü geçersiz.");
        if (amountTry <= 0) throw new DomainException("Ödeme tutarı sıfırdan büyük olmalı.");
        if (string.IsNullOrWhiteSpace(callbackUrl)) throw new DomainException("Dönüş adresi zorunlu.");
        PublicRef = publicRef;
        ConversationId = conversationId.Trim();
        Kind = kind;
        TenantId = tenantId;
        AmountTRY = amountTry;
        Description = description.Length > 200 ? description[..200] : description;
        CallbackUrl = callbackUrl.Trim();
        ExpiresAtUtc = nowUtc.Add(Lifetime);
    }

    /// <summary>Adreste görünen tahmin edilemez anahtar (128 bit, küçük harf onaltılık).</summary>
    public string PublicRef { get; private set; } = string.Empty;

    /// <summary>Ödeme satırının (abonelik ya da kredi) işlem anahtarı.</summary>
    public string ConversationId { get; private set; } = string.Empty;

    public string Kind { get; private set; } = KindSubscription;
    public Guid TenantId { get; private set; }

    /// <summary>Tahsil edilecek brüt tutar (KDV dahil, TL).</summary>
    public decimal AmountTRY { get; private set; }

    public string Description { get; private set; } = string.Empty;

    /// <summary>Ödeme sonrası tarayıcının döneceği BeautyAsist ucu (<c>?token=PublicRef</c> eklenir).</summary>
    public string CallbackUrl { get; private set; } = string.Empty;

    public string Status { get; private set; } = StatusPending;
    public DateTime ExpiresAtUtc { get; private set; }

    /// <summary>Maydanoz'un bildirdiği ödeme kimliği (Maydanoz sipariş/iyzico ödeme kimliği).</summary>
    public string? ProviderPaymentId { get; private set; }
    public decimal? PaidAmountTRY { get; private set; }
    public string? PaidCurrency { get; private set; }
    public DateTime? PaidAtUtc { get; private set; }

    public bool IsExpired(DateTime nowUtc) => Status == StatusPending && nowUtc >= ExpiresAtUtc;

    public enum RecordOutcome { Recorded, AlreadyRecorded, Conflict }

    /// <summary>
    /// Maydanoz'un "ödendi" bildirimi. Aynı bildirimin tekrarı (aynı ödeme kimliği) işlem yapmaz;
    /// FARKLI bir ödeme kimliğiyle ikinci bildirim reddedilir (aynı ödeme iki kez alınmış olabilir —
    /// Maydanoz tarafında incelenir). Tutar burada YARGILANMAZ: olduğu gibi yazılır, abonelik/kredi
    /// yolu beklenen tutarla karşılaştırıp uyuşmazsa ödemeyi reddeder.
    /// </summary>
    public RecordOutcome RecordPaid(string providerPaymentId, decimal paidAmountTry, string currency, DateTime nowUtc)
    {
        if (string.IsNullOrWhiteSpace(providerPaymentId)) throw new DomainException("Ödeme kimliği zorunlu.");
        var id = providerPaymentId.Trim();
        if (Status == StatusPaid) return string.Equals(ProviderPaymentId, id, StringComparison.Ordinal) ? RecordOutcome.AlreadyRecorded : RecordOutcome.Conflict;
        Status = StatusPaid;
        ProviderPaymentId = id;
        PaidAmountTRY = paidAmountTry;
        PaidCurrency = currency;
        PaidAtUtc = nowUtc;
        Touch(nowUtc);
        return RecordOutcome.Recorded;
    }
}
