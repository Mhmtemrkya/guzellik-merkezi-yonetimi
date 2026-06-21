using GuzellikMerkezi.Application.Abstractions;

namespace GuzellikMerkezi.Infrastructure.Time;

public sealed class SystemDateTimeProvider : IDateTimeProvider
{
    public DateTime UtcNow => DateTime.UtcNow;
}
