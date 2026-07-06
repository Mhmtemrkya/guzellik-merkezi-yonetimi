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

    public static readonly string[] ValidStatuses = ["Draft", "Sent", "Paid", "Overdue", "Cancelled"];

    public void ChangeStatus(string status)
    {
        if (!ValidStatuses.Contains(status)) throw new DomainException("Geçersiz fatura durumu.");
        Status = status;
        PaidAtUtc = status == "Paid" ? DateTime.UtcNow : null;
        Touch();
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
