using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// İPTAL EDİLEN SATIŞ ARŞİVİ. Bir satış iptal edildiğinde cari kaydı (taksitleri, tahsilatları ve
/// seans bakiyeleriyle birlikte) canlı tablolardan <b>gerçekten silinir</b> ve buraya taşınır.
/// <para>
/// Neden taşıma? Eskiden iptal yalnızca <c>customer_accounts.CancelledAtUtc</c> damgasıydı; satırlar
/// yerinde kaldığı için her okuma yolunun kendi süzgecini koyması gerekiyordu. Koymayanlar
/// (kasa akışı, kâr-zarar, günlük kart, müşteri harcaması) iptal edilmiş satışın parasını saymaya
/// devam ediyordu. Taşıma bu sınıf hatasını yapısal olarak bitirir: canlı tabloda satır yoksa
/// hiçbir rapor onu sayamaz.
/// </para>
/// <para>
/// <see cref="Snapshot"/> silinen satırların tam JSON kopyasıdır; "iptali geri al" bundan yeniden
/// kurulur (aynı Id'lerle, böylece randevu/adisyon referansları tutar).
/// </para>
/// </summary>
public sealed class CancelledSale : Entity
{
    private CancelledSale() { }

    public CancelledSale(
        Guid tenantId,
        Guid? branchId,
        Guid originalAccountId,
        Guid customerId,
        Guid? servicePackageId,
        string name,
        decimal totalAmount,
        decimal depositAmount,
        decimal collectedAmount,
        decimal refundedAmount,
        DateTime soldAtUtc,
        Guid? soldByStaffMemberId,
        bool isHistorical,
        int sessionsTotal,
        int sessionsUsed,
        Guid? adisyonId,
        string? reason,
        string snapshot)
    {
        if (collectedAmount < 0) throw new DomainException("Tahsil edilmiş tutar negatif olamaz.");
        if (refundedAmount < 0) throw new DomainException("İade tutarı negatif olamaz.");
        if (refundedAmount > collectedAmount) throw new DomainException("İade tutarı tahsil edilmiş tutardan büyük olamaz.");

        TenantId = tenantId;
        BranchId = branchId;
        OriginalAccountId = originalAccountId;
        CustomerId = customerId;
        ServicePackageId = servicePackageId;
        Name = string.IsNullOrWhiteSpace(name) ? "Satış" : name.Trim();
        TotalAmount = totalAmount;
        DepositAmount = depositAmount;
        CollectedAmount = collectedAmount;
        RefundedAmount = refundedAmount;
        SoldAtUtc = DateTime.SpecifyKind(soldAtUtc == default ? DateTime.UtcNow : soldAtUtc, DateTimeKind.Utc);
        SoldByStaffMemberId = soldByStaffMemberId == Guid.Empty ? null : soldByStaffMemberId;
        IsHistorical = isHistorical;
        SessionsTotal = sessionsTotal;
        SessionsUsed = sessionsUsed;
        AdisyonId = adisyonId == Guid.Empty ? null : adisyonId;
        CancellationReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        CancelledAtUtc = DateTime.UtcNow;
        Snapshot = snapshot;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }

    /// <summary>Silinen cari kaydın Id'si. FK DEĞİLDİR — satır artık yok; geri almada aynı Id yeniden kurulur.</summary>
    public Guid OriginalAccountId { get; private set; }

    public Guid CustomerId { get; private set; }
    public Customer? Customer { get; private set; }
    public Guid? ServicePackageId { get; private set; }

    /// <summary>Satışın adı (ör. "Lazer Epilasyon 6 Seans") — cariden kopyalanır.</summary>
    public string Name { get; private set; } = string.Empty;

    public decimal TotalAmount { get; private set; }
    public decimal DepositAmount { get; private set; }

    /// <summary>İptal anında müşteriden fiilen tahsil edilmiş toplam (peşinat + tahsilatlar).</summary>
    public decimal CollectedAmount { get; private set; }

    /// <summary>Bu tahsilatın müşteriye geri ödenen kısmı. Kısmi iade desteklenir.</summary>
    public decimal RefundedAmount { get; private set; }

    /// <summary>Kurumda kalan para (tahsil edilmiş − iade edilen). Gelirde bu kadarı sayılmaya devam eder.</summary>
    public decimal RetainedAmount => Math.Max(0m, CollectedAmount - RefundedAmount);

    public DateTime SoldAtUtc { get; private set; }
    public Guid? SoldByStaffMemberId { get; private set; }
    public StaffMember? SoldByStaffMember { get; private set; }
    public bool IsHistorical { get; private set; }

    public int SessionsTotal { get; private set; }
    public int SessionsUsed { get; private set; }

    /// <summary>Satışı doğuran adisyon (varsa) — iptalde o da Cancelled'a çekilir, geri almada Approved'a döner.</summary>
    public Guid? AdisyonId { get; private set; }

    public DateTime CancelledAtUtc { get; private set; }
    public string? CancellationReason { get; private set; }

    /// <summary>Silinen satırların tam kopyası (cari + taksitler + tahsilatlar + seanslar) — geri alma kaynağı.</summary>
    public string Snapshot { get; private set; } = string.Empty;

    /// <summary>Dolu ise iptal geri alınmış demektir; arşiv listesinde görünmez, iz olarak durur.</summary>
    public DateTime? RestoredAtUtc { get; private set; }

    public void MarkRestored()
    {
        if (RestoredAtUtc is not null) throw new DomainException("Bu iptal zaten geri alınmış.");
        RestoredAtUtc = DateTime.UtcNow;
        Touch();
    }
}
