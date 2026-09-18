using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class Customer : Entity
{
    private Customer() { }

    public Customer(Guid tenantId, Guid branchId, string fullName, string phone, string? email = null)
    {
        TenantId = tenantId;
        BranchId = branchId;
        UpdateContact(fullName, phone, email);
    }

    public Guid TenantId { get; private set; }
    public Guid BranchId { get; private set; }
    public Branch? Branch { get; private set; }
    public string FullName { get; private set; } = string.Empty;
    public string Phone { get; private set; } = string.Empty;
    public string? Email { get; private set; }
    public DateOnly? BirthDate { get; private set; }
    public Gender Gender { get; private set; }
    public bool KvkkConsent { get; private set; }
    public string? Notes { get; private set; }
    /// <summary>Müşteri fotoğrafı (data-URL/base64) — liste ve kartlarda görünür.</summary>
    public string? PhotoUrl { get; private set; }

    /// <summary>Kara liste — true ise bu müşteriye randevu oluşturulamaz.</summary>
    public bool IsBlacklisted { get; private set; }
    public string? BlacklistReason { get; private set; }
    public DateTime? BlacklistedAtUtc { get; private set; }

    /// <summary>VIP müşteri etiketi — listede rozet ve VIP filtresi için.</summary>
    public bool IsVip { get; private set; }

    /// <summary>Online portal son giriş zamanı (ad+soyad+telefon+doğum tarihi eşleşmesi ile giriş).</summary>
    public DateTime? LastLoginUtc { get; private set; }

    /// <summary>
    /// Ad/telefon/e-posta üzerinde SQL araması yapabilmek için anahtarlı hash (blind index) — <c>|hash|hash|</c>.
    /// Düz metin İÇERMEZ. Elle set edilmez: <c>GuzellikDbContext.SaveChangesAsync</c> her ekleme/güncellemede
    /// <c>ISearchIndexService</c> ile yeniden üretir, böylece hiçbir kod yolu indeksi güncellemeyi unutamaz.
    /// </summary>
    public string? SearchIndex { get; private set; }

    /// <summary>Yalnızca altyapı (DbContext + backfill) tarafından çağrılır; iş kuralı taşımaz.</summary>
    public void SetSearchIndex(string? value) => SearchIndex = value;

    public void SetVip(bool isVip)
    {
        IsVip = isVip;
        Touch();
    }

    public void Blacklist(string? reason)
    {
        IsBlacklisted = true;
        BlacklistReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        BlacklistedAtUtc = DateTime.UtcNow;
        Touch();
    }

    public void RemoveFromBlacklist()
    {
        IsBlacklisted = false;
        BlacklistReason = null;
        BlacklistedAtUtc = null;
        Touch();
    }

    public void UpdateContact(string fullName, string phone, string? email)
    {
        if (string.IsNullOrWhiteSpace(fullName)) throw new DomainException("Müşteri adı boş olamaz.");
        if (string.IsNullOrWhiteSpace(phone)) throw new DomainException("Telefon boş olamaz.");
        FullName = fullName.Trim();
        Phone = phone.Trim();
        Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
        Touch();
    }

    public void UpdateProfile(DateOnly? birthDate, Gender gender, bool kvkkConsent, string? notes)
    {
        BirthDate = birthDate;
        Gender = gender;
        KvkkConsent = kvkkConsent;
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        Touch();
    }

    public void SetPhoto(string? photoUrl)
    {
        PhotoUrl = string.IsNullOrWhiteSpace(photoUrl) ? null : photoUrl.Trim();
        Touch();
    }

    public void AssignBranch(Guid branchId)
    {
        if (branchId == Guid.Empty) throw new DomainException("Şube seçimi zorunlu.");
        BranchId = branchId;
        Touch();
    }

    public void RecordLogin(DateTime utcNow)
    {
        LastLoginUtc = utcNow;
        Touch(utcNow);
    }

    /// <summary>Kimlik bilgileri silindiği an. <c>null</c> ise kayıt normaldir.</summary>
    public DateTime? AnonymizedAtUtc { get; private set; }

    /// <summary>Kaydı anonimleştirdikten sonra gösterilecek ad.</summary>
    public const string AnonymizedName = "Silinmiş müşteri";

    /// <summary>
    /// KİŞİSEL VERİYİ SİLER, KAYDI BIRAKIR.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden satır silinmiyor?</b> Müşteri satırı randevu, adisyon, cari hesap, tahsilat ve
    /// paket seansının bağlandığı düğümdür. Satırı silmek, kapanmış bir kasanın toplamını ve
    /// tahsilat defterini dayanaksız bırakır — muhasebe bütünlüğü bozulur ve yasal saklama
    /// süresi dolmadan finansal kayıt yok edilmiş olur.
    /// </para>
    /// <para>
    /// Bu yüzden silinen şey KİŞİYE AİT OLANDIR: ad, telefon, e-posta, doğum tarihi, cinsiyet,
    /// notlar, fotoğraf ve arama indeksi. Geriye kimseye bağlanamayan bir işlem kaydı kalır.
    /// Telefon ve e-posta BOŞALTILIR: ikisi de giriş kimliğidir ve boş değer kimlik aramasının
    /// alt sınırını geçemez, yani bu kayıtla bir daha giriş yapılamaz.
    /// </para>
    /// <para>
    /// KVKK onayı da düşürülür: onay belirli bir kişinin beyanıdır, kimliği silinmiş bir satırda
    /// "onay var" demek anlamsızdır.
    /// </para>
    /// </remarks>
    public void Anonymize(DateTime utcNow)
    {
        if (AnonymizedAtUtc.HasValue) return; // idempotent: ikinci çağrı bir şey değiştirmez

        FullName = AnonymizedName;
        Phone = string.Empty;
        Email = null;
        BirthDate = null;
        Gender = Gender.Unspecified;
        KvkkConsent = false;
        Notes = null;
        PhotoUrl = null;
        SearchIndex = null;
        AnonymizedAtUtc = utcNow;

        // Kayıt artık giriş yapamaz; kara liste bayrağının da anlamı kalmaz.
        IsBlacklisted = false;
        BlacklistReason = null;
        BlacklistedAtUtc = null;

        Touch(utcNow);
    }
}
