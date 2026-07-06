namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Uzaktan push (FCM/APNs) göndericisi. Kimlik bilgisi yoksa <see cref="IsConfigured"/>=false döner ve
/// gönderim simülasyona düşer (loglanır, hata fırlatmaz) — WhatsApp servis deseniyle aynı.
/// </summary>
public interface IPushSender
{
    /// <summary>Gerçek gönderim için yapılandırma (servis hesabı) mevcut mu.</summary>
    bool IsConfigured { get; }

    /// <summary>Verilen mesajları gönderir; başarıyla iletilen mesaj sayısını döndürür. Hata durumunda 0.</summary>
    Task<int> SendAsync(IReadOnlyCollection<PushMessage> messages, CancellationToken ct = default);
}

/// <summary>Tek bir cihaza push. Data payload'ı deep-link + tür bilgisini taşır.</summary>
public sealed record PushMessage(
    string Token,
    string Title,
    string Body,
    IReadOnlyDictionary<string, string>? Data = null);
