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
    public static string? ValidateSmtp(string? host, int port)
    {
        if (string.IsNullOrWhiteSpace(host)) return null;

        if (!SmtpPorts.Contains(port))
            return $"İzin verilmeyen SMTP portu: {port}. İzinli: {string.Join(", ", SmtpPorts)}.";
        if (Uri.CheckHostName(host) == UriHostNameType.Unknown)
            return "SMTP sunucu adı geçersiz.";
        if (IsPrivateHost(host))
            return "SMTP sunucusu özel/loopback bir adrese çözülüyor.";
        return null;
    }

    /// <summary>
    /// Host loopback/özel/link-local bir adrese mi çözülüyor? DNS çözülemezse GÜVENSİZ sayılmaz
    /// (dış dünyada erişilemeyen bir ad zaten bağlanamaz); çözülüyorsa aralık kontrol edilir.
    /// </summary>
    private static bool IsPrivateHost(string host)
    {
        try
        {
            var addresses = IPAddress.TryParse(host, out var literal)
                ? [literal]
                : Dns.GetHostAddresses(host);
            return addresses.Any(IsPrivate);
        }
        catch (SocketException)
        {
            return false;
        }
    }

    private static bool IsPrivate(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return true;
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv4MappedToIPv6 && IsPrivate(ip.MapToIPv4());

        var b = ip.GetAddressBytes();
        return b[0] switch
        {
            10 => true,                                     // 10.0.0.0/8
            127 => true,                                    // loopback
            0 => true,                                      // 0.0.0.0/8
            172 => b[1] >= 16 && b[1] <= 31,                // 172.16.0.0/12
            192 => b[1] == 168,                             // 192.168.0.0/16
            169 => b[1] == 254,                             // link-local + bulut metadata
            100 => b[1] >= 64 && b[1] <= 127,               // CGNAT 100.64.0.0/10
            _ => false,
        };
    }
}
