using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kalıcı arka plan işi (DB-outbox). Bellek içi Channel kuyruğunun aksine restart/deploy'da
/// kaybolmaz: iş satır olarak yazılır, DurableJobHostedService poll edip yürütür,
/// başarısızlıkta üstel geri çekilmeyle yeniden dener, hakkı bitince Failed (dead-letter) kalır.
/// Tenant kapsam filtresine girmez; platform sistem sayfasından izlenir.
/// </summary>
public sealed class BackgroundJob : Entity
{
    private BackgroundJob() { }

    public BackgroundJob(string type, string payloadJson, int maxAttempts = 5)
    {
        if (string.IsNullOrWhiteSpace(type)) throw new DomainException("İş tipi zorunlu.");
        Type = type.Trim();
        PayloadJson = payloadJson;
        MaxAttempts = maxAttempts < 1 ? 1 : maxAttempts;
        Status = "Pending";
        NextAttemptUtc = DateTime.UtcNow;
    }

    public string Type { get; private set; } = string.Empty;
    public string PayloadJson { get; private set; } = string.Empty;
    /// <summary>Pending | Processing | Succeeded | Failed</summary>
    public string Status { get; private set; } = "Pending";
    public int Attempts { get; private set; }
    public int MaxAttempts { get; private set; } = 5;
    public DateTime NextAttemptUtc { get; private set; }
    /// <summary>İşlenmekte olan satırın kilidi; süre dolarsa (worker öldü) yeniden alınabilir.</summary>
    public DateTime? LockedUntilUtc { get; private set; }
    public string? LastError { get; private set; }
    public DateTime? CompletedAtUtc { get; private set; }

    public void MarkProcessing(TimeSpan lockDuration)
    {
        Status = "Processing";
        LockedUntilUtc = DateTime.UtcNow.Add(lockDuration);
        Touch();
    }

    public void MarkSucceeded()
    {
        Status = "Succeeded";
        CompletedAtUtc = DateTime.UtcNow;
        LockedUntilUtc = null;
        LastError = null;
        Touch();
    }

    /// <summary>Deneme başarısız: hakkı varsa üstel backoff ile Pending'e döner, yoksa Failed kalır.</summary>
    public void MarkFailedAttempt(string error)
    {
        Attempts++;
        LastError = error.Length > 1000 ? error[..1000] : error;
        LockedUntilUtc = null;
        if (Attempts >= MaxAttempts)
        {
            Status = "Failed";
            CompletedAtUtc = DateTime.UtcNow;
        }
        else
        {
            Status = "Pending";
            // 30sn, 1dk, 2dk, 4dk...
            NextAttemptUtc = DateTime.UtcNow.AddSeconds(30 * Math.Pow(2, Attempts - 1));
        }
        Touch();
    }

    /// <summary>Failed işi elle yeniden kuyruğa alma (platform admin).</summary>
    public void Requeue()
    {
        Status = "Pending";
        Attempts = 0;
        NextAttemptUtc = DateTime.UtcNow;
        LockedUntilUtc = null;
        CompletedAtUtc = null;
        Touch();
    }
}
