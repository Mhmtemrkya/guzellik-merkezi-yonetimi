using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.WhatsApp;

namespace GuzellikMerkezi.Infrastructure.Background;

/// <summary>Kalıcı iş tipleri — enqueue eden ve handler aynı sabiti kullanır.</summary>
public static class DurableJobTypes
{
    public const string WaitlistOffer = "whatsapp.waitlist-offer";
    public const string WaitlistActivated = "whatsapp.waitlist-activated";
    public const string PushSend = "push.send";
    public const string RatingLink = "whatsapp.rating-link";
}

public sealed record WaitlistOfferJob(Guid TenantId, Guid WaitlistId);
public sealed record WaitlistActivatedJob(Guid TenantId, Guid AppointmentId);
public sealed record PushSendJob(List<PushMessage> Messages);
public sealed record RatingLinkJob(Guid TenantId, Guid AppointmentId);

public sealed class WaitlistOfferJobHandler : IDurableJobHandler
{
    private readonly IWhatsAppService _whatsApp;
    public WaitlistOfferJobHandler(IWhatsAppService whatsApp) => _whatsApp = whatsApp;
    public string JobType => DurableJobTypes.WaitlistOffer;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<WaitlistOfferJob>(payloadJson)
                  ?? throw new InvalidOperationException("WaitlistOffer payload çözülemedi.");
        await _whatsApp.SendWaitlistOfferAsync(job.TenantId, job.WaitlistId, ct);
    }
}

public sealed class WaitlistActivatedJobHandler : IDurableJobHandler
{
    private readonly IWhatsAppService _whatsApp;
    public WaitlistActivatedJobHandler(IWhatsAppService whatsApp) => _whatsApp = whatsApp;
    public string JobType => DurableJobTypes.WaitlistActivated;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<WaitlistActivatedJob>(payloadJson)
                  ?? throw new InvalidOperationException("WaitlistActivated payload çözülemedi.");
        await _whatsApp.SendWaitlistActivatedAsync(job.TenantId, job.AppointmentId, ct);
    }
}

/// <summary>
/// Randevu tamamlanınca: 24 saat geçerli değerlendirme linki üretir (idempotent) ve müşteriye
/// WhatsApp'tan gönderir. Link hem personel hem salon yıldızını kapsar. Zaten puanlanmışsa sessizce biter.
/// </summary>
public sealed class RatingLinkJobHandler : IDurableJobHandler
{
    private readonly Application.Features.Ratings.IRatingService _ratings;
    private readonly IWhatsAppService _whatsApp;

    public RatingLinkJobHandler(Application.Features.Ratings.IRatingService ratings, IWhatsAppService whatsApp)
    {
        _ratings = ratings;
        _whatsApp = whatsApp;
    }

    public string JobType => DurableJobTypes.RatingLink;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<RatingLinkJob>(payloadJson)
                  ?? throw new InvalidOperationException("RatingLink payload çözülemedi.");
        var issued = await _ratings.IssueAsync(job.TenantId, job.AppointmentId,
            Domain.Entities.AppointmentRating.WhatsAppLinkLifetimeMinutes, ct);
        // Conflict = zaten puanlanmış → gönderilecek bir şey yok; diğer hatalarda da sessizce bit (best-effort).
        if (issued.IsFailure) return;
        await _whatsApp.SendRatingLinkAsync(job.TenantId, job.AppointmentId, issued.Value!.Token, ct);
    }
}

public sealed class PushSendJobHandler : IDurableJobHandler
{
    private readonly IPushSender _push;
    public PushSendJobHandler(IPushSender push) => _push = push;
    public string JobType => DurableJobTypes.PushSend;

    public async Task ExecuteAsync(string payloadJson, CancellationToken ct)
    {
        var job = JsonSerializer.Deserialize<PushSendJob>(payloadJson)
                  ?? throw new InvalidOperationException("PushSend payload çözülemedi.");
        if (job.Messages.Count > 0) await _push.SendAsync(job.Messages, ct);
    }
}
