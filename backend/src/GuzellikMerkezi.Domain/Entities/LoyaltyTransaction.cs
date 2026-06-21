using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Sadakat puan hareketi. Adisyon onayında tahsilat tutarına göre puan kazanılır (Earn);
/// ödemede puan kullanılabilir (Redeem, negatif). Bakiye = işlemlerin toplamı.
/// </summary>
public sealed class LoyaltyTransaction : Entity
{
    private LoyaltyTransaction() { }

    public LoyaltyTransaction(Guid tenantId, Guid customerId, int points, string sourceType, Guid? sourceId, string? description, DateTime occurredAtUtc)
    {
        TenantId = tenantId;
        CustomerId = customerId;
        if (points == 0) throw new DomainException("Puan değeri sıfır olamaz.");
        Points = points;
        SourceType = string.IsNullOrWhiteSpace(sourceType) ? "Manual" : sourceType.Trim();
        SourceId = sourceId;
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        if (occurredAtUtc.Kind != DateTimeKind.Utc) occurredAtUtc = DateTime.SpecifyKind(occurredAtUtc, DateTimeKind.Utc);
        OccurredAtUtc = occurredAtUtc;
    }

    public Guid TenantId { get; private set; }
    public Guid CustomerId { get; private set; }
    public Customer? Customer { get; private set; }
    /// <summary>Pozitif = kazanım (Earn/Adjust+), negatif = kullanım (Redeem/Adjust-).</summary>
    public int Points { get; private set; }
    public string SourceType { get; private set; } = "Manual";
    public Guid? SourceId { get; private set; }
    public string? Description { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
}
