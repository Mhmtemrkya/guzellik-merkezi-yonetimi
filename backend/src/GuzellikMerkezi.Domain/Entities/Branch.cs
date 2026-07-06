using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

public sealed class Branch : Entity
{
    private Branch() { }

    internal Branch(Guid tenantId, string name, string city, bool isDefault)
    {
        TenantId = tenantId;
        Rename(name, city);
        IsDefault = isDefault;
    }

    public Guid TenantId { get; private set; }
    public Tenant? Tenant { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string City { get; private set; } = string.Empty;
    public bool IsDefault { get; private set; }
    public int StaffCount { get; private set; }
    public int RoomCount { get; private set; }

    // --- Online randevu çalışma saatleri (slot üretiminde kullanılır) ---
    public TimeOnly OpenTime { get; private set; } = new(9, 0);
    public TimeOnly CloseTime { get; private set; } = new(20, 0);
    /// <summary>Online randevu slot adım uzunluğu (dakika). Vars. 30.</summary>
    public int SlotMinutes { get; private set; } = 30;

    public void Rename(string name, string city)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Şube adı boş olamaz.");
        if (string.IsNullOrWhiteSpace(city)) throw new DomainException("Şehir/ilçe boş olamaz.");
        Name = name.Trim();
        City = city.Trim();
        Touch();
    }

    public void UpdateCapacity(int staffCount, int roomCount)
    {
        if (staffCount < 0) throw new DomainException("Personel sayısı negatif olamaz.");
        if (roomCount < 0) throw new DomainException("Oda sayısı negatif olamaz.");
        StaffCount = staffCount;
        RoomCount = roomCount;
        Touch();
    }

    public void MarkDefault(bool value = true)
    {
        IsDefault = value;
        Touch();
    }

    public void SetWorkingHours(TimeOnly openTime, TimeOnly closeTime, int slotMinutes)
    {
        if (closeTime <= openTime) throw new DomainException("Kapanış saati açılıştan sonra olmalı.");
        if (slotMinutes is < 5 or > 240) throw new DomainException("Slot adımı 5-240 dakika aralığında olmalı.");
        OpenTime = openTime;
        CloseTime = closeTime;
        SlotMinutes = slotMinutes;
        Touch();
    }
}
