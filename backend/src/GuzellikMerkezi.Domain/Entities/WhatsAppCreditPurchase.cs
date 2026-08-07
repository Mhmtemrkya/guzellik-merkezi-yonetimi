using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kurumun ek kontör satın alma talebi. İki yoldan onaylanabilir:
/// <list type="bullet">
///   <item><b>Havale/elden:</b> PENDING talep oluşur, platform admin onaylayınca bakiye eklenir.
///         Bu onay adımı platformun her yüklemeyi denetlemesini sağlar.</item>
///   <item><b>Kartla ödeme:</b> talep, iyzico Ortak Ödeme Sayfası işlem anahtarıyla (<see cref="ConversationId"/>)
///         açılır ve YALNIZ sağlayıcı tahsilatı onayladığında onaylanır.</item>
/// </list>
/// Her iki yolda da değişmez aynıdır: <b>bakiye asla tahsilatsız/onaysız artmaz.</b> Kart yolunda
/// talebin açılması ödeme SAYILMAZ — form başlatmak yetmez, sonuç sağlayıcıya sorulur.
/// </summary>
public sealed class WhatsAppCreditPurchase : Entity
{
    private WhatsAppCreditPurchase() { }

    /// <param name="provider">Kart ödemesinde sağlayıcı adı ("Iyzico"/"Simulation"); havalede null.</param>
    /// <param name="conversationId">Kart ödemesinde sağlayıcı işlem anahtarı; havalede null.</param>
    public WhatsAppCreditPurchase(Guid tenantId, Guid? creditPackageId, string packageName, decimal priceTry, decimal grantsTry, Guid? requestedByUserId,
        string? provider = null, string? conversationId = null)
    {
        TenantId = tenantId;
        CreditPackageId = creditPackageId;
        PackageName = string.IsNullOrWhiteSpace(packageName) ? "Kontör" : packageName.Trim();
        if (priceTry < 0) throw new DomainException("Fiyat negatif olamaz.");
        if (grantsTry <= 0) throw new DomainException("Kontör tutarı pozitif olmalı.");
        PriceTry = decimal.Round(priceTry, 2);
        GrantsTry = decimal.Round(grantsTry, 2);
        RequestedByUserId = requestedByUserId;
        Provider = string.IsNullOrWhiteSpace(provider) ? null : provider.Trim();
        ConversationId = string.IsNullOrWhiteSpace(conversationId) ? null : conversationId.Trim();
        Status = CreditPurchaseStatus.Pending;
    }

    public Guid TenantId { get; private set; }
    public Guid? CreditPackageId { get; private set; }
    public string PackageName { get; private set; } = string.Empty;
    public decimal PriceTry { get; private set; }
    public decimal GrantsTry { get; private set; }
    public CreditPurchaseStatus Status { get; private set; }
    public Guid? RequestedByUserId { get; private set; }
    public Guid? ProcessedByUserId { get; private set; }
    public DateTime? ProcessedAtUtc { get; private set; }
    public string? Note { get; private set; }

    /// <summary>Kart ödemesinin sağlayıcısı; havale yolunda null.</summary>
    public string? Provider { get; private set; }

    /// <summary>
    /// Sağlayıcı işlem anahtarı — dönüşün BİZİM açtığımız denemeye ait olduğunun tek kanıtı.
    /// Benzersizdir (havale talepleri null taşır, MySQL çoklu NULL'a izin verir).
    /// </summary>
    public string? ConversationId { get; private set; }

    /// <summary>
    /// Sağlayıcının ödeme kimliği. Tekrar oynatma (replay) koruması buna dayanır: aynı kimlik
    /// ne ikinci bir kontör talebine ne de bir aboneliğe yazılabilir (çapraz tablo kontrolü).
    /// </summary>
    public string? ProviderPaymentId { get; private set; }

    public DateTime? PaidAtUtc { get; private set; }

    /// <summary>
    /// Kart tahsilatı doğrulandı → talep onaylanır. Ayrı metot: <see cref="Approve"/> "platform
    /// yöneticisi onayladı" demektir ve ProcessedByUserId'ye bir insan yazar; burada onaylayan
    /// sağlayıcı tahsilatıdır.
    /// </summary>
    public void MarkPaidAndApprove(string? providerPaymentId, DateTime nowUtc)
    {
        if (Status != CreditPurchaseStatus.Pending) throw new DomainException("Yalnızca bekleyen talep ödenebilir.");
        ProviderPaymentId = string.IsNullOrWhiteSpace(providerPaymentId) ? null : providerPaymentId.Trim();
        PaidAtUtc = nowUtc;
        Status = CreditPurchaseStatus.Approved;
        ProcessedAtUtc = nowUtc;
        Touch();
    }

    /// <summary>
    /// Sonuç henüz kesinleşmedi (3DS ortası, ağ hatası, geçmiş tutmayan sağlayıcı).
    /// Talep PENDING KALIR — kapatılırsa, müşteri ödemeyi hemen ardından tamamladığında kayıt
    /// yeniden değerlendirilemez ve para karşılıksız kalırdı. Yalnız gerekçe not edilir.
    /// </summary>
    public void MarkPaymentUnresolved(string? reason, DateTime nowUtc)
    {
        if (Status != CreditPurchaseStatus.Pending) return; // karara bağlanmış kaydı geri açmayız
        Note = string.IsNullOrWhiteSpace(reason)
            ? "Ödeme sonucu henüz kesinleşmedi."
            : reason.Trim();
        ProcessedAtUtc = nowUtc;   // "en son ne zaman soruldu" izi
        Touch();
    }

    /// <summary>Kart tahsilatı KESİN olarak reddedildi/uyumsuz. Bakiye artmaz; sebep Note'ta taşınır.</summary>
    public void MarkPaymentFailed(string? errorCode, string? errorMessage, DateTime nowUtc)
    {
        if (Status is CreditPurchaseStatus.Approved)
            throw new DomainException("Onaylanmış talep başarısız işaretlenemez.");
        Status = CreditPurchaseStatus.Failed;
        ProcessedAtUtc = nowUtc;
        var text = string.Join(" · ", new[] { errorCode, errorMessage }.Where(x => !string.IsNullOrWhiteSpace(x)));
        Note = string.IsNullOrWhiteSpace(text) ? "Ödeme tamamlanamadı." : text.Trim();
        Touch();
    }

    /// <summary>
    /// Kart ödemesiyle açılmış talep mi? Bu kayıtlar İNSAN ONAYINA KAPALIDIR — sonuçlarını
    /// yalnız doğrulanmış sağlayıcı dönüşü belirler.
    /// </summary>
    public bool IsCardCheckout => ConversationId is not null;

    /// <summary>
    /// ELLE ONAY — yalnız havale/elden ödeme talepleri için.
    ///
    /// <para>
    /// SOMUT AÇIK (denetimde yakalandı): kartla ödeme akışı da PENDING bir talep açıyor ve bu
    /// satır platform onay kuyruğuna düşüyordu. Yönetici onu havale talebi sanıp onayladığında
    /// <b>hiç tahsilat yapılmadan</b> cüzdana kontör yükleniyordu — kurum ödeme formunu açıp
    /// kapatmakla bedava kontör alabilirdi. Sonraki gerçek callback de kaydı "zaten alınmış"
    /// görüp sessizce geçiyordu. Kapı hem burada hem serviste (çift savunma).
    /// </para>
    /// </summary>
    public void Approve(Guid? processedByUserId)
    {
        if (IsCardCheckout)
            throw new DomainException("Kartla ödeme talebi elle onaylanamaz; sonucu ödeme sağlayıcısı belirler.");
        if (Status != CreditPurchaseStatus.Pending) throw new DomainException("Yalnızca bekleyen talep onaylanabilir.");
        Status = CreditPurchaseStatus.Approved;
        ProcessedByUserId = processedByUserId;
        ProcessedAtUtc = DateTime.UtcNow;
        Touch();
    }

    /// <summary>ELLE RED — onayla aynı gerekçe: kartlı talebi insan kapatamaz. Kapatsaydı,
    /// müşteri ödemeyi sonradan tamamladığında kayıt yeniden değerlendirilemezdi.</summary>
    public void Reject(Guid? processedByUserId, string? note)
    {
        if (IsCardCheckout)
            throw new DomainException("Kartla ödeme talebi elle reddedilemez; sonucu ödeme sağlayıcısı belirler.");
        if (Status != CreditPurchaseStatus.Pending) throw new DomainException("Yalnızca bekleyen talep reddedilebilir.");
        Status = CreditPurchaseStatus.Rejected;
        ProcessedByUserId = processedByUserId;
        ProcessedAtUtc = DateTime.UtcNow;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        Touch();
    }

    public void Cancel()
    {
        if (Status != CreditPurchaseStatus.Pending) throw new DomainException("Yalnızca bekleyen talep iptal edilebilir.");
        Status = CreditPurchaseStatus.Cancelled;
        Touch();
    }
}
