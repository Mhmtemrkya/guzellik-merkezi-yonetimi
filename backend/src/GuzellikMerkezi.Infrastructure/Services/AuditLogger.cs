using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class AuditLogger : IAuditLogger
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly GuzellikDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<AuditLogger> _logger;
    private readonly IAuditActivityScope? _activityScope;

    public AuditLogger(
        GuzellikDbContext db,
        ICurrentUser currentUser,
        ILogger<AuditLogger> logger,
        IAuditActivityScope? activityScope = null)
    {
        _db = db;
        _currentUser = currentUser;
        _logger = logger;
        _activityScope = activityScope;
    }

    public async Task LogAsync(
        Guid? tenantId,
        Guid? branchId,
        string action,
        string entityName,
        Guid? entityId,
        string? summary = null,
        object? data = null,
        CancellationToken ct = default)
    {
        await LogCoreAsync(
            tenantId,
            branchId,
            _currentUser.UserId,
            _currentUser.Email,
            _currentUser.Role?.ToString(),
            action,
            entityName,
            entityId,
            summary,
            data,
            _currentUser.IpAddress,
            ct);
    }

    public async Task LogActorAsync(
        Guid? tenantId,
        Guid? branchId,
        Guid? actorUserId,
        string? actorName,
        string? actorRole,
        string action,
        string entityName,
        Guid? entityId,
        string? summary = null,
        object? data = null,
        string? ipAddress = null,
        CancellationToken ct = default)
    {
        await LogCoreAsync(
            tenantId,
            branchId,
            actorUserId,
            actorName,
            actorRole,
            action,
            entityName,
            entityId,
            summary,
            data,
            ipAddress,
            ct);
    }

    private async Task LogCoreAsync(
        Guid? tenantId,
        Guid? branchId,
        Guid? actorUserId,
        string? actorName,
        string? actorRole,
        string action,
        string entityName,
        Guid? entityId,
        string? summary,
        object? data,
        string? ipAddress,
        CancellationToken ct)
    {
        try
        {
            var dataJson = data switch
            {
                null => null,
                string s => s,
                _ => JsonSerializer.Serialize(data, JsonOptions)
            };

            var log = new AuditLog(
                tenantId,
                branchId,
                actorUserId,
                actorName,
                actorRole,
                action,
                entityName,
                entityId,
                summary,
                dataJson,
                ipAddress,
                // Cihaz bilgisi her zaman istek bağlamından okunur; UI, cihaz güvenliği
                // özelliği kapalıyken bu kolonları göstermez.
                _currentUser.DeviceId,
                _currentUser.DeviceInfoJson);

            _db.AuditLogs.Add(log);
            // Çağıran servisin asıl SaveChanges'ı zaten yapılmış olur (iş mantığı save'inden sonra log atılır).
            // Burada ayrı bir save ile audit log'u kalıcı yapıyoruz.
            await _db.SaveChangesAsync(ct);
            _activityScope?.MarkAuditLogWritten();
        }
        catch (Exception ex)
        {
            // Audit log akışı asla iş akışını bloklamasın.
            _logger.LogWarning(ex, "AuditLog yazılamadı (action={Action}, entity={Entity}).", action, entityName);
        }
    }
}
