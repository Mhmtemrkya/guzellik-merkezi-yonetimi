using System.Globalization;
using GuzellikMerkezi.Application.Features.CashFlow;
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
    private static string DayEn(DateTime utc) => (utc + TurkeyOffset).ToString("dddd, MMMM d", CultureInfo.InvariantCulture);
    private static string Money(decimal value) => value.ToString("#,##0.00", Tr) + " ₺";

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

    private async Task<DataAnswer> DataAsync(AssistantIntent intent, AssistantPeriod period, string portal, AssistantVoice v, CancellationToken ct)
    {
        var staff = portal == AssistantPortals.Staff;
        return intent switch
        {
            AssistantIntent.AppointmentsToday => staff ? await MyAppointmentsTodayAsync(v, ct) : await AppointmentsTodayAsync(v, ct),
            AssistantIntent.NextAppointment => staff ? await MyNextCustomerAsync(v, ct) : await CustomerNextAsync(v, ct),
            AssistantIntent.WeekSchedule => await WeekAsync(staff, v, ct),
            AssistantIntent.RemainingSessions => staff ? await MyCustomersSessionsAsync(v, ct) : await CustomerSessionsAsync(v, ct),
            AssistantIntent.MyRating => await MyRatingAsync(v, ct),
            AssistantIntent.PendingApprovals => await PendingAsync(staff, v, ct),
            AssistantIntent.FreeSlots => await FreeSlotsAsync(v, ct),
            AssistantIntent.Revenue => await RevenueAsync(period, v, ct),
            AssistantIntent.OverdueInstallments => await OverdueAsync(v, ct),
            AssistantIntent.CriticalStock => await CriticalStockAsync(v, ct),
            AssistantIntent.Waitlist => await WaitlistAsync(v, ct),
            AssistantIntent.TopStaff => await TopStaffAsync(v, ct),
            AssistantIntent.NoShows => await NoShowsAsync(v, ct),
            AssistantIntent.AppointmentHistory => await CustomerHistoryAsync(v, ct),
            _ => new DataAnswer(v.OutOfPortal(), []),
        };
    }

    // ── Personel ────────────────────────────────────────────────────────────

    private async Task<DataAnswer> MyAppointmentsTodayAsync(AssistantVoice v, CancellationToken ct)
    {
        if (await MyStaffIdAsync(ct) is not Guid staffId) return NoStaffProfile(v);
        var start = DayStartUtc(LocalNow);
        var rows = await db.Appointments.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.StaffMemberId == staffId && x.Status != AppointmentStatus.Draft && x.StartUtc >= start && x.StartUtc < start.AddDays(1))
            .OrderBy(x => x.StartUtc)
            .Select(x => new { x.StartUtc, Customer = x.Customer!.FullName, Service = x.ServiceDefinition!.Name, x.Status })
            .ToListAsync(ct);
        var items = rows.Select(x => (object)new { time = Clock(x.StartUtc), customer = x.Customer, service = x.Service, status = StatusTr(x.Status) }).ToList();
        if (rows.Count == 0) return new DataAnswer(v.T("Bugün size atanmış randevu yok.", "You have no appointments today."), items);
        // Panodaki "sırada" ile aynı: saati henüz gelmemiş açık randevular.
        var now = DateTime.UtcNow;
        var upcoming = rows.Count(x => Active.Contains(x.Status) && x.StartUtc >= now);
        return new DataAnswer(v.T($"Bugün {rows.Count} randevunuz var; {upcoming} tanesi sırada.", $"You have {rows.Count} appointments today; {upcoming} still to come."), items);
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
            : new DataAnswer(v.T($"{customerCount} paketli müşterinizin toplam {rows.Sum(x => x.Left)} seansı kaldı.",
                $"{customerCount} of your package customers have {rows.Sum(x => x.Left)} sessions left in total."), items);
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

    // ── Yönetici ────────────────────────────────────────────────────────────

    private async Task<DataAnswer> AppointmentsTodayAsync(AssistantVoice v, CancellationToken ct)
    {
        var start = DayStartUtc(LocalNow);
        var end = start.AddDays(1);
        var today = await Appointments().Where(x => x.StartUtc >= start && x.StartUtc < end)
            .Select(x => new { x.Status, x.StartUtc }).ToListAsync(ct);
        var total = today.Count;
        var items = today.GroupBy(x => x.Status).OrderBy(g => g.Key)
            .Select(g => (object)new { status = StatusTr(g.Key), count = g.Count() }).ToList();
        if (total == 0) return new DataAnswer(v.T("Bugün randevu yok.", "There are no appointments today."), items);
        // Panodaki "sırada" ile aynı: saati henüz gelmemiş açık randevular.
        var now = DateTime.UtcNow;
        var upcoming = today.Count(x => Active.Contains(x.Status) && x.StartUtc >= now);
        var done = today.Count(x => x.Status == AppointmentStatus.Completed);
        return new DataAnswer(v.T($"Bugün {total} randevu var: {done} tamamlandı, {upcoming} sırada.",
            $"{total} appointments today: {done} completed, {upcoming} still to come."), items);
    }

    private async Task<DataAnswer> WeekAsync(bool staff, AssistantVoice v, CancellationToken ct)
    {
        var today = LocalNow.Date;
        var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var start = DayStartUtc(monday);
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
            .Select(day => (object)new { day = day.ToString(v.English ? "dddd" : "dddd", v.English ? CultureInfo.InvariantCulture : Tr), count = times.Count(t => (t + TurkeyOffset).Date == day) })
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
    /// Bugün, şu andan mesai bitimine kadar her personelin boş aralıkları (çalışma saati − aktif randevular).
    /// Çalışma saati tanımlı olmayan personel listelenmez (uydurma saat gösterilmez).
    /// </summary>
    private async Task<DataAnswer> FreeSlotsAsync(AssistantVoice v, CancellationToken ct)
    {
        var local = LocalNow;
        var weekday = ((int)local.DayOfWeek + 6) % 7; // 0 = Pazartesi
        var start = DayStartUtc(local);
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

        var nowMinute = local.Hour * 60 + local.Minute;
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
                var from = (int)((appointment.StartUtc + TurkeyOffset) - local.Date).TotalMinutes;
                var to = (int)((appointment.EndUtc + TurkeyOffset) - local.Date).TotalMinutes;
                if (from - cursor >= 30) { windows.Add($"{cursor / 60:00}:{cursor % 60:00}–{from / 60:00}:{from % 60:00}"); freeTotal += from - cursor; }
                cursor = Math.Max(cursor, to);
            }
            if (shift.EndMinute - cursor >= 30) { windows.Add($"{cursor / 60:00}:{cursor % 60:00}–{shift.EndMinute / 60:00}:{shift.EndMinute % 60:00}"); freeTotal += shift.EndMinute - cursor; }
            if (windows.Count > 0) items.Add(new { staff = person.FullName, free = windows });
        }
        if (hours.Count == 0)
            return new DataAnswer(v.T("Bugün için tanımlı personel çalışma saati yok; boş saatleri hesaplayamıyorum.",
                "No staff working hours are defined for today, so I can't work out free slots."), items);
        return items.Count == 0
            ? new DataAnswer(v.T("Bugün kalan saatlerde 30 dakikalık boşluk yok.", "There are no 30-minute gaps left today."), items)
            : new DataAnswer(v.T($"Bugün {items.Count} personelde toplam {freeTotal / 60} saat {freeTotal % 60} dakika boşluk var.",
                $"{items.Count} staff have {freeTotal / 60}h {freeTotal % 60}m free in total today."), items);
    }

    private async Task<DataAnswer> RevenueAsync(AssistantPeriod period, AssistantVoice v, CancellationToken ct)
    {
        var local = LocalNow.Date;
        var from = period switch
        {
            AssistantPeriod.Month => new DateTime(local.Year, local.Month, 1),
            AssistantPeriod.Week => local.AddDays(-(((int)local.DayOfWeek + 6) % 7)),
            _ => local,
        };
        var result = await cashFlow.SummaryAsync(TenantId, new CashFlowFilter(DayStartUtc(from), DateTime.UtcNow), ct);
        if (result.IsFailure || result.Value is null) return new DataAnswer(v.Error(), []);
        var summary = result.Value;
        var label = period switch
        {
            AssistantPeriod.Month => v.T("Bu ay", "This month"),
            AssistantPeriod.Week => v.T("Bu hafta", "This week"),
            _ => v.T("Bugün", "Today"),
        };
        return new DataAnswer(v.T($"{label} tahsilat {Money(summary.TotalIncome)} ({summary.IncomeCount} işlem); gider {Money(summary.TotalExpense)}, net {Money(summary.NetAmount)}.",
            $"{label}: collections {Money(summary.TotalIncome)} ({summary.IncomeCount} entries); expenses {Money(summary.TotalExpense)}, net {Money(summary.NetAmount)}."),
            summary.ByMethod.Select(x => (object)new { method = x.Method, income = x.IncomeAmount }).ToList());
    }

    private async Task<DataAnswer> OverdueAsync(AssistantVoice v, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(LocalNow);
        // Taksit tablosunda kurum filtresi yok: kapsam hesap (kurum + şube filtreli) üzerinden kurulur.
        var accounts = db.CustomerAccounts.AsNoTracking().Where(x => x.TenantId == TenantId);
        if (ScopeBranch is Guid branch) accounts = accounts.Where(x => x.BranchId == null || x.BranchId == branch);
        var rows = await (from account in accounts
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

    private async Task<DataAnswer> TopStaffAsync(AssistantVoice v, CancellationToken ct)
    {
        var local = LocalNow;
        var start = DayStartUtc(new DateTime(local.Year, local.Month, 1));
        // Personel adı şifreli kolon: SQL'de gruplanamaz; ayın tamamlanan randevuları çekilip bellekte gruplanır.
        var done = await Appointments().Where(x => x.StartUtc >= start && x.Status == AppointmentStatus.Completed)
            .Select(x => new { x.StaffMemberId, Staff = x.StaffMember!.FullName, x.Price }).Take(20000).ToListAsync(ct);
        var rows = done.GroupBy(x => x.StaffMemberId)
            .Select(g => new { Name = g.First().Staff, Count = g.Count(), Revenue = g.Sum(x => x.Price) })
            .OrderByDescending(x => x.Count).Take(5).ToList();
        if (rows.Count == 0) return new DataAnswer(v.T("Bu ay tamamlanmış randevu yok.", "No completed appointments this month."), []);
        var top = rows[0];
        return new DataAnswer(v.T($"Bu ay en çok çalışan {top.Name}: {top.Count} tamamlanan randevu.",
                $"Busiest this month: {top.Name} with {top.Count} completed appointments."),
            rows.Select(x => (object)new { staff = x.Name, completed = x.Count, revenue = x.Revenue }).ToList());
    }

    private async Task<DataAnswer> NoShowsAsync(AssistantVoice v, CancellationToken ct)
    {
        var since = DateTime.UtcNow.AddDays(-30);
        var missed = await Appointments().Where(x => x.Status == AppointmentStatus.NoShow && x.StartUtc >= since)
            .Select(x => new { x.CustomerId, Customer = x.Customer!.FullName, x.StartUtc }).Take(5000).ToListAsync(ct);
        var rows = missed.GroupBy(x => x.CustomerId)
            .Select(g => new { Name = g.First().Customer, Count = g.Count(), Last = g.Max(x => x.StartUtc) })
            .OrderByDescending(x => x.Count).ThenByDescending(x => x.Last).Take(15).ToList();
        if (rows.Count == 0) return new DataAnswer(v.T("Son 30 günde gelmeyen müşteri yok.", "No no-shows in the last 30 days."), []);
        return new DataAnswer(v.T($"Son 30 günde {rows.Count} müşteri randevusuna gelmedi.", $"{rows.Count} customers missed appointments in the last 30 days."),
            rows.Select(x => (object)new { customer = x.Name, count = x.Count, last = Day(x.Last) }).ToList());
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
            lines.Add((await DataAsync(intent, AssistantPeriod.Today, portal, v, ct)).Text);
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
