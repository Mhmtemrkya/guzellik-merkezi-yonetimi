using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Platform → kurum abonelik faturası. Tenant kapsam filtresine GİRMEZ:
/// yalnızca PlatformAdmin uçlarından okunur/yazılır (faturalama sayfası).
/// </summary>
public sealed class TenantInvoice : Entity
{
    private TenantInvoice() { }

    public TenantInvoice(Guid tenantId, string number, DateTime periodStartUtc, DateTime periodEndUtc, decimal amountTry, string? notes = null)
    {
        if (tenantId == Guid.Empty) throw new DomainException("Fatura için kurum zorunlu.");
        if (string.IsNullOrWhiteSpace(number)) throw new DomainException("Fatura numarası zorunlu.");
        if (periodEndUtc <= periodStartUtc) throw new DomainException("Fatura dönemi geçersiz.");
        if (amountTry < 0) throw new DomainException("Fatura tutarı negatif olamaz.");
        TenantId = tenantId;
        Number = number.Trim();
        PeriodStartUtc = periodStartUtc;
        PeriodEndUtc = periodEndUtc;
        AmountTRY = amountTry;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        IssuedAtUtc = DateTime.UtcNow;
        DueDateUtc = IssuedAtUtc.AddDays(14);
    }

    public Guid TenantId { get; private set; }
    public Tenant? Tenant { get; private set; }

    /// <summary>
    /// Bu fatura ÖDENDİĞİNDE kapsadığı dönem boyunca açılan dijital onam kademesi (kademe eşiği; 10000 =
    /// "10.000 üzeri evrak"). null = kademe yok (yalnız ücretsiz bölüm). İmza kapısı YALNIZ "Paid" ve
    /// bugünü kapsayan faturalardaki en yüksek değeri esas alır — açık (ödenmemiş) fatura kilidi AÇMAZ.
    /// Tutar düzenlemesi bunu silmez: hak, tahsilatın kendisine değil ödenmiş olmasına bağlıdır.
    /// </summary>
    public int? ConsentTierAbove { get; private set; }

    public void CoverConsentTier(int? tierAbove)
    {
        if (tierAbove is < 0) throw new DomainException("Onam kademesi eşiği negatif olamaz.");
        ConsentTierAbove = tierAbove;
        Touch();
    }

    /// <summary>
    /// Bu fatura ÖDENDİĞİNDE kapsadığı dönem boyunca açılan MÜŞTERİ kademesi (eşik; 10000 = "10.000 üzeri
    /// müşteri"). Onam kademesiyle aynı kural: yalnız "Paid" ve bugünü kapsayan fatura hak açar.
    /// </summary>
    public int? CustomerTierAbove { get; private set; }

    public void CoverCustomerTier(int? tierAbove)
    {
        if (tierAbove is < 0) throw new DomainException("Müşteri kademesi eşiği negatif olamaz.");
        CustomerTierAbove = tierAbove;
        Touch();
    }

    /// <summary>
    /// ÖDEME BEKLEYEN ŞUBE TALEBİ (kartsız kurum): açılacak şubenin bilgisi (JSON). Şube fatura ÖDENDİ
    /// yapıldığında açılır ve alan aynı kayıtta temizlenir — Ödendi→Gönderildi→Ödendi gidip gelmesi ya da
    /// iki yöneticinin eşzamanlı işaretlemesi ikinci şube açamaz.
    /// </summary>
    public string? PendingBranchJson { get; private set; }

    public void AwaitBranch(string payloadJson)
    {
        if (string.IsNullOrWhiteSpace(payloadJson)) throw new DomainException("Şube bilgisi zorunlu.");
        PendingBranchJson = payloadJson.Trim();
        Touch();
    }

    /// <summary>Bekleyen şube talebini TÜKETİR (bir kez döner, sonra null).</summary>
    public string? TakePendingBranch()
    {
        var json = PendingBranchJson;
        if (json is null) return null;
        PendingBranchJson = null;
        Touch();
        return json;
    }

    public string Number { get; private set; } = string.Empty;
    public DateTime PeriodStartUtc { get; private set; }
    public DateTime PeriodEndUtc { get; private set; }
    public decimal AmountTRY { get; private set; }
    /// <summary>Draft | Sent | Paid | Overdue | Cancelled</summary>
    public string Status { get; private set; } = "Draft";
    public DateTime IssuedAtUtc { get; private set; }
    public DateTime DueDateUtc { get; private set; }
    public DateTime? PaidAtUtc { get; private set; }
    public string? Notes { get; private set; }

    /// <summary>
    /// KDV oranı (0.20 = %20). <see cref="AmountTRY"/> KDV DAHİL brüt (tahsil edilen) tutardır.
    /// Paket fiyatları KDV HARİÇ girilir; tahsilat teklifi (SubscriptionQuote) KDV'yi ekler ve fatura
    /// o teklifin net/KDV değerlerini aynen taşır. Oran faturaya yazılır ki geçmiş faturalar oran değişse de bozulmasın.
    /// </summary>
    public decimal VatRate { get; private set; } = 0.20m;

    /// <summary>Sağlayıcı işlem kimliği (iyzico paymentId) — mutabakat ve iade için.</summary>
    public string? PaymentReference { get; private set; }

    /// <summary>
    /// Teklifle kurulan faturada KDV hariç tutar ve KDV AYNEN saklanır (brütten yeniden türetmek kalem
    /// toplamından 1 kuruş sapabilirdi). Elle kesilen/düzenlenen faturada boştur, brütten türetilir.
    /// </summary>
    public decimal? QuotedNetTRY { get; private set; }
    public decimal? QuotedVatTRY { get; private set; }
    /// <summary>Kalem dökümü (SubscriptionQuote JSON) — tahsilat anındaki ANLIK GÖRÜNTÜ, sonradan yeniden hesaplanmaz.</summary>
    public string? LinesJson { get; private set; }

    /// <summary>KDV hariç tutar: tekliften geliyorsa aynen, değilse brütten türetilir.</summary>
    public decimal NetAmountTRY => QuotedNetTRY
        ?? (VatRate <= 0 ? AmountTRY : Math.Round(AmountTRY / (1 + VatRate), 2, MidpointRounding.AwayFromZero));

    /// <summary>KDV tutarı: tekliften geliyorsa aynen, değilse brüt − net.</summary>
    public decimal VatAmountTRY => QuotedVatTRY ?? Math.Round(AmountTRY - NetAmountTRY, 2, MidpointRounding.AwayFromZero);

    /// <summary>Faturayı tahsilattaki teklif dökümüne bağlar. Brüt tutar teklif toplamına eşit olmalı.</summary>
    public void ApplyQuote(Billing.SubscriptionQuote quote)
    {
        if (quote.Total != AmountTRY) throw new DomainException("Teklif toplamı fatura tutarıyla aynı değil.");
        VatRate = quote.VatRate;
        QuotedNetTRY = quote.Subtotal;
        QuotedVatTRY = quote.Vat;
        LinesJson = quote.ToJson();
        Touch();
    }

    public static readonly string[] ValidStatuses = ["Draft", "Sent", "Paid", "Overdue", "Cancelled"];

    public void ChangeStatus(string status)
    {
        if (!ValidStatuses.Contains(status)) throw new DomainException("Geçersiz fatura durumu.");
        Status = status;
        PaidAtUtc = status == "Paid" ? DateTime.UtcNow : null;
        Touch();
    }

    public void SetVatRate(decimal rate)
    {
        if (rate is < 0 or > 1) throw new DomainException("KDV oranı 0 ile 1 arasında olmalı.");
        VatRate = rate;
        Touch();
    }

    /// <summary>
    /// Faturayı ÖDENDİ olarak kapatır ve sağlayıcı işlem kimliğini bağlar.
    /// <see cref="ChangeStatus"/>'tan farkı: ödeme anını çağıran belirler (webhook geç gelebilir)
    /// ve referans korunur — "bu fatura hangi çekimle kapandı" sorusu cevapsız kalmasın.
    /// </summary>
    public void MarkPaid(DateTime paidAtUtc, string? paymentReference)
    {
        Status = "Paid";
        PaidAtUtc = paidAtUtc;
        if (!string.IsNullOrWhiteSpace(paymentReference)) PaymentReference = paymentReference.Trim();
        Touch(paidAtUtc);
    }

    public void UpdateDetails(decimal amountTry, DateTime dueDateUtc, string? notes)
    {
        if (amountTry < 0) throw new DomainException("Fatura tutarı negatif olamaz.");
        if (amountTry != AmountTRY)
        {
            // Tutar elle değişti: döküm artık tutmaz — net/KDV brütten türetilir, kalemler düşer.
            QuotedNetTRY = null;
            QuotedVatTRY = null;
            LinesJson = null;
        }
        AmountTRY = amountTry;
        DueDateUtc = dueDateUtc;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Touch();
    }
}
