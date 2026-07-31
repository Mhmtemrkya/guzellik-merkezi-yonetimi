namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// İPTAL EDİLEN SATIŞIN TAHSİLATI — kasadan gerçekten geçmiş paranın kalıcı defteri.
/// <para>
/// Satış iptal edildiğinde cari kaydı silinir ve <c>account_payments</c> satırları cascade ile
/// gider. Ama o para geçmişte fiilen tahsil edilmiştir: kasa akışı, kâr-zarar ve dönem raporları
/// onu görmeye devam etmelidir. Satır silinince gelir sıfırlanıp yalnız iade gider olarak kalıyordu
/// → net kasa eksiye düşüyordu (1.200 tahsil / 500 iade → net 700 yerine −500).
/// </para>
/// <para>
/// Bu tablo o boşluğu kapatır: tahsilat "finansal defterden" silinmez, yalnızca yer değiştirir.
/// <see cref="CancelledSale.Snapshot"/> içindeki kopya geri yükleme içindir (şifreli, SQL'de
/// süzülemez); burası ise raporların tarih aralığıyla doğrudan sorgulayabildiği hâlidir.
/// </para>
/// <para>
/// İptal geri alınırsa canlı <c>account_payments</c> satırları aynı Id'lerle geri gelir; bu yüzden
/// arşiv satırları o anda soft-delete edilir — çift sayım olmaz, iz kaybolmaz.
/// </para>
/// </summary>
public sealed class ArchivedSalePayment : Entity
{
    private ArchivedSalePayment() { }

    public ArchivedSalePayment(
        Guid tenantId,
        Guid? branchId,
        Guid cancelledSaleId,
        Guid originalAccountId,
        Guid originalPaymentId,
        Guid customerId,
        string? accountName,
        decimal amount,
        string? method,
        string? reference,
        DateTime occurredAtUtc)
    {
        TenantId = tenantId;
        BranchId = branchId;
        CancelledSaleId = cancelledSaleId;
        OriginalAccountId = originalAccountId;
        OriginalPaymentId = originalPaymentId;
        CustomerId = customerId;
        AccountName = string.IsNullOrWhiteSpace(accountName) ? null : accountName.Trim();
        Amount = amount;
        Method = NormalizeMethod(method);
        Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();
        OccurredAtUtc = occurredAtUtc.Kind == DateTimeKind.Utc
            ? occurredAtUtc
            : DateTime.SpecifyKind(occurredAtUtc, DateTimeKind.Utc);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }

    /// <summary>Bağlı olduğu iptal arşivi (FK verilmez — arşiv satırı kalıcı, bu satır soft-delete olabilir).</summary>
    public Guid CancelledSaleId { get; private set; }

    /// <summary>Silinen carinin Id'si — katalog/paket raporları tahsilatı satışa buradan bağlar.</summary>
    public Guid OriginalAccountId { get; private set; }

    /// <summary>Silinen <c>account_payments</c> satırının Id'si; geri yüklemede aynı Id kurulur (mükerrer koruması).</summary>
    public Guid OriginalPaymentId { get; private set; }

    public Guid CustomerId { get; private set; }
    public Customer? Customer { get; private set; }

    /// <summary>Satışın adı — kasa akışında satır açıklaması için kopyalanır (cari silindiği için join edilemez).</summary>
    public string? AccountName { get; private set; }

    public decimal Amount { get; private set; }

    /// <summary>cash / card / transfer / unknown — kasa kırılımı canlı tahsilatlarla aynı sözlüğü kullanır.</summary>
    public string Method { get; private set; } = "unknown";

    public string? Reference { get; private set; }

    /// <summary>Paranın fiilen alındığı an — dönem süzgeci buna bakar (iptal tarihine DEĞİL).</summary>
    public DateTime OccurredAtUtc { get; private set; }

    /// <summary>
    /// Bilinmeyen yöntem "unknown" kalır — nakit VARSAYILMAZ. Eski kayıtta yöntem yoksa kasa
    /// kırılımında nakit gibi görünmesi gerçeğe aykırı olurdu.
    /// </summary>
    private static string NormalizeMethod(string? method)
    {
        var m = (method ?? string.Empty).Trim().ToLowerInvariant();
        if (m.Length == 0) return "unknown";
        if (m.Contains("card") || m.Contains("kart")) return "card";
        if (m.Contains("transfer") || m.Contains("eft") || m.Contains("havale") || m.Contains("bank")) return "transfer";
        if (m.Contains("cash") || m.Contains("nakit")) return "cash";
        return m.Length > 24 ? m[..24] : m;
    }
}
