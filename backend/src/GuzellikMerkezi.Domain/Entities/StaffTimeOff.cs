using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Personel izni / kapalı saat — çizelgede bir personelin gününü ya da o gün içindeki bir SAAT
/// ARALIĞINI kapatır (kapalı aralığa randevu verilemez). Aralık yerel (TR) dakika cinsindendir:
/// 540 = 09:00. Tüm gün kapalı = 0–1440; eski kayıtların tamamı bu değerlerle backfill edilir.
/// Aynı personel/gün için birden çok aralık tanımlanabilir.
/// </summary>
public sealed class StaffTimeOff : Entity
{
    public const int FullDayStartMinute = 0;
    public const int FullDayEndMinute = 1440;

    private StaffTimeOff() { }

    public StaffTimeOff(Guid tenantId, Guid staffMemberId, DateOnly date, string? reason, int? startMinute = null, int? endMinute = null)
    {
        TenantId = tenantId;
        StaffMemberId = staffMemberId;
        Date = date;
        SetRange(startMinute, endMinute);
        SetReason(reason);
    }

    public Guid TenantId { get; private set; }
    public Guid StaffMemberId { get; private set; }
    public StaffMember? StaffMember { get; private set; }
    public DateOnly Date { get; private set; }

    /// <summary>Kapalı aralığın başlangıcı (yerel dakika). Tüm gün kapalıysa 0.</summary>
    public int StartMinute { get; private set; } = FullDayStartMinute;

    /// <summary>Kapalı aralığın bitişi (hariç, yerel dakika). Tüm gün kapalıysa 1440.</summary>
    public int EndMinute { get; private set; } = FullDayEndMinute;

    public string? Reason { get; private set; }

    /// <summary>Günün tamamını kapatan kayıt mı? (aralık verilmemiş eski kayıtlar dahil)</summary>
    public bool IsFullDay => StartMinute <= FullDayStartMinute && EndMinute >= FullDayEndMinute;

    /// <summary>Verilen yerel dakika aralığı bu kapalı aralıkla kesişiyor mu?</summary>
    public bool Overlaps(int startMinute, int endMinute) => StartMinute < endMinute && startMinute < EndMinute;

    /// <summary>Aralığı ayarlar; null/null verilirse tüm gün kapatılır.</summary>
    public void SetRange(int? startMinute, int? endMinute)
    {
        var start = startMinute ?? FullDayStartMinute;
        var end = endMinute ?? FullDayEndMinute;
        if (start is < FullDayStartMinute or >= FullDayEndMinute) throw new DomainException("Başlangıç saati geçersiz.");
        if (end is <= FullDayStartMinute or > FullDayEndMinute) throw new DomainException("Bitiş saati geçersiz.");
        if (end <= start) throw new DomainException("Bitiş saati başlangıçtan sonra olmalı.");
        StartMinute = start;
        EndMinute = end;
        Touch();
    }

    public void SetReason(string? reason)
    {
        Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        Touch();
    }
}
