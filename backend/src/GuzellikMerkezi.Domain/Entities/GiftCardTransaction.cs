using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// HEDİYE ÇEKİ HAREKET DEFTERİ — çekin bakiyesinde/kullanım hakkında olan her değişimin kaydı.
///
/// <para>
/// SOMUT AÇIK: <see cref="GiftCard"/> yalnız SON DURUMU taşıyordu (kalan bakiye + kullanım sayısı).
/// "Bu çekin 500 ₺'si nereye gitti", "hangi adisyonda harcandı", "iptalde gerçekten geri geldi mi"
/// sorularının tek cevabı yoktu; bakiye ile gerçeklik ayrışırsa (yarım kalan iptal, elle düzeltme,
/// eşzamanlı yazma) bunu fark etmenin bir yolu da yoktu. Çek gerçek bir parasal yükümlülüktür —
/// tahsilat ve iade nasıl kendi defterine yazılıyorsa (bkz. <see cref="RefundTransaction"/>),
/// çek kullanımı da yazılmalıdır.
/// </para>
///
/// <para>
/// DEFTER EKLENİR, DÜZELTİLMEZ: geri alma (iptal) yeni bir satır olarak yazılır, eski satır silinmez.
/// Değişmez: <c>Σ BalanceDelta == Balance − Value</c> ve <c>Σ UsesDelta == UsedCount</c>.
/// </para>
/// </summary>
public sealed class GiftCardTransaction : Entity
{
    private GiftCardTransaction() { }

    public GiftCardTransaction(
        Guid tenantId,
        Guid? branchId,
        Guid giftCardId,
        string direction,
        decimal amount,
        decimal balanceDelta,
        int usesDelta,
        decimal balanceAfter,
        int usedCountAfter,
        string sourceType,
        Guid? sourceId,
        Guid? customerId,
        Guid? performedByUserId,
        DateTime occurredAtUtc)
    {
        if (amount < 0) throw new DomainException("Hareket tutarı negatif olamaz.");
        if (string.IsNullOrWhiteSpace(direction)) throw new DomainException("Hareket yönü boş olamaz.");

        TenantId = tenantId;
        BranchId = branchId;
        GiftCardId = giftCardId;
        Direction = direction.Trim();
        Amount = amount;
        BalanceDelta = balanceDelta;
        UsesDelta = usesDelta;
        BalanceAfter = balanceAfter;
        UsedCountAfter = usedCountAfter;
        SourceType = string.IsNullOrWhiteSpace(sourceType) ? "Unknown" : sourceType.Trim();
        SourceId = sourceId;
        CustomerId = customerId;
        PerformedByUserId = performedByUserId;
        OccurredAtUtc = occurredAtUtc.Kind == DateTimeKind.Utc
            ? occurredAtUtc
            : DateTime.SpecifyKind(occurredAtUtc, DateTimeKind.Utc);
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public Guid GiftCardId { get; private set; }

    /// <summary>"Redeem" (harcama) veya "Undo" (geri alma).</summary>
    public string Direction { get; private set; } = string.Empty;

    /// <summary>Hareketin konusu olan indirim tutarı — HER ZAMAN POZİTİF, yön ayrı alandadır.</summary>
    public decimal Amount { get; private set; }

    /// <summary>
    /// Bakiyedeki gerçek değişim (harcamada negatif, geri almada pozitif). Kupon türlerinde
    /// bakiye kullanılmadığı için 0'dır — tutar yine <see cref="Amount"/>'ta görünür.
    /// </summary>
    public decimal BalanceDelta { get; private set; }

    /// <summary>Kullanım sayacındaki değişim (+1 / −1).</summary>
    public int UsesDelta { get; private set; }

    /// <summary>Hareket sonrası bakiye ve kullanım sayısı — defter tek başına okunabilsin diye.</summary>
    public decimal BalanceAfter { get; private set; }
    public int UsedCountAfter { get; private set; }

    /// <summary>"Adisyon" | "Direct" — hareketin hangi akıştan geldiği.</summary>
    public string SourceType { get; private set; } = string.Empty;

    /// <summary>Kaynak kayıt (adisyon kimliği); doğrudan kullanımda boştur.</summary>
    public Guid? SourceId { get; private set; }

    /// <summary>Hareketin yapıldığı müşteri (biliniyorsa) — çekin kime yaradığının izi.</summary>
    public Guid? CustomerId { get; private set; }

    public Guid? PerformedByUserId { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
}
