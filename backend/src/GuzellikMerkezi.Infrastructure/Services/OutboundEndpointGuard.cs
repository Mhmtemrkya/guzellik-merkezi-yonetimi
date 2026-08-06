using System.Net;
using System.Net.Sockets;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// DIŞARI ÇIKAN BAĞLANTI ALLOWLIST'İ (SSRF freni).
///
/// <para>
/// Platform yöneticisi SMS API adresini ve SMTP sunucusunu serbestçe girebiliyordu; "test gönder"
/// fonksiyonları bu değerlerle ağ bağlantısı kuruyordu. Ele geçirilmiş ya da kötüye kullanılan bir
/// PlatformAdmin hesabı böylece <c>127.0.0.1</c>, özel ağ ya da bulut metadata uçlarına (169.254.169.254)
/// istek attırabilir, iç servisleri keşfedebilirdi.
/// </para>
///
/// <para>
/// Kural: yalnız HTTPS (SMS için), yalnız bilinen sağlayıcı host'ları, ve host bir IP'ye çözülüyorsa
/// bu IP <b>public</b> olmalı. Yeni sağlayıcı eklenirken listeye açıkça yazılır.
/// </para>
/// </summary>
public static class OutboundEndpointGuard
{
    /// <summary>SMS sağlayıcılarının izinli API host'ları.</summary>
    private static readonly HashSet<string> SmsHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "api.netgsm.com.tr",
        "api.twilio.com",
    };

    /// <summary>SMTP için izinli port'lar (submission + implicit TLS).</summary>
    private static readonly HashSet<int> SmtpPorts = [25, 465, 587, 2525];

    /// <summary>Ödeme sağlayıcısının izinli API host'ları (sandbox + canlı).</summary>
    private static readonly HashSet<string> PaymentHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "api.iyzipay.com",
        "sandbox-api.iyzipay.com",
    };

    /// <summary>
    /// Ödeme API adresini doğrular. SMS ile aynı gerekçe, daha yüksek risk: bu adrese kart
    /// referansları ve tahsilat istekleri gider; sahte bir host'a yönlendirmek hem para hem
    /// kimlik bilgisi sızdırır.
    /// </summary>
    public static string? ValidatePaymentApiUrl(string? apiUrl)
    {
        if (string.IsNullOrWhiteSpace(apiUrl)) return null; // boş = sağlayıcının varsayılan (sandbox) adresi

        if (!Uri.TryCreate(apiUrl, UriKind.Absolute, out var uri))
            return "Ödeme API adresi geçerli bir URL değil.";
        if (uri.Scheme != Uri.UriSchemeHttps)
            return "Ödeme API adresi yalnız HTTPS olabilir.";
        if (!PaymentHosts.Contains(uri.Host))
            return $"İzin verilmeyen ödeme sunucusu: {uri.Host}. İzinli: {string.Join(", ", PaymentHosts)}.";
        if (IsPrivateHost(uri.Host))
            return "Ödeme API adresi özel/loopback bir adrese çözülüyor.";
        return null;
    }

    /// <summary>SMS API adresini doğrular; sorun varsa mesaj döner (null = geçerli).</summary>
    public static string? ValidateSmsApiUrl(string? apiUrl)
    {
        if (string.IsNullOrWhiteSpace(apiUrl)) return null; // boş = sağlayıcının varsayılan adresi

        if (!Uri.TryCreate(apiUrl, UriKind.Absolute, out var uri))
            return "SMS API adresi geçerli bir URL değil.";
        if (uri.Scheme != Uri.UriSchemeHttps)
            return "SMS API adresi yalnız HTTPS olabilir.";
        if (!SmsHosts.Contains(uri.Host))
            return $"İzin verilmeyen SMS sunucusu: {uri.Host}. İzinli: {string.Join(", ", SmsHosts)}.";
        if (IsPrivateHost(uri.Host))
            return "SMS API adresi özel/loopback bir adrese çözülüyor.";
        return null;
    }

    /// <summary>SMTP host/port'unu doğrular; sorun varsa mesaj döner (null = geçerli).</summary>
    public static string? ValidateSmtp(string? host, int port) => ResolveSmtp(host, port, useTls: true).Error;

    /// <param name="Error">null ise geçerli.</param>
    /// <param name="ConnectHost">
    /// Bağlantıda KULLANILMASI GEREKEN adres. TLS kapalıyken doğrulanmış IP literal'idir
    /// (yeniden çözümleme olmaz); TLS açıkken host adının kendisidir (sertifika adı bağlar).
    /// </param>
    public readonly record struct SmtpEndpoint(string? Error, string? ConnectHost);

    /// <summary>
    /// SMTP UCUNU DOĞRULAR VE BAĞLANILACAK ADRESİ SABİTLER (DNS rebinding freni).
    ///
    /// <para>
    /// SOMUT AÇIK: doğrulama host adını çözüp IP'yi denetliyor, bağlantı ise host ADINI istemciye
    /// verip DNS'i YENİDEN çözdürüyordu. Aradaki pencerede kayıt iç bir adrese döndürülürse
    /// (klasik DNS rebinding) doğrulamayı geçen ad, bağlantı anında 127.0.0.1 ya da özel ağa
    /// gidiyordu. SMS/ödeme tarafındaki host allowlist'i SMTP'de yok — dolayısıyla bu kontrol
    /// tek savunmaydı ve atlanabiliyordu.
    /// </para>
    /// <para>
    /// ÇÖZÜM iki yollu, ikisi de yeniden çözümlemeyi anlamsız kılar:
    /// <list type="bullet">
    /// <item>TLS KAPALI → doğrulanan IP'ye doğrudan bağlanılır; çözülecek bir ad kalmaz.</item>
    /// <item>TLS AÇIK → host adıyla bağlanılır ama bağı SERTİFİKA kurar: iç bir servise yönlenen
    /// bağlantı, yapılandırılmış ad için geçerli sertifika sunamayacağı için el sıkışmada düşer.</item>
    /// </list>
    /// </para>
    /// </summary>
    public static SmtpEndpoint ResolveSmtp(string? host, int port, bool useTls)
    {
        if (string.IsNullOrWhiteSpace(host)) return new SmtpEndpoint(null, host);

        if (!SmtpPorts.Contains(port))
            return new SmtpEndpoint($"İzin verilmeyen SMTP portu: {port}. İzinli: {string.Join(", ", SmtpPorts)}.", null);
        if (Uri.CheckHostName(host) == UriHostNameType.Unknown)
            return new SmtpEndpoint("SMTP sunucu adı geçersiz.", null);

        var addresses = ResolveAddresses(host);
        if (addresses.Length == 0 || addresses.Any(ip => !IsGloballyRoutable(ip)))
            return new SmtpEndpoint("SMTP sunucusu özel/loopback bir adrese çözülüyor.", null);

        // TLS açıkken ad korunur: sertifika doğrulaması adı bağlar (IP'ye bağlanmak geçerli
        // sertifikaları da reddettirirdi). TLS kapalıyken bağ ancak adresi sabitleyerek kurulur.
        return new SmtpEndpoint(null, useTls ? host : addresses[0].ToString());
    }

    /// <summary>
    /// Host GLOBAL olarak yönlendirilebilir bir adrese mi çözülüyor?
    ///
    /// <para>
    /// KURAL TERSİNE ÇEVRİLDİ (fail-closed). Eskiden "bilinen özel aralıklar" listeleniyor, listede
    /// olmayan her şey güvenli sayılıyordu; DNS çözülemediğinde de "güvenli" deniyordu. İki açık
    /// vardı: (1) IPv6 tarafında yalnız link-local/site-local biliniyordu — ULA (fc00::/7),
    /// belirsiz adres (::), multicast ve IPv4-eşlemeli metadata adresleri geçiyordu;
    /// (2) çözülemeyen ad "güvenli" sayılıp bağlantı denemesine izin veriyordu.
    /// Artık her adres AÇIKÇA global olduğunu kanıtlamak zorundadır; kanıtlayamayan reddedilir.
    /// </para>
    /// <para>
    /// DNS REBINDING: doğrulama anında çözülen adres ile bağlantı anında kullanılan adres farklı
    /// olabilir. Bu kapı tek başına yeterli değildir; asıl koruma HOST ALLOWLIST'idir (SMS/ödeme)
    /// ve SMTP tarafında port kısıtıdır. Aşağıdaki kontrol savunmanın ikinci katmanıdır.
    /// </para>
    /// </summary>
    private static bool IsPrivateHost(string host)
    {
        var addresses = ResolveAddresses(host);
        // Hiç adres dönmediyse kanıt yok → reddet.
        return addresses.Length == 0 || addresses.Any(ip => !IsGloballyRoutable(ip));
    }

    /// <summary>
    /// Adı adreslere çözer. ÇÖZÜLEMEYEN AD GÜVENLİ DEĞİLDİR: ad sonradan (bağlantı anında) iç bir
    /// adrese çözülebilir; "şimdi çözülemedi" bir güvence değildir → boş dizi = reddedilsin.
    /// </summary>
    private static IPAddress[] ResolveAddresses(string host)
    {
        try
        {
            return IPAddress.TryParse(host, out var literal) ? [literal] : Dns.GetHostAddresses(host);
        }
        catch (SocketException)
        {
            return [];
        }
        catch (ArgumentException)
        {
            return [];
        }
    }

    /// <summary>
    /// Adres GERÇEKTEN dış dünyaya mı ait? Şüphe varsa <c>false</c> — yani reddedilir.
    /// </summary>
    private static bool IsGloballyRoutable(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return false;
        if (IPAddress.Any.Equals(ip) || IPAddress.IPv6Any.Equals(ip)) return false;   // 0.0.0.0 / ::

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            // IPv4-eşlemeli/uyumlu adresler IPv4 kurallarıyla değerlendirilir; aksi hâlde
            // ::ffff:169.254.169.254 gibi bir yazımla metadata ucu geçerdi.
            if (ip.IsIPv4MappedToIPv6) return IsGloballyRoutable(ip.MapToIPv4());
            if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast) return false;

            var v6 = ip.GetAddressBytes();
            if ((v6[0] & 0xFE) == 0xFC) return false;          // fc00::/7 — benzersiz yerel (ULA)
            if (v6[0] == 0x20 && v6[1] == 0x01 && v6[2] == 0x00 && v6[3] == 0x00) return false; // 2001:0::/32 Teredo
            if (v6[0] == 0x01 && v6[1] == 0x00 && v6[2] == 0x00 && v6[3] == 0x00) return false; // 100::/64 discard
            return true;
        }

        var b = ip.GetAddressBytes();
        return b[0] switch
        {
            0 => false,                                     // 0.0.0.0/8
            10 => false,                                    // özel
            127 => false,                                   // loopback
            169 => b[1] != 254,                             // 169.254.0.0/16 link-local + bulut metadata
            172 => !(b[1] >= 16 && b[1] <= 31),             // 172.16.0.0/12
            192 => !(b[1] == 168 || (b[1] == 0 && b[2] == 0)), // 192.168/16 + 192.0.0/24
            100 => !(b[1] >= 64 && b[1] <= 127),            // CGNAT 100.64.0.0/10
            198 => !(b[1] == 18 || b[1] == 19),             // 198.18.0.0/15 kıyas ağı
            >= 224 => false,                                // multicast + ayrılmış (224+)
            _ => true,
        };
    }
}
