using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// KURUMUN KENDİ SMS HESABI (Verimor / Netgsm) — kurumun numarası/başlığı. Bağlantıyı PLATFORM
/// (BeautyAsist) kurar ve yönetir; kurum yalnız durumu görür (WhatsApp bağlantısıyla aynı model).
///
/// <para>
/// Bağlantı ETKİNKEN kurumun müşteri SMS'leri (şablonlu gönderimler, hatırlatmalar, değerlendirme
/// linki, bekleme listesi, KVKK, hediye çeki) bu hesaptan, kurumun başlığıyla gider. Ücreti kurumun
/// sağlayıcısı keser: BeautyAsist paket kotası ve mesaj kredisi DÜŞMEZ. Platformun kendi
/// maliyetindeki SMS'ler (müşteri giriş kodu, kurum kaydı doğrulaması) bu hesaptan GEÇMEZ.
/// </para>
///
/// <para>
/// <b>Etkinlik = açık + doğrulanmış.</b> Kayıt tek başına yetmez: bilgiler bir test SMS'iyle
/// doğrulanana kadar gönderim platform altyapısından devam eder. Sağlayıcı, kullanıcı adı, parola
/// ya da başlık değişirse doğrulama SIFIRLANIR — eski test yeni hesabı kanıtlamaz. Doğrulanmış
/// hesabın sonraki bir testi başarısız olursa doğrulama KALIR (bilgiler aynı; hata geçici olabilir:
/// bakiye, IP izni). Aksi hâlde kurumun SMS'leri sessizce platforma dönüp krediden düşerdi.
/// </para>
///
/// <para>
/// <see cref="Username"/> ve <see cref="Password"/> veritabanında ŞİFRELİ tutulur (DbContext
/// şifreleme kaydı). Parola hiçbir yanıtta istemciye dönmez; kullanıcı adı yalnız son dört
/// hanesiyle (<see cref="UsernameHint"/>) gösterilir.
/// </para>
/// </summary>
public sealed class TenantSmsConnection : Entity
{
    public const string Verimor = "Verimor";
    public const string Netgsm = "Netgsm";

    /// <summary>Desteklenen sağlayıcılar. Adresleri kodda sabittir — kurumdan URL alınmaz (SSRF).</summary>
    public static readonly IReadOnlyList<string> SupportedProviders = [Verimor, Netgsm];

    private TenantSmsConnection() { }

    public TenantSmsConnection(Guid tenantId, string provider, string username, string password, string sender, bool enabled)
    {
        TenantId = tenantId;
        Provider = CanonicalProvider(provider);
        Username = username.Trim();
        UsernameHint = Hint(Username);
        Password = password.Trim();
        Sender = sender.Trim();
        Enabled = enabled;
    }

    public Guid TenantId { get; private set; }

    /// <summary>"Verimor" ya da "Netgsm".</summary>
    public string Provider { get; private set; } = Verimor;

    /// <summary>Verimor: 12 haneli abone numarası (90850…); Netgsm: kullanıcı kodu. ŞİFRELİ.</summary>
    public string Username { get; private set; } = string.Empty;

    /// <summary>Sağlayıcı API parolası. ŞİFRELİ — istemciye asla dönmez.</summary>
    public string Password { get; private set; } = string.Empty;

    /// <summary>Kullanıcı adının gösterim ipucu (son 4 hane), ör. "•••• 8425".</summary>
    public string UsernameHint { get; private set; } = string.Empty;

    /// <summary>Gönderici: BTK'da kayıtlı alfasayısal başlık ("SALONUM") ya da numara.</summary>
    public string Sender { get; private set; } = string.Empty;

    /// <summary>Kurumun "SMS'leri bu hesaptan gönder" anahtarı.</summary>
    public bool Enabled { get; private set; }

    /// <summary>Mevcut bilgilerle başarılı test SMS'inin zamanı; null = doğrulanmadı.</summary>
    public DateTime? VerifiedAtUtc { get; private set; }

    public DateTime? LastTestAtUtc { get; private set; }

    /// <summary>Son test SMS'inin sağlayıcı hatası (başarılıysa boş).</summary>
    public string? LastError { get; private set; }

    /// <summary>Gönderim bu hesaptan mı yapılır? (açık + doğrulanmış)</summary>
    public bool IsActive => Enabled && VerifiedAtUtc is not null && !IsDeleted;

    /// <summary>
    /// Bilgileri günceller. Boş kullanıcı adı/parola MEVCUDU KORUR (istemci kayıtlı parolayı
    /// bilmez, yalnız değiştirmek isterse yazar). Herhangi bir kimlik bilgisi değişirse doğrulama sıfırlanır.
    /// </summary>
    /// <returns>Kimlik bilgisi değişti mi (yeniden test gerekir mi)?</returns>
    public bool Update(string provider, string? username, string? password, string sender, bool enabled)
    {
        var changed = false;

        var p = CanonicalProvider(provider);
        if (!string.Equals(p, Provider, StringComparison.Ordinal)) { Provider = p; changed = true; }

        if (!string.IsNullOrWhiteSpace(username) && !string.Equals(username.Trim(), Username, StringComparison.Ordinal))
        {
            Username = username.Trim();
            UsernameHint = Hint(Username);
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(password) && !string.Equals(password.Trim(), Password, StringComparison.Ordinal))
        {
            Password = password.Trim();
            changed = true;
        }

        var s = sender.Trim();
        if (!string.Equals(s, Sender, StringComparison.Ordinal)) { Sender = s; changed = true; }

        if (changed)
        {
            VerifiedAtUtc = null;
            LastError = null;
        }
        Enabled = enabled;
        return changed;
    }

    /// <summary>Test başladı — damga sağlayıcıdan ÖNCE yazılır ki bekleme süresi çift gönderimi engellesin.</summary>
    public void RecordTestStarted(DateTime utcNow) => LastTestAtUtc = utcNow;

    /// <summary>Test SMS'inin sonucunu işler (bkz. sınıf notu: başarısız test doğrulamayı silmez).</summary>
    public void RecordTest(bool success, string? error, DateTime utcNow)
    {
        LastTestAtUtc = utcNow;
        if (success)
        {
            VerifiedAtUtc = utcNow;
            LastError = null;
        }
        else
        {
            var e = string.IsNullOrWhiteSpace(error) ? "Bilinmeyen hata" : error.Trim();
            LastError = e.Length > 480 ? e[..480] + "…" : e;
        }
    }

    /// <summary>Sağlayıcı adını kanonik biçime çeker; desteklenmiyorsa <see cref="DomainException"/>.</summary>
    public static string CanonicalProvider(string? provider)
    {
        var match = SupportedProviders.FirstOrDefault(x => string.Equals(x, provider?.Trim(), StringComparison.OrdinalIgnoreCase));
        return match ?? throw new DomainException("SMS sağlayıcısı Verimor ya da Netgsm olmalı.");
    }

    private static string Hint(string username)
    {
        var digits = username.Trim();
        return digits.Length <= 4 ? "••••" : $"•••• {digits[^4..]}";
    }
}
