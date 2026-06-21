namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Gün sonu kasa kapanışı (Z raporu). Kasiyerin saydığı fiziki nakit ile sistemin hesapladığı
/// nakit (açılış + günün nakit tahsilatı − nakit gideri) karşılaştırılır; fark mutabakat için tutulur.
/// Gün başına tek kayıt (BusinessDate benzersiz).
/// </summary>
public sealed class CashRegisterClosing : Entity
{
    private CashRegisterClosing() { }

    public CashRegisterClosing(
        Guid tenantId,
        Guid? branchId,
        DateOnly businessDate,
        decimal openingBalance,
        decimal cashIncome,
        decimal cashExpense,
        decimal countedCash,
        string? note)
    {
        TenantId = tenantId;
        BranchId = branchId;
        BusinessDate = businessDate;
        Set(openingBalance, cashIncome, cashExpense, countedCash, note);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public DateOnly BusinessDate { get; private set; }
    /// <summary>Devir — bir önceki günden kalan nakit.</summary>
    public decimal OpeningBalance { get; private set; }
    /// <summary>Günün nakit tahsilatı (snapshot).</summary>
    public decimal CashIncome { get; private set; }
    /// <summary>Günün nakit gideri (snapshot).</summary>
    public decimal CashExpense { get; private set; }
    /// <summary>Kasiyerin saydığı fiziki nakit.</summary>
    public decimal CountedCash { get; private set; }
    public string? Note { get; private set; }

    /// <summary>Sistemin beklediği kasa nakdi = açılış + nakit gelir − nakit gider.</summary>
    public decimal SystemCash => OpeningBalance + CashIncome - CashExpense;
    /// <summary>Sayım farkı = sayılan − sistem (pozitif: fazla, negatif: eksik).</summary>
    public decimal Difference => CountedCash - SystemCash;

    public void Set(decimal openingBalance, decimal cashIncome, decimal cashExpense, decimal countedCash, string? note)
    {
        OpeningBalance = openingBalance;
        CashIncome = cashIncome;
        CashExpense = cashExpense;
        CountedCash = countedCash;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        Touch();
    }
}
