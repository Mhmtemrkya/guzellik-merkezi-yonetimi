namespace GuzellikMerkezi.Application.Features.Schedule;

public sealed record StaffTimeOffDto(
    Guid Id,
    Guid StaffMemberId,
    string? StaffName,
    DateOnly Date,
    string? Reason);

public sealed record CreateTimeOffRequest(Guid StaffMemberId, DateOnly Date, string? Reason);

/// <summary>Bir günün çalışma penceresi — 0=Pazartesi … 6=Pazar; dakikalar TR yerel saati (540=09:00).</summary>
public sealed record WorkingHourDto(int DayOfWeek, int StartMinute, int EndMinute, bool IsDayOff);

/// <summary>Personelin haftalık çalışma şablonu. Satırı olmayan gün = kısıt yok.</summary>
public sealed record StaffWorkingHoursDto(Guid StaffMemberId, IReadOnlyCollection<WorkingHourDto> Days);

public sealed record SetWorkingHoursRequest(IReadOnlyCollection<WorkingHourDto> Days);

/// <summary>Kurum genelinde çalışma saatleri kısıtı açık mı?</summary>
public sealed record WorkingHoursEnforcementDto(bool Enabled);
