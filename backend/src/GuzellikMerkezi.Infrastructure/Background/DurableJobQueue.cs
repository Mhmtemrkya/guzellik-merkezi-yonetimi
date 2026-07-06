using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;

namespace GuzellikMerkezi.Infrastructure.Background;

/// <summary>İşi background_jobs tablosuna yazar (scoped — çağıranın DbContext'iyle aynı bağlam değil, kendi save'i var).</summary>
public sealed class DurableJobQueue : IDurableJobQueue
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    private readonly GuzellikDbContext _db;
    private readonly IJobSignalPublisher _signal;

    public DurableJobQueue(GuzellikDbContext db, IJobSignalPublisher signal)
    {
        _db = db;
        _signal = signal;
    }

    public async Task EnqueueAsync(string jobType, object payload, CancellationToken ct = default)
    {
        var job = new BackgroundJob(jobType, JsonSerializer.Serialize(payload, JsonOptions));
        _db.BackgroundJobs.Add(job);
        await _db.SaveChangesAsync(ct);
        // Outbox + broker: satır kalıcı; RabbitMQ açıksa anında işlensin diye sinyal gönder
        // (best-effort — başarısızsa DB poller güvenlik ağı devralır).
        await _signal.TryPublishAsync(job.Id, ct);
    }
}
