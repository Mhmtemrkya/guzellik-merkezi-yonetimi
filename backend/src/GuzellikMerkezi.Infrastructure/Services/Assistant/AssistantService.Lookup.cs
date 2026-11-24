using System.Globalization;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services.Assistant;

/// <summary>
/// Adıyla sorulan kayıtlar (müşteri, personel, hizmet, ürün) ve rollerin kendi durum soruları.
/// KAPSAM: Maydi bir rolün kendi ekranlarında gördüğünden FAZLASINI söylemez — personel yalnız hizmet verdiği
/// müşteriyi, kendi programını görür; telefon personelde maskelidir; borç yalnız muhasebeyi görebilene; sağlık/
/// konsültasyon verisi hiçbir cevapta yoktur; müşteri yalnız kendi kaydını görür.
/// </summary>
public sealed partial class AssistantService
{
    /// <summary>Soruda adıyla geçen kayda göre niyet (kural motorunun genel niyetinden önce gelir).</summary>
    private static AssistantIntent? EntityIntent(AssistantEntities entities, string folded, string portal, AssistantIntent ruleIntent)
    {
        if (!entities.Any) return null;
        if (entities.Customers.Count > 0 && portal != AssistantPortals.Customer
            && (AssistantIntentResolver.AsksCustomer(folded) || ruleIntent is AssistantIntent.Receivables or AssistantIntent.RemainingSessions
                or AssistantIntent.AppointmentHistory or AssistantIntent.NextAppointment || OnlyNames(folded, entities)))
            return AssistantIntent.CustomerLookup;
        if (entities.Staff.Count > 0 && AssistantIntentResolver.AsksStaffSchedule(folded) && portal != AssistantPortals.Customer)
            return AssistantIntent.StaffSchedule;
        if (entities.Services.Count + entities.Packages.Count > 0 && (AssistantIntentResolver.AsksPrice(folded) || ruleIntent == AssistantIntent.ServicePrice))
            return AssistantIntent.ServicePrice;
        if (entities.Products.Count > 0 && (AssistantIntentResolver.AsksStock(folded) || AssistantIntentResolver.AsksPrice(folded)) && portal != AssistantPortals.Customer)
            return AssistantIntent.ProductStock;
        return null;
    }

    /// <summary>Soru yalnız bir addan ibaretse ("Ayşe Yılmaz?") müşteri kartı istenmiştir.</summary>
    private static bool OnlyNames(string folded, AssistantEntities entities) =>
        folded.Split(' ', StringSplitOptions.RemoveEmptyEntries).All(word => entities.NameWords.Contains(word) || AssistantEntityFinder.Roots(word).Any(entities.NameWords.Contains));

    /// <summary>Ad kelimeleri çıkarılmış metin: "Kasım Demir'in yarınki randevusu" → dönem "Kasım" ayı sanılmaz.</summary>
    private static string WithoutNames(string folded, AssistantEntities entities) =>
        string.Join(' ', folded.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(word => !entities.NameWords.Contains(word.Split('\'', '’')[0]) && !AssistantEntityFinder.Roots(word.Split('\'', '’')[0]).Any(entities.NameWords.Contains)));

    /// <summary>Ad-kayıt niyetleri ve portala göre yeniden yönlendirilen niyetler (müşteride "puanım" sadakat puanıdır…).</summary>
    private static AssistantIntent ForPortal(AssistantIntent intent, string portal) => (intent, portal) switch
    {
        (AssistantIntent.MyRating, AssistantPortals.Customer) => AssistantIntent.Loyalty,
        (AssistantIntent.MyDebt, not AssistantPortals.Customer) => AssistantIntent.Receivables,
        (AssistantIntent.MyWork, AssistantPortals.Owner or AssistantPortals.Branch) => AssistantIntent.TopStaff,
        (AssistantIntent.RemainingSessions or AssistantIntent.NextAppointment, AssistantPortals.Owner or AssistantPortals.Branch) => AssistantIntent.AppointmentsToday,
        _ => intent,
    };

    private string MaskedPhone(string? phone) =>
        currentUser.Role == UserRole.Staff ? PhoneMask.Mask(phone) : phone ?? "—";

    private bool CanSeeMoney(string portal) =>
        portal != AssistantPortals.Staff || Permissions.IsGrantedTo(currentUser.Role, false, currentUser.Permissions, Permissions.Accounting);

    // ── Müşteri kartı ───────────────────────────────────────────────────────

    private async Task<DataAnswer> CustomerLookupAsync(AssistantEntities entities, string portal, AssistantVoice v, CancellationToken ct)
    {
        if (entities.Customers.Count == 0)
            return new DataAnswer(v.T("Bu adla bir müşteri bulamadım; adı ve soyadıyla yazar mısınız?", "I couldn't find a customer by that name."), []);
        var ids = entities.Customers.Select(x => x.Id).ToList();
        var people = new List<Customer>();
        foreach (var id in ids)
            if (await ScopedCustomers().FirstOrDefaultAsync(x => x.Id == id, ct) is { } person) people.Add(person);

        if (portal == AssistantPortals.Staff && await MyStaffIdAsync(ct) is Guid me)
        {
            var mine = new List<Customer>();
            foreach (var person in people)
                if (await db.Appointments.AsNoTracking().AnyAsync(x => x.TenantId == TenantId && x.StaffMemberId == me && x.CustomerId == person.Id, ct))
                    mine.Add(person);
            if (mine.Count == 0 && people.Count > 0)
                return new DataAnswer(v.T("Bu müşteri sizin hizmet verdiğiniz müşteriler arasında değil; bilgilerini yalnız yöneticiniz görebilir.",
                    "This customer isn't one you've served; only your manager can see their details."), []);
            people = mine;
        }
        if (people.Count == 0)
            return new DataAnswer(v.T("Bu adla bir müşteri bulamadım; adı ve soyadıyla yazar mısınız?", "I couldn't find a customer by that name."), []);
        if (people.Count > 1)
            return new DataAnswer(v.T($"Bu adla {people.Count} müşteri var; hangisini soruyorsunuz? Adı ve soyadıyla yazın.",
                    $"{people.Count} customers match that name; which one do you mean?"),
                people.Take(8).Select(x => (object)new { customer = x.FullName, Telefon = MaskedPhone(x.Phone) }).ToList());

        var c = people[0];
        var now = DateTime.UtcNow;
        var visits = await db.Appointments.AsNoTracking().Where(x => x.TenantId == TenantId && x.CustomerId == c.Id && x.Status == AppointmentStatus.Completed)
            .OrderByDescending(x => x.StartUtc).Select(x => new { x.StartUtc, Service = x.ServiceDefinition!.Name }).Take(500).ToListAsync(ct);
        var next = await db.Appointments.AsNoTracking().Where(x => x.TenantId == TenantId && x.CustomerId == c.Id && x.StartUtc >= now).Where(IsActive)
            .OrderBy(x => x.StartUtc).Select(x => new { x.StartUtc, Service = x.ServiceDefinition!.Name, Staff = x.StaffMember!.FullName }).FirstOrDefaultAsync(ct);
        var sessions = await db.CustomerPackageSessions.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.CustomerId == c.Id && x.TotalSessions > x.UsedSessions)
            .Select(x => new { Service = x.ServiceDefinition!.Name, Left = x.TotalSessions - x.UsedSessions }).ToListAsync(ct);
        var today = DateOnly.FromDateTime(LocalNow);
        var debt = CanSeeMoney(portal)
            ? await (from account in ScopedAccounts()
                     join installment in db.Installments.AsNoTracking() on account.Id equals installment.CustomerAccountId
                     where account.CustomerId == c.Id && installment.Status == InstallmentStatus.Planned
                     select new { installment.Amount, installment.DueDate }).ToListAsync(ct)
            : null;
        var points = await db.LoyaltyTransactions.AsNoTracking().Where(x => x.TenantId == TenantId && x.CustomerId == c.Id).SumAsync(x => (int?)x.Points, ct) ?? 0;

        var parts = new List<string>();
        parts.Add(visits.Count > 0 ? v.T($"son geliş {ShortDay(visits[0].StartUtc)} ({visits[0].Service}), toplam {visits.Count} ziyaret", $"last visit {ShortDay(visits[0].StartUtc)}, {visits.Count} visits")
            : v.T("henüz tamamlanmış ziyareti yok", "no completed visits yet"));
        parts.Add(next is not null ? v.T($"sıradaki randevu {Day(next.StartUtc)} {Clock(next.StartUtc)} ({next.Service}, {next.Staff})", $"next appointment {DayEn(next.StartUtc)} {Clock(next.StartUtc)}")
            : v.T("yaklaşan randevusu yok", "no upcoming appointment"));
        if (sessions.Count > 0) parts.Add(v.T($"{sessions.Sum(x => x.Left)} seansı kaldı", $"{sessions.Sum(x => x.Left)} sessions left"));
        if (debt is not null) parts.Add(debt.Count > 0
            ? v.T($"açık borcu {Money(debt.Sum(x => x.Amount))}" + (debt.Any(x => x.DueDate < today) ? $" (vadesi geçen {Money(debt.Where(x => x.DueDate < today).Sum(x => x.Amount))})" : ""), $"owes {Money(debt.Sum(x => x.Amount))}")
            : v.T("borcu yok", "no debt"));
        var text = $"{c.FullName}: " + string.Join("; ", parts) + ".";

        var items = new List<object>
        {
            Row(("Kalem", v.T("Telefon", "Phone")), ("Değer", MaskedPhone(c.Phone))),
            Row(("Kalem", v.T("Son geliş", "Last visit")), ("Değer", visits.Count > 0 ? ShortDay(visits[0].StartUtc) : "—")),
            Row(("Kalem", v.T("Ziyaret", "Visits")), ("Değer", visits.Count.ToString(Tr))),
            Row(("Kalem", v.T("Sıradaki randevu", "Next appointment")), ("Değer", next is null ? "—" : $"{ShortDay(next.StartUtc)} {Clock(next.StartUtc)} · {next.Service}")),
        };
        foreach (var s in sessions) items.Add(Row(("Kalem", v.T($"Kalan seans · {s.Service}", $"Sessions left · {s.Service}")), ("Değer", s.Left.ToString(Tr))));
        if (debt is not null) items.Add(Row(("Kalem", v.T("Açık borç", "Open debt")), ("Değer", Money(debt.Sum(x => x.Amount)))));
        if (points != 0) items.Add(Row(("Kalem", v.T("Sadakat puanı", "Loyalty points")), ("Değer", points.ToString(Tr))));
        var tags = new List<string>();
        if (c.IsVip) tags.Add("VIP");
        if (c.IsBlacklisted) tags.Add(v.T("kara liste", "blacklisted"));
        tags.Add(c.KvkkConsent ? v.T("KVKK onaylı", "KVKK consent") : v.T("KVKK onayı yok", "no KVKK consent"));
        items.Add(Row(("Kalem", v.T("Durum", "Status")), ("Değer", string.Join(", ", tags))));
        return new DataAnswer(text, items);
    }

    // ── Hizmet fiyatları ────────────────────────────────────────────────────

    private async Task<DataAnswer> ServicePriceAsync(AssistantEntities entities, AssistantVoice v, CancellationToken ct)
    {
        IReadOnlyList<ServiceDefinition> services = entities.Services;
        IReadOnlyList<ServicePackage> packages = entities.Packages;
        var all = services.Count + packages.Count == 0;
        if (all)
        {
            var branch = ScopeBranch;
            services = await db.ServiceDefinitions.AsNoTracking()
                .Where(x => x.TenantId == TenantId && x.IsActive && x.Status == CatalogStatus.Active && (branch == null || x.BranchId == null || x.BranchId == branch))
                .OrderBy(x => x.Category).ThenBy(x => x.Name).Take(60).ToListAsync(ct);
            packages = await db.ServicePackages.AsNoTracking()
                .Where(x => x.TenantId == TenantId && x.IsActive && x.Status == CatalogStatus.Active && (branch == null || x.BranchId == null || x.BranchId == branch))
                .OrderBy(x => x.Name).Take(30).ToListAsync(ct);
        }
        if (services.Count + packages.Count == 0)
            return new DataAnswer(v.T("Tanımlı aktif hizmet ya da paket yok.", "There are no active services or packages."), []);
        var items = services.Select(x => (object)Row(("service", x.Name), ("Süre", $"{x.DurationMinutes} dk"), ("amount", x.Price)))
            .Concat(packages.Select(x => (object)Row(("service", x.Name), ("Süre", v.T("Paket", "Package")), ("amount", x.TotalPrice)))).ToList();
        string text;
        if (!all && services.Count + packages.Count == 1)
            text = services.Count == 1
                ? v.T($"{services[0].Name}: {Money(services[0].Price)} ({services[0].DurationMinutes} dakika).", $"{services[0].Name}: {Money(services[0].Price)} ({services[0].DurationMinutes} min).")
                : v.T($"{packages[0].Name} paketi: {Money(packages[0].TotalPrice)}.", $"{packages[0].Name} package: {Money(packages[0].TotalPrice)}.");
        else if (!all)
            text = v.T($"Bununla ilgili {services.Count} hizmet ve {packages.Count} paket var:", $"{services.Count} services and {packages.Count} packages match:");
        else
            text = v.T($"Fiyat listesi: {services.Count} hizmet, {packages.Count} paket.", $"Price list: {services.Count} services, {packages.Count} packages.");
        return new DataAnswer(text, items);
    }

    // ── Personel programı ───────────────────────────────────────────────────

    private async Task<DataAnswer> StaffScheduleAsync(AssistantEntities entities, AssistantDateRange? range, string portal, AssistantVoice v, CancellationToken ct)
    {
        if (entities.Staff.Count > 1)
            return new DataAnswer(v.T($"Bu adla {entities.Staff.Count} personel var; hangisini soruyorsunuz?", $"{entities.Staff.Count} staff match; which one?"),
                entities.Staff.Select(x => (object)new { staff = x.Name }).ToList());
        var (staffId, name) = entities.Staff[0];
        if (portal == AssistantPortals.Staff && await MyStaffIdAsync(ct) != staffId)
            return new DataAnswer(v.T("Diğer personelin programını yalnız yönetici görebilir; kendi programınızı sorabilirsiniz.",
                "Only managers can see other staff schedules; you can ask about your own."), []);

        var day = (range is { SingleDay: true } ? range.From : LocalNow).Date;
        var label = range is { SingleDay: true } ? Title(range, v) : v.T("Bugün", "Today");
        var weekday = ((int)day.DayOfWeek + 6) % 7;
        var hour = await db.StaffWorkingHours.AsNoTracking().FirstOrDefaultAsync(x => x.StaffMemberId == staffId && x.DayOfWeek == weekday, ct);
        var date = DateOnly.FromDateTime(day);
        var off = await db.StaffTimeOffs.AsNoTracking().Where(x => x.TenantId == TenantId && x.StaffMemberId == staffId && x.Date == date).ToListAsync(ct);
        var start = Utc(day);
        var appointments = await db.Appointments.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.StaffMemberId == staffId && x.StartUtc >= start && x.StartUtc < start.AddDays(1)
                && x.Status != AppointmentStatus.Draft && x.Status != AppointmentStatus.Cancelled)
            .OrderBy(x => x.StartUtc).Select(x => new { x.StartUtc, Customer = x.Customer!.FullName, Service = x.ServiceDefinition!.Name, x.Status }).ToListAsync(ct);

        static string Hm(int minute) => $"{minute / 60:00}:{minute % 60:00}";
        string status;
        if (off.Any(x => x.StartMinute <= 0 && x.EndMinute >= 24 * 60 - 1) || (off.Count > 0 && hour is not null && off.Any(x => x.StartMinute <= hour.StartMinute && x.EndMinute >= hour.EndMinute)))
            status = v.T($"izinli{(off[0].Reason is { Length: > 0 } reason ? $" ({reason})" : "")}", "off");
        else if (hour is null)
            status = v.T("için çalışma saati tanımlı değil", "has no working hours defined");
        else if (hour.IsDayOff)
            status = v.T("çalışmıyor (haftalık izin günü)", "not working (weekly day off)");
        else
        {
            status = v.T($"{Hm(hour.StartMinute)}–{Hm(hour.EndMinute)} arası çalışıyor", $"works {Hm(hour.StartMinute)}–{Hm(hour.EndMinute)}");
            if (off.Count > 0) status += v.T($"; {Hm(off[0].StartMinute)}–{Hm(off[0].EndMinute)} arası izinli", $"; off {Hm(off[0].StartMinute)}–{Hm(off[0].EndMinute)}");
        }
        var text = v.T($"{name} {label.ToLower(Tr)} {status}; {appointments.Count} randevusu var.", $"{name} ({label}) {status}; {appointments.Count} appointments.");
        return new DataAnswer(text, appointments.Select(x => (object)new { time = Clock(x.StartUtc), customer = x.Customer, service = x.Service, status = StatusTr(x.Status) }).ToList());
    }

    private async Task<DataAnswer> StaffTodayAsync(AssistantDateRange? range, AssistantVoice v, CancellationToken ct)
    {
        var day = (range is { SingleDay: true } ? range.From : LocalNow).Date;
        var label = range is { SingleDay: true } ? Title(range, v) : v.T("Bugün", "Today");
        var weekday = ((int)day.DayOfWeek + 6) % 7;
        var date = DateOnly.FromDateTime(day);
        var staffQuery = db.StaffMembers.AsNoTracking().Where(x => x.TenantId == TenantId && x.IsActive);
        if (ScopeBranch is Guid branch) staffQuery = staffQuery.Where(x => x.BranchId == branch);
        var staff = await staffQuery.Select(x => new { x.Id, x.FullName }).ToListAsync(ct);
        var hours = await (from h in db.StaffWorkingHours.AsNoTracking() join m in staffQuery on h.StaffMemberId equals m.Id where h.DayOfWeek == weekday
                           select new { h.StaffMemberId, h.StartMinute, h.EndMinute, h.IsDayOff }).ToListAsync(ct);
        var offs = await (from o in db.StaffTimeOffs.AsNoTracking() join m in staffQuery on o.StaffMemberId equals m.Id where o.Date == date
                          select new { o.StaffMemberId, o.StartMinute, o.EndMinute, o.Reason }).ToListAsync(ct);
        static string Hm(int minute) => $"{minute / 60:00}:{minute % 60:00}";
        var rows = staff.OrderBy(x => x.FullName).Select(person =>
        {
            var h = hours.FirstOrDefault(x => x.StaffMemberId == person.Id);
            var o = offs.FirstOrDefault(x => x.StaffMemberId == person.Id);
            var working = h is { IsDayOff: false } && (o is null || o.StartMinute > h.StartMinute || o.EndMinute < h.EndMinute);
            var state = o is not null && !working ? v.T("izinli", "off") + (o.Reason is { Length: > 0 } r ? $" ({r})" : "")
                : h is null ? v.T("saat tanımlı değil", "no hours")
                : h.IsDayOff ? v.T("haftalık izin", "day off")
                : $"{Hm(h.StartMinute)}–{Hm(h.EndMinute)}" + (o is not null ? v.T($" (izin {Hm(o.StartMinute)}–{Hm(o.EndMinute)})", " (partly off)") : "");
            return new { person.FullName, Working = working, State = state };
        }).ToList();
        var working = rows.Where(x => x.Working).Select(x => x.FullName).ToList();
        var offNames = rows.Where(x => !x.Working && (x.State.StartsWith("izinli", StringComparison.Ordinal) || x.State.StartsWith("off", StringComparison.Ordinal))).Select(x => x.FullName).ToList();
        if (hours.Count == 0)
            return new DataAnswer(v.T($"Personelin çalışma saatleri tanımlı olmadığı için {label.ToLower(Tr)} kimin çalıştığını bilemiyorum"
                    + (offNames.Count > 0 ? $"; izinli: {string.Join(", ", offNames)}." : "; kayıtlı izin yok.") + " Saatleri Personel → Çizelge ekranından girebilirsiniz.",
                    $"No working hours are defined, so I can't tell who works {label}."),
                rows.Select(x => (object)Row(("staff", x.FullName), ("Durum", x.State))).ToList());
        var text = v.T($"{label} {working.Count} personel çalışıyor" + (offNames.Count > 0 ? $"; izinli: {string.Join(", ", offNames)}." : "; izinli personel yok."),
            $"{label}: {working.Count} staff working" + (offNames.Count > 0 ? $"; off: {string.Join(", ", offNames)}." : "."));
        return new DataAnswer(text, rows.Select(x => (object)Row(("staff", x.FullName), ("Durum", x.State))).ToList());
    }

    // ── Ürün stoğu ──────────────────────────────────────────────────────────

    private static DataAnswer ProductStock(AssistantEntities entities, AssistantVoice v)
    {
        var rows = entities.Products;
        if (rows.Count == 0) return new DataAnswer(v.T("Bu adla bir ürün bulamadım.", "I couldn't find that product."), []);
        var text = rows.Count == 1
            ? v.T($"{rows[0].Name}: stokta {rows[0].CurrentStock.ToString("0.##", Tr)} {rows[0].Unit}" + (rows[0].MinStockLevel > 0 ? $" (kritik seviye {rows[0].MinStockLevel.ToString("0.##", Tr)})" : "") + $", satış fiyatı {Money(rows[0].SalePrice)}.",
                $"{rows[0].Name}: {rows[0].CurrentStock.ToString("0.##", CultureInfo.InvariantCulture)} {rows[0].Unit} in stock.")
            : v.T($"Bununla ilgili {rows.Count} ürün var:", $"{rows.Count} products match:");
        return new DataAnswer(text, rows.Select(x => (object)Row(("product", x.Name), ("stock", x.CurrentStock), ("unit", x.Unit), ("min", x.MinStockLevel), ("amount", x.SalePrice))).ToList());
    }

    // ── Kurum durumu ────────────────────────────────────────────────────────

    private async Task<DataAnswer> SubscriptionAsync(AssistantVoice v, CancellationToken ct)
    {
        var tenant = await db.Tenants.AsNoTracking().Where(x => x.Id == TenantId)
            .Select(x => new { x.Status, x.TrialEndsAtUtc, x.SubscriptionEndsAtUtc, x.SubscriptionPeriod, Plan = x.SubscriptionPlan != null ? x.SubscriptionPlan.Name : x.Plan })
            .FirstOrDefaultAsync(ct);
        if (tenant is null) return new DataAnswer(v.Error(), []);
        var period = tenant.SubscriptionPeriod switch { BillingPeriod.Yearly => v.T("yıllık", "yearly"), BillingPeriod.Monthly => v.T("aylık", "monthly"), _ => null };
        string Left(DateTime end) => v.T($"{Math.Max(0, (int)Math.Ceiling((end - DateTime.UtcNow).TotalDays))} gün kaldı", $"{Math.Max(0, (int)Math.Ceiling((end - DateTime.UtcNow).TotalDays))} days left");
        var text = tenant.Status switch
        {
            TenantStatus.Trial when tenant.TrialEndsAtUtc is DateTime trial => v.T($"Deneme sürümündesiniz ({tenant.Plan}); deneme {ShortDay(trial)} tarihinde bitiyor ({Left(trial)}).", $"You're on a trial; it ends {ShortDay(trial)}."),
            TenantStatus.Active when tenant.SubscriptionEndsAtUtc is DateTime end => v.T($"Aboneliğiniz aktif: {tenant.Plan}{(period is null ? "" : $" ({period})")}, dönem sonu {ShortDay(end)} ({Left(end)}).", $"Your subscription is active until {ShortDay(end)}."),
            TenantStatus.Active => v.T($"Aboneliğiniz aktif: {tenant.Plan}.", "Your subscription is active."),
            TenantStatus.Suspended => v.T("Aboneliğiniz askıda; Paketim ekranından durumu görebilirsiniz.", "Your subscription is suspended."),
            _ => v.T("Aboneliğiniz aktif değil.", "Your subscription isn't active."),
        };
        return new DataAnswer(text, []);
    }

    private async Task<DataAnswer> MessagingCreditsAsync(AssistantVoice v, CancellationToken ct)
    {
        var wallet = await db.TenantMessagingWallets.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == TenantId, ct);
        var whatsapp = wallet is null ? 0 : wallet.BalanceCredits - wallet.ReservedCredits;
        var sms = wallet is null ? 0 : wallet.SmsBalanceCredits - wallet.SmsReservedCredits;
        return new DataAnswer(v.T($"WhatsApp kredisi {whatsapp.ToString("0.##", Tr)}, SMS kredisi {sms.ToString("0.##", Tr)}.",
                $"WhatsApp credits {whatsapp.ToString("0.##", CultureInfo.InvariantCulture)}, SMS credits {sms.ToString("0.##", CultureInfo.InvariantCulture)}."),
            [Row(("Kalem", "WhatsApp"), ("count", whatsapp)), Row(("Kalem", "SMS"), ("count", sms))]);
    }

    private async Task<DataAnswer> CashClosingStatusAsync(AssistantVoice v, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(LocalNow);
        var query = db.CashRegisterClosings.AsNoTracking().Where(x => x.TenantId == TenantId);
        if (ScopeBranch is Guid branch) query = query.Where(x => x.BranchId == null || x.BranchId == branch);
        var last = await query.OrderByDescending(x => x.BusinessDate).Select(x => new { x.BusinessDate, x.CountedCash, x.CashIncome, x.CashExpense, x.OpeningBalance })
            .FirstOrDefaultAsync(ct);
        if (last is null) return new DataAnswer(v.T("Henüz hiç kasa kapanışı yapılmamış.", "No till closing has been done yet."), []);
        var expected = last.OpeningBalance + last.CashIncome - last.CashExpense;
        var diff = last.CountedCash - expected;
        var head = last.BusinessDate == today
            ? v.T("Bugünün kasa kapanışı yapıldı.", "Today's till closing is done.")
            : v.T($"Bugünün kasa kapanışı henüz yapılmadı; son kapanış {last.BusinessDate.ToString("d MMMM", Tr)}.", $"Today's closing isn't done yet; last one was {last.BusinessDate:MMM d}.");
        return new DataAnswer(head + v.T($" Sayılan nakit {Money(last.CountedCash)}" + (diff == 0 ? ", fark yok." : $", fark {Money(diff)}."), ""),
            [
                Row(("Kalem", v.T("Açılış", "Opening")), ("amount", last.OpeningBalance)),
                Row(("Kalem", v.T("Nakit giriş", "Cash in")), ("amount", last.CashIncome)),
                Row(("Kalem", v.T("Nakit çıkış", "Cash out")), ("amount", last.CashExpense)),
                Row(("Kalem", v.T("Sayılan", "Counted")), ("amount", last.CountedCash)),
            ]);
    }

    private async Task<DataAnswer> CampaignsAsync(AssistantVoice v, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(LocalNow);
        var query = db.Campaigns.AsNoTracking().Where(x => x.TenantId == TenantId && x.IsActive && x.StartDate <= today && x.EndDate >= today);
        if (ScopeBranch is Guid branch) query = query.Where(x => x.BranchId == null || x.BranchId == branch);
        var rows = await query.OrderBy(x => x.EndDate).Select(x => new { x.Name, x.DiscountType, x.DiscountValue, x.EndDate }).Take(30).ToListAsync(ct);
        if (rows.Count == 0) return new DataAnswer(v.T("Şu an aktif kampanya yok.", "There are no active campaigns."), []);
        return new DataAnswer(v.T($"{rows.Count} aktif kampanya var.", $"{rows.Count} active campaigns."),
            rows.Select(x => (object)Row(("Kampanya", x.Name), ("İndirim", x.DiscountType == DiscountType.Percent ? $"%{x.DiscountValue:0.##}" : Money(x.DiscountValue)),
                ("Bitiş", x.EndDate.ToString("d MMMM yyyy", Tr)))).ToList());
    }

    private async Task<DataAnswer> KvkkPendingAsync(AssistantVoice v, CancellationToken ct)
    {
        var total = await ScopedCustomers().CountAsync(ct);
        var pending = await ScopedCustomers().Where(x => !x.KvkkConsent).OrderByDescending(x => x.CreatedAtUtc)
            .Select(x => new { x.FullName, x.CreatedAtUtc }).Take(5000).ToListAsync(ct);
        if (pending.Count == 0) return new DataAnswer(v.T("Bütün müşterilerin KVKK onayı var.", "Every customer has given KVKK consent."), []);
        return new DataAnswer(v.T($"{total} müşteriden {pending.Count} tanesinin KVKK onayı yok.", $"{pending.Count} of {total} customers have no KVKK consent."),
            pending.Take(15).Select(x => (object)new { customer = x.FullName, date = ShortDay(x.CreatedAtUtc) }).ToList());
    }

    private static string Kind(GiftCardKind kind, AssistantVoice v) => kind switch
    {
        GiftCardKind.Percentage => v.T("yüzde kupon", "percent coupon"),
        GiftCardKind.FixedAmount => v.T("tutar kuponu", "amount coupon"),
        _ => v.T("hediye çeki", "gift card"),
    };

    private async Task<DataAnswer> GiftCardsAsync(string portal, AssistantVoice v, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var query = db.GiftCards.AsNoTracking().Where(x => x.TenantId == TenantId && x.IsActive && (x.ValidUntilUtc == null || x.ValidUntilUtc >= now));
        if (portal == AssistantPortals.Customer)
        {
            if (currentUser.CustomerId is not Guid me) return new DataAnswer(v.OutOfPortal(), []);
            var mine = await query.Where(x => x.CustomerId == me).Select(x => new { x.Kind, x.Value, x.Balance, x.ValidUntilUtc, x.ScopeLabel }).ToListAsync(ct);
            if (mine.Count == 0) return new DataAnswer(v.T("Size tanımlı aktif hediye çeki ya da kupon yok.", "You have no active gift cards or coupons."), []);
            return new DataAnswer(v.T($"{mine.Count} aktif hediye çekiniz/kuponunuz var.", $"You have {mine.Count} active gift cards/coupons."),
                mine.Select(x => (object)Row(("Tür", Kind(x.Kind, v)), ("Değer", x.Kind == GiftCardKind.Percentage ? $"%{x.Value:0.##}" : Money(x.Kind == GiftCardKind.StoredValue ? x.Balance : x.Value)),
                    ("Son geçerlilik", x.ValidUntilUtc is DateTime until ? ShortDay(until) : "—"))).ToList());
        }
        if (ScopeBranch is Guid branch) query = query.Where(x => x.BranchId == null || x.BranchId == branch);
        var rows = await query.Select(x => new { x.Kind, x.Code, x.Value, x.Balance, x.ValidUntilUtc, x.UsedCount, x.MaxUses }).Take(5000).ToListAsync(ct);
        if (rows.Count == 0) return new DataAnswer(v.T("Aktif hediye çeki ya da kupon yok.", "There are no active gift cards or coupons."), []);
        var stored = rows.Where(x => x.Kind == GiftCardKind.StoredValue).ToList();
        return new DataAnswer(v.T($"{rows.Count} aktif hediye çeki/kupon var; hediye çeklerinde kullanılmamış bakiye {Money(stored.Sum(x => x.Balance))}.",
                $"{rows.Count} active gift cards/coupons; unused gift card balance {Money(stored.Sum(x => x.Balance))}."),
            rows.OrderBy(x => x.ValidUntilUtc ?? DateTime.MaxValue).Take(15).Select(x => (object)Row(("Kod", "…" + (x.Code.Length > 4 ? x.Code[^4..] : x.Code)), ("Tür", Kind(x.Kind, v)),
                ("Değer", x.Kind == GiftCardKind.Percentage ? $"%{x.Value:0.##}" : Money(x.Kind == GiftCardKind.StoredValue ? x.Balance : x.Value)),
                ("Son geçerlilik", x.ValidUntilUtc is DateTime until ? ShortDay(until) : "—"))).ToList());
    }

    // ── Personelin kendisi ──────────────────────────────────────────────────

    private async Task<DataAnswer> MyWorkAsync(AssistantDateRange range, AssistantVoice v, CancellationToken ct)
    {
        if (await MyStaffIdAsync(ct) is not Guid staffId) return NoStaffProfile(v);
        var start = Utc(range.From);
        var end = Utc(range.To);
        var rows = await db.Appointments.AsNoTracking()
            .Where(x => x.TenantId == TenantId && x.StaffMemberId == staffId && x.StartUtc >= start && x.StartUtc < end && x.Status == AppointmentStatus.Completed)
            .Select(x => new { x.CustomerId, Service = x.ServiceDefinition!.Name }).Take(20000).ToListAsync(ct);
        var title = Title(range, v);
        if (rows.Count == 0) return new DataAnswer(v.T($"{title}: tamamladığınız randevu yok.", $"{title}: you have no completed appointments."), []);
        return new DataAnswer(v.T($"{title} {rows.Count} randevu tamamladınız, {rows.Select(x => x.CustomerId).Distinct().Count()} farklı müşteriye hizmet verdiniz.",
                $"{title}: you completed {rows.Count} appointments for {rows.Select(x => x.CustomerId).Distinct().Count()} customers."),
            rows.GroupBy(x => x.Service).OrderByDescending(g => g.Count()).Take(10).Select(g => (object)new { service = g.Key, count = g.Count() }).ToList());
    }

    // ── Müşterinin kendisi ──────────────────────────────────────────────────

    private async Task<DataAnswer> MyDebtAsync(AssistantVoice v, CancellationToken ct)
    {
        if (currentUser.CustomerId is not Guid me) return new DataAnswer(v.OutOfPortal(), []);
        var today = DateOnly.FromDateTime(LocalNow);
        var rows = await (from account in db.CustomerAccounts.AsNoTracking()
                          join installment in db.Installments.AsNoTracking() on account.Id equals installment.CustomerAccountId
                          where account.TenantId == TenantId && account.CustomerId == me && installment.Status == InstallmentStatus.Planned
                          orderby installment.DueDate
                          select new { installment.Amount, installment.DueDate, account.Name }).ToListAsync(ct);
        if (rows.Count == 0) return new DataAnswer(v.T("Ödenmemiş taksitiniz yok.", "You have no unpaid installments."), []);
        var overdue = rows.Where(x => x.DueDate < today).Sum(x => x.Amount);
        return new DataAnswer(v.T($"Kalan borcunuz {Money(rows.Sum(x => x.Amount))}; sıradaki taksit {rows[0].DueDate.ToString("d MMMM yyyy", Tr)} ({Money(rows[0].Amount)})." + (overdue > 0 ? $" Vadesi geçen {Money(overdue)}." : ""),
                $"You owe {Money(rows.Sum(x => x.Amount))}; next installment {rows[0].DueDate:MMM d} ({Money(rows[0].Amount)})."),
            rows.Take(20).Select(x => (object)Row(("date", x.DueDate.ToString("d MMMM yyyy", Tr)), ("amount", x.Amount), ("Paket", x.Name))).ToList());
    }

    private async Task<DataAnswer> LoyaltyAsync(AssistantVoice v, CancellationToken ct)
    {
        if (currentUser.CustomerId is not Guid me) return new DataAnswer(v.OutOfPortal(), []);
        var points = await db.LoyaltyTransactions.AsNoTracking().Where(x => x.TenantId == TenantId && x.CustomerId == me).SumAsync(x => (int?)x.Points, ct) ?? 0;
        return new DataAnswer(v.T($"Sadakat puanınız {points}.", $"You have {points} loyalty points."), []);
    }

    // ── Salon bilgisi ───────────────────────────────────────────────────────

    private async Task<DataAnswer> SalonInfoAsync(AssistantVoice v, CancellationToken ct)
    {
        var profile = await db.TenantPublicProfiles.AsNoTracking().Where(x => x.TenantId == TenantId)
            .Select(x => new { x.Address, x.City, x.PublicPhone, x.WorkingHoursText, x.Instagram, x.PublicEmail }).FirstOrDefaultAsync(ct);
        var branches = db.Branches.AsNoTracking().Where(x => x.TenantId == TenantId && !x.IsDeleted);
        if (ScopeBranch is Guid branch) branches = branches.Where(x => x.Id == branch);
        var hours = await branches.Select(x => new { x.Name, x.City, x.OpenTime, x.CloseTime }).ToListAsync(ct);
        var parts = new List<string>();
        if (profile?.Address is { Length: > 0 } address) parts.Add(v.T($"Adres: {address}{(profile.City is { Length: > 0 } city ? $", {city}" : "")}", $"Address: {address}"));
        if (profile?.PublicPhone is { Length: > 0 } phone) parts.Add(v.T($"Telefon: {phone}", $"Phone: {phone}"));
        if (profile?.WorkingHoursText is { Length: > 0 } text) parts.Add(v.T($"Çalışma saatleri: {text}", $"Hours: {text}"));
        else if (hours.Count == 1) parts.Add(v.T($"Çalışma saatleri: {hours[0].OpenTime:HH\\:mm}–{hours[0].CloseTime:HH\\:mm}", $"Hours: {hours[0].OpenTime:HH\\:mm}–{hours[0].CloseTime:HH\\:mm}"));
        if (profile?.Instagram is { Length: > 0 } instagram) parts.Add($"Instagram: {instagram}");
        if (parts.Count == 0) return new DataAnswer(v.T("Salonun adres ve iletişim bilgisi henüz girilmemiş.", "The salon's contact details haven't been entered yet."), []);
        return new DataAnswer(string.Join(". ", parts) + ".",
            hours.Count > 1 ? hours.Select(x => (object)Row(("Şube", x.Name), ("Şehir", x.City), ("Saat", $"{x.OpenTime:HH\\:mm}–{x.CloseTime:HH\\:mm}"))).ToList() : []);
    }
}
