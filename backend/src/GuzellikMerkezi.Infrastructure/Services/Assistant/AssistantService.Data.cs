using System.Globalization;
using GuzellikMerkezi.Application.Features.Reports;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services.Assistant;

/// <summary>
/// Veri niyetleri. KAPSAM KURALLARI (global sorgu filtresine EK olarak, savunma derinliği için açıkça):
/// <list type="bullet">
/// <item>Her sorgu oturumdaki kuruma sabitlenir (TenantId).</item>
/// <item>Şube yöneticisi yalnız kendi şubesini görür; kurum sahibi seçili şubeyi ya da (seçim yoksa) tüm kurumu.</item>
/// <item>Personel yalnız KENDİ randevularını, müşterilerini, puanını ve taslaklarını görür.</item>
/// <item>Müşteri yalnız kendi kaydını görür.</item>
/// <item>Konsültasyon/sağlık verisi hiçbir niyette dönmez.</item>
/// </list>
/// Finans, hizmet, personel, şube ve müşteri rakamları <see cref="IReportsService"/>'ten gelir: Maydi'nin
/// söylediği sayı Raporlar ekranındakiyle (aynı dönem ve şube seçimiyle) birebir aynıdır.
/// </summary>
public sealed partial class AssistantService
{
    private static readonly CultureInfo Tr = new("tr-TR");
    // Bellekte (materyalize edilmiş satırlar üzerinde) kullanılır. SORGU İÇİNDE KULLANILMAZ: MySql.EntityFrameworkCore
    // yerel koleksiyonların hiçbir şeklini (dizi/List/HashSet/enum[]) çeviremiyor ("does not have a type mapping
    // assigned") — bkz. ContainsTranslationProbeMySqlTests. Sorgularda IsActive ifadesi ya da join kullanılır.
    private static readonly AppointmentStatus[] Active = [AppointmentStatus.Scheduled, AppointmentStatus.Confirmed, AppointmentStatus.InProgress];

    private static readonly System.Linq.Expressions.Expression<Func<Appointment, bool>> IsActive = x =>
        x.Status == AppointmentStatus.Scheduled || x.Status == AppointmentStatus.Confirmed || x.Status == AppointmentStatus.InProgress;

    internal sealed record DataAnswer(string Text, IReadOnlyList<object> Items);

    private Guid TenantId => currentUser.TenantId!.Value;

    /// <summary>
    /// Doğrulanmış şube kapsamı (TenantResolutionMiddleware): şube yöneticisi ve personelde JWT şubesi, kurum sahibinde
    /// seçtiği şube (X-Branch-Id, kuruma ait olduğu doğrulanır) ya da seçim yoksa tüm kurum.
    /// </summary>
    private Guid? ScopeBranch => tenantContext.BranchId;

    private IQueryable<Appointment> Appointments()
    {
        var query = db.Appointments.AsNoTracking().Where(x => x.TenantId == TenantId && x.Status != AppointmentStatus.Draft);
        if (ScopeBranch is Guid branch) query = query.Where(x => x.BranchId == branch);
        return query;
    }

    private async Task<Guid?> MyStaffIdAsync(CancellationToken ct)
    {
        var userId = currentUser.UserId;
        return await db.StaffMembers.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.TenantUserId == userId)
            .Select(x => (Guid?)x.Id).FirstOrDefaultAsync(ct);
    }

    private static string Clock(DateTime utc) => (utc + TurkeyOffset).ToString("HH:mm", Tr);
    private static string Day(DateTime utc) => (utc + TurkeyOffset).ToString("d MMMM dddd", Tr);
    private static string ShortDay(DateTime utc) => (utc + TurkeyOffset).ToString("d MMMM", Tr);
    private static string DayEn(DateTime utc) => (utc + TurkeyOffset).ToString("dddd, MMMM d", CultureInfo.InvariantCulture);
    private static string Money(decimal value) => value.ToString("#,##0.00", Tr) + " ₺";
    private static DateTime Utc(DateTime local) => DateTime.SpecifyKind(local - TurkeyOffset, DateTimeKind.Utc);

    /// <summary>Türkçe başlıklı tablo satırı (istemciler bilinmeyen alan adını olduğu gibi başlık yapar).</summary>
    private static Dictionary<string, object?> Row(params (string Key, object? Value)[] cells) => cells.ToDictionary(c => c.Key, c => c.Value);

    private static string StatusTr(AppointmentStatus status) => status switch
    {
        AppointmentStatus.Scheduled => "planlı",
        AppointmentStatus.Confirmed => "onaylı",
        AppointmentStatus.InProgress => "işlemde",
        AppointmentStatus.Completed => "tamamlandı",
        AppointmentStatus.Cancelled => "iptal",
        AppointmentStatus.NoShow => "gelmedi",
        _ => "taslak",
    };

    // ── Dönem varsayılanları ────────────────────────────────────────────────

    private AssistantDateRange TodayRange => AssistantDateParser.Make(LocalNow.Date, LocalNow.Date.AddDays(1), "Bugün", "Today");
    private AssistantDateRange MonthRange
    {
        get
        {
            var start = new DateTime(LocalNow.Year, LocalNow.Month, 1);
            return AssistantDateParser.Make(start, start.AddMonths(1), "Bu ay", "This month");
        }
    }
    private AssistantDateRange LastDays(int days) =>
        AssistantDateParser.Make(LocalNow.Date.AddDays(1 - days), LocalNow.Date.AddDays(1), $"Son {days} gün", $"Last {days} days");
    private AssistantDateRange AllTime => AssistantDateParser.Make(new DateTime(2000, 1, 1), LocalNow.Date.AddDays(1), "Bugüne kadar", "All time");

    private static string Title(AssistantDateRange range, AssistantVoice v) => v.English ? range.TitleEn : range.Title;

    /// <summary>"geçen döneme göre %12 artış" — önceki değer yoksa boş.</summary>
    private static string Change(decimal current, decimal previous, AssistantVoice v)
    {
        if (previous == 0) return string.Empty;
        var pct = Math.Round((current - previous) / Math.Abs(previous) * 100m, 0);
        if (pct == 0) return v.T(" Önceki döneme göre değişmedi.", " Unchanged from the previous period.");
        return pct > 0
            ? v.T($" Önceki döneme göre %{pct} artış.", $" Up {pct}% on the previous period.")
            : v.T($" Önceki döneme göre %{-pct} düşüş.", $" Down {-pct}% on the previous period.");
    }

    private ReportRangeRequest ReportRange(AssistantDateRange range, bool compare = true)
    {
        var (prevFrom, prevTo) = range.Previous();
        return compare
            ? new ReportRangeRequest(Utc(range.From), Utc(range.To), Utc(prevFrom), Utc(prevTo))
            : new ReportRangeRequest(Utc(range.From), Utc(range.To));
    }

    private async Task<DataAnswer> DataAsync(AssistantIntent intent, AssistantDateRange? range, string portal, AssistantVoice v, CancellationToken ct,
        AssistantEntities? entities = null)
    {
        var staff = portal == AssistantPortals.Staff;
        var found = entities ?? AssistantEntities.None;
        return intent switch
        {
            AssistantIntent.CustomerLookup => await CustomerLookupAsync(found, portal, v, ct),
            AssistantIntent.ServicePrice => await ServicePriceAsync(found, v, ct),
            AssistantIntent.StaffSchedule => found.Staff.Count > 0 ? await StaffScheduleAsync(found, range, portal, v, ct) : await StaffTodayAsync(range, v, ct),
            AssistantIntent.StaffToday => await StaffTodayAsync(range, v, ct),
            AssistantIntent.ProductStock => found.Products.Count > 0 ? ProductStock(found, v) : await InventoryAsync(range ?? MonthRange, v, ct),
            AssistantIntent.Subscription => await SubscriptionAsync(v, ct),
            AssistantIntent.MessagingCredits => await MessagingCreditsAsync(v, ct),
            AssistantIntent.CashClosingStatus => await CashClosingStatusAsync(v, ct),
            AssistantIntent.Campaigns => await CampaignsAsync(v, ct),
            AssistantIntent.KvkkPending => await KvkkPendingAsync(v, ct),
            AssistantIntent.GiftCards => await GiftCardsAsync(portal, v, ct),
            AssistantIntent.MyWork => await MyWorkAsync(range ?? MonthRange, v, ct),
            AssistantIntent.MyDebt => await MyDebtAsync(v, ct),
            AssistantIntent.Loyalty => await LoyaltyAsync(v, ct),
            AssistantIntent.SalonInfo => await SalonInfoAsync(v, ct),
            AssistantIntent.AppointmentsToday => portal == AssistantPortals.Customer
                ? (range is null ? await CustomerNextAsync(v, ct) : await CustomerAppointmentsAsync(range, v, ct))
                : staff ? await MyAppointmentsAsync(range ?? TodayRange, v, ct) : await AppointmentsAsync(range ?? TodayRange, v, ct),
            AssistantIntent.NextAppointment => staff ? await MyNextCustomerAsync(v, ct) : await CustomerNextAsync(v, ct),
            AssistantIntent.WeekSchedule => await WeekAsync(staff, v, ct),
            AssistantIntent.RemainingSessions => staff ? await MyCustomersSessionsAsync(v, ct) : await CustomerSessionsAsync(v, ct),
            AssistantIntent.MyRating => await MyRatingAsync(v, ct),
            AssistantIntent.PendingApprovals => await PendingAsync(staff, v, ct),
            AssistantIntent.FreeSlots => await FreeSlotsAsync(range, v, ct),
            AssistantIntent.Revenue => await RevenueAsync(range ?? TodayRange, v, ct),
            AssistantIntent.Expenses => await ExpensesAsync(range ?? MonthRange, v, ct),
            AssistantIntent.Profit => await ProfitAsync(range ?? MonthRange, v, ct),
            AssistantIntent.Sales => await SalesAsync(range ?? TodayRange, v, ct),
            AssistantIntent.PaymentMethods => await PaymentMethodsAsync(range ?? TodayRange, v, ct),
            AssistantIntent.OverdueInstallments => await OverdueAsync(v, ct),
            AssistantIntent.Receivables => await ReceivablesAsync(v, ct),
            AssistantIntent.CriticalStock => await CriticalStockAsync(v, ct),
            AssistantIntent.Inventory => await InventoryAsync(range ?? MonthRange, v, ct),
            AssistantIntent.Waitlist => await WaitlistAsync(v, ct),
            AssistantIntent.TopStaff => await TopStaffAsync(range ?? MonthRange, v, ct),
            AssistantIntent.TopServices => await TopServicesAsync(range ?? MonthRange, v, ct),
            AssistantIntent.Branches => await BranchesAsync(range ?? MonthRange, v, ct),
            AssistantIntent.NewCustomers => await NewCustomersAsync(range ?? MonthRange, v, ct),
            AssistantIntent.CustomerCount => await CustomerCountAsync(v, ct),
            AssistantIntent.TopCustomers => await TopCustomersAsync(range ?? AllTime, v, ct),
            AssistantIntent.PassiveCustomers => await PassiveCustomersAsync(v, ct),
            AssistantIntent.Birthdays => await BirthdaysAsync(range ?? TodayRange, v, ct),
            AssistantIntent.NoShows => await NoShowsAsync(range ?? LastDays(30), v, ct),
            AssistantIntent.Cancellations => await CancellationsAsync(range ?? MonthRange, v, ct),
            AssistantIntent.BusiestTimes => await BusiestTimesAsync(range ?? LastDays(90), v, ct),
            AssistantIntent.AppointmentHistory => await CustomerHistoryAsync(v, ct),
            _ => new DataAnswer(v.OutOfPortal(), []),
        };
    }

    // ── Personel ────────────────────────────────────────────────────────────

    private async Task<DataAnswer> MyAppointmentsAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        if (await MyStaffIdAsync(ct) is not Guid staffId) return NoStaffProfile(v);
        var start = Utc(range.From);
        var end = Utc(range.To);
        var rows = await db.Appointments.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.StaffMemberId == staffId && x.Status != AppointmentStatus.Draft && x.StartUtc >= start && x.StartUtc < end)
            .OrderBy(x => x.StartUtc)
            .Select(x => new { x.StartUtc, Customer = x.Customer!.FullName, Service = x.ServiceDefinition!.Name, x.Status })
            .Take(500).ToListAsync(ct);
        var title = Title(range, v);
        var items = rows.Take(30).Select(x => (object)new
        {
            time = range.SingleDay ? Clock(x.StartUtc) : $"{ShortDay(x.StartUtc)} {Clock(x.StartUtc)}",
            customer = x.Customer, service = x.Service, status = StatusTr(x.Status),
        }).ToList();
        if (rows.Count == 0) return new DataAnswer(v.T($"{title}: size atanmış randevu yok.", $"{title}: you have no appointments."), items);
        var now = DateTime.UtcNow;
        var upcoming = rows.Count(x => Active.Contains(x.Status) && x.StartUtc >= now);
        var done = rows.Count(x => x.Status == AppointmentStatus.Completed);
        return new DataAnswer(v.T($"{title}: {rows.Count} randevunuz var; {done} tamamlandı, {upcoming} sırada.",
            $"{title}: you have {rows.Count} appointments; {done} completed, {upcoming} to come."), items);
    }

    private async Task<DataAnswer> MyNextCustomerAsync(AssistantVoice v, CancellationToken ct)
    {
        if (await MyStaffIdAsync(ct) is not Guid staffId) return NoStaffProfile(v);
        var now = DateTime.UtcNow.AddMinutes(-15);
        var next = await db.Appointments.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.StaffMemberId == staffId && x.StartUtc >= now)
            .Where(IsActive)
            .OrderBy(x => x.StartUtc)
            .Select(x => new { x.StartUtc, Customer = x.Customer!.FullName, Service = x.ServiceDefinition!.Name })
            .FirstOrDefaultAsync(ct);
        if (next is null) return new DataAnswer(v.T("Sırada bekleyen randevunuz yok.", "You have no upcoming appointments."), []);
        var when = (next.StartUtc + TurkeyOffset).Date == LocalNow.Date ? Clock(next.StartUtc) : $"{Day(next.StartUtc)} {Clock(next.StartUtc)}";
        return new DataAnswer(v.T($"Sıradaki müşteriniz {next.Customer}: {when}, {next.Service}.", $"Your next customer is {next.Customer}: {when}, {next.Service}."),
            [new { time = when, customer = next.Customer, service = next.Service }]);
    }

    private async Task<DataAnswer> MyCustomersSessionsAsync(AssistantVoice v, CancellationToken ct)
    {
        if (await MyStaffIdAsync(ct) is not Guid staffId) return NoStaffProfile(v);
        // "Paketli müşterilerim": bu personelle randevusu olmuş müşterilerin kalan seansları.
        var myCustomers = db.Appointments.AsNoTracking().Where(x => x.TenantId == TenantId && x.StaffMemberId == staffId).Select(x => x.CustomerId);
        var rows = await (from session in db.CustomerPackageSessions.AsNoTracking()
                          join customer in db.Customers.AsNoTracking() on session.CustomerId equals customer.Id
                          where session.TenantId == TenantId && session.TotalSessions > session.UsedSessions && myCustomers.Contains(session.CustomerId)
                          select new { session.CustomerId, customer.FullName, Service = session.ServiceDefinition!.Name, Left = session.TotalSessions - session.UsedSessions })
            .Take(200).ToListAsync(ct);
        var customerCount = rows.Select(x => x.CustomerId).Distinct().Count();
        var items = rows.OrderBy(x => x.FullName).Take(30)
            .Select(x => (object)new { customer = x.FullName, service = x.Service, left = x.Left }).ToList();
        return rows.Count == 0
            ? new DataAnswer(v.T("Kalan seansı olan paketli müşteriniz yok.", "None of your package customers have sessions left."), items)
            : new DataAnswer(v.T($"{customerCount} müşterinizin toplam {rows.Sum(x => x.Left)} seansı kaldı.",
                $"{customerCount} of your customers have {rows.Sum(x => x.Left)} sessions left in total."), items);
    }

    private async Task<DataAnswer> MyRatingAsync(AssistantVoice v, CancellationToken ct)
    {
        if (await MyStaffIdAsync(ct) is not Guid staffId) return NoStaffProfile(v);
        var stars = await db.AppointmentRatings.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.StaffMemberId == staffId && x.Status == RatingStatus.Submitted && x.Stars > 0)
            .Select(x => x.Stars).ToListAsync(ct);
        if (stars.Count == 0) return new DataAnswer(v.T("Henüz müşteri değerlendirmeniz yok.", "You have no customer ratings yet."), []);
        var average = stars.Average();
        return new DataAnswer(v.T($"Yıldız puanınız {average.ToString("0.0", Tr)} ({stars.Count} değerlendirme).",
            $"Your star rating is {average.ToString("0.0", CultureInfo.InvariantCulture)} ({stars.Count} ratings)."),
            [new { average = Math.Round(average, 1), count = stars.Count }]);
    }

    private static DataAnswer NoStaffProfile(AssistantVoice v) =>
        new(v.T("Hesabınıza bağlı bir personel kaydı bulamadım; yöneticiniz Personel ekranından bağlayabilir.",
            "I couldn't find a staff profile linked to your account; your manager can link it from the Staff page."), []);

    // ── Yönetici: randevular ────────────────────────────────────────────────

    private async Task<DataAnswer> AppointmentsAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var start = Utc(range.From);
        var end = Utc(range.To);
        var rows = await Appointments().Where(x => x.StartUtc >= start && x.StartUtc < end)
            .OrderBy(x => x.StartUtc)
            .Select(x => new { x.Status, x.StartUtc, Customer = x.Customer!.FullName, Service = x.ServiceDefinition!.Name, Staff = x.StaffMember!.FullName })
            .Take(20000).ToListAsync(ct);
        var title = Title(range, v);
        var total = rows.Count;
        if (total == 0) return new DataAnswer(v.T($"{title}: randevu yok.", $"{title}: no appointments."), []);

        var now = DateTime.UtcNow;
        var upcoming = rows.Count(x => Active.Contains(x.Status) && x.StartUtc >= now);
        var done = rows.Count(x => x.Status == AppointmentStatus.Completed);
        var cancelled = rows.Count(x => x.Status == AppointmentStatus.Cancelled);
        var missed = rows.Count(x => x.Status == AppointmentStatus.NoShow);
        var parts = new List<string> { v.T($"{done} tamamlandı", $"{done} completed") };
        if (upcoming > 0) parts.Add(v.T($"{upcoming} sırada", $"{upcoming} to come"));
        if (cancelled > 0) parts.Add(v.T($"{cancelled} iptal", $"{cancelled} cancelled"));
        if (missed > 0) parts.Add(v.T($"{missed} gelmedi", $"{missed} no-show"));
        var text = v.T($"{title}: {total} randevu var ({string.Join(", ", parts)}).", $"{title}: {total} appointments ({string.Join(", ", parts)}).");

        // Tek gün: saat saat liste; uzun dönem: gün gün (≤ 31 gün) ya da durum dağılımı.
        List<object> items;
        if (range.SingleDay)
            items = rows.Take(40).Select(x => (object)new { time = Clock(x.StartUtc), customer = x.Customer, service = x.Service, staff = x.Staff, status = StatusTr(x.Status) }).ToList();
        else if ((range.To - range.From).TotalDays <= 31)
            items = rows.GroupBy(x => (x.StartUtc + TurkeyOffset).Date).OrderBy(g => g.Key)
                .Select(g => (object)new { day = g.Key.ToString("d MMMM dddd", Tr), count = g.Count(), completed = g.Count(x => x.Status == AppointmentStatus.Completed) }).ToList();
        else
            items = rows.GroupBy(x => x.Status).OrderBy(g => g.Key).Select(g => (object)new { status = StatusTr(g.Key), count = g.Count() }).ToList();
        return new DataAnswer(text, items);
    }

    private async Task<DataAnswer> WeekAsync(bool staff, AssistantVoice v, CancellationToken ct)
    {
        var today = LocalNow.Date;
        var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var start = Utc(monday);
        var query = Appointments().Where(x => x.StartUtc >= start && x.StartUtc < start.AddDays(7) && x.Status != AppointmentStatus.Cancelled);
        if (staff)
        {
            if (await MyStaffIdAsync(ct) is not Guid staffId) return NoStaffProfile(v);
            query = db.Appointments.AsNoTracking().Where(x => x.TenantId == TenantId && x.StaffMemberId == staffId
                && x.Status != AppointmentStatus.Draft && x.Status != AppointmentStatus.Cancelled && x.StartUtc >= start && x.StartUtc < start.AddDays(7));
        }
        var times = await query.Select(x => x.StartUtc).ToListAsync(ct);
        var items = Enumerable.Range(0, 7)
            .Select(i => monday.AddDays(i))
            .Select(day => (object)new { day = day.ToString("dddd", v.English ? CultureInfo.InvariantCulture : Tr), count = times.Count(t => (t + TurkeyOffset).Date == day) })
            .ToList();
        return new DataAnswer(staff
            ? v.T($"Bu hafta {times.Count} randevunuz var.", $"You have {times.Count} appointments this week.")
            : v.T($"Bu hafta {times.Count} randevu var.", $"There are {times.Count} appointments this week."), items);
    }

    private async Task<DataAnswer> PendingAsync(bool staff, AssistantVoice v, CancellationToken ct)
    {
        var query = db.PendingOperations.AsNoTracking().Where(x => x.TenantId == TenantId && x.Status == PendingOperationStatus.Pending);
        if (staff)
        {
            var userId = currentUser.UserId!.Value;
            query = query.Where(x => x.RequestedByUserId == userId);
        }
        else if (ScopeBranch is Guid branch)
        {
            query = query.Where(x => x.BranchId == null || x.BranchId == branch);
        }
        var rows = await query.OrderBy(x => x.RequestedAtUtc).Select(x => new { x.Title, x.RequestedByName, x.RequestedAtUtc }).Take(50).ToListAsync(ct);
        var items = rows.Take(10).Select(x => (object)new { title = x.Title, by = staff ? null : x.RequestedByName, at = Day(x.RequestedAtUtc) }).ToList();
        if (rows.Count == 0)
            return new DataAnswer(staff ? v.T("Onay bekleyen taslağınız yok.", "You have no drafts awaiting approval.") : v.T("Onay bekleyen işlem yok.", "Nothing is awaiting approval."), items);
        return new DataAnswer(staff
            ? v.T($"{rows.Count} taslağınız yönetici onayı bekliyor.", $"{rows.Count} of your drafts are awaiting approval.")
            : v.T($"{rows.Count} işlem onayınızı bekliyor.", $"{rows.Count} items are awaiting your approval."), items);
    }

    /// <summary>
    /// Bir gün için (varsayılan bugün; sorulan gün bugün ya da sonrasıysa o gün) her personelin boş aralıkları
    /// (çalışma saati − aktif randevular). Çalışma saati tanımlı olmayan personel listelenmez (uydurma saat gösterilmez).
    /// </summary>
    private async Task<DataAnswer> FreeSlotsAsync(AssistantDateRange? range, AssistantVoice v, CancellationToken ct)
    {
        var local = LocalNow;
        var day = range is { SingleDay: true } && range.From.Date > local.Date ? range.From.Date : local.Date;
        var isToday = day == local.Date;
        var label = isToday ? v.T("Bugün", "Today") : (v.English ? range!.TitleEn : range!.Title);
        var weekday = ((int)day.DayOfWeek + 6) % 7; // 0 = Pazartesi
        var start = Utc(day);
        var staffQuery = db.StaffMembers.AsNoTracking().Where(x => x.TenantId == TenantId && x.IsActive);
        if (ScopeBranch is Guid branch) staffQuery = staffQuery.Where(x => x.BranchId == branch);
        var staff = await staffQuery.Select(x => new { x.Id, x.FullName }).ToListAsync(ct);
        var hours = await (from hour in db.StaffWorkingHours.AsNoTracking()
                           join member in staffQuery on hour.StaffMemberId equals member.Id
                           where hour.DayOfWeek == weekday && !hour.IsDayOff
                           select new { hour.StaffMemberId, hour.StartMinute, hour.EndMinute }).ToListAsync(ct);
        var end = start.AddDays(1);
        var busy = await (from appointment in db.Appointments.AsNoTracking()
                          join member in staffQuery on appointment.StaffMemberId equals member.Id
                          where appointment.TenantId == TenantId && appointment.StartUtc >= start && appointment.StartUtc < end
                              && appointment.Status != AppointmentStatus.Cancelled && appointment.Status != AppointmentStatus.NoShow
                              && appointment.Status != AppointmentStatus.Draft
                          select new { appointment.StaffMemberId, appointment.StartUtc, appointment.EndUtc }).ToListAsync(ct);

        var nowMinute = isToday ? local.Hour * 60 + local.Minute : 0;
        var items = new List<object>();
        var freeTotal = 0;
        foreach (var person in staff.OrderBy(x => x.FullName))
        {
            var shift = hours.FirstOrDefault(x => x.StaffMemberId == person.Id);
            if (shift is null) continue;
            var cursor = Math.Max(shift.StartMinute, nowMinute);
            var windows = new List<string>();
            foreach (var appointment in busy.Where(x => x.StaffMemberId == person.Id).OrderBy(x => x.StartUtc))
            {
                var from = (int)((appointment.StartUtc + TurkeyOffset) - day).TotalMinutes;
                var to = (int)((appointment.EndUtc + TurkeyOffset) - day).TotalMinutes;
                if (from - cursor >= 30) { windows.Add($"{cursor / 60:00}:{cursor % 60:00}–{from / 60:00}:{from % 60:00}"); freeTotal += from - cursor; }
                cursor = Math.Max(cursor, to);
            }
            if (shift.EndMinute - cursor >= 30) { windows.Add($"{cursor / 60:00}:{cursor % 60:00}–{shift.EndMinute / 60:00}:{shift.EndMinute % 60:00}"); freeTotal += shift.EndMinute - cursor; }
            if (windows.Count > 0) items.Add(new { staff = person.FullName, free = windows });
        }
        if (hours.Count == 0)
            return new DataAnswer(v.T($"{label} için tanımlı personel çalışma saati yok; boş saatleri hesaplayamıyorum.",
                $"No staff working hours are defined for {label}, so I can't work out free slots."), items);
        return items.Count == 0
            ? new DataAnswer(v.T($"{label} kalan saatlerde 30 dakikalık boşluk yok.", $"There are no 30-minute gaps left ({label})."), items)
            : new DataAnswer(v.T($"{label} {items.Count} personelde toplam {freeTotal / 60} saat {freeTotal % 60} dakika boşluk var.",
                $"{label}: {items.Count} staff have {freeTotal / 60}h {freeTotal % 60}m free in total."), items);
    }

    // ── Yönetici: finans (Raporlar ile aynı hesap) ──────────────────────────

    private async Task<ReportSummaryDto?> SummaryAsync(AssistantDateRange range, CancellationToken ct)
    {
        var result = await reports.GetSummaryAsync(TenantId, ReportRange(range), ct);
        return result.IsSuccess ? result.Value : null;
    }

    private static decimal Metric(ReportSummaryDto summary, string key, bool previous = false) =>
        summary.Metrics.FirstOrDefault(x => x.Key == key) is { } metric ? (previous ? metric.PreviousValue : metric.Value) : 0m;

    private static string? Hint(ReportSummaryDto summary, string key) => summary.Metrics.FirstOrDefault(x => x.Key == key)?.Hint;

    /// <summary>Uzun dönemde (≥ 2 ay) aylık seri, kısa dönemde ödeme yöntemleri.</summary>
    private static List<object> FinanceItems(ReportSummaryDto summary, AssistantDateRange range)
    {
        var busy = summary.Series.Where(p => p.Income != 0 || p.Sales != 0 || p.Expense != 0 || p.Appointments != 0).ToList();
        if ((range.To - range.From).TotalDays > 45 && busy.Count > 1)
            return busy.Select(p => (object)Row(("Dönem", p.Label), ("income", p.Income), ("Satış", Money(p.Sales)), ("Randevu", p.Appointments))).ToList();
        return summary.PaymentMethods.Where(x => x.Amount != 0).Select(x => (object)new { method = x.Label, amount = x.Amount, count = x.Count }).ToList();
    }

    private async Task<DataAnswer> RevenueAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        if (await SummaryAsync(range, ct) is not { } summary) return new DataAnswer(v.Error(), []);
        var income = Metric(summary, "income");
        var expense = Metric(summary, "expense");
        var sales = Metric(summary, "sales");
        var title = Title(range, v);
        var text = v.T(
            $"{title} gelir (tahsilat) {Money(income)} ({Hint(summary, "income")}). Satış {Money(sales)}, gider {Money(expense)}, net {Money(income - expense)}.",
            $"{title}: income (collections) {Money(income)}. Sales {Money(sales)}, expenses {Money(expense)}, net {Money(income - expense)}.")
            + Change(income, Metric(summary, "income", previous: true), v);
        return new DataAnswer(text, FinanceItems(summary, range));
    }

    private async Task<DataAnswer> ExpensesAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        if (await SummaryAsync(range, ct) is not { } summary) return new DataAnswer(v.Error(), []);
        var expense = Metric(summary, "expense");
        var title = Title(range, v);
        if (expense == 0) return new DataAnswer(v.T($"{title}: kayıtlı gider yok.", $"{title}: no expenses recorded."), []);
        var top = summary.ExpenseCategories.OrderByDescending(x => x.Amount).FirstOrDefault();
        var text = v.T($"{title} toplam gider {Money(expense)} ({Hint(summary, "expense")})." + (top is null ? "" : $" En büyük kalem: {top.Label} ({Money(top.Amount)})."),
                $"{title}: total expenses {Money(expense)}." + (top is null ? "" : $" Largest: {top.Label} ({Money(top.Amount)})."))
            + Change(expense, Metric(summary, "expense", previous: true), v);
        return new DataAnswer(text, summary.ExpenseCategories.OrderByDescending(x => x.Amount)
            .Select(x => (object)Row(("Kategori", x.Label), ("amount", x.Amount), ("count", x.Count))).ToList());
    }

    private async Task<DataAnswer> ProfitAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        if (await SummaryAsync(range, ct) is not { } summary) return new DataAnswer(v.Error(), []);
        var income = Metric(summary, "income");
        var expense = Metric(summary, "expense");
        var net = income - expense;
        var previousNet = Metric(summary, "income", true) - Metric(summary, "expense", true);
        var margin = income > 0 ? Math.Round(net / income * 100m, 0) : 0m;
        var title = Title(range, v);
        var verdict = net >= 0 ? v.T("kâr", "profit") : v.T("zarar", "loss");
        var text = v.T($"{title} net {verdict} {Money(Math.Abs(net))}: gelir {Money(income)} − gider {Money(expense)}" + (income > 0 && net >= 0 ? $" (kâr marjı %{margin})." : "."),
                $"{title}: net {verdict} {Money(Math.Abs(net))} — income {Money(income)} − expenses {Money(expense)}.")
            + Change(net, previousNet, v);
        var items = new List<object>
        {
            Row(("Kalem", v.T("Gelir (tahsilat)", "Income")), ("amount", income)),
            Row(("Kalem", v.T("Gider", "Expenses")), ("amount", expense)),
            Row(("Kalem", v.T("Net", "Net")), ("amount", net)),
            Row(("Kalem", v.T("Önceki dönem net", "Previous net")), ("amount", previousNet)),
        };
        return new DataAnswer(text, items);
    }

    private async Task<DataAnswer> SalesAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        if (await SummaryAsync(range, ct) is not { } summary) return new DataAnswer(v.Error(), []);
        var sales = Metric(summary, "sales");
        var title = Title(range, v);
        var text = v.T($"{title} satış tutarı {Money(sales)} ({Hint(summary, "sales")}); bunun tahsil edilmeyen kısmı {Money(Metric(summary, "openReceivable"))}.",
                $"{title}: sales {Money(sales)}; uncollected part {Money(Metric(summary, "openReceivable"))}.")
            + Change(sales, Metric(summary, "sales", previous: true), v);
        return new DataAnswer(text, summary.RevenueSources.Where(x => x.Amount != 0)
            .Select(x => (object)Row(("Kaynak", x.Label), ("amount", x.Amount), ("count", x.Count))).ToList());
    }

    private async Task<DataAnswer> PaymentMethodsAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        if (await SummaryAsync(range, ct) is not { } summary) return new DataAnswer(v.Error(), []);
        var methods = summary.PaymentMethods.Where(x => x.Amount != 0).OrderByDescending(x => x.Amount).ToList();
        var title = Title(range, v);
        if (methods.Count == 0) return new DataAnswer(v.T($"{title}: tahsilat yok.", $"{title}: no collections."), []);
        var text = v.T($"{title} tahsilatın dağılımı: " + string.Join(", ", methods.Select(x => $"{x.Label} {Money(x.Amount)}")) + ".",
            $"{title} collections by method: " + string.Join(", ", methods.Select(x => $"{x.Label} {Money(x.Amount)}")) + ".");
        return new DataAnswer(text, methods.Select(x => (object)new { method = x.Label, amount = x.Amount, count = x.Count }).ToList());
    }

    private IQueryable<CustomerAccount> ScopedAccounts()
    {
        // Taksit tablosunda kurum filtresi yok: kapsam hesap (kurum + şube filtreli) üzerinden kurulur.
        var accounts = db.CustomerAccounts.AsNoTracking().Where(x => x.TenantId == TenantId);
        if (ScopeBranch is Guid branch) accounts = accounts.Where(x => x.BranchId == null || x.BranchId == branch);
        return accounts;
    }

    private async Task<DataAnswer> OverdueAsync(AssistantVoice v, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(LocalNow);
        var rows = await (from account in ScopedAccounts()
                          join installment in db.Installments.AsNoTracking() on account.Id equals installment.CustomerAccountId
                          where installment.Status == InstallmentStatus.Planned && installment.DueDate < today
                          select new { account.CustomerId, CustomerName = account.Customer!.FullName, installment.Amount, installment.DueDate }).Take(1000).ToListAsync(ct);
        if (rows.Count == 0) return new DataAnswer(v.T("Geciken taksit yok.", "There are no overdue installments."), []);
        var byCustomer = rows.GroupBy(x => x.CustomerId)
            .Select(g => new { CustomerId = g.Key, Name = g.First().CustomerName, Amount = g.Sum(x => x.Amount), Oldest = g.Min(x => x.DueDate) })
            .OrderByDescending(x => x.Amount).Take(10).ToList();
        return new DataAnswer(v.T($"{rows.Select(x => x.CustomerId).Distinct().Count()} müşteride {rows.Count} geciken taksit var, toplam {Money(rows.Sum(x => x.Amount))}.",
                $"{rows.Count} overdue installments across {rows.Select(x => x.CustomerId).Distinct().Count()} customers, {Money(rows.Sum(x => x.Amount))} in total."),
            byCustomer.Select(x => (object)new { customer = x.Name, amount = x.Amount, oldest = x.Oldest.ToString("d MMMM", Tr) }).ToList());
    }

    /// <summary>Müşterilerin açık borcu (ödenmemiş taksitler) — anlık; vadesi geçen kısım ayrıca söylenir.</summary>
    private async Task<DataAnswer> ReceivablesAsync(AssistantVoice v, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(LocalNow);
        var rows = await (from account in ScopedAccounts()
                          join installment in db.Installments.AsNoTracking() on account.Id equals installment.CustomerAccountId
                          where installment.Status == InstallmentStatus.Planned
                          select new { account.CustomerId, CustomerName = account.Customer!.FullName, installment.Amount, installment.DueDate }).Take(20000).ToListAsync(ct);
        if (rows.Count == 0) return new DataAnswer(v.T("Ödenmemiş taksit (açık alacak) yok.", "There are no open receivables."), []);
        var total = rows.Sum(x => x.Amount);
        var overdue = rows.Where(x => x.DueDate < today).Sum(x => x.Amount);
        var customers = rows.Select(x => x.CustomerId).Distinct().Count();
        var top = rows.GroupBy(x => x.CustomerId)
            .Select(g => new { Name = g.First().CustomerName, Amount = g.Sum(x => x.Amount), Late = g.Where(x => x.DueDate < today).Sum(x => x.Amount), Next = g.Min(x => x.DueDate) })
            .OrderByDescending(x => x.Amount).Take(10).ToList();
        return new DataAnswer(v.T($"{customers} müşterinin toplam açık borcu {Money(total)}; bunun {Money(overdue)} kadarının vadesi geçmiş.",
                $"{customers} customers owe {Money(total)} in total; {Money(overdue)} of it is overdue."),
            top.Select(x => (object)Row(("customer", x.Name), ("amount", x.Amount), ("Geciken", Money(x.Late)), ("Sıradaki vade", x.Next.ToString("d MMMM yyyy", Tr)))).ToList());
    }

    // ── Yönetici: stok ──────────────────────────────────────────────────────

    private async Task<DataAnswer> CriticalStockAsync(AssistantVoice v, CancellationToken ct)
    {
        var query = db.Products.AsNoTracking().Where(x => x.TenantId == TenantId && x.IsActive && x.MinStockLevel > 0 && x.CurrentStock <= x.MinStockLevel);
        if (ScopeBranch is Guid branch) query = query.Where(x => x.BranchId == null || x.BranchId == branch);
        var rows = await query.OrderBy(x => x.CurrentStock - x.MinStockLevel).Select(x => new { x.Name, x.CurrentStock, x.MinStockLevel, x.Unit }).Take(50).ToListAsync(ct);
        var items = rows.Take(15).Select(x => (object)new { product = x.Name, stock = x.CurrentStock, min = x.MinStockLevel, unit = x.Unit }).ToList();
        return rows.Count == 0
            ? new DataAnswer(v.T("Kritik seviyede ürün yok.", "No products are at critical level."), items)
            : new DataAnswer(v.T($"{rows.Count} ürün kritik seviyede ya da altında.", $"{rows.Count} products are at or below critical level."), items);
    }

    private async Task<DataAnswer> InventoryAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var result = await reports.GetInventoryAsync(TenantId, ReportRange(range), ct);
        if (result.IsFailure || result.Value is not { } inv) return new DataAnswer(v.Error(), []);
        var title = Title(range, v);
        var text = v.T(
            $"{inv.ProductCount} ürün var; {inv.CriticalCount} tanesi kritik seviyede, {inv.OutOfStockCount} tanesi tükenmiş. Stok değeri maliyetle {Money(inv.StockValueAtCost)}, satış fiyatıyla {Money(inv.StockValueAtSale)}. {title} ürün satışı {Money(inv.SoldAmount)} (kâr {Money(inv.SoldProfit)}).",
            $"{inv.ProductCount} products; {inv.CriticalCount} critical, {inv.OutOfStockCount} out of stock. Stock value {Money(inv.StockValueAtCost)} at cost, {Money(inv.StockValueAtSale)} at sale price. {title}: product sales {Money(inv.SoldAmount)} (profit {Money(inv.SoldProfit)}).");
        var items = inv.Products.Where(x => x.SoldQuantity > 0).OrderByDescending(x => x.SoldAmount).Take(10)
            .Select(x => (object)Row(("product", x.Name), ("Satılan", x.SoldQuantity), ("amount", x.SoldAmount), ("stock", x.CurrentStock))).ToList();
        if (items.Count == 0)
            items = inv.Products.OrderBy(x => x.CurrentStock).Take(10)
                .Select(x => (object)Row(("product", x.Name), ("stock", x.CurrentStock), ("min", x.MinStockLevel))).ToList();
        return new DataAnswer(text, items);
    }

    private async Task<DataAnswer> WaitlistAsync(AssistantVoice v, CancellationToken ct)
    {
        var query = db.WaitlistEntries.AsNoTracking().Where(x => x.TenantId == TenantId && (x.Status == WaitlistStatus.Waiting || x.Status == WaitlistStatus.Notified));
        if (ScopeBranch is Guid branch) query = query.Where(x => x.BranchId == null || x.BranchId == branch);
        var rows = await (from entry in query
                          join customer in db.Customers.AsNoTracking() on entry.CustomerId equals customer.Id
                          orderby entry.PreferredDate
                          select new { customer.FullName, entry.PreferredDate, entry.Status }).Take(100).ToListAsync(ct);
        var items = rows.Take(15).Select(x => (object)new
        {
            customer = x.FullName,
            date = x.PreferredDate.ToString("d MMMM", Tr),
            status = x.Status == WaitlistStatus.Notified ? v.T("teklif gönderildi", "offer sent") : v.T("bekliyor", "waiting"),
        }).ToList();
        return rows.Count == 0
            ? new DataAnswer(v.T("Bekleme listesi boş.", "The waitlist is empty."), items)
            : new DataAnswer(v.T($"Bekleme listesinde {rows.Count} kişi var.", $"{rows.Count} people are on the waitlist."), items);
    }

    // ── Yönetici: personel, hizmet, şube ────────────────────────────────────

    private async Task<DataAnswer> TopStaffAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var result = await reports.GetStaffAsync(TenantId, ReportRange(range), ct);
        if (result.IsFailure || result.Value is not { } report) return new DataAnswer(v.Error(), []);
        var title = Title(range, v);
        var rows = report.Rows.Where(x => x.AppointmentCount > 0 || x.SalesAmount > 0 || x.ServiceRevenue > 0)
            .OrderByDescending(x => x.CompletedCount).ThenByDescending(x => x.ServiceRevenue).ToList();
        if (rows.Count == 0) return new DataAnswer(v.T($"{title}: personel için tamamlanmış randevu ya da satış yok.", $"{title}: no completed appointments or sales for staff."), []);
        var top = rows[0];
        var byRevenue = rows.OrderByDescending(x => x.ServiceRevenue + x.SalesAmount).First();
        var text = v.T($"{title} en çok çalışan {top.StaffName}: {top.CompletedCount} tamamlanan randevu."
                + (byRevenue.StaffMemberId != top.StaffMemberId ? $" En çok ciro yapan {byRevenue.StaffName} ({Money(byRevenue.ServiceRevenue + byRevenue.SalesAmount)})." : $" Cirosu {Money(top.ServiceRevenue + top.SalesAmount)}.")
                + $" Toplam {report.TotalCompleted} tamamlanan randevu, hizmet cirosu {Money(report.TotalServiceRevenue)}.",
            $"{title}: busiest is {top.StaffName} with {top.CompletedCount} completed appointments. Total {report.TotalCompleted} completed, service revenue {Money(report.TotalServiceRevenue)}.");
        return new DataAnswer(text, rows.Take(10).Select(x => (object)Row(
            ("staff", x.StaffName), ("completed", x.CompletedCount), ("revenue", x.ServiceRevenue), ("Satış", Money(x.SalesAmount)),
            ("Prim", Money(x.CommissionEarned)), ("Puan", x.RatingCount > 0 ? x.AverageRating.ToString("0.0", Tr) : "—"))).ToList());
    }

    private async Task<DataAnswer> TopServicesAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var result = await reports.GetCatalogAsync(TenantId, ReportRange(range), ct);
        if (result.IsFailure || result.Value is not { } catalog) return new DataAnswer(v.Error(), []);
        var title = Title(range, v);
        var services = catalog.Services.Where(x => x.SessionsInPeriod > 0 || x.SoldCount > 0)
            .OrderByDescending(x => x.SessionsInPeriod + x.SoldCount).ThenByDescending(x => x.SessionRevenue + x.GrossAmount).ToList();
        var packages = catalog.Packages.Where(x => x.SoldCount > 0).OrderByDescending(x => x.SoldCount).ThenByDescending(x => x.GrossAmount).ToList();
        if (services.Count == 0 && packages.Count == 0)
            return new DataAnswer(v.T($"{title}: satılan ya da yapılan hizmet/paket yok.", $"{title}: no services or packages sold or performed."), []);
        var parts = new List<string>();
        if (services.Count > 0) parts.Add(v.T($"en çok yapılan hizmet {services[0].Name} ({services[0].SessionsInPeriod + services[0].SoldCount} kez)",
            $"top service {services[0].Name} ({services[0].SessionsInPeriod + services[0].SoldCount} times)"));
        if (packages.Count > 0) parts.Add(v.T($"en çok satan paket {packages[0].Name} ({packages[0].SoldCount} adet, {Money(packages[0].GrossAmount)})",
            $"top package {packages[0].Name} ({packages[0].SoldCount} sold, {Money(packages[0].GrossAmount)})"));
        var items = services.Take(8).Select(x => (object)Row(("service", x.Name), ("Tür", v.T("Hizmet", "Service")), ("count", x.SessionsInPeriod + x.SoldCount), ("amount", x.SessionRevenue + x.GrossAmount)))
            .Concat(packages.Take(5).Select(x => (object)Row(("service", x.Name), ("Tür", v.T("Paket", "Package")), ("count", x.SoldCount), ("amount", x.GrossAmount))))
            .ToList();
        return new DataAnswer(v.T($"{title} " + string.Join("; ", parts) + ".", $"{title}: " + string.Join("; ", parts) + "."), items);
    }

    private async Task<DataAnswer> BranchesAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var result = await reports.GetBranchesAsync(TenantId, ReportRange(range), ct);
        if (result.IsFailure || result.Value is not { } report) return new DataAnswer(v.Error(), []);
        var title = Title(range, v);
        var rows = report.Rows.OrderByDescending(x => x.Income).ToList();
        if (rows.Count == 0) return new DataAnswer(v.T("Şube bulunamadı.", "No branches found."), []);
        var scoped = report.ScopedToSingleBranch
            ? v.T(" (Üst menüde tek şube seçili olduğu için yalnız o şube.)", " (Only the branch selected in the top menu.)") : string.Empty;
        var text = v.T($"{title} en çok gelir {rows[0].BranchName} şubesinde: {Money(rows[0].Income)}. Tüm şubeler: gelir {Money(report.TotalIncome)}, gider {Money(report.TotalExpense)}, net {Money(report.TotalNet)}.{scoped}",
            $"{title}: top branch {rows[0].BranchName} with {Money(rows[0].Income)}. All branches: income {Money(report.TotalIncome)}, expenses {Money(report.TotalExpense)}, net {Money(report.TotalNet)}.{scoped}");
        return new DataAnswer(text, rows.Select(x => (object)Row(
            ("Şube", x.BranchName), ("income", x.Income), ("Gider", Money(x.Expense)), ("Net", Money(x.Net)), ("Randevu", x.AppointmentCount), ("Yeni müşteri", x.NewCustomerCount))).ToList());
    }

    // ── Yönetici: müşteriler ────────────────────────────────────────────────

    private IQueryable<Customer> ScopedCustomers()
    {
        var query = db.Customers.AsNoTracking().Where(x => x.TenantId == TenantId);
        if (ScopeBranch is Guid branch) query = query.Where(x => x.BranchId == branch);
        return query;
    }

    private async Task<DataAnswer> NewCustomersAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var start = Utc(range.From);
        var end = Utc(range.To);
        var (prevFrom, prevTo) = range.Previous();
        var prevStart = Utc(prevFrom);
        var prevEnd = Utc(prevTo);
        var rows = await ScopedCustomers().Where(x => x.CreatedAtUtc >= start && x.CreatedAtUtc < end)
            .OrderByDescending(x => x.CreatedAtUtc).Select(x => new { x.FullName, x.CreatedAtUtc }).Take(5000).ToListAsync(ct);
        var previous = await ScopedCustomers().CountAsync(x => x.CreatedAtUtc >= prevStart && x.CreatedAtUtc < prevEnd, ct);
        var title = Title(range, v);
        if (rows.Count == 0) return new DataAnswer(v.T($"{title}: yeni müşteri kaydı yok.", $"{title}: no new customers."), []);
        return new DataAnswer(v.T($"{title} {rows.Count} yeni müşteri kaydedildi.", $"{title}: {rows.Count} new customers.") + Change(rows.Count, previous, v),
            rows.Take(15).Select(x => (object)new { customer = x.FullName, date = ShortDay(x.CreatedAtUtc) }).ToList());
    }

    private async Task<DataAnswer> CustomerCountAsync(AssistantVoice v, CancellationToken ct)
    {
        var total = await ScopedCustomers().CountAsync(ct);
        var vip = await ScopedCustomers().CountAsync(x => x.IsVip, ct);
        var blacklisted = await ScopedCustomers().CountAsync(x => x.IsBlacklisted, ct);
        var since = DateTime.UtcNow.AddDays(-90);
        var active = await Appointments().Where(x => x.StartUtc >= since && x.Status != AppointmentStatus.Cancelled)
            .Select(x => x.CustomerId).Distinct().CountAsync(ct);
        var monthStart = Utc(MonthRange.From);
        var newThisMonth = await ScopedCustomers().CountAsync(x => x.CreatedAtUtc >= monthStart, ct);
        return new DataAnswer(v.T($"Toplam {total} kayıtlı müşteri var; son 90 günde {active} müşteri randevuya geldi. {vip} VIP, {blacklisted} kara listede; bu ay {newThisMonth} yeni kayıt.",
                $"{total} customers in total; {active} visited in the last 90 days. {vip} VIP, {blacklisted} blacklisted; {newThisMonth} new this month."),
            [
                Row(("Kalem", v.T("Toplam müşteri", "Total")), ("count", total)),
                Row(("Kalem", v.T("Son 90 günde gelen", "Active (90 days)")), ("count", active)),
                Row(("Kalem", "VIP"), ("count", vip)),
                Row(("Kalem", v.T("Kara liste", "Blacklisted")), ("count", blacklisted)),
                Row(("Kalem", v.T("Bu ay yeni", "New this month")), ("count", newThisMonth)),
            ]);
    }

    private async Task<DataAnswer> TopCustomersAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var result = await reports.GetCustomersAsync(TenantId, ReportRange(range, compare: false), ct);
        if (result.IsFailure || result.Value is not { } report) return new DataAnswer(v.Error(), []);
        var title = Title(range, v);
        var rows = report.TopCustomers.Take(10).ToList();
        if (rows.Count == 0) return new DataAnswer(v.T($"{title}: harcaması olan müşteri yok.", $"{title}: no customer spending."), []);
        return new DataAnswer(v.T($"{title} en çok harcayan müşteri {rows[0].FullName}: {Money(rows[0].Spent)} ({rows[0].VisitCount} ziyaret).",
                $"{title}: top customer {rows[0].FullName} with {Money(rows[0].Spent)} ({rows[0].VisitCount} visits)."),
            rows.Select(x => (object)Row(("customer", x.FullName), ("amount", x.Spent), ("Ziyaret", x.VisitCount), ("Borç", Money(x.Debt)),
                ("last", x.LastVisitUtc is DateTime last ? ShortDay(last) : "—"))).ToList());
    }

    private async Task<DataAnswer> PassiveCustomersAsync(AssistantVoice v, CancellationToken ct)
    {
        var result = await customerService.GetPassiveCustomersAsync(TenantId, ct);
        if (result.IsFailure || result.Value is not { } list)
            return new DataAnswer(result.IsFailure && result.Error.Code == "Conflict" ? v.NotInPlan() : v.Error(), []);
        var rows = list.Items.Where(x => ScopeBranch is not Guid branch || x.BranchId == branch).OrderByDescending(x => x.DaysSinceActivity).ToList();
        if (rows.Count == 0) return new DataAnswer(v.T($"{list.ThresholdDays} günden uzun süredir gelmeyen müşteri yok.", $"No customers inactive for more than {list.ThresholdDays} days."), []);
        return new DataAnswer(v.T($"{rows.Count} müşteri {list.ThresholdDays} günden uzun süredir gelmiyor.", $"{rows.Count} customers haven't visited for over {list.ThresholdDays} days."),
            rows.Take(15).Select(x => (object)Row(("customer", x.FullName), ("last", x.LastActivityUtc is DateTime last ? ShortDay(last) : "—"), ("Gün", x.DaysSinceActivity))).ToList());
    }

    private async Task<DataAnswer> BirthdaysAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        // Yalnız ay-gün eşleşir; dönem en fazla bir yıl. Ad şifreli olduğundan doğum tarihi olanlar çekilip bellekte süzülür.
        var days = Enumerable.Range(0, (int)Math.Min(366, Math.Max(1, (range.To - range.From).TotalDays)))
            .Select(i => range.From.AddDays(i)).ToList();
        var wanted = days.Select(d => (d.Month, d.Day)).ToHashSet();
        var people = await ScopedCustomers().Where(x => x.BirthDate != null)
            .Select(x => new { x.FullName, x.BirthDate }).Take(50000).ToListAsync(ct);
        var rows = people.Where(x => wanted.Contains((x.BirthDate!.Value.Month, x.BirthDate.Value.Day)))
            .Select(x => new { x.FullName, Date = days.First(d => d.Month == x.BirthDate!.Value.Month && d.Day == x.BirthDate.Value.Day) })
            .OrderBy(x => x.Date).ToList();
        var title = Title(range, v);
        if (rows.Count == 0) return new DataAnswer(v.T($"{title}: doğum günü olan müşteri yok.", $"{title}: no customer birthdays."), []);
        return new DataAnswer(v.T($"{title} {rows.Count} müşterinin doğum günü var.", $"{title}: {rows.Count} customer birthdays."),
            rows.Take(30).Select(x => (object)new { customer = x.FullName, date = x.Date.ToString("d MMMM dddd", Tr) }).ToList());
    }

    private async Task<DataAnswer> NoShowsAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var start = Utc(range.From);
        var end = Utc(range.To);
        var missed = await Appointments().Where(x => x.Status == AppointmentStatus.NoShow && x.StartUtc >= start && x.StartUtc < end)
            .Select(x => new { x.CustomerId, Customer = x.Customer!.FullName, x.StartUtc }).Take(5000).ToListAsync(ct);
        var title = Title(range, v);
        var rows = missed.GroupBy(x => x.CustomerId)
            .Select(g => new { Name = g.First().Customer, Count = g.Count(), Last = g.Max(x => x.StartUtc) })
            .OrderByDescending(x => x.Count).ThenByDescending(x => x.Last).Take(15).ToList();
        if (rows.Count == 0) return new DataAnswer(v.T($"{title}: randevusuna gelmeyen müşteri yok.", $"{title}: no no-shows."), []);
        return new DataAnswer(v.T($"{title} {missed.Count} randevuya gelinmedi ({missed.Select(x => x.CustomerId).Distinct().Count()} müşteri).",
                $"{title}: {missed.Count} no-shows ({missed.Select(x => x.CustomerId).Distinct().Count()} customers)."),
            rows.Select(x => (object)new { customer = x.Name, count = x.Count, last = Day(x.Last) }).ToList());
    }

    private async Task<DataAnswer> CancellationsAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var start = Utc(range.From);
        var end = Utc(range.To);
        var all = await Appointments().Where(x => x.StartUtc >= start && x.StartUtc < end)
            .Select(x => new { x.Status, x.StartUtc, Customer = x.Customer!.FullName, Service = x.ServiceDefinition!.Name, x.CancellationReason })
            .Take(20000).ToListAsync(ct);
        var cancelled = all.Where(x => x.Status == AppointmentStatus.Cancelled).OrderByDescending(x => x.StartUtc).ToList();
        var title = Title(range, v);
        if (cancelled.Count == 0) return new DataAnswer(v.T($"{title}: iptal edilen randevu yok.", $"{title}: no cancelled appointments."), []);
        var rate = Math.Round(cancelled.Count * 100m / all.Count, 0);
        return new DataAnswer(v.T($"{title} {cancelled.Count} randevu iptal edildi (tüm randevuların %{rate}'i).",
                $"{title}: {cancelled.Count} appointments were cancelled ({rate}% of all)."),
            cancelled.Take(15).Select(x => (object)Row(("when", $"{ShortDay(x.StartUtc)} {Clock(x.StartUtc)}"), ("customer", x.Customer), ("service", x.Service),
                ("Neden", string.IsNullOrWhiteSpace(x.CancellationReason) ? "—" : x.CancellationReason))).ToList());
    }

    private async Task<DataAnswer> BusiestTimesAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        var start = Utc(range.From);
        var end = Utc(range.To);
        var times = await Appointments().Where(x => x.StartUtc >= start && x.StartUtc < end && x.Status != AppointmentStatus.Cancelled)
            .Select(x => x.StartUtc).Take(50000).ToListAsync(ct);
        var title = Title(range, v);
        if (times.Count == 0) return new DataAnswer(v.T($"{title}: randevu yok, yoğunluk hesaplanamadı.", $"{title}: no appointments to analyse."), []);
        var local = times.Select(t => t + TurkeyOffset).ToList();
        var byDay = local.GroupBy(t => t.DayOfWeek).OrderByDescending(g => g.Count()).ToList();
        var byHour = local.GroupBy(t => t.Hour).OrderByDescending(g => g.Count()).ToList();
        string DayName(DayOfWeek d) => Tr.DateTimeFormat.GetDayName(d);
        var quietest = byDay.Count > 1 ? v.T($" En sakin gün {DayName(byDay[^1].Key)}.", "") : string.Empty;
        var text = v.T($"{title} en yoğun gün {DayName(byDay[0].Key)} ({byDay[0].Count()} randevu), en yoğun saat {byHour[0].Key:00}:00–{byHour[0].Key + 1:00}:00 ({byHour[0].Count()} randevu).{quietest}",
            $"{title}: busiest day {byDay[0].Key} ({byDay[0].Count()}), busiest hour {byHour[0].Key:00}:00 ({byHour[0].Count()}).");
        var items = byDay.Select(g => (object)Row(("day", DayName(g.Key)), ("count", g.Count()),
            ("En yoğun saat", $"{g.GroupBy(t => t.Hour).OrderByDescending(h => h.Count()).First().Key:00}:00"))).ToList();
        return new DataAnswer(text, items);
    }

    // ── Müşteri ─────────────────────────────────────────────────────────────

    private async Task<DataAnswer> CustomerNextAsync(AssistantVoice v, CancellationToken ct)
    {
        if (currentUser.CustomerId is not Guid customerId) return new DataAnswer(v.OutOfPortal(), []);
        var next = await db.Appointments.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.CustomerId == customerId && x.StartUtc >= DateTime.UtcNow)
            .Where(IsActive)
            .OrderBy(x => x.StartUtc).Select(x => new { x.StartUtc, Service = x.ServiceDefinition!.Name, Staff = x.StaffMember!.FullName })
            .FirstOrDefaultAsync(ct);
        if (next is null) return new DataAnswer(v.T("Yaklaşan randevunuz yok.", "You have no upcoming appointments."), []);
        var when = $"{(v.English ? DayEn(next.StartUtc) : Day(next.StartUtc))} {Clock(next.StartUtc)}";
        return new DataAnswer(v.T($"Yaklaşan randevunuz {when}: {next.Service}.", $"Your upcoming appointment is {when}: {next.Service}."),
            [new { when, service = next.Service, staff = next.Staff }]);
    }

    /// <summary>Müşterinin KENDİ randevuları, sorduğu gün/dönemde ("yarın randevum var mı", "aralıktaki randevularım").</summary>
    private async Task<DataAnswer> CustomerAppointmentsAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        if (currentUser.CustomerId is not Guid customerId) return new DataAnswer(v.OutOfPortal(), []);
        var start = Utc(range.From);
        var end = Utc(range.To);
        var rows = await db.Appointments.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.CustomerId == customerId && x.Status != AppointmentStatus.Draft && x.StartUtc >= start && x.StartUtc < end)
            .OrderBy(x => x.StartUtc).Take(50)
            .Select(x => new { x.StartUtc, Service = x.ServiceDefinition!.Name, x.Status }).ToListAsync(ct);
        var title = Title(range, v);
        return rows.Count == 0
            ? new DataAnswer(v.T($"{title}: randevunuz yok.", $"{title}: you have no appointments."), [])
            : new DataAnswer(v.T($"{title}: {rows.Count} randevunuz var.", $"{title}: you have {rows.Count} appointments."),
                rows.Select(x => (object)new { when = $"{Day(x.StartUtc)} {Clock(x.StartUtc)}", service = x.Service, status = StatusTr(x.Status) }).ToList());
    }

    private async Task<DataAnswer> CustomerSessionsAsync(AssistantVoice v, CancellationToken ct)
    {
        if (currentUser.CustomerId is not Guid customerId) return new DataAnswer(v.OutOfPortal(), []);
        var rows = await db.CustomerPackageSessions.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.CustomerId == customerId && x.TotalSessions > x.UsedSessions)
            .Select(x => new { Service = x.ServiceDefinition!.Name, Left = x.TotalSessions - x.UsedSessions, x.TotalSessions })
            .ToListAsync(ct);
        return rows.Count == 0
            ? new DataAnswer(v.T("Kalan seansınız yok.", "You have no sessions left."), [])
            : new DataAnswer(v.T($"Toplam {rows.Sum(x => x.Left)} seansınız kaldı.", $"You have {rows.Sum(x => x.Left)} sessions left."),
                rows.Select(x => (object)new { service = x.Service, left = x.Left, total = x.TotalSessions }).ToList());
    }

    private async Task<DataAnswer> CustomerHistoryAsync(AssistantVoice v, CancellationToken ct)
    {
        if (currentUser.CustomerId is not Guid customerId) return new DataAnswer(v.OutOfPortal(), []);
        var rows = await db.Appointments.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.CustomerId == customerId && x.Status != AppointmentStatus.Draft && x.StartUtc < DateTime.UtcNow)
            .OrderByDescending(x => x.StartUtc).Take(10)
            .Select(x => new { x.StartUtc, Service = x.ServiceDefinition!.Name, x.Status }).ToListAsync(ct);
        return rows.Count == 0
            ? new DataAnswer(v.T("Geçmiş randevunuz yok.", "You have no past appointments."), [])
            : new DataAnswer(v.T($"Son {rows.Count} randevunuz:", $"Your last {rows.Count} appointments:"),
                rows.Select(x => (object)new { when = Day(x.StartUtc), service = x.Service, status = StatusTr(x.Status) }).ToList());
    }

    // ── Brifing ─────────────────────────────────────────────────────────────

    private async Task<IReadOnlyList<string>> BriefingLinesAsync(string portal, IReadOnlyCollection<string>? active, AssistantVoice v, CancellationToken ct)
    {
        var lines = new List<string>();
        async Task Add(AssistantIntent intent)
        {
            var rule = AssistantIntentCatalog.RuleFor(intent)!;
            if (!rule.Portals.Contains(portal) || !HasAny(active, rule.FeatureKeys) || !Granted(portal, rule.StaffPermission)) return;
            lines.Add((await DataAsync(intent, null, portal, v, ct)).Text);
        }
        switch (portal)
        {
            case AssistantPortals.Staff:
                await Add(AssistantIntent.AppointmentsToday);
                await Add(AssistantIntent.NextAppointment);
                break;
            case AssistantPortals.Customer:
                await Add(AssistantIntent.NextAppointment);
                break;
            default:
                await Add(AssistantIntent.AppointmentsToday);
                await Add(AssistantIntent.PendingApprovals);
                await Add(AssistantIntent.CriticalStock);
                break;
        }
        return lines;
    }
}
