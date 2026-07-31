using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// MÜŞTERİYE YAPILAN PARA İADESİ — gerçek bir kasa çıkışıdır.
/// <para>
/// Satış iptal edilirken "ne kadarı müşteriye geri ödendi" bilgisi arşive (<see cref="CancelledSale"/>)
/// yazılıyordu ama yalnızca BİLGİ olarak: kasa akışı, kâr-zarar ve günlük kartta hiçbir karşılığı yoktu.
/// Bu kayıt o boşluğu kapatır — iade artık negatif bir nakit hareketi olarak raporlanır.
/// </para>
/// <para>
/// Ayrı tablo olmasının sebebi: bir iptal için birden çok kısmi iade yapılabilsin ve her birinin
/// kendi yöntemi (nakit/kart/havale), tarihi, gerekçesi ve sorumlusu tutulabilsin.
/// </para>
/// </summary>
public sealed class RefundTransaction : Entity
{
    private RefundTransaction() { }

    public RefundTransaction(
        Guid tenantId,
        Guid? branchId,
        Guid cancelledSaleId,
        Guid customerId,
        decimal amount,
        string? method,
        string? reference = null,
        DateTime? refundedAtUtc = null,
        Guid? refundedByUserId = null,
        string? reason = null)
    {
        if (amount <= 0) throw new DomainException("İade tutarı pozitif olmalı.");

        TenantId = tenantId;
        BranchId = branchId;
        CancelledSaleId = cancelledSaleId;
        CustomerId = customerId;
        Amount = amount;
        Method = NormalizeMethod(method);
        Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();
        var at = refundedAtUtc ?? DateTime.UtcNow;
        RefundedAtUtc = at.Kind == DateTimeKind.Utc ? at : DateTime.SpecifyKind(at, DateTimeKind.Utc);
        RefundedByUserId = refundedByUserId;
        Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }

    /// <summary>Bağlı olduğu iptal arşivi. Kayıt silinmez; iptal geri alınırsa iade soft-delete edilir.</summary>
    public Guid CancelledSaleId { get; private set; }

    public Guid CustomerId { get; private set; }
    public Customer? Customer { get; private set; }

    public decimal Amount { get; private set; }

    /// <summary>cash / card / transfer — tahsilatlarla aynı sözlük (kasa kırılımı tutarlı olsun).</summary>
    public string Method { get; private set; } = "cash";

    public string? Reference { get; private set; }

    /// <summary>Paranın fiilen çıktığı an — kasa/kâr-zarar bu tarihe göre raporlar.</summary>
    public DateTime RefundedAtUtc { get; private set; }

    /// <summary>İadeyi yapan kullanıcı (denetim izi).</summary>
    public Guid? RefundedByUserId { get; private set; }

    public string? Reason { get; private set; }

    /// <summary>Boş/bilinmeyen yöntem nakit sayılır — kasa kırılımında kayıp satır olmasın.</summary>
    private static string NormalizeMethod(string? method)
    {
        var m = (method ?? string.Empty).Trim().ToLowerInvariant();
        return m switch
        {
            "card" or "kart" or "creditcard" => "card",
            "transfer" or "banktransfer" or "havale" or "eft" => "transfer",
            _ => "cash",
        };
    }
}
