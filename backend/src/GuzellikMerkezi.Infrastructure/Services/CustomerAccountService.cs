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

    /// <summary>
    /// SoldAtUtc kolonu eklenmeden önce oluşmuş cariler bu eşiğin altında (0001-01-01) kalır.
    /// Dönem süzmesinde bu satırlar CreatedAtUtc'ye düşürülür — bkz. GetReportAsync.
    /// </summary>
    private static readonly DateTime LegacySoldAtThreshold = new(1900, 1, 1, 0, 0, 0, DateTimeKind.Utc);

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

    /// <summary>Tekil satış yanıtı: telefon maskesi + "kim sattı" düşümü tek yerden uygulanır.</summary>
    private async Task<CustomerAccountDto> PresentAsync(
        Guid tenantId, CustomerAccount account, decimal revenue, int completedCount, CancellationToken cancellationToken) =>
        Mask(await WithSellerFallbackAsync(tenantId, account, account.ToDto(revenue, completedCount), cancellationToken));

    // --- "Kim sattı" düşümü -------------------------------------------------------------------
    // Satışta personel seçilmemiş olabilir: adisyondan açılan cariler seçim taşımaz ve kurum
    // yöneticisi personel listesinde olmadığı için kendi yaptığı satışta alan hep boş kalır.
    // Bu durumda satır, kaydı OLUŞTURAN kullanıcıya (Entity.CreatedBy) düşürülür — yönetici ise
    // "Kurum Yöneticisi (Ad Soyad)", personel hesabıysa personelin kendi adı yazılır. Kullanıcı da
    // bilinmiyorsa alan boş bırakılır; arayüz "Belirtilmemiş" gösterir — isim UYDURULMAZ.

    /// <summary>Satıcı çözümlemesi için kurumun personel + kullanıcı adları (adlar şifreli kolon → bellekte eşlenir).</summary>
    private sealed record SellerLookup(
        Dictionary<Guid, string> StaffNames,        // StaffMember.Id → personel adı
        Dictionary<Guid, Guid> StaffIdByUserId,     // TenantUser.Id → bağlı olduğu StaffMember.Id
        Dictionary<Guid, string> UserLabels)        // TenantUser.Id → "Kurum Yöneticisi (Ad Soyad)"
    {
        /// <summary>Satırın satıcı anahtarı: seçilen personel → oluşturanın personel kaydı → oluşturan kullanıcı.</summary>
        public Guid KeyFor(Guid? soldByStaffMemberId, Guid? createdBy)
        {
            if (soldByStaffMemberId is { } staffId && staffId != Guid.Empty) return staffId;
            if (createdBy is not { } userId || userId == Guid.Empty) return Guid.Empty;
            // Personel hesabından yapılan satış, o personelin kendi satışlarıyla aynı kovaya düşsün.
            return StaffIdByUserId.TryGetValue(userId, out var mapped) ? mapped : userId;
        }

        /// <summary>Anahtarın görünen adı; çözülemezse null (çağıran "Belirtilmemiş" der).</summary>
        public string? NameFor(Guid key) =>
            key == Guid.Empty ? null
            : StaffNames.TryGetValue(key, out var staffName) ? staffName
            : UserLabels.TryGetValue(key, out var label) ? label
            : null;

        /// <summary>Anahtar gerçek bir personel kaydı mı (değilse DTO'da StaffMemberId null kalır).</summary>
        public bool IsStaff(Guid key) => StaffNames.ContainsKey(key);
    }

    private async Task<SellerLookup> LoadSellerLookupAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var staff = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.FullName, s.TenantUserId })
            .ToListAsync(cancellationToken);
        // Müşteri portalı kullanıcıları (Role=Customer) hariç — binlerce satır olabilir.
        var users = await _db.TenantUsers.AsNoTracking()
            .Where(u => u.TenantId == tenantId
                        && (u.Role == UserRole.InstitutionOwner || u.Role == UserRole.BranchManager || u.Role == UserRole.Staff))
            .Select(u => new { u.Id, u.FullName, u.Role })
            .ToListAsync(cancellationToken);

        var staffNames = staff.GroupBy(s => s.Id).ToDictionary(g => g.Key, g => g.First().FullName);
        var staffIdByUserId = staff
            .Where(s => s.TenantUserId is { } uid && uid != Guid.Empty)
            .GroupBy(s => s.TenantUserId!.Value)
            .ToDictionary(g => g.Key, g => g.First().Id);

        var userLabels = new Dictionary<Guid, string>();
        foreach (var user in users)
        {
            var label = SellerLabel(user.Role, user.FullName);
            if (label is not null) userLabels[user.Id] = label;
        }
        return new SellerLookup(staffNames, staffIdByUserId, userLabels);
    }

    /// <summary>
    /// Yönetici satışının etiketi. Bir kurumda birden fazla yönetici olabildiği için ad parantez
    /// içinde verilir: "Kurum Yöneticisi (Ayşe Yılmaz)". Adı tanımlı değilse yalnız unvan yazılır.
    /// </summary>
    private static string? SellerLabel(UserRole role, string? fullName)
    {
        var name = string.IsNullOrWhiteSpace(fullName) ? null : fullName.Trim();
        var title = role switch
        {
            UserRole.InstitutionOwner => "Kurum Yöneticisi",
            UserRole.BranchManager => "Şube Yöneticisi",
            _ => null,   // Personel hesabı: unvan değil, yalnız adı yazılır.
        };
        if (title is null) return name;
        return name is null ? title : $"{title} ({name})";
    }

    /// <summary>Tek satırda satıcı adı boşsa oluşturana düşer (gerekmiyorsa ek sorgu yapılmaz).</summary>
    private async Task<CustomerAccountDto> WithSellerFallbackAsync(
        Guid tenantId, CustomerAccount account, CustomerAccountDto dto, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(dto.SoldByStaffName) || account.CreatedBy is null) return dto;
        var lookup = await LoadSellerLookupAsync(tenantId, cancellationToken);
        var name = lookup.NameFor(lookup.KeyFor(account.SoldByStaffMemberId, account.CreatedBy));
        return name is null ? dto : dto with { SoldByStaffName = name };
    }

    /// <summary>Liste için aynı düşüm — adlar tek seferde yüklenir.</summary>
    private async Task<CustomerAccountDto[]> WithSellerFallbackAsync(
        Guid tenantId, CustomerAccount[] accounts, CustomerAccountDto[] dtos, CancellationToken cancellationToken)
    {
        if (dtos.Length == 0) return dtos;
        var byId = accounts.GroupBy(a => a.Id).ToDictionary(g => g.Key, g => g.First());
        var needed = dtos.Any(d => string.IsNullOrWhiteSpace(d.SoldByStaffName)
                                   && byId.TryGetValue(d.Id, out var a) && a.CreatedBy is not null);
        if (!needed) return dtos;

        var lookup = await LoadSellerLookupAsync(tenantId, cancellationToken);
        return dtos.Select(dto =>
        {
            if (!string.IsNullOrWhiteSpace(dto.SoldByStaffName) || !byId.TryGetValue(dto.Id, out var account)) return dto;
            var name = lookup.NameFor(lookup.KeyFor(account.SoldByStaffMemberId, account.CreatedBy));
            return name is null ? dto : dto with { SoldByStaffName = name };
        }).ToArray();
    }

    public async Task<Result<PagedResult<CustomerAccountDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default, Guid? customerId = null, Guid? serviceDefinitionId = null, Guid? servicePackageId = null, string? category = null)
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

        // Katalog kartı (hizmet/paket satış paneli): satış, seans satırları üzerinden eşlenir.
        // EXISTS alt sorgusu kullanılır — Guid listesi .Contains() MySQL'de çevrilemiyor.
        if (serviceDefinitionId is { } svcId && svcId != Guid.Empty)
        {
            query = query.Where(x => _db.CustomerPackageSessions
                .Any(s => s.CustomerAccountId == x.Id && s.ServiceDefinitionId == svcId));
        }
        if (servicePackageId is { } pkgId && pkgId != Guid.Empty)
        {
            // Doğrudan cari satışı (ServicePackageId dolu) VEYA adisyon satışı (paket yalnız seansta).
            query = query.Where(x => x.ServicePackageId == pkgId || _db.CustomerPackageSessions
                .Any(s => s.CustomerAccountId == x.Id && s.ServicePackageId == pkgId));
        }
        // Kategori kapsamı: o kategorideki HERHANGİ bir hizmetin seansını içeren satışlar.
        // DİKKAT: ServiceDefinition.Category ŞİFRELİ bir kolondur (AES-GCM, rastgele nonce) —
        // SQL'de eşitlik karşılaştırması yapılamaz, sessizce 0 satır döner. Bu yüzden hizmetler
        // belleğe çözülüp kategori orada eşleştirilir, ardından satış kümesi seanslardan bulunur.
        var categoryScoped = !string.IsNullOrWhiteSpace(category);
        HashSet<Guid>? categoryAccountIds = null;
        if (categoryScoped)
        {
            var wanted = category!.Trim();
            var uncategorized = string.Equals(wanted, "Kategorisiz", StringComparison.OrdinalIgnoreCase);

            var services = await _db.ServiceDefinitions.AsNoTracking()
                .Where(x => x.TenantId == tenantId)
                .Select(x => new { x.Id, x.Category })
                .ToListAsync(cancellationToken);
            var serviceIds = services
                .Where(x => uncategorized
                    ? string.IsNullOrWhiteSpace(x.Category)
                    : string.Equals(x.Category?.Trim(), wanted, StringComparison.OrdinalIgnoreCase))
                .Select(x => x.Id)
                .ToHashSet();

            var sessionRows = await _db.CustomerPackageSessions.AsNoTracking()
                .Where(s => s.TenantId == tenantId)
                .Select(s => new { s.CustomerAccountId, s.ServiceDefinitionId })
                .ToListAsync(cancellationToken);
            categoryAccountIds = sessionRows
                .Where(s => serviceIds.Contains(s.ServiceDefinitionId))
                .Select(s => s.CustomerAccountId)
                .ToHashSet();
        }

        var catalogScoped = (serviceDefinitionId is { } s1 && s1 != Guid.Empty)
                            || (servicePackageId is { } s2 && s2 != Guid.Empty)
                            || categoryScoped;

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            query = query.Where(x => x.Name.Contains(search) || (x.Customer != null && x.Customer.FullName.Contains(search)));
        }

        int total;
        CustomerAccount[] accounts;
        if (categoryAccountIds is not null)
        {
            // Kategori süzgeci bellekte olduğu için sayfalama da bellekte yapılır.
            // Ölçek notu: bu görünüm yalnız katalog sayfasında, kategori seçilince açılır.
            var inCategory = (await query.ToListAsync(cancellationToken))
                .Where(a => categoryAccountIds.Contains(a.Id))
                .ToList();
            total = inCategory.Count;
            accounts = inCategory.Skip(request.Skip).Take(request.SafePageSize).ToArray();
        }
        else
        {
            total = await query.CountAsync(cancellationToken);
            accounts = await query.Skip(request.Skip).Take(request.SafePageSize).ToArrayAsync(cancellationToken);
        }

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

        // "Kim sattı": personel seçilmemiş satışlarda kaydı oluşturan kullanıcıya düşülür.
        items = await WithSellerFallbackAsync(tenantId, accounts, items, cancellationToken);

        // Paket bağı: adisyondan açılan satışta cari.ServicePackageId NULL bırakılır (paket yalnızca
        // seans satırında tutulur). Bağ seanstan türetilmezse "bu paketin satışı iptal edildi mi"
        // sorusu yalnızca doğrudan satışlarda cevaplanır — Paketler sayfasındaki "Müşteri İptali"
        // süzgeci adisyon satışlarını hiç göremezdi. Genel listede de gerekli, bu yüzden burada.
        items = await WithPackageLinkAsync(tenantId, items, cancellationToken);

        // Satış paneli (müşteri kartı ya da katalog kartı): seans durumu + kalemler +
        // Aktif/Tamamlandı/İptal rozeti. Yalnızca süzülmüş listede hesaplanır (genel liste hafif kalsın).
        if ((customerId is { } scoped && scoped != Guid.Empty) || catalogScoped)
            items = await EnrichSalesAsync(tenantId, accounts, items, cancellationToken);

        return Result<PagedResult<CustomerAccountDto>>.Success(new PagedResult<CustomerAccountDto>(items, total, request.SafePage, request.SafePageSize));
    }

    /// <summary>
    /// Satış satırlarına seans durumu, kalem dökümü ve durum rozetini ekler.
    /// Kalem tutarı: paket kalemi birim fiyatı varsa ondan, yoksa satış toplamı seanslara dağıtılarak.
    /// </summary>
    /// <summary>
    /// ServicePackageId'si boş olan satışlara (adisyon yoluyla açılanlar) paket bağını seanslardan
    /// doldurur. Yalnızca gereken satırlar için tek hafif sorgu çalışır.
    /// </summary>
    private async Task<CustomerAccountDto[]> WithPackageLinkAsync(
        Guid tenantId, CustomerAccountDto[] dtos, CancellationToken cancellationToken)
    {
        var missing = dtos.Where(d => d.ServicePackageId is null).Select(d => d.Id).ToHashSet();
        if (missing.Count == 0) return dtos;

        // MySQL'de Guid listesi .Contains() sunucuda çevrilemez → bellekte süzülür.
        var links = await _db.CustomerPackageSessions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.CustomerAccountId, s.ServicePackageId })
            .ToListAsync(cancellationToken);
        var byAccount = links
            // Paketsiz (tek hizmet) satışın seansında ServicePackageId boş Guid'dir — paket bağı sayılmaz.
            .Where(l => l.ServicePackageId != Guid.Empty && missing.Contains(l.CustomerAccountId))
            .GroupBy(l => l.CustomerAccountId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ServicePackageId).First());
        if (byAccount.Count == 0) return dtos;

        return dtos
            .Select(d => d.ServicePackageId is null && byAccount.TryGetValue(d.Id, out var pkg)
                ? d with { ServicePackageId = pkg }
                : d)
            .ToArray();
    }

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
                x.ServicePackageId,
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
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, hydrated!, 0m, 0, cancellationToken));
    }

    public async Task<Result<CustomerAccountDto>> CancelSaleAsync(Guid tenantId, Guid id, CancelSaleRequest request, CancellationToken cancellationToken = default)
    {
        var account = await LoadAsync(tenantId, id, cancellationToken);
        if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Satış kaydı bulunamadı."));
        account.CancelSale(request.Reason);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, account.BranchId, "Cancel", "CustomerAccount", account.Id,
            $"Satış iptal edildi: {account.Name}", new { request.Reason }, cancellationToken);
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, account, 0m, 0, cancellationToken));
    }

    public async Task<Result<CustomerAccountDto>> RestoreSaleAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var account = await LoadAsync(tenantId, id, cancellationToken);
        if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Satış kaydı bulunamadı."));
        account.RestoreSale();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, account.BranchId, "Restore", "CustomerAccount", account.Id,
            $"Satış iptali geri alındı: {account.Name}", null, cancellationToken);
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, account, 0m, 0, cancellationToken));
    }

    public async Task<Result<CustomerAccountDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var account = await LoadAsync(tenantId, id, cancellationToken);
        if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));
        var (revenue, count) = await GetAppointmentStatsAsync(tenantId, account.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, account, revenue, count, cancellationToken));
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
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, hydrated!, revenue, count, cancellationToken));
    }

    public async Task<Result<CustomerAccountDto>> UpdateAsync(Guid tenantId, Guid id, UpdateCustomerAccountRequest request, CancellationToken cancellationToken = default)
    {
        var account = await LoadAsync(tenantId, id, cancellationToken);
        if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));

        // İptal edilmiş satışın tutarı/taksiti değiştirilemez — önce iptal geri alınmalı.
        if (account.CancelledAtUtc is not null)
            return Result<CustomerAccountDto>.Failure(Error.Conflict("Bu satış iptal edilmiş; değişiklik yapılamaz. Gerekiyorsa önce iptali geri alın."));

        account.Rename(request.Name);
        account.ChangeTotal(request.TotalAmount, request.DepositAmount);
        account.SetNotes(request.Notes);
        if (request.IsActive) account.Activate(); else account.Deactivate();
        await _db.SaveChangesAsync(cancellationToken);
        var (revenue, count) = await GetAppointmentStatsAsync(tenantId, account.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, account, revenue, count, cancellationToken));
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
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, hydrated!, revenue, completedCount, cancellationToken));
    }

    public async Task<Result<CustomerAccountDto>> RegisterPaymentAsync(Guid tenantId, Guid id, RegisterAccountPaymentRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Amount <= 0) return Result<CustomerAccountDto>.Failure(Error.Validation("Tahsilat tutarı pozitif olmalı."));

        var accountInfo = await _db.CustomerAccounts
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Id == id)
            .Select(x => new { x.CustomerId, x.CancelledAtUtc })
            .FirstOrDefaultAsync(cancellationToken);
        if (accountInfo is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));

        // İPTAL EDİLMİŞ SATIŞA TAHSİLAT GİRİLEMEZ. Arayüzdeki buton gizlemesi güvenlik sınırı
        // değildir (Ön Muhasebe "Tahsilat Al" yolu ve doğrudan API çağrısı bu kapıdan geçer).
        // Yanlışlıkla iptal edildiyse önce "İptali geri al" yapılmalı.
        if (accountInfo.CancelledAtUtc is not null)
            return Result<CustomerAccountDto>.Failure(Error.Conflict("Bu satış iptal edilmiş; tahsilat alınamaz. Gerekiyorsa önce iptali geri alın."));

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

        // Parent Touch — ExecuteUpdate yalnız ilişkisel sağlayıcıda var (birim testleri InMemory kullanır).
        var nowUtc = DateTime.UtcNow;
        if (_db.Database.IsRelational())
        {
            await _db.CustomerAccounts
                .Where(x => x.Id == id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedAtUtc, (DateTime?)nowUtc), cancellationToken);
        }
        else
        {
            var parent = await _db.CustomerAccounts.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
            if (parent is not null) { parent.Touch(); await _db.SaveChangesAsync(cancellationToken); }
        }

        // Return hydrated
        var hydrated = await LoadAsync(tenantId, id, cancellationToken);
        var (revenue, completedCount) = await GetAppointmentStatsAsync(tenantId, accountInfo.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, hydrated!, revenue, completedCount, cancellationToken));
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

    /// <summary>
    /// Pano "Hizmet Raporu": kaç hizmet tanımlı, kaçının satışı sürüyor, dönemde kaç hizmet satıldı.
    /// PAKET raporundan ayrıdır — buradaki kategori HİZMETİN kategorisidir ve paket sayılmaz.
    /// Kategori/alt kategori ŞİFRELİ kolon olduğu için bellekte süzülür (SQL eşitliği çalışmaz).
    /// </summary>
    public async Task<Result<ServiceReportDto>> GetServiceReportAsync(Guid tenantId, DateTime? fromUtc = null, DateTime? toUtc = null, string? category = null, string? subCategory = null, CancellationToken cancellationToken = default)
    {
        var serviceRows = await _db.ServiceDefinitions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.Id, s.Category, s.SubCategory, s.Price })
            .ToListAsync(cancellationToken);

        var wantedCat = category?.Trim();
        var wantedSub = subCategory?.Trim();
        var scopedServices = string.IsNullOrWhiteSpace(wantedCat)
            ? serviceRows
            : serviceRows
                .Where(s => string.Equals(s.Category?.Trim(), wantedCat, StringComparison.OrdinalIgnoreCase)
                            && (string.IsNullOrWhiteSpace(wantedSub)
                                || string.Equals(s.SubCategory?.Trim(), wantedSub, StringComparison.OrdinalIgnoreCase)))
                .ToList();
        var scopedServiceIds = scopedServices.Select(s => s.Id).ToHashSet();

        // Dönemdeki satışlar — paket raporuyla aynı kurallar: iptal edilenler girmez, satış tarihi
        // yoksa kayıt tarihine düşülür.
        var accountsQuery = _db.CustomerAccounts
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.CancelledAtUtc == null);
        if (fromUtc.HasValue) accountsQuery = accountsQuery.Where(a => (a.SoldAtUtc < LegacySoldAtThreshold ? a.CreatedAtUtc : a.SoldAtUtc) >= fromUtc.Value);
        if (toUtc.HasValue) accountsQuery = accountsQuery.Where(a => (a.SoldAtUtc < LegacySoldAtThreshold ? a.CreatedAtUtc : a.SoldAtUtc) < toUtc.Value);
        var periodAccounts = await accountsQuery
            .Select(a => new { a.Id, a.TotalAmount })
            .ToListAsync(cancellationToken);
        var periodAccountIds = periodAccounts.Select(a => a.Id).ToHashSet();
        var totalByAccount = periodAccounts.ToDictionary(a => a.Id, a => a.TotalAmount);

        var sessions = await _db.CustomerPackageSessions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => new { s.CustomerAccountId, s.ServiceDefinitionId, s.TotalSessions, s.UsedSessions })
            .ToListAsync(cancellationToken);

        var scopedSessions = sessions
            .Where(s => scopedServiceIds.Contains(s.ServiceDefinitionId) && periodAccountIds.Contains(s.CustomerAccountId))
            .ToList();

        // Ciro: seans satırında tutar yok → satışın toplamı seans ağırlığına göre dağıtılır
        // (paket raporundaki kalem dağıtımıyla aynı mantık; kategori dışı kalemler paya girmez).
        var weightByAccount = sessions
            .Where(s => periodAccountIds.Contains(s.CustomerAccountId))
            .GroupBy(s => s.CustomerAccountId)
            .ToDictionary(g => g.Key, g => g.Sum(x => Math.Max(1, x.TotalSessions)));
        var revenue = scopedSessions.Sum(s =>
        {
            var weight = weightByAccount.TryGetValue(s.CustomerAccountId, out var w) && w > 0 ? w : 1;
            var total = totalByAccount.TryGetValue(s.CustomerAccountId, out var t) ? t : 0m;
            return total * Math.Max(1, s.TotalSessions) / weight;
        });

        // "Aktif Hizmet": dönemde satılanlardan seansı hâlâ devam eden satış adedi
        // (paket tarafındaki "Aktif Paket" ile aynı mantık — çeşit değil, satış).
        var activeSoldServiceCount = scopedSessions
            .GroupBy(s => new { s.CustomerAccountId, s.ServiceDefinitionId })
            .Count(g => g.Sum(x => Math.Max(0, x.TotalSessions - x.UsedSessions)) > 0);

        // "İptal Edilen": satılmış ama sonradan iptal edilmiş satışlar (yukarıdaki hesaplara girmez).
        var cancelledQuery = _db.CustomerAccounts
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.CancelledAtUtc != null);
        if (fromUtc.HasValue) cancelledQuery = cancelledQuery.Where(a => (a.SoldAtUtc < LegacySoldAtThreshold ? a.CreatedAtUtc : a.SoldAtUtc) >= fromUtc.Value);
        if (toUtc.HasValue) cancelledQuery = cancelledQuery.Where(a => (a.SoldAtUtc < LegacySoldAtThreshold ? a.CreatedAtUtc : a.SoldAtUtc) < toUtc.Value);
        var cancelledAccountIds = (await cancelledQuery.Select(a => a.Id).ToListAsync(cancellationToken)).ToHashSet();
        var cancelledSoldServiceCount = sessions
            .Count(s => scopedServiceIds.Contains(s.ServiceDefinitionId) && cancelledAccountIds.Contains(s.CustomerAccountId));

        var sessionsTotal = scopedSessions.Sum(s => s.TotalSessions);
        var sessionsUsed = scopedSessions.Sum(s => s.UsedSessions);

        return Result<ServiceReportDto>.Success(new ServiceReportDto(
            scopedSessions.Count,
            activeSoldServiceCount,
            cancelledSoldServiceCount,
            sessionsTotal,
            sessionsUsed,
            Math.Max(0, sessionsTotal - sessionsUsed),
            Math.Round(revenue, 2)));
    }

    public async Task<Result<AccountReportDto>> GetReportAsync(Guid tenantId, int months, DateTime? fromUtc = null, DateTime? toUtc = null, string? category = null, string? subCategory = null, CancellationToken cancellationToken = default)
    {
        // 'months' artık takvimin EN AZ kaç ay göstereceği (taban). Gerçek pencere, taksitlerin
        // bittiği son aya kadar otomatik uzar (üst sınır 36 ay) — sonda boş ay kuyruğu olmasın diye.
        if (months < 1) months = 6;
        if (months > 24) months = 24;
        const int hardCapMonths = 36;

        // Dönem filtresi: verilirse rapor, [fromUtc, toUtc) aralığında satılan paketlere göre süzülür.
        // Kapsamdaki cariler (tenant + şube global filtresiyle süzülür) — taksit + tahsilat dahil.
        // İPTAL EDİLEN SATIŞLAR RAPORA GİRMEZ: CancelSale yalnızca IsActive/CancelledAtUtc yazar,
        // taksitleri Cancelled'a çekmez. Bu yüzden burada elenmezlerse iptal edilmiş bir satışın
        // kalan taksiti "Toplam Kalan Taksit"/"Vadesi Geçmiş"e, yapılmayacak seansları "Kalan
        // Seans"a eklenirdi. İptaller Ön Muhasebe'deki "İptal edilenler" görünümünde izlenir.
        var accountsQuery = _db.CustomerAccounts
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.CancelledAtUtc == null);
        // Dönem, satışın GERÇEK tarihine (SoldAtUtc) göre süzülür. Normal satışta SoldAtUtc =
        // oluşturma anı; geçmiş satış girişinde ise geçmiş bir tarihtir — böylece 2024 satışı
        // bugünün cirosunda görünmez.
        // SoldAtUtc kolonu sonradan eklendi (20260725211801) ve eski satırlarda 0001-01-01 kalır;
        // BackfillCustomerAccountSoldAt bunu doldurur ama migration'ı henüz uygulanmamış kurumda
        // bu kayıtlar HİÇBİR döneme düşmezdi. Mapping.ToDto ile aynı kural: satış tarihi yoksa
        // kayıt tarihine düşülür.
        if (fromUtc.HasValue) accountsQuery = accountsQuery.Where(a => (a.SoldAtUtc < LegacySoldAtThreshold ? a.CreatedAtUtc : a.SoldAtUtc) >= fromUtc.Value);
        if (toUtc.HasValue) accountsQuery = accountsQuery.Where(a => (a.SoldAtUtc < LegacySoldAtThreshold ? a.CreatedAtUtc : a.SoldAtUtc) < toUtc.Value);
        // Kategori süzgeci (dönem çipiyle BİRLİKTE çalışır): seçiliyse rapor yalnızca o kategorideki
        // paketlere ve onların satışlarına daralır. Alt kategori de verilirse ikisi birden aranır.
        // null = süzgeç yok (tüm paketler).
        // DİKKAT: Category/SubCategory ŞİFRELİ kolonlardır — SQL'de `p.Category == category`
        // eşitliği HİÇBİR satırı bulmaz (şifreleme deterministik değil). Satırlar çekilip bellekte
        // süzülür; EF materialize ederken çözer. Paket sayısı küçüktür (katalog), maliyeti yok.
        HashSet<Guid>? categoryPackageIds = null;
        if (!string.IsNullOrWhiteSpace(category))
        {
            var catRows = await _db.ServicePackages
                .AsNoTracking()
                .Where(p => p.TenantId == tenantId)
                .Select(p => new { p.Id, p.Category, p.SubCategory })
                .ToListAsync(cancellationToken);
            var wantedCat = category.Trim();
            var wantedSub = subCategory?.Trim();
            categoryPackageIds = catRows
                .Where(p => string.Equals(p.Category?.Trim(), wantedCat, StringComparison.OrdinalIgnoreCase)
                            && (string.IsNullOrWhiteSpace(wantedSub)
                                || string.Equals(p.SubCategory?.Trim(), wantedSub, StringComparison.OrdinalIgnoreCase)))
                .Select(p => p.Id)
                .ToHashSet();
        }

        var accounts = await accountsQuery
            .Include(a => a.Installments)
            .Include(a => a.Payments)
            .Include(a => a.Customer)   // müşteri kırılımı için ad (şifreli kolon → bellekte çözülür)
            .ToListAsync(cancellationToken);

        // Kategori seçiliyse satışlar da daralır. Cari→paket bağı doğrudan alandan ya da (adisyon
        // satışında NULL kaldığı için) seans satırından kurulur — bkz. WithPackageLinkAsync.
        if (categoryPackageIds is not null)
        {
            var linkRows = await _db.CustomerPackageSessions
                .AsNoTracking()
                .Where(s => s.TenantId == tenantId)
                .Select(s => new { s.CustomerAccountId, s.ServicePackageId })
                .ToListAsync(cancellationToken);
            var packagesByAccount = linkRows
                .Where(l => l.ServicePackageId != Guid.Empty)
                .GroupBy(l => l.CustomerAccountId)
                .ToDictionary(g => g.Key, g => g.Select(x => x.ServicePackageId).ToHashSet());

            accounts = accounts
                .Where(a => (a.ServicePackageId is { } pid && categoryPackageIds.Contains(pid))
                            || (packagesByAccount.TryGetValue(a.Id, out var pkgs) && pkgs.Overlaps(categoryPackageIds)))
                .ToList();
        }

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
        // Dönem ONAY anına göre süzülür: satış cariye onayda işlenir ve o carinin SoldAtUtc'si de
        // onay anıdır. CreatedAtUtc kullanılırsa dün açılıp bugün onaylanan adisyonun paketi dünkü
        // döneme, seansları/tutarı bugünkü döneme düşer — "Satılan Paket" ile kırılım çelişirdi.
        var adisyonQuery = _db.Adisyonlar
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.Status == AdisyonStatus.Approved);
        if (fromUtc.HasValue) adisyonQuery = adisyonQuery.Where(a => (a.ApprovedAtUtc ?? a.CreatedAtUtc) >= fromUtc.Value);
        if (toUtc.HasValue) adisyonQuery = adisyonQuery.Where(a => (a.ApprovedAtUtc ?? a.CreatedAtUtc) < toUtc.Value);
        // Adisyonla satılan paket sonradan iptal edilen bir cariye bağlandıysa satış sayılmamalı.
        // Doğrudan satışta bunu accountsQuery'deki CancelledAtUtc süzgeci hallediyor; adisyon
        // kalemi cariye bağlı olmadığı için bağ, seans satırındaki SourceAdisyonId üzerinden kurulur.
        // Ek sorgular yalnızca gerçekten iptal edilmiş satış varsa çalışır.
        var cancelledAccountIds = (await _db.CustomerAccounts
                .AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.CancelledAtUtc != null)
                .Select(a => a.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();
        var cancelledSourceAdisyonIds = new HashSet<Guid>();
        if (cancelledAccountIds.Count > 0)
        {
            // MySQL'de Guid listesi .Contains() sunucuda çevrilemez → bellekte süzülür.
            var sourceLinks = await _db.CustomerPackageSessions
                .AsNoTracking()
                .Where(s => s.TenantId == tenantId && s.SourceAdisyonId != null)
                .Select(s => new { s.CustomerAccountId, s.SourceAdisyonId })
                .ToListAsync(cancellationToken);
            cancelledSourceAdisyonIds = sourceLinks
                .Where(r => cancelledAccountIds.Contains(r.CustomerAccountId))
                .Select(r => r.SourceAdisyonId!.Value)
                .ToHashSet();
        }

        var approvedAdisyonlar = (await adisyonQuery
                .Include(a => a.Items)
                .ToListAsync(cancellationToken))
            .Where(a => !cancelledSourceAdisyonIds.Contains(a.Id))
            .ToList();
        var adisyonPackageItems = approvedAdisyonlar
            // Paket satışı kaleminde RefId = satılan paketin kimliği; kategori seçiliyse ona göre süzülür.
            .SelectMany(a => a.Items.Where(i => i.Type == AdisyonItemType.PackageSale
                                                && (categoryPackageIds is null
                                                    || (i.RefId is { } refId && categoryPackageIds.Contains(refId))))
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

        // "Kim sattı" adları: personel + (personel seçilmemiş satışlar için) kaydı oluşturan kullanıcı.
        var sellers = await LoadSellerLookupAsync(tenantId, cancellationToken);

        foreach (var acc in accounts)
        {
            var bucket = customerAgg.TryGetValue(acc.CustomerId, out var existingBucket)
                ? existingBucket
                : customerAgg[acc.CustomerId] = new CustomerBreakdownAccumulator(acc.Customer?.FullName ?? "Müşteri");
            bucket.AccountCount++;
            bucket.TotalAmount += acc.TotalAmount;
            if (!string.IsNullOrWhiteSpace(acc.Name) && !bucket.PackageNames.Contains(acc.Name)) bucket.PackageNames.Add(acc.Name);

            // "Kim sattı" — müşteri kırılımında da satışı yapan personel görünsün.
            var sellerKey = sellers.KeyFor(acc.SoldByStaffMemberId, acc.CreatedBy);
            if (!bucket.Sellers.TryGetValue(sellerKey, out var sellerAcc)) bucket.Sellers[sellerKey] = sellerAcc = new SellerAccumulator();
            sellerAcc.Accounts.Add(acc.Id);
            sellerAcc.Customers.Add(acc.CustomerId);
            sellerAcc.Amount += acc.TotalAmount;

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
        // Kategori seçiliyse seanslar da o kategorinin paketleriyle sınırlanır. Aksi halde aynı
        // satışa bağlı BAŞKA paketlerin (ya da pakete bağlı olmayan manuel) seansları "Kalan Seans"a
        // sızar ve "Toplam/Aktif Paket" ile çelişirdi.
        var scopedSessions = sessionRows
            .Where(s => inScopeAccountIds.Contains(s.CustomerAccountId)
                        && (categoryPackageIds is null || categoryPackageIds.Contains(s.ServicePackageId)))
            .ToList();
        var sessionsTotal = scopedSessions.Sum(s => s.TotalSessions);
        var sessionsUsed = scopedSessions.Sum(s => s.UsedSessions);

        // --- "Aktif Paket" / "İptal Edilen Paket" -------------------------------
        // Kartlar KATALOĞU değil SATIŞI sayar; hepsi dönem + kategori süzgecine uyar:
        //   Toplam Paket = packageSalesCount (dönemde satılan paket adedi)
        //   Aktif Paket  = bunlardan seansı HÂLÂ devam eden satış adedi
        //   İptal Edilen = satılmış AMA sonradan iptal edilmiş satış adedi
        // Paket örneği = (cari, paket) çifti — aynı paket 5 müşteriye satıldıysa 5 sayılır.
        // Toplam ve Aktif AYNI tabandan sayılır (satılan paket örnekleri). Farklı tabanlar
        // kullanılınca dönem dilimlerinde "Aktif > Toplam" gibi imkânsız sonuçlar çıkıyordu.
        var soldPackageInstances = scopedSessions
            .GroupBy(s => new { s.CustomerAccountId, s.ServicePackageId })
            .Select(g => new { g.Key.CustomerAccountId, Remaining = g.Sum(r => Math.Max(0, r.TotalSessions - r.UsedSessions)) })
            .ToList();
        var soldPackageCount = soldPackageInstances.Count;
        var activeSoldPackageCount = soldPackageInstances.Count(x => x.Remaining > 0);

        // İptaller yukarıdaki hesaplara girmez (accountsQuery onları eler); ayrı sayılır.
        var cancelledQuery = _db.CustomerAccounts
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.CancelledAtUtc != null);
        if (fromUtc.HasValue) cancelledQuery = cancelledQuery.Where(a => (a.SoldAtUtc < LegacySoldAtThreshold ? a.CreatedAtUtc : a.SoldAtUtc) >= fromUtc.Value);
        if (toUtc.HasValue) cancelledQuery = cancelledQuery.Where(a => (a.SoldAtUtc < LegacySoldAtThreshold ? a.CreatedAtUtc : a.SoldAtUtc) < toUtc.Value);
        var cancelledPeriodAccountIds = (await cancelledQuery.Select(a => a.Id).ToListAsync(cancellationToken)).ToHashSet();
        var cancelledSoldPackageCount = sessionRows
            .Where(s => cancelledPeriodAccountIds.Contains(s.CustomerAccountId)
                        && (categoryPackageIds is null || categoryPackageIds.Contains(s.ServicePackageId)))
            .GroupBy(s => new { s.CustomerAccountId, s.ServicePackageId })
            .Count();

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
        // "Kim sattı": cari → satıcı anahtarı (personel seçilmemişse oluşturan kullanıcı).
        var accountSellers = accounts.ToDictionary(a => a.Id, a => sellers.KeyFor(a.SoldByStaffMemberId, a.CreatedBy));

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
                // Kırılımdaki kategori HİZMETİN kategorisidir (rapor parametresindeki paket kategorisiyle karışmasın).
                var serviceCategory = string.IsNullOrWhiteSpace(row.Category) ? "Kategorisiz" : row.Category!.Trim();
                var key = (serviceCategory, row.ServiceDefinitionId);
                if (!serviceAgg.TryGetValue(key, out var acc))
                {
                    acc = new CategoryServiceAccumulator(row.ServiceName);
                    serviceAgg[key] = acc;
                }
                acc.SessionsTotal += row.TotalSessions;
                acc.SessionsUsed += row.UsedSessions;
                acc.Accounts.Add(row.CustomerAccountId);
                acc.Customers.Add(row.CustomerId);
                var share = weightSum > 0m ? accountTotal * weights[i] / weightSum : 0m;
                acc.Amount += share;

                var sellerId = accountSellers.TryGetValue(row.CustomerAccountId, out var sid) ? sid : Guid.Empty;
                if (!acc.Sellers.TryGetValue(sellerId, out var seller)) acc.Sellers[sellerId] = seller = new SellerAccumulator();
                seller.Accounts.Add(row.CustomerAccountId);
                seller.Customers.Add(row.CustomerId);
                seller.SessionsTotal += row.TotalSessions;
                seller.Amount += share;
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
                        Math.Round(kv.Value.Amount, 2),
                        BuildSellers(kv.Value.Sellers, sellers)))
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
                    services,
                    BuildSellers(g.SelectMany(kv => kv.Value.Sellers), sellers));
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
                Math.Max(0, kv.Value.SessionsTotal - kv.Value.SessionsUsed),
                BuildSellers(kv.Value.Sellers, sellers)))
            .OrderByDescending(c => c.RemainingAmount)
            .ThenByDescending(c => c.TotalAmount)
            .Take(200)
            .ToList();

        var report = new AccountReportDto(
            // "Toplam Paket" kartı: Aktif/İptal ile aynı tabandan (satılan paket örnekleri).
            // packageSalesCount (cari + adisyon kalemi) yalnızca seansı olmayan satışlar için
            // yedek: seans tabanı boşsa eski sayıma düşülür.
            soldPackageCount > 0 ? soldPackageCount : packageSalesCount,
            customersWithPackages,
            activeSoldPackageCount,
            cancelledSoldPackageCount,
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
        /// <summary>Bu müşteriye satış yapan personel bazında pay (Guid.Empty = atanmamış).</summary>
        public Dictionary<Guid, SellerAccumulator> Sellers { get; } = [];
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
        /// <summary>Satışı yapan personel bazında pay (Guid.Empty = personel atanmamış satış).</summary>
        public Dictionary<Guid, SellerAccumulator> Sellers { get; } = [];
    }

    /// <summary>Tek personelin bir hizmet/kategori içindeki satış payı.</summary>
    private sealed class SellerAccumulator
    {
        public HashSet<Guid> Accounts { get; } = [];
        public HashSet<Guid> Customers { get; } = [];
        public int SessionsTotal { get; set; }
        public decimal Amount { get; set; }
    }

    /// <summary>Satıcı sözlüklerini birleştirip DTO listesine çevirir (tutar → azalan).</summary>
    private static List<PackageSellerDto> BuildSellers(
        IEnumerable<KeyValuePair<Guid, SellerAccumulator>> entries,
        SellerLookup sellers)
    {
        var merged = new Dictionary<Guid, SellerAccumulator>();
        foreach (var (key, value) in entries)
        {
            if (!merged.TryGetValue(key, out var acc)) merged[key] = acc = new SellerAccumulator();
            foreach (var a in value.Accounts) acc.Accounts.Add(a);
            foreach (var c in value.Customers) acc.Customers.Add(c);
            acc.SessionsTotal += value.SessionsTotal;
            acc.Amount += value.Amount;
        }

        return merged
            .Select(kv => new PackageSellerDto(
                // Anahtar bir kullanıcı (yönetici) olabilir; StaffMemberId yalnız gerçek personelde dolar.
                sellers.IsStaff(kv.Key) ? kv.Key : null,
                sellers.NameFor(kv.Key) ?? "Belirtilmemiş",
                kv.Value.Accounts.Count,
                kv.Value.Customers.Count,
                kv.Value.SessionsTotal,
                Math.Round(kv.Value.Amount, 2)))
            .OrderByDescending(s => s.Amount)
            .ThenByDescending(s => s.SoldCount)
            .ToList();
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
