using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class CustomerAccount : Entity
{
    private readonly List<Installment> _installments = new();
    private readonly List<AccountPayment> _payments = new();

    private CustomerAccount() { }

    public CustomerAccount(Guid tenantId, Guid? branchId, Guid customerId, Guid? servicePackageId, string name, decimal totalAmount, decimal depositAmount)
    {
        TenantId = tenantId;
        BranchId = branchId;
        CustomerId = customerId;
        ServicePackageId = servicePackageId;
        Rename(name);
        ChangeTotal(totalAmount, depositAmount);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }
    public Guid CustomerId { get; private set; }
    public Customer? Customer { get; private set; }
    public Guid? ServicePackageId { get; private set; }
    public ServicePackage? ServicePackage { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public decimal TotalAmount { get; private set; }
    public decimal DepositAmount { get; private set; }
    public string? Notes { get; private set; }
    public bool IsActive { get; private set; } = true;
    public IReadOnlyCollection<Installment> Installments => _installments.AsReadOnly();
    public IReadOnlyCollection<AccountPayment> Payments => _payments.AsReadOnly();

    public decimal PaidAmount => _payments.Sum(p => p.Amount) + DepositAmount;
    public decimal RemainingAmount => Math.Max(0, TotalAmount - PaidAmount);
    /// <summary>Tüm borcu aşan tahsilat (fazla ödeme) — müşteri lehine kredi olarak taşınır.</summary>
    public decimal CreditBalance => Math.Max(0, PaidAmount - TotalAmount);

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Cari adı boş olamaz.");
        Name = name.Trim();
        Touch();
    }

    public void SetNotes(string? notes)
    {
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Touch();
    }

    public void ChangeTotal(decimal totalAmount, decimal depositAmount)
    {
        if (totalAmount < 0) throw new DomainException("Toplam tutar negatif olamaz.");
        if (depositAmount < 0) throw new DomainException("Peşinat negatif olamaz.");
        if (depositAmount > totalAmount) throw new DomainException("Peşinat toplam tutardan büyük olamaz.");
        TotalAmount = totalAmount;
        DepositAmount = depositAmount;
        Touch();
    }

    /// <summary>
    /// Finanse edilen tutarı (toplam − peşinat) eşit aylık taksitlere böler.
    /// Taksitler <b>sabit plandır</b>; ödendikçe değişmez — tahsilatlar
    /// <see cref="AllocatePayments"/> ile taksitlere dağıtılarak "ödenen/kalan" hesaplanır.
    /// </summary>
    public void RebuildInstallments(int count, DateOnly firstDueDate)
    {
        if (count < 0) throw new DomainException("Taksit sayısı negatif olamaz.");

        // Tüm taksitleri sıfırla — plan baştan kurulur. (Ödenen bilgisi taksitte değil,
        // tahsilatlarda tutulduğu için plan yeniden bölünse de "ödenen" korunur.)
        // EF Core .Clear() + Re-add yerine targeted Remove, "tracked entity duplicate" sorununu engeller.
        var toRemove = _installments.ToList();
        foreach (var item in toRemove)
        {
            _installments.Remove(item);
        }

        if (count == 0) { Touch(); return; }

        var financed = Math.Max(0, TotalAmount - DepositAmount);
        if (financed <= 0) { Touch(); return; }

        var per = Math.Round(financed / count, 2, MidpointRounding.AwayFromZero);
        var drift = financed - per * count;

        for (var i = 0; i < count; i++)
        {
            var amount = per;
            if (i == count - 1) amount += drift;
            var due = firstDueDate.AddMonths(i);
            _installments.Add(new Installment(Id, i + 1, due, amount));
        }
        Touch();
    }

    /// <summary>
    /// Tahsilat kaydeder. Taksit planı <b>değişmez</b>; ödenen tutar
    /// <see cref="AllocatePayments"/> ile vade sırasına göre taksitlere dağıtılır.
    /// Böylece eksik ödemede ilgili taksit kısmen, fazla ödemede birden çok taksit kapanır.
    /// </summary>
    public void RegisterPayment(decimal amount, string? method, string? reference, DateTime occurredAt)
    {
        if (amount <= 0) throw new DomainException("Tahsilat tutarı pozitif olmalı.");
        if (occurredAt.Kind != DateTimeKind.Utc) occurredAt = DateTime.SpecifyKind(occurredAt, DateTimeKind.Utc);
        _payments.Add(new AccountPayment(Id, amount, method, reference, occurredAt));
        Touch();
    }

    /// <summary>
    /// Tahsilatları (peşinat hariç) taksitlere vade sırasıyla dağıtır: taksit Id → ödenen tutar.
    /// Saf okuma — kalıcı durum değiştirmez. Bir taksit tutarınca karşılandıysa kapanır, eksik
    /// karşılandıysa o kadarı ödenmiş sayılır; tüm taksitleri aşan kısım fazla ödeme (credit) olur.
    /// </summary>
    public IReadOnlyDictionary<Guid, decimal> AllocatePayments()
    {
        var pool = _payments.Sum(p => p.Amount);
        var map = new Dictionary<Guid, decimal>();
        foreach (var inst in _installments
            .Where(i => i.Status != InstallmentStatus.Cancelled)
            .OrderBy(i => i.No)
            .ThenBy(i => i.DueDate))
        {
            var alloc = Math.Min(Math.Max(0, pool), inst.Amount);
            map[inst.Id] = Math.Round(alloc, 2, MidpointRounding.AwayFromZero);
            pool -= alloc;
        }
        return map;
    }

    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }
}

public sealed class Installment : Entity
{
    private Installment() { }

    public Installment(Guid accountId, int no, DateOnly dueDate, decimal amount)
    {
        CustomerAccountId = accountId;
        No = no;
        DueDate = dueDate;
        Amount = amount;
        Status = InstallmentStatus.Planned;
    }

    public Guid CustomerAccountId { get; private set; }
    public CustomerAccount? Account { get; private set; }
    public int No { get; private set; }
    public DateOnly DueDate { get; private set; }
    public decimal Amount { get; private set; }
    public InstallmentStatus Status { get; private set; }
    public DateTime? PaidAtUtc { get; private set; }

    public void MarkPaid()
    {
        Status = InstallmentStatus.Paid;
        PaidAtUtc = DateTime.UtcNow;
        Touch();
    }

    /// <summary>Açık (Planned) taksitin tutarını günceller — yeniden bölme için.</summary>
    public void SetAmount(decimal amount)
    {
        if (amount < 0) throw new DomainException("Taksit tutarı negatif olamaz.");
        Amount = Math.Round(amount, 2, MidpointRounding.AwayFromZero);
        Touch();
    }

    public void Cancel()
    {
        Status = InstallmentStatus.Cancelled;
        Touch();
    }
}

public sealed class AccountPayment : Entity
{
    private AccountPayment() { }

    public AccountPayment(Guid accountId, decimal amount, string? method, string? reference, DateTime occurredAtUtc)
    {
        CustomerAccountId = accountId;
        Amount = amount;
        Method = string.IsNullOrWhiteSpace(method) ? null : method.Trim();
        Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();
        OccurredAtUtc = occurredAtUtc;
    }

    public Guid CustomerAccountId { get; private set; }
    public CustomerAccount? Account { get; private set; }
    public decimal Amount { get; private set; }
    public string? Method { get; private set; }
    public string? Reference { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
}
