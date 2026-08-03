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
    /// KDV oranı (0.20 = %20). <see cref="AmountTRY"/> KDV DAHİL brüt tutardır — paket fiyatları
    /// liste fiyatı olarak KDV dahil girildiği için fatura da brütten kurulur; net ve KDV tutarı
    /// buradan türetilir. Oran faturaya yazılır ki geçmiş faturalar oran değişse de bozulmasın.
    /// </summary>
    public decimal VatRate { get; private set; } = 0.20m;

    /// <summary>Sağlayıcı işlem kimliği (iyzico paymentId) — mutabakat ve iade için.</summary>
    public string? PaymentReference { get; private set; }

    /// <summary>KDV hariç tutar (brütten türetilir).</summary>
    public decimal NetAmountTRY => VatRate <= 0 ? AmountTRY : Math.Round(AmountTRY / (1 + VatRate), 2, MidpointRounding.AwayFromZero);

    /// <summary>KDV tutarı (brüt − net).</summary>
    public decimal VatAmountTRY => Math.Round(AmountTRY - NetAmountTRY, 2, MidpointRounding.AwayFromZero);

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
        AmountTRY = amountTry;
        DueDateUtc = dueDateUtc;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Touch();
    }
}
