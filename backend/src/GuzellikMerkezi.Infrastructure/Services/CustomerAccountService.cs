using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CustomerAccountService : ICustomerAccountService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;

    public CustomerAccountService(GuzellikDbContext db, IAuditLogger audit, ICurrentUser currentUser)
    {
        _db = db;
        _audit = audit;
        _currentUser = currentUser;
    }

    // Personel müşteri telefonunu yalnızca son 4 hane görür; ham numara API'den hiç çıkmaz.
    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

    private CustomerAccountDto Mask(CustomerAccountDto dto) =>
        IsStaffViewer ? dto with { CustomerPhone = PhoneMask.Mask(dto.CustomerPhone) } : dto;

    public async Task<Result<PagedResult<CustomerAccountDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        var query = _db.CustomerAccounts
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .Include(x => x.Customer)
            .Include(x => x.ServicePackage)
            .Include(x => x.Installments)
            .Include(x => x.Payments)
            .OrderByDescending(x => x.CreatedAtUtc)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            query = query.Where(x => x.Name.Contains(search) || (x.Customer != null && x.Customer.FullName.Contains(search)));
        }

        var total = await query.CountAsync(cancellationToken);
        var accounts = await query.Skip(request.Skip).Take(request.SafePageSize).ToArrayAsync(cancellationToken);

        var customerIds = accounts.Select(a => a.CustomerId).Distinct().ToArray();
        // Sadece tamamlanmış randevuları çek, sonra customer id filtresini in-memory uygula
        var completedAppointments = await _db.Appointments
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.Status == AppointmentStatus.Completed)
            .Select(a => new { a.CustomerId, a.Price })
            .ToListByIdsAsync(customerIds, a => a.CustomerId, cancellationToken);
        var revenueByCustomer = completedAppointments
            .GroupBy(a => a.CustomerId)
            .Select(g => new { CustomerId = g.Key, Revenue = g.Sum(a => a.Price), Count = g.Count() })
            .ToDictionary(x => x.CustomerId);

        var items = accounts.Select(a =>
        {
            var stats = revenueByCustomer.TryGetValue(a.CustomerId, out var s) ? s : null;
            return Mask(a.ToDto(stats?.Revenue ?? 0m, stats?.Count ?? 0));
        }).ToArray();

        return Result<PagedResult<CustomerAccountDto>>.Success(new PagedResult<CustomerAccountDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<CustomerAccountDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var account = await LoadAsync(tenantId, id, cancellationToken);
        if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));
        var (revenue, count) = await GetAppointmentStatsAsync(tenantId, account.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(Mask(account.ToDto(revenue, count)));
    }

    public async Task<Result<CustomerAccountDto>> CreateAsync(Guid tenantId, CreateCustomerAccountRequest request, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == request.CustomerId, cancellationToken);
        if (customer is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        ServicePackage? package = null;
        if (request.ServicePackageId.HasValue)
        {
            package = await _db.ServicePackages
                .Include(p => p.Items)
                .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == request.ServicePackageId.Value, cancellationToken);
            if (package is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Paket bulunamadı."));
        }

        var account = new CustomerAccount(tenantId, customer.BranchId, customer.Id, request.ServicePackageId, request.Name, request.TotalAmount, request.DepositAmount);
        account.SetNotes(request.Notes);
        account.RebuildInstallments(request.InstallmentCount, request.FirstDueDate);

        _db.CustomerAccounts.Add(account);

        // Paketle satış: müşteride hizmet-bazlı seans bakiyesi aç (otomatik düşüm için).
        if (package is not null)
        {
            foreach (var item in package.Items)
            {
                _db.CustomerPackageSessions.Add(new CustomerPackageSession(
                    tenantId, customer.Id, account.Id, package.Id, item.ServiceDefinitionId, item.SessionCount));
            }
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, account.BranchId, "Create", "CustomerAccount", account.Id,
            $"Cari hesap açıldı: {account.Name} · {account.TotalAmount:N2}",
            new { account.Name, account.TotalAmount, account.DepositAmount, request.InstallmentCount }, cancellationToken);

        var hydrated = await LoadAsync(tenantId, account.Id, cancellationToken);
        var (revenue, count) = await GetAppointmentStatsAsync(tenantId, account.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(Mask(hydrated!.ToDto(revenue, count)));
    }

    public async Task<Result<CustomerAccountDto>> UpdateAsync(Guid tenantId, Guid id, UpdateCustomerAccountRequest request, CancellationToken cancellationToken = default)
    {
        var account = await LoadAsync(tenantId, id, cancellationToken);
        if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));

        account.Rename(request.Name);
        account.ChangeTotal(request.TotalAmount, request.DepositAmount);
        account.SetNotes(request.Notes);
        if (request.IsActive) account.Activate(); else account.Deactivate();
        await _db.SaveChangesAsync(cancellationToken);
        var (revenue, count) = await GetAppointmentStatsAsync(tenantId, account.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(Mask(account.ToDto(revenue, count)));
    }

    public async Task<Result<CustomerAccountDto>> RescheduleAsync(Guid tenantId, Guid id, RescheduleAccountRequest request, CancellationToken cancellationToken = default)
    {
        // EF Core change tracker'ı bypass et — ExecuteUpdateAsync ile direkt SQL.
        // MySql.EntityFrameworkCore'un Add/Remove kombinasyonunda hatalı SQL üretip
        // DbUpdateConcurrencyException fırlatması bilinen bir bug.

        var accountInfo = await _db.CustomerAccounts
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Id == id)
            .Select(x => new { x.TotalAmount, x.DepositAmount, x.CustomerId })
            .FirstOrDefaultAsync(cancellationToken);
        if (accountInfo is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));

        var nowUtc = DateTime.UtcNow;

        // Step 1: Tüm mevcut taksitleri soft-delete et — plan baştan kurulur.
        // (Ödenen tutar taksitte değil tahsilatlarda tutulduğundan, plan yeniden bölünse de
        // "ödenen" korunur; tahsilatlar yeni taksitlere vade sırasıyla yeniden dağıtılır.)
        await _db.Installments
            .Where(i => i.CustomerAccountId == id && !i.IsDeleted)
            .ExecuteUpdateAsync(s => s
                .SetProperty(i => i.IsDeleted, true)
                .SetProperty(i => i.DeletedAtUtc, (DateTime?)nowUtc)
                .SetProperty(i => i.UpdatedAtUtc, (DateTime?)nowUtc), cancellationToken);

        // Step 2: Yeni taksitleri Add et — finanse edilen tutar (toplam − peşinat) eşit bölünür.
        var financed = Math.Max(0, accountInfo.TotalAmount - accountInfo.DepositAmount);
        if (request.InstallmentCount > 0 && financed > 0)
        {
            var per = Math.Round(financed / request.InstallmentCount, 2, MidpointRounding.AwayFromZero);
            var drift = financed - per * request.InstallmentCount;
            for (var i = 0; i < request.InstallmentCount; i++)
            {
                var amount = per;
                if (i == request.InstallmentCount - 1) amount += drift;
                var due = request.FirstDueDate.AddMonths(i);
                _db.Installments.Add(new Installment(id, i + 1, due, amount));
            }
            await _db.SaveChangesAsync(cancellationToken);
        }

        // Step 3: Parent Account Touch — direct SQL
        await _db.CustomerAccounts
            .Where(x => x.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedAtUtc, (DateTime?)nowUtc), cancellationToken);

        // Return hydrated
        var hydrated = await LoadAsync(tenantId, id, cancellationToken);
        var (revenue, completedCount) = await GetAppointmentStatsAsync(tenantId, accountInfo.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(Mask(hydrated!.ToDto(revenue, completedCount)));
    }

    public async Task<Result<CustomerAccountDto>> RegisterPaymentAsync(Guid tenantId, Guid id, RegisterAccountPaymentRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Amount <= 0) return Result<CustomerAccountDto>.Failure(Error.Validation("Tahsilat tutarı pozitif olmalı."));

        var accountInfo = await _db.CustomerAccounts
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Id == id)
            .Select(x => new { x.CustomerId })
            .FirstOrDefaultAsync(cancellationToken);
        if (accountInfo is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));

        var occurredAt = request.OccurredAtUtc ?? DateTime.UtcNow;
        if (occurredAt.Kind != DateTimeKind.Utc) occurredAt = DateTime.SpecifyKind(occurredAt, DateTimeKind.Utc);

        // Tahsilatı kaydet (sadece INSERT). Taksit planına dokunulmaz — "ödenen/kalan",
        // okuma anında AllocatePayments ile tahsilatların vade sırasına dağıtılmasıyla hesaplanır.
        // Böylece eksik ödeme ilgili taksiti kısmen, fazla ödeme birden çok taksiti kapatır.
        var payment = new AccountPayment(id, request.Amount, request.Method, request.Reference, occurredAt);
        _db.AccountPayments.Add(payment);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, null, "RegisterPayment", "AccountPayment", payment.Id,
            $"Tahsilat alındı: {request.Amount:N2} ({request.Method ?? "—"})",
            new { Amount = request.Amount, request.Method, request.Reference, OccurredAt = occurredAt, AccountId = id }, cancellationToken);

        // Parent Touch
        var nowUtc = DateTime.UtcNow;
        await _db.CustomerAccounts
            .Where(x => x.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedAtUtc, (DateTime?)nowUtc), cancellationToken);

        // Return hydrated
        var hydrated = await LoadAsync(tenantId, id, cancellationToken);
        var (revenue, completedCount) = await GetAppointmentStatsAsync(tenantId, accountInfo.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(Mask(hydrated!.ToDto(revenue, completedCount)));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var account = await _db.CustomerAccounts.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (account is null) return Result.Failure(Error.NotFound("Cari hesap bulunamadı."));
        account.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyCollection<CustomerPackageSessionDto>>> GetCustomerSessionsAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default)
    {
        var rows = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.CustomerId == customerId)
            .Join(_db.ServiceDefinitions.AsNoTracking(),
                s => s.ServiceDefinitionId,
                d => d.Id,
                (s, d) => new CustomerPackageSessionDto(
                    s.Id, s.CustomerAccountId, s.ServicePackageId, s.ServiceDefinitionId,
                    d.Name, s.TotalSessions, s.UsedSessions, s.TotalSessions - s.UsedSessions))
            .ToListAsync(cancellationToken);

        return Result<IReadOnlyCollection<CustomerPackageSessionDto>>.Success(rows);
    }

    public async Task<Result<AccountReportDto>> GetReportAsync(Guid tenantId, int months, DateTime? fromUtc = null, DateTime? toUtc = null, CancellationToken cancellationToken = default)
    {
        // 'months' artık takvimin EN AZ kaç ay göstereceği (taban). Gerçek pencere, taksitlerin
        // bittiği son aya kadar otomatik uzar (üst sınır 36 ay) — sonda boş ay kuyruğu olmasın diye.
        if (months < 1) months = 6;
        if (months > 24) months = 24;
        const int hardCapMonths = 36;

        // Dönem filtresi: verilirse rapor, [fromUtc, toUtc) aralığında satılan (oluşturulan)
        // paketlere göre süzülür. Hem cari hem adisyon CreatedAtUtc'sine uygulanır.
        // Kapsamdaki cariler (tenant + şube global filtresiyle süzülür) — taksit + tahsilat dahil.
        var accountsQuery = _db.CustomerAccounts
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId);
        if (fromUtc.HasValue) accountsQuery = accountsQuery.Where(a => a.CreatedAtUtc >= fromUtc.Value);
        if (toUtc.HasValue) accountsQuery = accountsQuery.Where(a => a.CreatedAtUtc < toUtc.Value);
        var accounts = await accountsQuery
            .Include(a => a.Installments)
            .Include(a => a.Payments)
            .ToListAsync(cancellationToken);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var firstOfThisMonth = new DateOnly(today.Year, today.Month, 1);

        var activeAccounts = accounts.Count(a => a.IsActive);

        // --- Satılan TOPLAM paket adedi ---
        // İki ayrı yoldan satılır, çakışmaz:
        //  1) Doğrudan cari satışı → CustomerAccount.ServicePackageId dolu (her cari = 1 paket).
        //  2) Adisyon satışı → PackageSale kalemi; onayda açılan carinin ServicePackageId'si NULL
        //     bırakılır, paket yalnızca kalemde/seansta tutulur. Bu yüzden kalem adedinden sayılır.
        var directPackageAccounts = accounts.Where(a => a.ServicePackageId != null).ToList();
        var directPackageCount = directPackageAccounts.Count;

        // Onaylı adisyonlardaki paket satışı kalemleri (şube+tenant global filtresiyle süzülür).
        var adisyonQuery = _db.Adisyonlar
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.Status == AdisyonStatus.Approved);
        if (fromUtc.HasValue) adisyonQuery = adisyonQuery.Where(a => a.CreatedAtUtc >= fromUtc.Value);
        if (toUtc.HasValue) adisyonQuery = adisyonQuery.Where(a => a.CreatedAtUtc < toUtc.Value);
        var approvedAdisyonlar = await adisyonQuery
            .Include(a => a.Items)
            .ToListAsync(cancellationToken);
        var adisyonPackageItems = approvedAdisyonlar
            .SelectMany(a => a.Items.Where(i => i.Type == AdisyonItemType.PackageSale)
                .Select(i => new { a.CustomerId, Qty = (int)Math.Max(1, Math.Round(i.Quantity, MidpointRounding.AwayFromZero)) }))
            .ToList();
        var adisyonPackageCount = adisyonPackageItems.Sum(x => x.Qty);

        var packageSalesCount = directPackageCount + adisyonPackageCount;

        // Paket satın almış benzersiz müşteri sayısı (her iki yoldan).
        var customersWithPackages = directPackageAccounts.Select(a => a.CustomerId)
            .Concat(adisyonPackageItems.Select(x => x.CustomerId))
            .Distinct()
            .Count();

        decimal totalReceivable = 0m;
        decimal totalCollected = 0m;
        decimal overdueAmount = 0m;
        // Ay → (vade tutarı, dağıtılan tahsilat)
        var monthBuckets = new Dictionary<(int Year, int Month), (decimal Due, decimal Collected)>();

        foreach (var acc in accounts)
        {
            // Ödenen/kalan, ToDto ile aynı mantık: tahsilatlar vade sırasına dağıtılır.
            var allocation = acc.AllocatePayments();
            foreach (var inst in acc.Installments)
            {
                if (inst.Status == InstallmentStatus.Cancelled) continue;
                var paid = allocation.TryGetValue(inst.Id, out var p) ? p : 0m;
                var remaining = Math.Max(0m, inst.Amount - paid);
                totalReceivable += remaining;
                totalCollected += paid;
                if (remaining > 0m && inst.DueDate < today) overdueAmount += remaining;

                var key = (inst.DueDate.Year, inst.DueDate.Month);
                var agg = monthBuckets.TryGetValue(key, out var cur) ? cur : (Due: 0m, Collected: 0m);
                monthBuckets[key] = (agg.Due + inst.Amount, agg.Collected + paid);
            }
        }

        var collectedThisMonth = accounts
            .SelectMany(a => a.Payments)
            .Where(p => p.OccurredAtUtc.Year == today.Year && p.OccurredAtUtc.Month == today.Month)
            .Sum(p => p.Amount);

        // Pencere: GEÇMİŞ (en erken taksit ya da bu yılın Ocak ayı) → gelecekteki son taksit ayı.
        // Geçmiş aylar da dahil edilir ki panodaki "bu ay" ve "bu yıl (Ocak–Aralık)" görünümleri
        // taksit performansını doğru göstersin. Sonda boş kuyruk olmasın diye son taksit ayında biter.
        var earliestOffset = 0;
        var lastInstallmentOffset = 0;
        foreach (var (key, agg) in monthBuckets)
        {
            if (agg.Due <= 0m) continue;
            var offset = (key.Year - firstOfThisMonth.Year) * 12 + (key.Month - firstOfThisMonth.Month);
            if (offset < earliestOffset) earliestOffset = offset;
            if (offset > lastInstallmentOffset) lastInstallmentOffset = offset;
        }
        // Pencere sınırları — KURAL: "bu ay" (offset 0) HER ZAMAN görünür.
        //  • start: yıl başına ya da en erken taksite kadar geri gider (ama asla >0).
        //  • end:   son taksit ayına kadar ileri gider (ama asla <0).
        //  • üst sınırda önce GEÇMİŞTEN kırpılır ki bu ay + gelecek taksitler gizlenmesin;
        //    çok ileri-tarihli plan varsa bu ay yine de gösterilir.
        var startOfYearOffset = -(today.Month - 1);
        var startOffset = Math.Min(Math.Min(earliestOffset, startOfYearOffset), 0);
        var endOffset = Math.Max(lastInstallmentOffset, 0);
        if (endOffset - startOffset + 1 < months) endOffset = startOffset + months - 1; // tabanı koru (geleceği uzat)
        if (endOffset - startOffset + 1 > hardCapMonths) startOffset = endOffset - hardCapMonths + 1; // geçmişten kırp
        if (startOffset > 0) { startOffset = 0; endOffset = Math.Min(endOffset, hardCapMonths - 1); }
        var totalSpan = endOffset - startOffset + 1;

        var monthly = new List<AccountMonthlyInstallmentDto>(totalSpan);
        for (var i = 0; i < totalSpan; i++)
        {
            var d = firstOfThisMonth.AddMonths(startOffset + i);
            var agg = monthBuckets.TryGetValue((d.Year, d.Month), out var cur) ? cur : (Due: 0m, Collected: 0m);
            monthly.Add(new AccountMonthlyInstallmentDto(
                d.Year, d.Month, agg.Due, agg.Collected, Math.Max(0m, agg.Due - agg.Collected)));
        }

        // Seanslar: CustomerPackageSession yalnızca tenant ile global süzülür (BranchId yok).
        // Şube tutarlılığı için kapsamdaki cari Id'leriyle bellekte süzülür (MySQL Guid .Contains tuzağından kaçınmak için).
        var inScopeAccountIds = accounts.Select(a => a.Id).ToHashSet();
        var sessionRows = await _db.CustomerPackageSessions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.CustomerAccountId, s.TotalSessions, s.UsedSessions })
            .ToListAsync(cancellationToken);
        var scopedSessions = sessionRows.Where(s => inScopeAccountIds.Contains(s.CustomerAccountId)).ToList();
        var sessionsTotal = scopedSessions.Sum(s => s.TotalSessions);
        var sessionsUsed = scopedSessions.Sum(s => s.UsedSessions);

        var report = new AccountReportDto(
            packageSalesCount,
            customersWithPackages,
            accounts.Count,
            activeAccounts,
            sessionsTotal,
            sessionsUsed,
            Math.Max(0, sessionsTotal - sessionsUsed),
            totalReceivable,
            totalCollected,
            overdueAmount,
            collectedThisMonth,
            monthly);

        return Result<AccountReportDto>.Success(report);
    }

    private Task<CustomerAccount?> LoadAsync(Guid tenantId, Guid id, CancellationToken cancellationToken)
    {
        return _db.CustomerAccounts
            .Include(x => x.Customer)
            .Include(x => x.ServicePackage)
            .Include(x => x.Installments)
            .Include(x => x.Payments)
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
    }

    private async Task<(decimal Revenue, int Count)> GetAppointmentStatsAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken)
    {
        var stat = await _db.Appointments
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.CustomerId == customerId && a.Status == AppointmentStatus.Completed)
            .GroupBy(a => a.CustomerId)
            .Select(g => new { Revenue = g.Sum(a => a.Price), Count = g.Count() })
            .FirstOrDefaultAsync(cancellationToken);
        return (stat?.Revenue ?? 0m, stat?.Count ?? 0);
    }
}
