using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Adisyon = işletmede yapılan işlemlerin (hizmet, ürün, paket kullanımı, tahsilat) önce toplandığı
/// ara katman. İşlemler ANINDA cariye/kasaya düşmez; kurum sahibi adisyonu <see cref="Approve"/>
/// edince yalnızca onaylanan kalemler cariye + kasaya aktarılır.
/// </summary>
public sealed class Adisyon : Entity
{
    private readonly List<AdisyonItem> _items = new();

    private Adisyon() { }

    public Adisyon(Guid tenantId, Guid? branchId, Guid customerId, Guid? customerAccountId, string? notes)
    {
        TenantId = tenantId;
        BranchId = branchId;
        CustomerId = customerId;
        CustomerAccountId = customerAccountId;
        Status = AdisyonStatus.Open;
        OpenedAtUtc = DateTime.UtcNow;
        SetNotes(notes);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid CustomerId { get; private set; }
    public Customer? Customer { get; private set; }
    public Guid? CustomerAccountId { get; private set; }
    public CustomerAccount? CustomerAccount { get; private set; }
    public AdisyonStatus Status { get; private set; }
    public DateTime OpenedAtUtc { get; private set; }
    public DateTime? ApprovedAtUtc { get; private set; }
    public Guid? DecidedByUserId { get; private set; }
    public string? Notes { get; private set; }

    /// <summary>Taksit planı: satış adisyonda taksitlendirilirse, onayda cariye bu sayıda eşit taksit kurulur (0 = peşin).</summary>
    public int PlannedInstallmentCount { get; private set; }
    /// <summary>Taksit planının ilk vade tarihi (taksit varsa). Sonraki taksitler aydan aya ilerler.</summary>
    public DateOnly? PlannedFirstDueDate { get; private set; }

    /// <summary>
    /// Faz 2: true ise bu satış adisyonu şimdi cariye/kasaya işlenmez (elle onaya da düşmez);
    /// müşterinin ilk randevusu tamamlandığında <c>AppointmentService</c> otomatik <see cref="Approve"/> eder
    /// (borç + peşinat + seanslar o an düşer). Satış modallarından açılan adisyonlarda true; manuel/Ön Muhasebe
    /// adisyonlarında false (onlar eski akışta elle onaylanır).
    /// </summary>
    public bool AutoApproveOnFirstAppointment { get; private set; }

    public IReadOnlyCollection<AdisyonItem> Items => _items.AsReadOnly();

    /// <summary>Cariye borç yazılacak net tutar: hizmet+ürün+ek+paket satışı kalemleri − indirimler (paketten karşılananlar hariç).</summary>
    public decimal ChargeTotal =>
        _items.Where(i => (i.Type == AdisyonItemType.Service || i.Type == AdisyonItemType.Product || i.Type == AdisyonItemType.Extra || i.Type == AdisyonItemType.PackageSale) && !i.CoveredByPackage)
              .Sum(i => i.LineTotal)
        - _items.Where(i => i.Type == AdisyonItemType.Discount).Sum(i => i.LineTotal);

    /// <summary>Adisyonda alınan toplam tahsilat — onayda cariye/kasaya gelir olarak işlenir.</summary>
    public decimal PaymentTotal => _items.Where(i => i.Type == AdisyonItemType.Payment).Sum(i => i.LineTotal);

    public void SetNotes(string? notes)
    {
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Touch();
    }

    public void SetCustomerAccount(Guid? accountId)
    {
        CustomerAccountId = accountId;
        Touch();
    }

    /// <summary>
    /// Satışın taksit planını belirler (peşin yerine taksitle). Onayda cariye bu plan kurulur.
    /// count ≤ 0 ya da vade yoksa peşin satış (taksit yok) demektir.
    /// </summary>
    public void SetInstallmentPlan(int? count, DateOnly? firstDueDate)
    {
        EnsureOpen();
        if (count is null or <= 0 || firstDueDate is null)
        {
            PlannedInstallmentCount = 0;
            PlannedFirstDueDate = null;
        }
        else
        {
            PlannedInstallmentCount = count.Value;
            PlannedFirstDueDate = firstDueDate;
        }
        Touch();
    }

    /// <summary>
    /// Satış adisyonunu "ilk randevu tamamlanınca otomatik işle" moduna alır. Açıkken çağrılır;
    /// onay tetiği <c>AppointmentService.ChangeStatusAsync</c> (Tamamlandı) içindedir.
    /// </summary>
    public void SetAutoApproveOnFirstAppointment(bool value)
    {
        EnsureOpen();
        AutoApproveOnFirstAppointment = value;
        Touch();
    }

    public AdisyonItem AddItem(AdisyonItemType type, Guid? refId, string description, decimal quantity, decimal unitPrice, Guid? staffMemberId, bool coveredByPackage)
    {
        EnsureOpen();
        var item = new AdisyonItem(Id, type, refId, description, quantity, unitPrice, staffMemberId, coveredByPackage);
        _items.Add(item);
        Touch();
        return item;
    }

    public void RemoveItem(Guid itemId)
    {
        EnsureOpen();
        var item = _items.FirstOrDefault(i => i.Id == itemId);
        if (item is null) return;
        _items.Remove(item);
        Touch();
    }

    public void Approve(Guid? decidedByUserId)
    {
        EnsureOpen();
        if (_items.Count == 0) throw new DomainException("Boş adisyon onaylanamaz.");
        Status = AdisyonStatus.Approved;
        ApprovedAtUtc = DateTime.UtcNow;
        DecidedByUserId = decidedByUserId;
        Touch();
    }

    public void Cancel(Guid? decidedByUserId)
    {
        if (Status == AdisyonStatus.Approved) throw new DomainException("Onaylanmış adisyon iptal edilemez.");
        Status = AdisyonStatus.Cancelled;
        DecidedByUserId = decidedByUserId;
        Touch();
    }

    private void EnsureOpen()
    {
        if (Status != AdisyonStatus.Open) throw new DomainException("Yalnızca açık adisyon düzenlenebilir.");
    }
}

public sealed class AdisyonItem : Entity
{
    private AdisyonItem() { }

    public AdisyonItem(Guid adisyonId, AdisyonItemType type, Guid? refId, string description, decimal quantity, decimal unitPrice, Guid? staffMemberId, bool coveredByPackage)
    {
        AdisyonId = adisyonId;
        Type = type;
        RefId = refId;
        Description = string.IsNullOrWhiteSpace(description) ? type.ToString() : description.Trim();
        Quantity = quantity <= 0 ? 1 : quantity;
        UnitPrice = unitPrice < 0 ? 0 : unitPrice;
        StaffMemberId = staffMemberId;
        // Paketten karşılanma yalnızca hizmet/paket-kullanım kalemleri için anlamlı.
        CoveredByPackage = coveredByPackage || type == AdisyonItemType.PackageUse;
    }

    public Guid AdisyonId { get; private set; }
    public Adisyon? Adisyon { get; private set; }
    public AdisyonItemType Type { get; private set; }
    public Guid? RefId { get; private set; }
    public string Description { get; private set; } = string.Empty;
    public decimal Quantity { get; private set; }
    public decimal UnitPrice { get; private set; }
    public Guid? StaffMemberId { get; private set; }
    public bool CoveredByPackage { get; private set; }

    public decimal LineTotal => Math.Round(Quantity * UnitPrice, 2, MidpointRounding.AwayFromZero);
}
