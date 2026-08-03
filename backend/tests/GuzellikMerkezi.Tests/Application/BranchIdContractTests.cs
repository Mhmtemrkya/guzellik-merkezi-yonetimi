using System.Text.Json;
using GuzellikMerkezi.Application.Features.Appointments;

namespace GuzellikMerkezi.Tests.Application;

/// <summary>
/// MOBİL SÖZLEŞME TUZAĞI (4 Ağu 2026): kurum yöneticisinin şubesi YOKTUR
/// (<c>branchId = null</c>) ama <see cref="CreateAppointmentRequest.BranchId"/> null
/// olamayan <c>Guid</c>. Mobil oturumdaki null'ı doğrudan gönderdiğinde istek model
/// bağlamada düşüyor, ASP.NET GÖVDESİZ 400 dönüyor ve istemci hatayı çözemediği için
/// kullanıcı yalnızca "İstek tamamlanamadı." görüyordu.
///
/// Bu test sözleşmeyi sabitler: null KABUL EDİLMEZ, dolayısıyla istemci gerçek bir
/// şube çözmek ZORUNDADIR (mobil: AppointmentForm._resolveBranchId).
/// </summary>
public sealed class BranchIdContractTests
{
    private const string Guid1 = "11111111-1111-1111-1111-111111111111";

    private static string Payload(string branchIdJson) => $$"""
    {
      "branchId": {{branchIdJson}},
      "customerId": "{{Guid1}}",
      "staffMemberId": "{{Guid1}}",
      "serviceDefinitionId": "{{Guid1}}",
      "startUtc": "2026-08-05T09:00:00Z",
      "endUtc": "2026-08-05T10:00:00Z",
      "price": 0,
      "notes": null
    }
    """;

    /// <summary>Eski mobil davranışı: null şube → çözümleme PATLAR (gövdesiz 400'ün kaynağı).</summary>
    [Fact]
    public void NullBranchId_IsRejected()
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<CreateAppointmentRequest>(Payload("null"),
                new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    /// <summary>Düzeltilmiş mobil davranışı: gerçek şube çözülür → istek geçerli.</summary>
    [Fact]
    public void ResolvedBranchId_IsAccepted()
    {
        var request = JsonSerializer.Deserialize<CreateAppointmentRequest>(
            Payload($"\"{Guid1}\""), new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.NotNull(request);
        Assert.Equal(Guid.Parse(Guid1), request!.BranchId);
    }
}
