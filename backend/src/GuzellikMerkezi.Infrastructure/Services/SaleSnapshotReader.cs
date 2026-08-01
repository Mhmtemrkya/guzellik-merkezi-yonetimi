using System.Text.Json;
using System.Text.Json.Serialization;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// İptal edilen satış arşivindeki (<c>cancelled_sales.Snapshot</c>) yedeğin şeması ve okuyucusu.
/// <para>
/// Yedek, satış iptal edilirken canlı tablolardan SİLİNEN satırların birebir kopyasıdır — Id'ler
/// dahil, böylece "iptali geri al" aynı Id'lerle kurabilir. Hem geri yükleme
/// (<see cref="CustomerAccountService"/>) hem raporlardaki "İptal Edilen" kırılımı
/// (<see cref="ReportsService"/>) buradan okur; şema tek yerde dursun diye ortak sınıfa alındı.
/// </para>
/// </summary>
internal static class SaleSnapshotReader
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new TolerantBoolConverter() },
    };

    /// <summary>
    /// bool alanlarını true/false DIŞINDA 1/0 ve "true"/"false" olarak da kabul eder.
    /// <para>
    /// Gerekçe: yedeğin bir kısmı SQL migration'ı tarafından üretiliyor ve MySQL/MariaDB'nin
    /// JSON boolean yazma yolları farklı (MariaDB <c>CAST(x AS JSON)</c> desteklemez, tinyint
    /// kolonlar kolayca 1/0 olarak sızabilir). Katı okuyucu böyle bir yedekte istisna atar ve
    /// "iptali geri al" TAMAMEN çalışmaz hâle gelirdi — bu, veri kurtarmayı bloklayan bir hata olur.
    /// </para>
    /// </summary>
    private sealed class TolerantBoolConverter : JsonConverter<bool>
    {
        public override bool Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => reader.TokenType switch
        {
            JsonTokenType.True => true,
            JsonTokenType.False => false,
            JsonTokenType.Number => reader.TryGetInt64(out var n) ? n != 0 : reader.GetDouble() != 0,
            JsonTokenType.String => bool.TryParse(reader.GetString(), out var b)
                ? b
                : reader.GetString() is "1",
            JsonTokenType.Null => false,
            _ => throw new JsonException($"Yedekteki boolean alan okunamadı: {reader.TokenType}"),
        };

        public override void Write(Utf8JsonWriter writer, bool value, JsonSerializerOptions options)
            => writer.WriteBooleanValue(value);
    }

    /// <summary>
    /// Şema sürümü — ileride alan eklenirse eski kayıtlar okunmaya devam etsin.
    /// <para>v2: adisyonların ÖZGÜN statüsü/onay tarihi + ters kayıt dökümü + iptalde kapatılan
    /// randevular eklendi. Eski (v1) yedeklerde bu alanlar null gelir ve geri alma eski
    /// davranışına düşer.</para>
    /// </summary>
    public const int Version = 2;

    /// <param name="AdisyonIds">v1 uyumluluğu — yalnız Id listesi (statü bilgisi yok).</param>
    /// <param name="Adisyonlar">v2: her adisyonun iptalden ÖNCEKİ statüsü ve onay tarihi.</param>
    /// <param name="Reversals">v2: iptalde fiilen pasifleştirilen prim/sadakat/seans dökümü.</param>
    /// <param name="CancelledAppointmentIds">v2: iptalde kapatılan aktif randevular (geri almada canlanır).</param>
    public sealed record SaleSnapshot(
        int Version,
        SnapshotAccount Account,
        IReadOnlyList<SnapshotInstallment> Installments,
        IReadOnlyList<SnapshotPayment> Payments,
        IReadOnlyList<SnapshotSession> Sessions,
        IReadOnlyList<Guid> AdisyonIds,
        IReadOnlyList<SnapshotAdisyon>? Adisyonlar = null,
        IReadOnlyList<AdisyonReversalRecord>? Reversals = null,
        IReadOnlyList<Guid>? CancelledAppointmentIds = null)
    {
        /// <summary>Ters kayıt dökümünü adisyona göre bulur (yoksa null → eski davranış).</summary>
        public AdisyonReversalRecord? ReversalFor(Guid adisyonId) =>
            Reversals?.FirstOrDefault(r => r.AdisyonId == adisyonId);
    }

    /// <param name="Status">İptalden önceki adisyon statüsü (Open/Approved/Cancelled).</param>
    public sealed record SnapshotAdisyon(Guid Id, string Status, DateTime? ApprovedAtUtc);

    public sealed record SnapshotAccount(
        Guid Id,
        Guid TenantId,
        Guid? BranchId,
        Guid CustomerId,
        Guid? ServicePackageId,
        string Name,
        decimal TotalAmount,
        decimal DepositAmount,
        string? Notes,
        bool IsActive,
        DateTime SoldAtUtc,
        Guid? SoldByStaffMemberId,
        Guid? AppliedByStaffMemberId,
        bool IsHistorical,
        DateTime CreatedAtUtc,
        /// <summary>Kaydı oluşturan kullanıcı — "kim sattı" düşümü personel seçilmemişse buna bakar.</summary>
        Guid? CreatedBy = null,
        /// <summary>Önceki geri almalarda KORUNMUŞ iade toplamı; tahsilattan düşülür (v2, eski yedekte 0).</summary>
        decimal RefundedAmount = 0m);

    public sealed record SnapshotInstallment(
        Guid Id, int No, DateOnly DueDate, decimal Amount, string Status, DateTime? PaidAtUtc, DateTime CreatedAtUtc);

    /// <param name="SourceAdisyonId">
    /// Tahsilatı doğuran adisyon. Yedeğe eskiden HİÇ yazılmıyordu: iptal → geri al → onaylı adisyonu
    /// sil zincirinde silme, tahsilatları bu kimlikle aradığı için geri yüklenmiş satırı bulamıyor ve
    /// para kasada kalıyordu. Eski yedeklerde alan yok → null (davranış değişmez).
    /// </param>
    public sealed record SnapshotPayment(
        Guid Id, decimal Amount, string? Method, string? Reference, DateTime OccurredAtUtc, DateTime CreatedAtUtc,
        Guid? SourceAdisyonId = null);

    public sealed record SnapshotSession(
        Guid Id, Guid ServicePackageId, Guid ServiceDefinitionId, int TotalSessions, int UsedSessions,
        Guid? SourceAdisyonId, DateTime CreatedAtUtc);

    /// <summary>DB'den okunan DateTime Kind=Unspecified döner; değer UTC instant olduğundan işaretlenir.</summary>
    public static DateTime Utc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static DateTime? Utc(DateTime? value) => value is { } v ? Utc(v) : null;

    /// <param name="adisyonStatuses">Adisyonların iptalden ÖNCEKİ (Status, ApprovedAtUtc) hâli.</param>
    /// <param name="reversals">Ters kayıtta fiilen değiştirilen satırların dökümü.</param>
    /// <param name="cancelledAppointmentIds">İptalde kapatılan aktif randevular.</param>
    public static string Build(
        CustomerAccount account,
        IReadOnlyList<CustomerPackageSession> sessions,
        IReadOnlyList<Adisyon> adisyonlar,
        IReadOnlyDictionary<Guid, (AdisyonStatus Status, DateTime? ApprovedAtUtc)>? adisyonStatuses = null,
        IReadOnlyList<AdisyonReversalRecord>? reversals = null,
        IReadOnlyList<Guid>? cancelledAppointmentIds = null)
    {
        var snapshot = new SaleSnapshot(
            Version,
            new SnapshotAccount(
                account.Id, account.TenantId, account.BranchId, account.CustomerId, account.ServicePackageId,
                account.Name, account.TotalAmount, account.DepositAmount, account.Notes, account.IsActive,
                Utc(account.SoldAtUtc), account.SoldByStaffMemberId, account.AppliedByStaffMemberId,
                account.IsHistorical, Utc(account.CreatedAtUtc), account.CreatedBy, account.RefundedAmount),
            account.Installments
                .Select(i => new SnapshotInstallment(i.Id, i.No, i.DueDate, i.Amount, i.Status.ToString(), Utc(i.PaidAtUtc), Utc(i.CreatedAtUtc)))
                .ToList(),
            account.Payments
                .Select(p => new SnapshotPayment(p.Id, p.Amount, p.Method, p.Reference, Utc(p.OccurredAtUtc), Utc(p.CreatedAtUtc), p.SourceAdisyonId))
                .ToList(),
            sessions
                .Select(s => new SnapshotSession(s.Id, s.ServicePackageId, s.ServiceDefinitionId, s.TotalSessions, s.UsedSessions, s.SourceAdisyonId, Utc(s.CreatedAtUtc)))
                .ToList(),
            adisyonlar.Select(a => a.Id).ToList(),
            adisyonlar
                .Select(a =>
                {
                    // Statü ters kayıttan ÖNCE alınmalı: adisyon o sırada Cancelled'a çekilmiş olur
                    // ve canlı nesneden okunursa geri alma her fişi Approved yapardı.
                    var original = adisyonStatuses is not null && adisyonStatuses.TryGetValue(a.Id, out var s)
                        ? s
                        : (a.Status, a.ApprovedAtUtc);
                    return new SnapshotAdisyon(a.Id, original.Status.ToString(), Utc(original.ApprovedAtUtc));
                })
                .ToList(),
            reversals ?? [],
            cancelledAppointmentIds ?? []);

        return JsonSerializer.Serialize(snapshot, Options);
    }

    /// <summary>Bozuk/eksik yedekte null döner — çağıran akışı durdurur, patlamaz.</summary>
    public static SaleSnapshot? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var parsed = JsonSerializer.Deserialize<SaleSnapshot>(json, Options);
            return parsed?.Account is null ? null : parsed;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
