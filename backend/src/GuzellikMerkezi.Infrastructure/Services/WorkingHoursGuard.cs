using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Personel müsaitlik kontrolü:
/// 1) Kapalı gün/saat (StaffTimeOff) — yönetici elle kapattığı için kurum anahtarından BAĞIMSIZ engeller.
/// 2) Haftalık çalışma şablonu — o gün için satır varsa randevu pencere içinde olmalı; IsDayOff ise
///    hiç alınamaz; satır yoksa kısıt yok (geriye uyumluluk). Kurum anahtarıyla kapatılabilir.
/// Anonim (portal/webhook) bağlamlardan da çağrıldığı için query filter'a güvenmez.
/// </summary>
public static class WorkingHoursGuard
{
    private static readonly TimeSpan TurkeyOffset = TimeSpan.FromHours(3);

    private static string F(int m) => $"{m / 60:00}:{m % 60:00}";

    /// <summary>Engel varsa Türkçe mesaj, yoksa null.</summary>
    public static async Task<string?> BlockReasonAsync(
        GuzellikDbContext db, Guid tenantId, Guid staffMemberId, DateTime startUtc, DateTime endUtc, CancellationToken ct)
    {
        var localStart = new DateTimeOffset(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc)).ToOffset(TurkeyOffset).DateTime;
        var localEnd = new DateTimeOffset(DateTime.SpecifyKind(endUtc, DateTimeKind.Utc)).ToOffset(TurkeyOffset).DateTime;

        var startMin = localStart.Hour * 60 + localStart.Minute;
        // Gece yarısını aşan randevu pratikte yok; bitiş aynı günün dakikası kabul edilir.
        var endMin = localEnd.Date > localStart.Date ? 1440 : localEnd.Hour * 60 + localEnd.Minute;

        // 1) Elle kapatılan gün/saat — kurum "çalışma saatleri kısıtı" kapalıyken bile geçerlidir.
        var date = DateOnly.FromDateTime(localStart);
        var closed = await db.StaffTimeOffs.IgnoreQueryFilters().AsNoTracking()
            .Where(t => !t.IsDeleted && t.TenantId == tenantId && t.StaffMemberId == staffMemberId && t.Date == date
                     && t.StartMinute < endMin && startMin < t.EndMinute)
            .OrderBy(t => t.StartMinute)
            .FirstOrDefaultAsync(ct);
        if (closed is not null)
        {
            return closed.IsFullDay
                ? "Personel bu gün izinli — randevu verilemez. Farklı bir gün ya da personel seçin."
                : $"Personelin {F(closed.StartMinute)}–{F(closed.EndMinute)} saatleri kapalı. Randevuyu farklı bir saate planlayın.";
        }

        // 2) Haftalık şablon — kurum anahtarı: yönetici bu kısıtı tamamen kapatabilir.
        var enforce = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => (bool?)t.EnforceWorkingHours)
            .FirstOrDefaultAsync(ct);
        if (enforce == false) return null;

        // 0=Pazartesi … 6=Pazar (System.DayOfWeek Pazar=0'dan çevrilir).
        var day = ((int)localStart.DayOfWeek + 6) % 7;
        var row = await db.StaffWorkingHours.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(w => !w.IsDeleted && w.TenantId == tenantId && w.StaffMemberId == staffMemberId && w.DayOfWeek == day, ct);
        if (row is null) return null;

        if (row.IsDayOff) return "Personel bu gün çalışmıyor (haftalık tatil). Farklı bir gün ya da personel seçin.";

        if (startMin < row.StartMinute || endMin > row.EndMinute)
            return $"Personelin bu günkü mesaisi {F(row.StartMinute)}–{F(row.EndMinute)} arası. Randevuyu bu aralıkta planlayın.";
        return null;
    }
}
