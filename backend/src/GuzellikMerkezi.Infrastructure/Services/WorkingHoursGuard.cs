using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Personel çalışma saatleri kontrolü: haftalık şablonda o gün için satır varsa randevu
/// pencere içinde olmalı; IsDayOff ise hiç alınamaz; satır yoksa kısıt yok (geriye uyumluluk).
/// Anonim (portal/webhook) bağlamlardan da çağrıldığı için query filter'a güvenmez.
/// </summary>
public static class WorkingHoursGuard
{
    private static readonly TimeSpan TurkeyOffset = TimeSpan.FromHours(3);

    /// <summary>Engel varsa Türkçe mesaj, yoksa null.</summary>
    public static async Task<string?> BlockReasonAsync(
        GuzellikDbContext db, Guid tenantId, Guid staffMemberId, DateTime startUtc, DateTime endUtc, CancellationToken ct)
    {
        // Kurum anahtarı: yönetici çalışma saatleri kısıtını tamamen kapatabilir.
        var enforce = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => (bool?)t.EnforceWorkingHours)
            .FirstOrDefaultAsync(ct);
        if (enforce == false) return null;

        var localStart = new DateTimeOffset(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc)).ToOffset(TurkeyOffset).DateTime;
        var localEnd = new DateTimeOffset(DateTime.SpecifyKind(endUtc, DateTimeKind.Utc)).ToOffset(TurkeyOffset).DateTime;

        // 0=Pazartesi … 6=Pazar (System.DayOfWeek Pazar=0'dan çevrilir).
        var day = ((int)localStart.DayOfWeek + 6) % 7;
        var row = await db.StaffWorkingHours.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(w => !w.IsDeleted && w.TenantId == tenantId && w.StaffMemberId == staffMemberId && w.DayOfWeek == day, ct);
        if (row is null) return null;

        if (row.IsDayOff) return "Personel bu gün çalışmıyor (haftalık tatil). Farklı bir gün ya da personel seçin.";

        var startMin = localStart.Hour * 60 + localStart.Minute;
        // Gece yarısını aşan randevu pratikte yok; bitiş aynı günün dakikası kabul edilir.
        var endMin = localEnd.Date > localStart.Date ? 1440 : localEnd.Hour * 60 + localEnd.Minute;
        if (startMin < row.StartMinute || endMin > row.EndMinute)
        {
            static string F(int m) => $"{m / 60:00}:{m % 60:00}";
            return $"Personelin bu günkü mesaisi {F(row.StartMinute)}–{F(row.EndMinute)} arası. Randevuyu bu aralıkta planlayın.";
        }
        return null;
    }
}
