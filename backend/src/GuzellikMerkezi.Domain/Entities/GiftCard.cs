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
        string? recipientName = null,
        Guid? serviceDefinitionId = null,
        Guid? servicePackageId = null,
        Guid? productId = null)
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
        SetCatalogTarget(serviceDefinitionId, servicePackageId, productId);
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

    /*
     * KATALOG BAĞI (opsiyonel). <see cref="ScopeLabel"/> kartın üzerine BASILAN metindir;
     * bunlar ise makinenin anladığı bağdır: satış ekranı müşterinin çekini görünce doğru
     * hizmeti/paketi kendiliğinden seçebilsin diye. Serbest metinden hizmet eşleştirmeye
     * çalışmak ("El ve Ayak Bakım" ≟ "El & Ayak Bakımı") kırılgan olurdu.
     *
     * EN FAZLA BİRİ DOLU OLABİLİR: bir çek ya bir hizmete, ya bir pakete, ya bir ürüne bağlıdır.
     */
    public Guid? ServiceDefinitionId { get; private set; }
    public Guid? ServicePackageId { get; private set; }
    /// <summary>
    /// Çekin bağlandığı ürün (varsa). Ürün satışı da adisyona kalem olarak girdiği için kısıt
    /// aynı yerden uygulanır; "yalnız şu şampuan için geçerli" çekleri kataloğa bağlar.
    /// </summary>
    public Guid? ProductId { get; private set; }

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

    /// <summary>
    /// Kartın BU KULLANIMDA geçerli olup olmadığı — engel varsa sebebi, yoksa <c>null</c>.
    ///
    /// <para>KISITLAR KAYITTA DEĞİL KULLANIMDA ANLAM KAZANIR. <see cref="CustomerId"/>,
    /// <see cref="BranchId"/> ve katalog hedefi kart üzerinde yazılıydı ama kullanım anında
    /// hiç okunmuyordu: A müşterisine, A şubesine ve X paketine bağlı bir çek, B müşterisinin
    /// Y paketi satışında sorunsuz harcanabiliyordu. Bu, kurumlar arası değil ama MÜŞTERİLER
    /// ARASI parasal değer aktarımıdır.</para>
    ///
    /// <para><paramref name="itemRefIds"/> adisyondaki hizmet/paket/ürün kalemlerinin katalog
    /// kimlikleridir; kart bir kaleme bağlıysa o kalem fişte BULUNMALIDIR.</para>
    /// </summary>
    public string? UsageProblemFor(
        DateTime nowUtc,
        Guid customerId,
        Guid? branchId,
        IReadOnlyCollection<Guid> itemRefIds)
    {
        if (!IsValid(nowUtc))
            return "Kod geçerli değil (pasif, süresi dolmuş, hakkı bitmiş veya bakiyesi yok).";

        if (CustomerId.HasValue && CustomerId.Value != customerId)
            return "Bu kart başka bir müşteriye tanımlı.";

        // Kart bir şubeye bağlıysa yalnız o şubede geçerlidir. Şubesiz kart (null) kurum geneli.
        if (BranchId.HasValue && branchId.HasValue && BranchId.Value != branchId.Value)
            return "Bu kart başka bir şubeye tanımlı.";

        var target = ServiceDefinitionId ?? ServicePackageId ?? ProductId;
        if (target.HasValue && !itemRefIds.Contains(target.Value))
            return "Bu kart yalnızca tanımlı olduğu hizmet/paket/ürün satışında kullanılabilir.";

        return null;
    }

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

    /// <summary>Kullanım hakkı (0 = sınırsız). Negatif değer sınırsız sayılır.</summary>
    public void SetMaxUses(int maxUses)
    {
        MaxUses = maxUses < 0 ? 0 : maxUses;
        Touch();
    }

    /// <summary>
    /// Kartın bağlı müşterisi — düzeltme ucu için. <c>null</c> bağı KALDIRIR (kart tekrar
    /// taşıyıcıya ait olur). Devir kuralı (kullanılmış kart devredilemez) servis katmanındadır;
    /// burada tek başına bir hak kontrolü yapılmaz çünkü "bağı kaldırma" da meşru bir düzeltmedir.
    /// </summary>
    public void SetCustomer(Guid? customerId)
    {
        CustomerId = customerId;
        Touch();
    }

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

    /// <summary>
    /// Geçerlilik penceresi.
    ///
    /// <para>TERS ARALIK REDDEDİLİR, sessizce takas EDİLMEZ. Takas, operatörün girdiğinden
    /// FARKLI bir hak kaydeder: "1 Ocak–1 Şubat" yerine yanlışlıkla "1 Şubat–1 Ocak" yazan
    /// kullanıcı, düzeltilmiş bir kart alır ve yanlışını hiç görmez. Kartlar basılıp müşteriye
    /// verildiği için bu, sonradan düzeltilemeyen bir kayıttır.</para>
    /// </summary>
    public void SetValidity(DateTime? fromUtc, DateTime? untilUtc)
    {
        if (fromUtc.HasValue && untilUtc.HasValue && fromUtc.Value > untilUtc.Value)
            throw new DomainException("Geçerlilik başlangıcı bitişten sonra olamaz.");
        ValidFromUtc = fromUtc;
        ValidUntilUtc = untilUtc;
        Touch();
    }

    /// <summary>Çekin bağlandığı katalog kaydı. Birden fazlası verilirse hata — bir çek TEK şeye bağlanır.</summary>
    public void SetCatalogTarget(Guid? serviceDefinitionId, Guid? servicePackageId, Guid? productId = null)
    {
        var filled = (serviceDefinitionId.HasValue ? 1 : 0) + (servicePackageId.HasValue ? 1 : 0) + (productId.HasValue ? 1 : 0);
        if (filled > 1)
            throw new DomainException("Hediye çeki yalnız bir hizmete, bir pakete VEYA bir ürüne bağlanabilir.");
        ServiceDefinitionId = serviceDefinitionId;
        ServicePackageId = servicePackageId;
        ProductId = productId;
        Touch();
    }

    /*
     * KOD DEĞİŞTİRİLEMEZ — bilerek `SetCode` public kalsa da düzeltme ucundan ÇAĞRILMAZ.
     *
     * Kart basılıp müşterinin eline geçer; üstündeki QR o kodu kalıcı olarak kodlar. Kodu
     * değiştirmek, dolaşımdaki her kartı tek hamlede geçersiz kılar ve müşteri elindeki kâğıdın
     * neden çalışmadığını asla öğrenemez. Yanlış kod için doğru yol: kartı pasifleştirip yenisini
     * basmaktır. Aynı gerekçeyle Kind/Value de kullanılmış kartta değiştirilemez (bkz. GiftCardService).
     */

    /// <summary>
    /// Çeki bir müşteriye bağlar (QR okutup eşleştirme). Zaten BAŞKA bir müşteriye bağlıysa
    /// sessizce üzerine yazılmaz: kart yanlışlıkla başkasının hesabına geçmemeli.
    /// </summary>
    public void AssignCustomer(Guid customerId, bool allowReassign)
    {
        if (CustomerId.HasValue && CustomerId.Value != customerId && !allowReassign)
            throw new DomainException("Bu kart zaten başka bir müşteriye tanımlı.");
        CustomerId = customerId;
        Touch();
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
