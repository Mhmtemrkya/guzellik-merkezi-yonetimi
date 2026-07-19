using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Personelin haftalık çalışma şablonu — gün başına tek satır (0=Pazartesi … 6=Pazar).
/// Satırı olmayan gün "kısıt yok" sayılır (geriye uyumluluk: şablonu hiç girilmemiş personel
/// her saatte çalışabilir). IsDayOff=true → o gün hiç randevu alınamaz.
/// Dakikalar yerel (TR) saat cinsindendir: 540 = 09:00.
/// </summary>
public sealed class StaffWorkingHour : Entity
{
    private StaffWorkingHour() { }

    public StaffWorkingHour(Guid tenantId, Guid staffMemberId, int dayOfWeek, int startMinute, int endMinute, bool isDayOff)
    {
        TenantId = tenantId;
        StaffMemberId = staffMemberId;
        if (dayOfWeek is < 0 or > 6) throw new DomainException("Gün 0 (Pazartesi) ile 6 (Pazar) arasında olmalı.");
        DayOfWeek = dayOfWeek;
        SetHours(startMinute, endMinute, isDayOff);
    }

    public Guid TenantId { get; private set; }
    public Guid StaffMemberId { get; private set; }
    public StaffMember? StaffMember { get; private set; }

    /// <summary>0=Pazartesi … 6=Pazar (TR hafta düzeni).</summary>
    public int DayOfWeek { get; private set; }

    /// <summary>Yerel (TR) gün içi başlangıç dakikası (540 = 09:00).</summary>
    public int StartMinute { get; private set; }

    /// <summary>Yerel (TR) gün içi bitiş dakikası (1200 = 20:00).</summary>
    public int EndMinute { get; private set; }

    public bool IsDayOff { get; private set; }

    public void SetHours(int startMinute, int endMinute, bool isDayOff)
    {
        if (!isDayOff)
        {
            if (startMinute is < 0 or > 1439 || endMinute is < 1 or > 1440) throw new DomainException("Saat aralığı geçersiz.");
            if (endMinute <= startMinute) throw new DomainException("Bitiş saati başlangıçtan sonra olmalı.");
        }
        StartMinute = startMinute;
        EndMinute = endMinute;
        IsDayOff = isDayOff;
        Touch();
    }
}
