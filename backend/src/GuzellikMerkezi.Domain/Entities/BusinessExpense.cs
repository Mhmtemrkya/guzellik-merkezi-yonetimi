using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// İşletme gideri. Personel maaşı, kira, sarf, fatura vb. tüm para çıkışları burada toplanır.
/// Gelir-gider raporlarının "gider" ayağını oluşturur.
/// </summary>
public sealed class BusinessExpense : Entity
{
    private BusinessExpense() { }

    /// <summary>
    /// GEÇERSİZ KILINAN GİDERİN KARŞI KAYDI (ters hareket).
    ///
    /// <para>
    /// SOMUT AÇIK: iptal yalnızca damga koyuyor ve okuma yolları geçersiz satırı SÜZÜYORDU. Bu,
    /// GERÇEKLEŞMİŞ bir kasa çıkışını geçmişten silmek demekti: geçen ayın kârı bugün değişiyor,
    /// o güne ait kasa kapanışı artık defterle tutmuyordu. Muhasebede kapanmış dönem yeniden
    /// yazılmaz; düzeltme, YAPILDIĞI döneme ters kayıt olarak girer.
    /// </para>
    /// <para>
    /// Karşı kayıt NEGATİF tutarlıdır: mevcut tüm toplamlar (kasa akışı, kâr-zarar, rapor) hiçbir
    /// değişiklik gerektirmeden doğru neti üretir — her okuma yerine "iptali süz" kuralı eklemek
    /// zorunda kalsaydık biri unutulur ve rakamlar yine ayrışırdı.
    /// </para>
    /// </summary>
    public static BusinessExpense CreateReversal(BusinessExpense original, DateTime atUtc, string reason)
    {
        var reversal = new BusinessExpense
        {
            TenantId = original.TenantId,
            BranchId = original.BranchId,
            Category = original.Category,
            Amount = -original.Amount,          // SetAmount atlanır: ters kayıt bilinçli olarak negatiftir
            PaymentMethod = original.PaymentMethod,
            StaffMemberId = original.StaffMemberId,
            PeriodLabel = original.PeriodLabel,
            Reference = original.Reference,
            Description = $"İPTAL DÜZELTMESİ · {original.Description ?? original.Category.ToString()} · {reason}",
            ReversalOfExpenseId = original.Id,
            IsApproved = true,                  // düzeltme gerçekleşmiştir; onay beklemez
        };
        reversal.SetOccurredAt(atUtc);          // düzeltme YAPILDIĞI döneme yazılır
        return reversal;
    }

    public BusinessExpense(
        Guid tenantId,
        Guid? branchId,
        ExpenseCategory category,
        decimal amount,
        DateTime occurredAtUtc,
        ExpensePaymentMethod paymentMethod = ExpensePaymentMethod.Cash,
        string? description = null,
        Guid? staffMemberId = null,
        string? periodLabel = null,
        string? reference = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        Category = category;
        SetAmount(amount);
        SetOccurredAt(occurredAtUtc);
        PaymentMethod = paymentMethod;
        StaffMemberId = staffMemberId;
        PeriodLabel = string.IsNullOrWhiteSpace(periodLabel) ? null : periodLabel.Trim();
        Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Branch? Branch { get; private set; }

    public ExpenseCategory Category { get; private set; }
    public decimal Amount { get; private set; }
    public ExpensePaymentMethod PaymentMethod { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }

    /// <summary>Personel maaşı/avans/prim kayıtlarında ilgili personel</summary>
    public Guid? StaffMemberId { get; private set; }
    public StaffMember? StaffMember { get; private set; }

    /// <summary>Hangi dönemi kapsadığı (örn. "2026-05" veya "Mayıs 2026")</summary>
    public string? PeriodLabel { get; private set; }

    /// <summary>Açıklama (Cilt bakım ürünleri, Elektrik faturası gibi)</summary>
    public string? Description { get; private set; }

    /// <summary>Fiş, fatura veya dekont numarası</summary>
    public string? Reference { get; private set; }

    public bool IsApproved { get; private set; }
    public DateTime? ApprovedAtUtc { get; private set; }

    /// <summary>
    /// Gideri günceller. FİNANSAL OLARAK ANLAMLI bir alan değiştiyse (tutar, tarih, kategori,
    /// ödeme yöntemi, ilgili personel) onay DÜŞER ve kayıt yeniden onay bekler.
    /// <para>
    /// Neden: onaylı gider kasa akışına, kâr-zarara ve gider özetine dahil edilir; onay sonrası
    /// tutar serbestçe değiştirilebildiği için onaylanmış 100 TL'lik bir kalem, yeniden onaya
    /// düşmeden 10.000 TL yapılabiliyordu. Onay "bu rakamı gördüm ve kabul ettim" demektir;
    /// rakam değişince onayın da tazelenmesi gerekir. Açıklama/dönem/fiş no gibi metin alanları
    /// tutarı etkilemediği için onayı düşürmez.
    /// </para>
    /// </summary>
    /// <returns>Bu güncelleme mevcut bir onayı düşürdüyse <c>true</c>.</returns>
    public bool Update(
        ExpenseCategory category,
        decimal amount,
        DateTime occurredAtUtc,
        ExpensePaymentMethod paymentMethod,
        string? description,
        Guid? staffMemberId,
        string? periodLabel,
        string? reference)
    {
        var materialChange =
            Category != category
            || Amount != amount
            || OccurredAtUtc != NormalizeUtc(occurredAtUtc)
            || PaymentMethod != paymentMethod
            || StaffMemberId != staffMemberId;

        Category = category;
        SetAmount(amount);
        SetOccurredAt(occurredAtUtc);
        PaymentMethod = paymentMethod;
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        StaffMemberId = staffMemberId;
        PeriodLabel = string.IsNullOrWhiteSpace(periodLabel) ? null : periodLabel.Trim();
        Reference = string.IsNullOrWhiteSpace(reference) ? null : reference.Trim();

        var approvalDropped = IsApproved && materialChange;
        if (approvalDropped)
        {
            IsApproved = false;
            ApprovedAtUtc = null;
        }

        Touch();
        return approvalDropped;
    }

    /// <summary>
    /// GEÇERSİZ KILMA (void) — gerçekleşmiş sayılan bir giderin, aslında olmadığının kaydı.
    ///
    /// <para>
    /// Onaylanmış gider SİLİNEMEZ (bkz. ExpenseService.DeleteAsync): soft-delete kaydı global
    /// süzgeçle gizliyor, kasa akışı ve kâr-zarar o parayı bir daha görmüyordu — kim, ne zaman,
    /// hangi gerekçeyle kaldırdı bilgisi de yoktu. Void bunun yerine KALICI iz bırakır: satır
    /// durur, gerekçe ve sorumlu yazılır, tutar muhasebe toplamlarından bu kayıtla birlikte düşer.
    /// </para>
    /// </summary>
    public void Void(string reason, Guid? voidedByUserId, DateTime? voidedAtUtc = null)
    {
        if (string.IsNullOrWhiteSpace(reason))
            throw new DomainException("Gideri geçersiz kılmak için gerekçe zorunludur.");
        if (VoidedAtUtc is not null) throw new DomainException("Bu gider zaten geçersiz kılınmış.");

        var at = voidedAtUtc ?? DateTime.UtcNow;
        VoidedAtUtc = at.Kind == DateTimeKind.Utc ? at : DateTime.SpecifyKind(at, DateTimeKind.Utc);
        VoidedByUserId = voidedByUserId;
        VoidReason = reason.Trim();
        Touch();
    }

    /// <summary>
    /// Geçersiz kılındıysa dolu. Satır ve TUTARI yerinde kalır (gerçekleşmiş kasa çıkışıdır);
    /// etkisini iptal eden ayrı bir ters kayıt yazılır (bkz. <see cref="CreateReversal"/>).
    /// </summary>
    public DateTime? VoidedAtUtc { get; private set; }

    /// <summary>
    /// Bu satır bir İPTAL DÜZELTMESİ ise, düzelttiği asıl giderin kimliği. Ters kayıtlar negatif
    /// tutarlıdır ve iptalin YAPILDIĞI döneme yazılır.
    /// </summary>
    public Guid? ReversalOfExpenseId { get; private set; }

    /// <summary>Bu satır bir ters kayıt mı?</summary>
    public bool IsReversal => ReversalOfExpenseId is not null;
    public Guid? VoidedByUserId { get; private set; }
    public string? VoidReason { get; private set; }

    public void Approve()
    {
        if (IsApproved) return;
        IsApproved = true;
        ApprovedAtUtc = DateTime.UtcNow;
        Touch();
    }

    public void Revoke()
    {
        if (!IsApproved) return;
        IsApproved = false;
        ApprovedAtUtc = null;
        Touch();
    }

    private void SetAmount(decimal amount)
    {
        if (amount <= 0) throw new DomainException("Gider tutarı pozitif olmalı.");
        Amount = amount;
    }

    private void SetOccurredAt(DateTime occurredAtUtc) => OccurredAtUtc = NormalizeUtc(occurredAtUtc);

    private static DateTime NormalizeUtc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
