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

    public async Task<Result<PagedResult<CustomerAccountDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default, Guid? customerId = null)
    {
        var query = _db.CustomerAccounts
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .Include(x => x.Customer)
            .Include(x => x.ServicePackage)
            .Include(x => x.Installments)
            .Include(x => x.Payments)
            .Include(x => x.SoldByStaffMember)
            .OrderByDescending(x => x.CreatedAtUtc)
            .AsQueryable();

        // Müşteri kartı: yalnız o müşterinin carileri (tüm liste çekilmesin).
        if (customerId is { } cid && cid != Guid.Empty) query = query.Where(x => x.CustomerId == cid);

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

        // Müşteri kartındaki satış paneli: seans durumu + kalemler + Aktif/Tamamlandı/İptal rozeti.
        // Yalnızca tek müşteri süzüldüğünde hesaplanır (genel liste hafif kalsın).
        if (customerId is { } scoped && scoped != Guid.Empty)
            items = await EnrichSalesAsync(tenantId, accounts, items, cancellationToken);

        return Result<PagedResult<CustomerAccountDto>>.Success(new PagedResult<CustomerAccountDto>(items, total, request.SafePage, request.SafePageSize));
    }

    /// <summary>
    /// Satış satırlarına seans durumu, kalem dökümü ve durum rozetini ekler.
    /// Kalem tutarı: paket kalemi birim fiyatı varsa ondan, yoksa satış toplamı seanslara dağıtılarak.
    /// </summary>
    private async Task<CustomerAccountDto[]> EnrichSalesAsync(
        Guid tenantId, CustomerAccount[] accounts, CustomerAccountDto[] dtos, CancellationToken cancellationToken)
    {
        if (dtos.Length == 0) return dtos;
        var accountIds = accounts.Select(a => a.Id).ToHashSet();

        // Seanslar (hizmet adı EF ile çözülür — şifreli kolon).
        var sessionRows = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .Select(x => new
            {
                x.CustomerAccountId,
                x.ServiceDefinitionId,
                ServiceName = x.ServiceDefinition!.Name,
                x.TotalSessions,
                x.UsedSessions,
            })
            .ToListAsync(cancellationToken);
        var sessionsByAccount = sessionRows
            .Where(x => accountIds.Contains(x.CustomerAccountId))
            .GroupBy(x => x.CustomerAccountId)
            .ToDictionary(g => g.Key, g => g.ToList());

        // Paket kalemi birim fiyatları (kalem tutarını doğru göstermek için).
        var packageIds = accounts.Where(a => a.ServicePackageId.HasValue).Select(a => a.ServicePackageId!.Value).ToHashSet();
        var unitPrices = new Dictionary<(Guid PackageId, Guid ServiceId), decimal>();
        if (packageIds.Count > 0)
        {
            var priceRows = await _db.ServicePackages.AsNoTracking()
                .Where(p => p.TenantId == tenantId)
                .SelectMany(p => p.Items.Select(i => new { i.ServicePackageId, i.ServiceDefinitionId, i.UnitPrice }))
                .ToListAsync(cancellationToken);
            foreach (var row in priceRows.Where(r => packageIds.Contains(r.ServicePackageId)))
                unitPrices[(row.ServicePackageId, row.ServiceDefinitionId)] = row.UnitPrice;
        }

        var byId = accounts.ToDictionary(a => a.Id);
        return dtos.Select(dto =>
        {
            var account = byId[dto.Id];
            var sessions = sessionsByAccount.TryGetValue(dto.Id, out var list) ? list : new();
            var sessionsTotal = sessions.Sum(x => x.TotalSessions);
            var sessionsUsed = sessions.Sum(x => x.UsedSessions);

            IReadOnlyCollection<CustomerAccountItemDto> items;
            if (sessions.Count > 0)
            {
                // Fiyatı olmayan kalemler için toplam tutar seanslara oranla dağıtılır.
                var weights = sessions
                    .Select(x => account.ServicePackageId is { } pid && unitPrices.TryGetValue((pid, x.ServiceDefinitionId), out var up) && up > 0m
                        ? up * Math.Max(1, x.TotalSessions)
                        : 0m)
                    .ToArray();
                if (weights.All(w => w <= 0m))
                    for (var i = 0; i < weights.Length; i++) weights[i] = Math.Max(1, sessions[i].TotalSessions);
                var weightSum = weights.Sum();

                items = sessions.Select((x, i) => new CustomerAccountItemDto(
                    x.ServiceDefinitionId,
                    x.ServiceName,
                    weightSum > 0m ? Math.Round(account.TotalAmount * weights[i] / weightSum, 2) : 0m,
                    x.TotalSessions,
                    x.UsedSessions)).ToArray();
            }
            else
            {
                // Seanssız satış (tek hizmet / geçmiş kayıt): kalem = satışın kendisi.
                items = new[] { new CustomerAccountItemDto(null, account.Name, account.TotalAmount, 0, 0) };
            }

            var status = account.CancelledAtUtc is not null
                ? "Cancelled"
                : sessionsTotal > 0
                    ? (sessionsUsed >= sessionsTotal ? "Completed" : "Active")
                    : (account.RemainingAmount <= 0.005m ? "Completed" : "Active");

            return dto with
            {
                SessionsTotal = sessionsTotal,
                SessionsUsed = sessionsUsed,
                SessionsRemaining = Math.Max(0, sessionsTotal - sessionsUsed),
                Items = items,
                SaleStatus = status,
            };
        }).ToArray();
    }

    /// <summary>
    /// GEÇMİŞ SATIŞ: yazılıma geçmeden önce yapılmış paket/hizmet satışını sisteme işler.
    /// Tahsil edilmiş tutar peşinat olarak, kalan tutar taksit planı olarak yazılır; kullanılmış
    /// seanslar da baştan düşülmüş gelir (müşteri kartı geçmişi olduğu gibi görünsün).
    /// </summary>
    public async Task<Result<CustomerAccountDto>> CreateHistoricalAsync(Guid tenantId, CreateHistoricalSaleRequest request, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == request.CustomerId, cancellationToken);
        if (customer is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        if (string.IsNullOrWhiteSpace(request.Name)) return Result<CustomerAccountDto>.Failure(Error.Validation("Paket / hizmet adı zorunludur."));
        if (request.TotalAmount < 0) return Result<CustomerAccountDto>.Failure(Error.Validation("Tutar negatif olamaz."));
        if (request.PaidAmount < 0) return Result<CustomerAccountDto>.Failure(Error.Validation("Tahsil edilen tutar negatif olamaz."));
        if (request.SessionsUsed > request.SessionsTotal)
            return Result<CustomerAccountDto>.Failure(Error.Validation("Kullanılan seans, toplam seanstan fazla olamaz."));

        var soldAtUtc = DateTime.SpecifyKind(request.SoldAtUtc == default ? DateTime.UtcNow : request.SoldAtUtc, DateTimeKind.Utc);
        if (soldAtUtc > DateTime.UtcNow.AddDays(1))
            return Result<CustomerAccountDto>.Failure(Error.Validation("Geçmiş satış tarihi gelecekte olamaz."));

        ServicePackage? package = null;
        if (request.ServicePackageId is { } packageId && packageId != Guid.Empty)
        {
            package = await _db.ServicePackages.Include(p => p.Items)
                .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == packageId, cancellationToken);
            if (package is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Paket bulunamadı."));
        }

        var branchId = request.BranchId ?? customer.BranchId;
        // Peşinat = geçmişte tahsil edilmiş tutar; kalan borç taksitlere bölünür.
        var paid = Math.Min(request.PaidAmount, request.TotalAmount);
        var account = new CustomerAccount(tenantId, branchId, customer.Id, package?.Id, request.Name.Trim(), request.TotalAmount, paid);
        account.SetNotes(request.Notes);
        account.SetSaleInfo(soldAtUtc, request.SoldByStaffMemberId, isHistorical: true);

        var remaining = request.TotalAmount - paid;
        if (request.InstallmentCount > 0 && remaining > 0)
        {
            // Vade verilmediyse satış tarihinin bir ay sonrasından başlatılır.
            var firstDue = request.FirstDueDate ?? DateOnly.FromDateTime(soldAtUtc.AddMonths(1));
            account.RebuildInstallments(request.InstallmentCount, firstDue);
        }

        _db.CustomerAccounts.Add(account);

        // Seanslar: pakette kalem varsa onlardan, yoksa tek hizmet + adet olarak.
        if (package is not null && package.Items.Count > 0)
        {
            foreach (var item in package.Items)
                _db.CustomerPackageSessions.Add(new CustomerPackageSession(
                    tenantId, customer.Id, account.Id, package.Id, item.ServiceDefinitionId, item.SessionCount));
        }
        else if (request.SessionsTotal > 0 && request.ServiceDefinitionId is { } serviceId && serviceId != Guid.Empty)
        {
            _db.CustomerPackageSessions.Add(new CustomerPackageSession(
                tenantId, customer.Id, account.Id, package?.Id ?? Guid.Empty, serviceId, request.SessionsTotal));
        }

        await _db.SaveChangesAsync(cancellationToken);

        // Geçmişte KULLANILMIŞ seanslar düşülür (kart "3/8 kaldı" desin).
        if (request.SessionsUsed > 0)
        {
            var sessions = await _db.CustomerPackageSessions
                .Where(x => x.TenantId == tenantId && x.CustomerAccountId == account.Id)
                .ToListAsync(cancellationToken);
            var toConsume = request.SessionsUsed;
            foreach (var session in sessions)
            {
                while (toConsume > 0 && session.TryConsume()) toConsume--;
                if (toConsume == 0) break;
            }
            await _db.SaveChangesAsync(cancellationToken);
        }

        await _audit.LogAsync(tenantId, account.BranchId, "CreateHistorical", "CustomerAccount", account.Id,
            $"Geçmiş satış girildi: {account.Name} · {soldAtUtc:dd.MM.yyyy} · {account.TotalAmount:N2}",
            new { account.Name, account.TotalAmount, paid, soldAtUtc, request.SessionsTotal, request.SessionsUsed }, cancellationToken);

        var hydrated = await LoadAsync(tenantId, account.Id, cancellationToken);
        return Result<CustomerAccountDto>.Success(Mask(hydrated!.ToDto()));
    }

    public async Task<Result<CustomerAccountDto>> CancelSaleAsync(Guid tenantId, Guid id, CancelSaleRequest request, CancellationToken cancellationToken = default)
    {
        var account = await LoadAsync(tenantId, id, cancellationToken);
        if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Satış kaydı bulunamadı."));
        account.CancelSale(request.Reason);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, account.BranchId, "Cancel", "CustomerAccount", account.Id,
            $"Satış iptal edildi: {account.Name}", new { request.Reason }, cancellationToken);
        return Result<CustomerAccountDto>.Success(Mask(account.ToDto()));
    }

    public async Task<Result<CustomerAccountDto>> RestoreSaleAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var account = await LoadAsync(tenantId, id, cancellationToken);
        if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Satış kaydı bulunamadı."));
        account.RestoreSale();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, account.BranchId, "Restore", "CustomerAccount", account.Id,
            $"Satış iptali geri alındı: {account.Name}", null, cancellationToken);
        return Result<CustomerAccountDto>.Success(Mask(account.ToDto()));
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
            .Include(a => a.Customer)   // müşteri kırılımı için ad (şifreli kolon → bellekte çözülür)
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

        // Müşteri kırılımı için cari bazında biriktirilen değerler (aşağıda müşteriye göre toplanır).
        var customerAgg = new Dictionary<Guid, CustomerBreakdownAccumulator>();

        foreach (var acc in accounts)
        {
            var bucket = customerAgg.TryGetValue(acc.CustomerId, out var existingBucket)
                ? existingBucket
                : customerAgg[acc.CustomerId] = new CustomerBreakdownAccumulator(acc.Customer?.FullName ?? "Müşteri");
            bucket.AccountCount++;
            bucket.TotalAmount += acc.TotalAmount;
            if (!string.IsNullOrWhiteSpace(acc.Name) && !bucket.PackageNames.Contains(acc.Name)) bucket.PackageNames.Add(acc.Name);

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

                bucket.InstallmentCount++;
                bucket.PaidAmount += paid;
                bucket.RemainingAmount += remaining;
                if (remaining <= 0m)
                {
                    bucket.PaidInstallmentCount++;
                }
                else
                {
                    if (inst.DueDate < today)
                    {
                        bucket.OverdueInstallmentCount++;
                        bucket.OverdueAmount += remaining;
                    }
                    // Sıradaki ödeme: en erken vadeli, kapanmamış taksit (gecikmişler dahil).
                    if (bucket.NextDueDate is null || inst.DueDate < bucket.NextDueDate)
                    {
                        bucket.NextDueDate = inst.DueDate;
                        bucket.NextDueAmount = remaining;
                    }
                }
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
            .Select(s => new
            {
                s.CustomerAccountId,
                s.CustomerId,
                s.ServicePackageId,
                s.ServiceDefinitionId,
                ServiceName = s.ServiceDefinition!.Name,
                Category = s.ServiceDefinition!.Category,
                s.TotalSessions,
                s.UsedSessions,
            })
            .ToListAsync(cancellationToken);
        var scopedSessions = sessionRows.Where(s => inScopeAccountIds.Contains(s.CustomerAccountId)).ToList();
        var sessionsTotal = scopedSessions.Sum(s => s.TotalSessions);
        var sessionsUsed = scopedSessions.Sum(s => s.UsedSessions);

        // --- Kategori kırılımı --------------------------------------------------
        // Seans satırında tutar yok; satışın toplamı (cari TotalAmount, indirim dahil) paket
        // kalemlerinin birim fiyatına göre hizmetlere dağıtılır. Fiyat bulunamazsa seans
        // sayısı ağırlık olur — böylece iskontolu satışlar da gerçek tutarla raporlanır.
        var packageItemPrices = await _db.ServicePackages
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId)
            .SelectMany(p => p.Items.Select(i => new { i.ServicePackageId, i.ServiceDefinitionId, i.UnitPrice }))
            .ToListAsync(cancellationToken);
        var unitPriceLookup = packageItemPrices
            .GroupBy(x => (x.ServicePackageId, x.ServiceDefinitionId))
            .ToDictionary(g => g.Key, g => g.First().UnitPrice);
        var accountTotals = accounts.ToDictionary(a => a.Id, a => a.TotalAmount);

        var serviceAgg = new Dictionary<(string Category, Guid ServiceId), CategoryServiceAccumulator>();
        foreach (var group in scopedSessions.GroupBy(s => s.CustomerAccountId))
        {
            var rows = group.ToList();
            var weights = rows
                .Select(r => unitPriceLookup.TryGetValue((r.ServicePackageId, r.ServiceDefinitionId), out var price) && price > 0m
                    ? price * Math.Max(1, r.TotalSessions)
                    : 0m)
                .ToArray();
            if (weights.All(w => w <= 0m))
            {
                for (var i = 0; i < weights.Length; i++) weights[i] = Math.Max(1, rows[i].TotalSessions);
            }
            var weightSum = weights.Sum();
            var accountTotal = accountTotals.TryGetValue(group.Key, out var t) ? t : 0m;

            for (var i = 0; i < rows.Count; i++)
            {
                var row = rows[i];
                var category = string.IsNullOrWhiteSpace(row.Category) ? "Kategorisiz" : row.Category!.Trim();
                var key = (category, row.ServiceDefinitionId);
                if (!serviceAgg.TryGetValue(key, out var acc))
                {
                    acc = new CategoryServiceAccumulator(row.ServiceName);
                    serviceAgg[key] = acc;
                }
                acc.SessionsTotal += row.TotalSessions;
                acc.SessionsUsed += row.UsedSessions;
                acc.Accounts.Add(row.CustomerAccountId);
                acc.Customers.Add(row.CustomerId);
                acc.Amount += weightSum > 0m ? accountTotal * weights[i] / weightSum : 0m;
            }
        }

        var categories = serviceAgg
            .GroupBy(kv => kv.Key.Category)
            .Select(g =>
            {
                var services = g
                    .Select(kv => new PackageCategoryServiceDto(
                        kv.Key.ServiceId,
                        kv.Value.ServiceName,
                        kv.Value.Accounts.Count,
                        kv.Value.Customers.Count,
                        kv.Value.SessionsTotal,
                        kv.Value.SessionsUsed,
                        Math.Max(0, kv.Value.SessionsTotal - kv.Value.SessionsUsed),
                        Math.Round(kv.Value.Amount, 2)))
                    .OrderByDescending(s => s.Amount)
                    .ThenByDescending(s => s.SessionsTotal)
                    .ToList();

                return new PackageCategoryBreakdownDto(
                    g.Key,
                    g.SelectMany(kv => kv.Value.Accounts).Distinct().Count(),
                    g.SelectMany(kv => kv.Value.Customers).Distinct().Count(),
                    services.Sum(s => s.SessionsTotal),
                    services.Sum(s => s.SessionsUsed),
                    services.Sum(s => s.SessionsRemaining),
                    Math.Round(services.Sum(s => s.Amount), 2),
                    services);
            })
            .OrderByDescending(c => c.Amount)
            .ThenByDescending(c => c.SessionsTotal)
            .ToList();

        // --- Müşteri kırılımı ---------------------------------------------------
        foreach (var group in scopedSessions.GroupBy(s => s.CustomerId))
        {
            if (!customerAgg.TryGetValue(group.Key, out var bucket)) continue;
            bucket.SessionsTotal += group.Sum(s => s.TotalSessions);
            bucket.SessionsUsed += group.Sum(s => s.UsedSessions);
        }

        // Liste 200 satırla sınırlanır (pano özeti) — en yüksek kalan borçtan başlar.
        var customerBreakdown = customerAgg
            .Select(kv => new PackageCustomerBreakdownDto(
                kv.Key,
                kv.Value.CustomerName,
                kv.Value.AccountCount,
                kv.Value.PackageNames,
                kv.Value.InstallmentCount,
                kv.Value.PaidInstallmentCount,
                kv.Value.OverdueInstallmentCount,
                Math.Round(kv.Value.TotalAmount, 2),
                Math.Round(kv.Value.PaidAmount, 2),
                Math.Round(kv.Value.RemainingAmount, 2),
                Math.Round(kv.Value.OverdueAmount, 2),
                kv.Value.NextDueDate,
                Math.Round(kv.Value.NextDueAmount, 2),
                kv.Value.SessionsTotal,
                kv.Value.SessionsUsed,
                Math.Max(0, kv.Value.SessionsTotal - kv.Value.SessionsUsed)))
            .OrderByDescending(c => c.RemainingAmount)
            .ThenByDescending(c => c.TotalAmount)
            .Take(200)
            .ToList();

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
            monthly,
            categories,
            customerBreakdown);

        return Result<AccountReportDto>.Success(report);
    }

    /// <summary>Rapor hesabı sırasında müşteri bazında biriktirilen değerler (DTO'ya çevrilmeden önce).</summary>
    private sealed class CustomerBreakdownAccumulator(string customerName)
    {
        public string CustomerName { get; } = customerName;
        public List<string> PackageNames { get; } = [];
        public int AccountCount { get; set; }
        public int InstallmentCount { get; set; }
        public int PaidInstallmentCount { get; set; }
        public int OverdueInstallmentCount { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal RemainingAmount { get; set; }
        public decimal OverdueAmount { get; set; }
        public DateOnly? NextDueDate { get; set; }
        public decimal NextDueAmount { get; set; }
        public int SessionsTotal { get; set; }
        public int SessionsUsed { get; set; }
    }

    /// <summary>Kategori kırılımında hizmet bazında biriktirilen değerler.</summary>
    private sealed class CategoryServiceAccumulator(string serviceName)
    {
        public string ServiceName { get; } = serviceName;
        public HashSet<Guid> Accounts { get; } = [];
        public HashSet<Guid> Customers { get; } = [];
        public int SessionsTotal { get; set; }
        public int SessionsUsed { get; set; }
        public decimal Amount { get; set; }
    }

    private Task<CustomerAccount?> LoadAsync(Guid tenantId, Guid id, CancellationToken cancellationToken)
    {
        return _db.CustomerAccounts
            .Include(x => x.Customer)
            .Include(x => x.ServicePackage)
            .Include(x => x.Installments)
            .Include(x => x.Payments)
            .Include(x => x.SoldByStaffMember)
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
