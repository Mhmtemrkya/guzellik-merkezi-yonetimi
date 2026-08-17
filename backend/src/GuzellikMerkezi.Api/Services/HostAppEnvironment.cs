using GuzellikMerkezi.Application.Abstractions;

namespace GuzellikMerkezi.Api.Services;

/// <summary>
/// <see cref="IAppEnvironment"/>'ın ASP.NET Core karşılığı — Infrastructure katmanı
/// <c>Microsoft.Extensions.Hosting</c>'e referans vermediği için köprü burada kurulur.
/// </summary>
public sealed class HostAppEnvironment(IHostEnvironment environment) : IAppEnvironment
{
    public bool IsDevelopment => environment.IsDevelopment();
}
