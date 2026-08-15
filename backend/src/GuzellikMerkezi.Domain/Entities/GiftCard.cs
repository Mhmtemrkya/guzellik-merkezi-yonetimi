using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Hediye çeki / kupon kodu. Üç tür: yüzde indirim, sabit tutar indirim ve yüklü bakiye (hediye çeki).
/// Kod tenant içinde benzersizdir; satış/adisyon akışında koda göre doğrulanıp uygulanır.
/// </summary>
public sealed class GiftCard : Entity
{
    private GiftCard() { }

    public GiftCard(
        Guid tenantId,
        Guid? branchId,
        string code,
        GiftCardKind kind,
        decimal value,
        DateTime? validUntilUtc,
        int maxUses,
        string? note,
        Guid? customerId,
        DateTime? validFromUtc = null,
        string? scopeLabel = null,
        string? recipientName = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        SetCode(code);
        SetValue(kind, value);
        // Hediye çekinde başlangıç bakiyesi = yüklenen değer; kuponlarda bakiye kullanılmaz.
        Balance = kind == GiftCardKind.StoredValue ? value : 0m;
        SetValidity(validFromUtc, validUntilUtc);
        MaxUses = maxUses < 0 ? 0 : maxUses;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        CustomerId = customerId;
        ScopeLabel = Clean(scopeLabel);
        RecipientName = Clean(recipientName);
        IsActive = true;
    }

    public Guid TenantId { get; private set; }
    public Guid? BranchId { get; private set; }
    public string Code { get; private set; } = string.Empty;
    public GiftCardKind Kind { get; private set; }
    /// <summary>Yüzde/sabit tutar veya hediye çekinin yüklü değeri.</summary>
    public decimal Value { get; private set; }
    /// <summary>Hediye çekinde kalan bakiye (kuponlarda 0).</summary>
    public decimal Balance { get; private set; }
    /// <summary>
    /// Geçerlilik BAŞLANGICI (opsiyonel). Oluşturulma tarihiyle KARIŞTIRILMAMALIDIR: çek bugün
    /// basılıp gelecek bir kampanya için ileri tarihli verilebilir. Boşsa kısıt yoktur.
    /// </summary>
    public DateTime? ValidFromUtc { get; private set; }
    public DateTime? ValidUntilUtc { get; private set; }
    /// <summary>0 = sınırsız kullanım.</summary>
    public int MaxUses { get; private set; }
    public int UsedCount { get; private set; }
    public bool IsActive { get; private set; } = true;
    public string? Note { get; private set; }
    /// <summary>Belirli bir müşteriye atanmışsa (opsiyonel).</summary>
    public Guid? CustomerId { get; private set; }
    /// <summary>
    /// Çekin kapsamı — basılı kartta "geçerli <b>El ve Ayak Bakım</b> çekidir" diye yazılır.
    /// SERBEST METİNDİR, hizmet kaydına bağlı değildir: kurum "Tüm hizmetler" de yazabilir.
    /// `Note`tan ayrıdır; Note iç kayıt notu, bu ise müşterinin gördüğü ibaredir.
    /// </summary>
    public string? ScopeLabel { get; private set; }
    /// <summary>Kartın üzerine basılan alıcı adı ("Bu çek, ... size"). Boşsa elle yazılmak üzere boş bırakılır.</summary>
    public string? RecipientName { get; private set; }

    public void SetCode(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) throw new DomainException("Kod boş olamaz.");
        Code = code.Trim().ToUpperInvariant();
        Touch();
    }

    public void SetValue(GiftCardKind kind, decimal value)
    {
        if (value <= 0) throw new DomainException("Değer pozitif olmalı.");
        if (kind == GiftCardKind.Percentage && value > 100) throw new DomainException("Yüzde indirim 100'ü aşamaz.");
        Kind = kind;
        Value = value;
        Touch();
    }

    /// <summary>
    /// Bugün için geçerli mi (aktif, süresi dolmamış, HENÜZ BAŞLAMAMIŞ DEĞİL, kullanım hakkı var,
    /// hediye çekinde bakiye var)?
    /// </summary>
    public bool IsValid(DateTime nowUtc) =>
        IsActive
        && (!ValidFromUtc.HasValue || ValidFromUtc.Value <= nowUtc)
        && (!ValidUntilUtc.HasValue || ValidUntilUtc.Value >= nowUtc)
        && (MaxUses <= 0 || UsedCount < MaxUses)
        && (Kind != GiftCardKind.StoredValue || Balance > 0m);

    /// <summary>Verilen fiyata uygulanacak indirim tutarı (fiyatı aşmaz).</summary>
    public decimal DiscountFor(decimal price) => Kind switch
    {
        GiftCardKind.Percentage => Math.Round(price * Value / 100m, 2, MidpointRounding.AwayFromZero),
        GiftCardKind.FixedAmount => Math.Min(price, Value),
        GiftCardKind.StoredValue => Math.Min(price, Balance),
        _ => 0m,
    };

    /// <summary>Kuponu/çeki kullan: hediye çekinde bakiye düşer, kuponlarda kullanım sayısı artar.</summary>
    public void Redeem(decimal amount, DateTime nowUtc)
    {
        if (!IsValid(nowUtc)) throw new DomainException("Kod geçerli değil (pasif, süresi dolmuş, hakkı bitmiş veya bakiyesi yok).");
        if (Kind == GiftCardKind.StoredValue)
        {
            if (amount <= 0) throw new DomainException("Harcanacak tutar pozitif olmalı.");
            if (amount > Balance) throw new DomainException("Hediye çeki bakiyesi yetersiz.");
            Balance -= amount;
        }
        UsedCount += 1;
        Touch();
    }

    /// <summary>Redeem'i geri alır (adisyon geri alma): hediye çekinde bakiye iade edilir, kullanım sayısı azaltılır.</summary>
    public void UndoRedeem(decimal amount)
    {
        if (Kind == GiftCardKind.StoredValue && amount > 0) Balance += amount;
        if (UsedCount > 0) UsedCount -= 1;
        Touch();
    }

    public void SetActive(bool active) { IsActive = active; Touch(); }

    public void SetNote(string? note)
    {
        Note = Clean(note);
        Touch();
    }

    /// <summary>Kartın üzerine basılan kapsam ve alıcı bilgisi (ikisi de opsiyonel).</summary>
    public void SetPrintDetails(string? scopeLabel, string? recipientName)
    {
        ScopeLabel = Clean(scopeLabel);
        RecipientName = Clean(recipientName);
        Touch();
    }

    /// <summary>Geçerlilik penceresi. Ters aralık kullanıcı hatasıdır, hata mesajı değil düzeltme hak eder.</summary>
    public void SetValidity(DateTime? fromUtc, DateTime? untilUtc)
    {
        if (fromUtc.HasValue && untilUtc.HasValue && fromUtc.Value > untilUtc.Value)
            (fromUtc, untilUtc) = (untilUtc, fromUtc);
        ValidFromUtc = fromUtc;
        ValidUntilUtc = untilUtc;
        Touch();
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
