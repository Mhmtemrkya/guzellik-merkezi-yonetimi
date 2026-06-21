namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Aynı HTTP isteği içinde detaylı bir domain audit log yazılıp yazılmadığını taşır.
/// Merkezi request-audit middleware'i bunu kullanarak duplicate log üretmez.
/// </summary>
public interface IAuditActivityScope
{
    bool HasAuditLogWritten { get; }
    void MarkAuditLogWritten();
}
