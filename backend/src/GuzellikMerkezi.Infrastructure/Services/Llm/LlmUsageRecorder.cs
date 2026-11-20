using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services.Llm;

/// <summary>
/// Kullanım kaydını KENDİ kapsamındaki DbContext ile yazar: çağıranın DbContext'inde izlenen yarım
/// iş durumu bu kayıtla birlikte yanlışlıkla kaydedilmez. Hata asla yukarı taşınmaz.
/// </summary>
public sealed class LlmUsageRecorder(IServiceScopeFactory scopes, ILogger<LlmUsageRecorder> logger) : ILlmUsageRecorder
{
    public async Task RecordAsync(LlmUsageEntry entry, CancellationToken cancellationToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
            db.LlmUsageRecords.Add(new LlmUsageRecord
            {
                TenantId = entry.TenantId,
                UserId = entry.UserId,
                Role = Clip(entry.Role, 50),
                Feature = Clip(entry.Feature, 60),
                Provider = Clip(entry.Provider, 30),
                Model = Clip(entry.Model, 150),
                PromptTokens = Math.Max(0, entry.PromptTokens),
                CompletionTokens = Math.Max(0, entry.CompletionTokens),
                DurationMs = Math.Max(0, entry.DurationMs),
                Succeeded = entry.Succeeded,
                Error = Clip(entry.Error, 60),
                Attempts = entry.Attempts,
            });
            // Kayıt, çağıran iptal etse de yazılsın: token zaten harcandı.
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Yapay zekâ kullanım kaydı yazılamadı ({Feature}).", entry.Feature);
        }
    }

    private static string Clip(string? value, int max)
        => string.IsNullOrEmpty(value) ? string.Empty : value.Length <= max ? value : value[..max];
}
