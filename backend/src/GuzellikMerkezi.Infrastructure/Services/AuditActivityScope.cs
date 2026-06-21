using GuzellikMerkezi.Application.Abstractions;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class AuditActivityScope : IAuditActivityScope
{
    public bool HasAuditLogWritten { get; private set; }

    public void MarkAuditLogWritten() => HasAuditLogWritten = true;
}
