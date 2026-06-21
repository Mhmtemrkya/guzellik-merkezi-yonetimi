namespace GuzellikMerkezi.Application.Abstractions;

public interface IDateTimeProvider
{
    DateTime UtcNow { get; }
}
