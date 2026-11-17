using System.Text.Json;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Ödenen faturanın taşıdığı "ödenince açılacak" şube talebini açar. Tek kaynak: platformun elle
/// "Ödendi" yaptığı yol (<see cref="PlatformOpsService"/>) ve Maydanoz'da ödenen fatura
/// (<see cref="InvoicePaymentService"/>) aynı kodu kullanır.
/// <para>Çağıran faturanın satırını kilitlemiş olmalıdır: talep bir kez tüketilir
/// (<see cref="TenantInvoice.TakePendingBranch"/>), iki ödeme bildirimi iki şube açmaz.</para>
/// </summary>
public static class InvoiceBranches
{
    private sealed record BranchRequest(string Name, string City, bool IsDefault);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Talep varsa şubeyi ekler ve döner (kaydetmek çağıranın işidir); yoksa null.</summary>
    public static async Task<Branch?> OpenPendingAsync(GuzellikDbContext db, TenantInvoice invoice, CancellationToken ct)
    {
        if (invoice.Status != "Paid" || invoice.TakePendingBranch() is not { } branchJson) return null;
        var payload = Read(branchJson);
        if (payload is null) return null;

        // Varsayılan şube işareti tüm şubelerde doğru güncellensin diye kapsam filtresi dışı yüklenir.
        var tenant = await db.Tenants.IgnoreQueryFilters()
            .Include(t => t.Branches.Where(b => !b.IsDeleted))
            .FirstAsync(t => t.Id == invoice.TenantId, ct);
        var opened = tenant.AddBranch(payload.Name, payload.City, payload.IsDefault);
        // Gezinme koleksiyonuna eklenen yeni nesneyi EF "var olan" sanıp UPDATE üretmesin (bkz. BranchService).
        db.Branches.Add(opened);
        return opened;
    }

    /// <summary>Bekleyen şube talebinin adı (platform fatura listesi gösterir); okunamazsa boş.</summary>
    public static string? PendingName(string json) => Read(json)?.Name;

    private static BranchRequest? Read(string json)
    {
        try { return JsonSerializer.Deserialize<BranchRequest>(json, Json); }
        catch (JsonException) { return null; }
    }
}
