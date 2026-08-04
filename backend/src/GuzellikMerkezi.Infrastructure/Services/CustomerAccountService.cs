using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed partial class CustomerAccountService : ICustomerAccountService
{
    private readonly GuzellikDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;
    /// <summary>Satış iptalinde adisyonun prim/sadakat/stok/kupon etkilerini geri alır.</summary>
    private readonly IAdisyonEffectsReversal _adisyonReversal;

    /// <summary>
    /// SoldAtUtc kolonu eklenmeden önce oluşmuş cariler bu eşiğin altında (0001-01-01) kalır.
    /// Dönem süzmesinde bu satırlar CreatedAtUtc'ye düşürülür — bkz. GetReportAsync.
    /// </summary>
    private static readonly DateTime LegacySoldAtThreshold = new(1900, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public CustomerAccountService(
        GuzellikDbContext db,
        IAuditLogger audit,
        ICurrentUser currentUser,
        IAdisyonEffectsReversal? adisyonReversal = null)
    {
        _db = db;
        _audit = audit;
        _currentUser = currentUser;
        // Birim testleri servisi 3 bağımlılıkla kuruyor; varsayılan gerçek uygulamaya düşer.
        _adisyonReversal = adisyonReversal ?? new AdisyonEffectsReversal(db, new Time.SystemDateTimeProvider());
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
            .Include(x => x.AppliedByStaffMember)
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
        var paid = Math.Min(request.PaidAmount, request.TotalAmount);
        var method = string.IsNullOrWhiteSpace(request.PaymentMethod) ? "cash" : request.PaymentMethod.Trim();

        CustomerAccount account;
        if (request.PaidInstallmentCount is { } paidInstallments)
        {
            // YENİ AKIŞ — ödeme geçmişi de kaydedilir: peşinat yok, plan TOPLAM tutar üzerinden
            // kurulur ve ödenmiş her taksit KENDİ VADE TARİHİYLE tahsilat olarak yazılır. Böylece
            // geçmiş satış, geçmiş cari/tahsilat dökümünde (ay ay) doğru tarihlerle görünür.
            account = new CustomerAccount(tenantId, branchId, customer.Id, package?.Id, request.Name.Trim(), request.TotalAmount, 0m);
            account.SetNotes(request.Notes);
            account.SetSaleInfo(soldAtUtc, request.SoldByStaffMemberId, isHistorical: true);
            account.SetAppliedBy(request.AppliedByStaffMemberId);

            if (request.InstallmentCount > 0)
            {
                var firstDue = request.FirstDueDate ?? DateOnly.FromDateTime(soldAtUtc.AddMonths(1));
                account.RebuildInstallments(request.InstallmentCount, firstDue);

                var payCount = Math.Clamp(paidInstallments, 0, request.InstallmentCount);
                foreach (var inst in account.Installments.OrderBy(i => i.No).Take(payCount))
                {
                    if (inst.Amount <= 0) continue;
                    // Vade günü öğlen UTC: gün kayması olmadan o aya düşsün.
                    var occurred = DateTime.SpecifyKind(inst.DueDate.ToDateTime(new TimeOnly(12, 0)), DateTimeKind.Utc);
                    account.RegisterPayment(inst.Amount, method, "Geçmiş satış", occurred);
                }
            }
            else if (paid > 0)
            {
                // Peşin: tek tahsilat, satış gününde.
                account.RegisterPayment(paid, method, "Geçmiş satış (peşin)", soldAtUtc);
            }
        }
        else
        {
            // ESKİ AKIŞ (alan göndermeyen istemciler): peşinat = geçmişte tahsil edilmiş tutar;
            // kalan borç taksitlere bölünür.
            account = new CustomerAccount(tenantId, branchId, customer.Id, package?.Id, request.Name.Trim(), request.TotalAmount, paid);
            account.SetNotes(request.Notes);
            account.SetSaleInfo(soldAtUtc, request.SoldByStaffMemberId, isHistorical: true);
            account.SetAppliedBy(request.AppliedByStaffMemberId);

            var remaining = request.TotalAmount - paid;
            if (request.InstallmentCount > 0 && remaining > 0)
            {
                // Vade verilmediyse satış tarihinin bir ay sonrasından başlatılır.
                var firstDue = request.FirstDueDate ?? DateOnly.FromDateTime(soldAtUtc.AddMonths(1));
                account.RebuildInstallments(request.InstallmentCount, firstDue);
            }

            // Peşinat GERÇEK bir tahsilat satırına dönüşür: sadece kolonda kalırsa cari "tahsil
            // edildi" sayıyor ama kasa/gelir defteri parayı hiç görmüyordu (bkz. RegisterDepositPayment).
            account.RegisterDepositPayment("cash", soldAtUtc);
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

        // Geçmişte KULLANILMIŞ seanslar düşülür (kart "3/8 kaldı" desin) ve istenirse her biri için
        // TAMAMLANMIŞ geçmiş randevu açılır — geçmiş seanslar randevular sayfasında da görünsün.
        if (request.SessionsUsed > 0)
        {
            var sessions = await _db.CustomerPackageSessions
                .Where(x => x.TenantId == tenantId && x.CustomerAccountId == account.Id)
                .ToListAsync(cancellationToken);
            var toConsume = request.SessionsUsed;
            // Hangi hizmetten kaç seans düşüldüğü: geçmiş randevular doğru hizmetle açılsın.
            var consumedByService = new List<Guid>();
            foreach (var session in sessions)
            {
                while (toConsume > 0 && session.TryConsume())
                {
                    consumedByService.Add(session.ServiceDefinitionId);
                    toConsume--;
                }
                if (toConsume == 0) break;
            }
            await _db.SaveChangesAsync(cancellationToken);

            if (request.CreateSessionAppointments && consumedByService.Count > 0)
            {
                await CreateHistoricalSessionAppointmentsAsync(
                    tenantId, account, consumedByService, request.AppliedByStaffMemberId,
                    soldAtUtc, request.SessionIntervalDays, cancellationToken);
            }
        }

        await _audit.LogAsync(tenantId, account.BranchId, "CreateHistorical", "CustomerAccount", account.Id,
            $"Geçmiş satış girildi: {account.Name} · {soldAtUtc:dd.MM.yyyy} · {account.TotalAmount:N2}",
            new
            {
                account.Name,
                account.TotalAmount,
                paid = account.PaidAmount,
                soldAtUtc,
                request.InstallmentCount,
                request.PaidInstallmentCount,
                request.SessionsTotal,
                request.SessionsUsed,
                request.AppliedByStaffMemberId,
                request.CreateSessionAppointments,
            }, cancellationToken);

        var hydrated = await LoadAsync(tenantId, account.Id, cancellationToken);
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, hydrated!, 0m, 0, cancellationToken));
    }

    /// <summary>
    /// Geçmiş satışta kullanılmış her seans için TAMAMLANMIŞ bir geçmiş randevu açar; böylece
    /// geçmiş seanslar randevular sayfasında, müşteri kartında ve personel performansında görünür.
    ///
    /// Kurallar: fiyat <b>0</b> (satış tutarı zaten caride — randevuya da yazılsa ciro iki kez
    /// sayılırdı), tarihler satış gününden başlayıp `intervalDays` aralıklarla ilerler ve BUGÜNÜ
    /// AŞMAZ (geçmiş kayıt geleceğe düşmesin), çakışma/mesai kontrolü yapılmaz (geçmişe yazılıyor).
    /// Personel seçilmemişse randevu açılmaz — randevunun personeli zorunludur.
    /// </summary>
    private async Task CreateHistoricalSessionAppointmentsAsync(
        Guid tenantId,
        CustomerAccount account,
        IReadOnlyList<Guid> consumedServiceIds,
        Guid? staffMemberId,
        DateTime soldAtUtc,
        int intervalDays,
        CancellationToken cancellationToken)
    {
        if (account.BranchId is not { } branchId) return;

        // Personel: seçilen ya da (yoksa) satışı yapan. İkisi de yoksa randevu açılamaz.
        var staffId = staffMemberId is { } s && s != Guid.Empty ? s : account.SoldByStaffMemberId;
        if (staffId is not { } staff || staff == Guid.Empty) return;
        var staffExists = await _db.StaffMembers.AsNoTracking()
            .AnyAsync(x => x.TenantId == tenantId && x.Id == staff, cancellationToken);
        if (!staffExists) return;

        // DİKKAT: Guid listesiyle `.Contains()` MySql.EntityFrameworkCore'da SQL'e çevrilemiyor (500).
        // Kurumun hizmetleri çekilip bellekte süzülür.
        var wanted = consumedServiceIds.ToHashSet();
        var durations = await _db.ServiceDefinitions.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .Select(x => new { x.Id, x.DurationMinutes })
            .ToListAsync(cancellationToken);
        var durationById = durations
            .Where(x => wanted.Contains(x.Id))
            .ToDictionary(x => x.Id, x => x.DurationMinutes <= 0 ? 60 : x.DurationMinutes);

        var maxNumber = await _db.Appointments.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.Number != null)
            .MaxAsync(a => (int?)a.Number, cancellationToken) ?? 10000;

        var step = intervalDays <= 0 ? 15 : Math.Min(intervalDays, 365);
        var now = DateTime.UtcNow;

        for (var i = 0; i < consumedServiceIds.Count; i++)
        {
            var serviceId = consumedServiceIds[i];
            var start = soldAtUtc.AddDays((double)step * i);
            // Geçmiş kayıt geleceğe düşmesin: taşarsa bugüne (bir saat öncesine) çekilir.
            if (start > now) start = now.AddHours(-1);
            start = DateTime.SpecifyKind(start, DateTimeKind.Utc);
            var minutes = durationById.TryGetValue(serviceId, out var d) ? d : 60;
            var end = start.AddMinutes(minutes);

            var appointment = new Appointment(
                tenantId, branchId, account.CustomerId, staff, serviceId, start, end,
                price: 0m,
                notes: $"Geçmiş kayıt · {account.Name}");
            appointment.AssignNumber(++maxNumber);
            appointment.Complete();
            _db.Appointments.Add(appointment);
        }

        await _db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// SATIŞ İPTALİ = ARŞİVE TAŞIMA. Cari kaydı, taksitleri, tahsilatları ve seans bakiyeleri canlı
    /// tablolardan <b>gerçekten silinir</b>; tam kopyası <c>cancelled_sales</c>'e yazılır.
    ///
    /// <para>Neden silme? İptal eskiden yalnızca bir damgaydı (<c>CancelledAtUtc</c>) ve satırlar
    /// yerinde kalıyordu; her okuma yolunun kendi süzgecini koyması gerekiyordu. Koymayan yollar
    /// (kasa akışı, kâr-zarar, günlük kart, müşteri harcaması) iptal edilmiş satışın parasını
    /// saymaya devam ediyordu. Satır yoksa hiçbir rapor sayamaz — hata sınıfı yapısal olarak biter.</para>
    ///
    /// <para>DİKKAT: <c>Remove()</c> bu DbContext'te otomatik soft-delete'e çevriliyor
    /// (bkz. GuzellikDbContext.ApplyAuditInfo). Gerçek silme yalnızca <c>ExecuteDeleteAsync</c> ile olur.</para>
    /// </summary>
    public async Task<Result<CustomerAccountDto>> CancelSaleAsync(Guid tenantId, Guid id, CancelSaleRequest request, CancellationToken cancellationToken = default)
    {
        // Tutar işareti kilit gerektirmez; tahsil edilene karşı doğrulama kilit ALTINDA yapılır.
        var refunded = Math.Round(request.RefundedAmount ?? 0m, 2, MidpointRounding.AwayFromZero);
        if (refunded < 0)
            return Result<CustomerAccountDto>.Failure(Error.Validation("İade tutarı negatif olamaz."));

        return await InTransactionAsync(async () =>
        {
            // 0) KİLİT SIRASI ORTAK OLMALI (RowLock.TableOrder: customers → … → customer_accounts).
            //    Bu yol cariyi EN BAŞTA kilitliyordu; adisyon onayı/silme ise müşteriyi önce alıyor.
            //    İki yön çapraz bekleyip MariaDB deadlock üretebiliyordu. Müşteri satırı burada da
            //    ilk kilitlenirse aynı müşterinin iki işlemi daha kapıda serileşir. Kimlik okuması
            //    kilitsizdir; asıl veriler kilit sonrası yeniden okunur (aşağıda).
            var customerIdForLock = await _db.CustomerAccounts.AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.Id == id)
                .Select(x => (Guid?)x.CustomerId)
                .FirstOrDefaultAsync(cancellationToken);
            if (customerIdForLock is { } lockCustomerId)
                await RowLock.LockRowAsync(_db, "customers", lockCustomerId, cancellationToken);

            // 1) ÖNCE KİLİT, SONRA OKUMA. Eskiden cari kilitten önce yüklendiği için araya giren
            //    bir tahsilat yedeğe girmiyor, sonraki hard-delete onu KALICI olarak siliyordu.
            var lockState = await LockForCancelAsync(tenantId, id, cancellationToken);
            if (lockState == CancelLockState.AlreadyArchived)
                return Result<CustomerAccountDto>.Failure(Error.Conflict("Bu satış az önce iptal edildi."));
            if (lockState == CancelLockState.NotFound)
                return Result<CustomerAccountDto>.Failure(Error.NotFound("Satış kaydı bulunamadı."));

            // Kilitten önce okunmuş (bayat) bir kopya izleniyor olabilir — taze okumayı garantile.
            _db.ChangeTracker.Clear();

            var account = await LoadAsync(tenantId, id, cancellationToken);
            if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Satış kaydı bulunamadı."));

            // İADE DOĞRULAMASI: geçersiz tutar sessizce kırpılmaz — kullanıcı ne kaydedildiğini bilmeli.
            var collected = account.PaidAmount;
            if (refunded > collected)
                return Result<CustomerAccountDto>.Failure(Error.Validation(
                    $"İade tutarı tahsil edilmiş tutarı aşamaz (tahsil edilen: {collected:N2})."));

            // ---- KİLİT ÖNCE, OKUMA SONRA (yan etki satırları için de) ---------------------
            // Bu satırlar kilitlenmeden okunursa araya giren bir işlemin değişikliği ChangeTracker'da
            // bayat kalır: kullanılmış bir seans "kullanılmamış" gibi yedeğe girip silinebilirdi.
            // Bu yüzden ilk okuma yalnız KİMLİKLERİ toplar; kilit alındıktan sonra her şey yeniden yüklenir.
            var sessionIdsForLock = await _db.CustomerPackageSessions
                .Where(s => s.TenantId == tenantId && s.CustomerId == account.CustomerId)
                .Select(s => s.Id).ToListAsync(cancellationToken);
            var adisyonIdsForLock = await _db.Adisyonlar
                .Where(a => a.TenantId == tenantId && a.CustomerAccountId == id)
                .Select(a => a.Id).ToListAsync(cancellationToken);
            // Guid listesiyle .Contains() MySQL sağlayıcısında SQL'e çevrilemez ("type mapping" hatası)
            // → korele EXISTS kullanılır. [[project_mysql_query_gotchas]]
            var refIdsForLock = await _db.AdisyonItems
                .Where(i => i.RefId != null && _db.Adisyonlar
                    .Any(a => a.Id == i.AdisyonId && a.TenantId == tenantId && a.CustomerAccountId == id))
                .Select(i => new { i.Type, RefId = i.RefId!.Value })
                .ToListAsync(cancellationToken);

            await LockSideEffectRowsAsync(
                account.CustomerId, adisyonIdsForLock,
                refIdsForLock.Where(x => x.Type == AdisyonItemType.Product).Select(x => x.RefId),
                refIdsForLock.Where(x => x.Type == AdisyonItemType.Discount).Select(x => x.RefId),
                sessionIdsForLock, cancellationToken);

            // Kilitler alındı → bayat kopyaları at ve HER ŞEYİ yeniden oku.
            _db.ChangeTracker.Clear();
            account = (await LoadAsync(tenantId, id, cancellationToken))!;
            if (account is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Satış kaydı bulunamadı."));

            var sessions = await _db.CustomerPackageSessions
                .Where(s => s.TenantId == tenantId && s.CustomerAccountId == id)
                .ToListAsync(cancellationToken);

            // Satışı doğuran adisyon(lar). Onaylı olsalar da iptale çekilir: karşılığı olmayan bir
            // satışın fişi ciroda kalmamalı. Cari bağı da koparılır (satır siliniyor).
            var adisyonlar = await _db.Adisyonlar
                .Include(a => a.Items)
                .Where(a => a.TenantId == tenantId && a.CustomerAccountId == id)
                .ToListAsync(cancellationToken);

            // Statüler ters kayıttan ÖNCE dondurulur: geri alma her fişi Approved yapmasın, herkes
            // kendi eski hâline dönsün (açık kalmış bir adisyon geri almada onaylı olmamalı).
            var originalStatuses = adisyonlar.ToDictionary(
                a => a.Id, a => (a.Status, a.ApprovedAtUtc));

            // Yanıt DTO'su SİLMEDEN ÖNCE üretilir — sonrasında kayıt yok.
            var dto = await PresentAsync(tenantId, account, 0m, 0, cancellationToken);
            var accountName = account.Name;
            var branchId = account.BranchId;

            // Adisyonun ONAYDA oluşturduğu yan etkileri (prim, sadakat, stok, kupon, paket kullanımı)
            // geri al. Yalnız statüyü Cancelled yapmak yetmiyordu: cari kaybolurken personel primi ve
            // stok düşümü sistemde kalıyordu. Onaylanmamış adisyonda ise hiç etki OLUŞMAMIŞTIR —
            // ters kayıt uygulanırsa hiç düşmemiş stok artar, hiç harcanmamış kupon geri açılırdı.
            var reversals = new List<AdisyonReversalRecord>(adisyonlar.Count);
            foreach (var adisyon in adisyonlar)
            {
                if (adisyon.Status == AdisyonStatus.Approved)
                    reversals.Add(await _adisyonReversal.ReverseAsync(tenantId, adisyon, cancellationToken));
                adisyon.CancelBySaleCancellation(_currentUser.UserId);
            }

            // Satışla birlikte karşılıksız kalan AKTİF randevular kapatılır (soft-delete → geri
            // almada canlanır). Başka bir paketten hâlâ karşılanan hizmetlere DOKUNULMAZ.
            var cancelledAppointmentIds = await CancelOrphanAppointmentsAsync(
                tenantId, account.CustomerId, id, sessions, cancellationToken);

            var snapshot = BuildSaleSnapshot(
                account, sessions, adisyonlar, originalStatuses, reversals, cancelledAppointmentIds);

            var archive = new CancelledSale(
                tenantId, branchId, account.Id, account.CustomerId, account.ServicePackageId, account.Name,
                account.TotalAmount, account.DepositAmount, collected, refunded,
                account.SoldAtUtc, account.SoldByStaffMemberId, account.IsHistorical,
                sessions.Sum(s => s.TotalSessions), sessions.Sum(s => s.UsedSessions),
                adisyonlar.FirstOrDefault()?.Id, request.Reason, snapshot);
            _db.CancelledSales.Add(archive);

            // TAHSİLAT DEFTERİ: cari silinince account_payments cascade ile gider. Geçmişte alınan
            // para raporlardan yok olmasın diye kalıcı kopyası arşive yazılır (bkz. ArchivedSalePayment).
            _db.ArchivedSalePayments.AddRange(BuildArchivedPayments(tenantId, archive, account));

            // İADE = gerçek para çıkışı. Kasa akışı/kâr-zarar/günlük kart bu kaydı görür.
            if (refunded > 0)
            {
                _db.RefundTransactions.Add(new RefundTransaction(
                    tenantId, branchId, archive.Id, account.CustomerId, refunded,
                    request.RefundMethod, reference: null, refundedAtUtc: null,
                    refundedByUserId: _currentUser.UserId, reason: request.Reason));
            }

            // 1. kayıt: arşiv + adisyon durumu + iade. Silme AYRI save'de yapılır ki adisyonun cari
            //    bağını koparan UPDATE, cari satırı silinmeden önce kesin uygulansın (FK sırası).
            await _db.SaveChangesAsync(cancellationToken);

            // 2. kayıt: canlı satırları GERÇEKTEN sil. Remove() normalde soft-delete'e çevrilir;
            //    taşıma tamamlandığı için hard-delete kapısı açılır. Taksit ve tahsilatlar cariye
            //    cascade bağlı olduğundan Remove(account) ile birlikte gider.
            _db.CustomerPackageSessions.RemoveRange(sessions);
            _db.CustomerAccounts.Remove(account);
            _db.HardDeleteEnabled = true;
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
            }
            finally
            {
                _db.HardDeleteEnabled = false;
            }

            // Silinen satırlar hâlâ ChangeTracker'da; temizlenmezse sonraki SaveChanges (audit log)
            // yok olan satıra UPDATE denemesi yapabilir.
            _db.ChangeTracker.Clear();

            await _audit.LogAsync(tenantId, branchId, "Cancel", "CustomerAccount", id,
                $"Satış iptal edildi ve arşive taşındı: {accountName} · tahsil {collected:N2} · iade {refunded:N2}",
                new { request.Reason, Collected = collected, Refunded = refunded, ArchiveId = archive.Id, AdisyonCount = adisyonlar.Count },
                cancellationToken);

            return Result<CustomerAccountDto>.Success(dto with
            {
                IsActive = false,
                SaleStatus = "Cancelled",
                CancelledAtUtc = archive.CancelledAtUtc,
                CancellationReason = archive.CancellationReason,
                RemainingAmount = 0m,
            });
        }, cancellationToken);
    }

    /// <summary>
    /// İptali geri alır: arşivdeki snapshot'tan cari + taksit + tahsilat + seans satırları AYNI
    /// Id'lerle yeniden kurulur (randevu/adisyon referansları tutsun diye) ve adisyonlar iptalden
    /// ÖNCEKİ statülerine döner.
    /// </summary>
    /// <param name="request">
    /// <c>VoidRefund</c> = iade fiilen yapılmamıştı (yanlış kayıt) → kasa çıkışı geri alınır.
    /// Varsayılan <c>false</c>: para gerçekten ödendiyse gider kaydı yerinde kalır.
    /// </param>
    public async Task<Result<CustomerAccountDto>> RestoreSaleAsync(Guid tenantId, Guid id, RestoreSaleRequest? request = null, CancellationToken cancellationToken = default)
        => await InTransactionAsync(async () =>
    {
        // id hem arşiv kaydının hem de silinen carinin Id'si olabilir (eski istemciler cari Id gönderir).
        // Eşzamanlı iki geri alma isteği arşivi aktif görüp aynı Id ile cariyi kurmaya çalışıyordu →
        // biri duplicate-key ile 500 alıyordu. Satır kilidi ikinciyi bekletir, sonra nazikçe reddeder.
        var archiveId = await LockArchiveForRestoreAsync(tenantId, id, cancellationToken);
        if (archiveId is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("İptal edilmiş satış bulunamadı."));

        _db.ChangeTracker.Clear();
        var archive = await _db.CancelledSales
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == archiveId.Value && x.RestoredAtUtc == null, cancellationToken);
        if (archive is null) return Result<CustomerAccountDto>.Failure(Error.Conflict("Bu iptal az önce geri alındı."));

        var snapshot = ParseSaleSnapshot(archive.Snapshot);
        if (snapshot is null) return Result<CustomerAccountDto>.Failure(Error.Conflict("İptal kaydının yedeği okunamadı; satış geri alınamıyor."));

        var accountId = archive.OriginalAccountId;
        var exists = await _db.CustomerAccounts.IgnoreQueryFilters()
            .AnyAsync(a => a.Id == accountId, cancellationToken);
        if (exists) return Result<CustomerAccountDto>.Failure(Error.Conflict("Bu satış zaten geri alınmış."));

        // ESKİ (v1) YEDEK KORUMASI. v1 kayıtları adisyonun özgün statüsünü ve iptalde FİİLEN
        // değiştirilen prim/sadakat/stok satırlarını taşımaz; otomatik geri alma o fişi koşulsuz
        // "onaylı" yapıp iptalle ilgisi olmayan pasif kayıtları da diriltebilir. Bu yüzden yönetici
        // açıkça onaylamadan yürütülmez.
        var isLegacySnapshot = snapshot.Adisyonlar is null or { Count: 0 } && snapshot.AdisyonIds.Count > 0;
        if (isLegacySnapshot && request?.AllowLegacySnapshot != true)
        {
            return Result<CustomerAccountDto>.Failure(Error.Conflict(
                "Bu iptal, adisyon durumunu ve yan etki dökümünü taşımayan ESKİ bir yedekle kaydedilmiş. " +
                "Geri alma, bağlı fişin durumunu ve prim/sadakat kayıtlarını yanlış kurabilir. " +
                "Devam etmek için adisyonu ve prim/sadakat kayıtlarını kontrol edip işlemi onaylayın."));
        }

        // Yan etkiler YENİDEN uygulanacak (stok düşer, kupon harcanır, seans tüketilir, prim/sadakat
        // canlanır). İptalle aynı kilit protokolü kullanılmazsa eşzamanlı bir satış/onay ile yarışta
        // kayıp güncelleme oluşur. Sıra RowLock.TableOrder ile aynıdır → deadlock olmaz.
        var restoreAdisyonIds = snapshot.AdisyonIds.ToList();
        // Guid listesiyle .Contains() MySQL'de çevrilemez; yedekteki adisyon sayısı küçük olduğu
        // için fiş başına ayrı sorgu yapılır. [[project_mysql_query_gotchas]]
        var restoreRefIds = new List<(AdisyonItemType Type, Guid RefId)>();
        foreach (var adisyonId in restoreAdisyonIds)
        {
            restoreRefIds.AddRange((await _db.AdisyonItems
                    .Where(i => i.RefId != null && i.AdisyonId == adisyonId)
                    .Select(i => new { i.Type, RefId = i.RefId!.Value })
                    .ToListAsync(cancellationToken))
                .Select(x => (x.Type, x.RefId)));
        }
        await LockSideEffectRowsAsync(
            archive.CustomerId, restoreAdisyonIds,
            restoreRefIds.Where(x => x.Type == AdisyonItemType.Product).Select(x => x.RefId),
            restoreRefIds.Where(x => x.Type == AdisyonItemType.Discount).Select(x => x.RefId),
            await _db.CustomerPackageSessions
                .Where(x => x.TenantId == tenantId && x.CustomerId == archive.CustomerId)
                .Select(x => x.Id).ToListAsync(cancellationToken),
            cancellationToken);

        var rebuilt = RebuildFromSnapshot(tenantId, accountId, snapshot);
        var nowUtc = DateTime.UtcNow;

        // Yedekte adisyon statüsü yoksa (v1 kayıtları) eski davranış: hepsi onaylı sayılır.
        var adisyonInfos = snapshot.Adisyonlar is { Count: > 0 }
            ? snapshot.Adisyonlar
            : snapshot.AdisyonIds
                .Select(x => new SaleSnapshotReader.SnapshotAdisyon(
                    x, nameof(AdisyonStatus.Approved), snapshot.Account.CreatedAtUtc))
                .ToList();

        foreach (var info in adisyonInfos)
        {
            var adisyon = await _db.Adisyonlar
                .Include(a => a.Items)
                .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == info.Id, cancellationToken);
            if (adisyon is null)
            {
                // ADİSYON SİLİNMİŞ. Eskiden sessizce atlanıyordu: cari, tahsilatlar ve paket
                // hakları geri geliyor, ama fiş yok olduğu için stok/prim/sadakat etkileri
                // yeniden UYGULANAMIYORDU — yine de "başarılı" dönülüyordu. Yarım geri alma,
                // hiç geri almamaktan kötüdür: sessizce devam etmek yerine reddet (bu akış
                // transaction içinde, dolayısıyla hiçbir şey yazılmaz).
                var missingStatus = Enum.TryParse<AdisyonStatus>(info.Status, out var ms) ? ms : AdisyonStatus.Approved;
                if (missingStatus != AdisyonStatus.Approved) continue; // onaylanmamış fişin yan etkisi yoktu
                return Result<CustomerAccountDto>.Failure(Error.Conflict(
                    "Bu satışın adisyonu silinmiş; iptal geri alınamıyor. Cari ve paket hakları geri gelse " +
                    "bile stok, prim ve sadakat etkileri fiş kalemleri olmadan yeniden uygulanamaz. " +
                    "Satışı yeniden oluşturmanız gerekir."));
            }

            var status = Enum.TryParse<AdisyonStatus>(info.Status, out var parsed) ? parsed : AdisyonStatus.Approved;
            adisyon.RestoreAfterSaleCancellation(accountId, status, Utc(info.ApprovedAtUtc), _currentUser.UserId);

            // Yan etkiler yalnız ONAYLI fişte oluşmuştu; yalnız onlar yeniden uygulanır. Döküm
            // (Reversals) sayesinde iptalde fiilen pasifleştirilen satırlar dışına taşılmaz.
            if (status != AdisyonStatus.Approved) continue;

            var reapplied = await _adisyonReversal.ReapplyAsync(
                tenantId, adisyon, snapshot.ReversalFor(info.Id), cancellationToken);

            // İptalle geri verilen paket hakkı, aradaki sürede BAŞKA bir işlemde kullanılmış olabilir.
            // Sessizce devam etmek satışı canlandırıp paket bakiyesini eksik bırakırdı → işlem geri alınır.
            if (reapplied.MissingSessions > 0)
            {
                return Result<CustomerAccountDto>.Failure(Error.Conflict(
                    $"Bu satışın kullandığı paket seansı ({reapplied.MissingSessions} adet) iptalden sonra " +
                    "başka bir işlemde harcanmış. Satış geri alınamıyor: önce ilgili paket kullanımını düzeltin."));
            }
        }

        // İptalde kapatılan randevular canlanır (yalnız o anda kapatılanlar — Id'ler yedekte).
        // ÇAKIŞMA KONTROLÜ: iptalden sonra boşalan saate başka randevu alınmış olabilir; körü körüne
        // Restore() aynı personele üst üste iki aktif randevu koyardı. Çakışanlar kapalı bırakılır
        // ve yöneticiye bildirilir (sessizce çakıştırmak da sessizce atlamak da yanlış olurdu).
        var skippedAppointments = 0;
        foreach (var appointmentId in snapshot.CancelledAppointmentIds ?? [])
        {
            var appointment = await _db.Appointments.IgnoreQueryFilters()
                .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId && a.IsDeleted, cancellationToken);
            if (appointment is null) continue;

            var clash = await _db.Appointments
                .AnyAsync(a => a.TenantId == tenantId
                               && a.StaffMemberId == appointment.StaffMemberId
                               && a.Id != appointment.Id
                               && a.Status != AppointmentStatus.Cancelled
                               && a.Status != AppointmentStatus.NoShow
                               && a.StartUtc < appointment.EndUtc
                               && appointment.StartUtc < a.EndUtc, cancellationToken);
            if (clash) { skippedAppointments++; continue; }

            appointment.Restore(nowUtc);
        }

        // Tahsilat defteri: canlı account_payments satırları aynı Id'lerle geri geldiği için arşiv
        // kopyaları pasifleştirilir — aynı para iki kez gelir sayılmasın.
        var archivedPayments = await _db.ArchivedSalePayments
            .Where(p => p.TenantId == tenantId && p.CancelledSaleId == archive.Id)
            .ToListAsync(cancellationToken);
        _db.ArchivedSalePayments.RemoveRange(archivedPayments);

        // İADE, GERÇEK BİR KASA ÇIKIŞIDIR — geri alma onu kendiliğinden görünmez YAPMAZ. Dünkü
        // ödeme bugünkü bir düzeltme yüzünden raporlardan silinemez. Yalnızca yönetici "iade fiilen
        // yapılmamıştı" derse (yanlış kayıt) hareket geri alınır.
        var refunds = await _db.RefundTransactions
            .Where(r => r.TenantId == tenantId && r.CancelledSaleId == archive.Id)
            .ToListAsync(cancellationToken);
        var voidRefunds = request?.VoidRefund == true;
        if (voidRefunds && refunds.Count > 0)
        {
            // GERÇEKLEŞMİŞ bir kasa çıkışını yok etmek ayrı bir yetkidir: normal cari/tahsilat izni
            // olan personel geçmiş bir para hareketini silememeli. Gerekçe de zorunludur (denetim izi).
            // Kurum sahibi ve platform yöneticisi dışındaki HER rol açık izin ister. Eskiden yalnız
            // Staff kontrol ediliyordu; şube yöneticisi ayrı izin olmadan gerçekleşmiş bir kasa
            // çıkışını silebiliyordu.
            var mayVoidRefund = _currentUser.IsPlatformAdmin
                || _currentUser.Role == UserRole.InstitutionOwner
                || _currentUser.HasPermission(GuzellikMerkezi.Domain.Permissions.AccountingVoidRefund);
            if (!mayVoidRefund)
            {
                return Result<CustomerAccountDto>.Failure(Error.Unauthorized(
                    "Yapılmış para iadesini geçersiz kılma yetkiniz yok. Yöneticinize başvurun."));
            }
            if (string.IsNullOrWhiteSpace(request?.VoidReason))
            {
                return Result<CustomerAccountDto>.Failure(Error.Validation(
                    "İadeyi geçersiz kılmak için gerekçe zorunludur (ör. 'iade fiilen yapılmamış, yanlış girilmiş')."));
            }
        }

        if (voidRefunds)
        {
            foreach (var refund in refunds) refund.SoftDelete(nowUtc, _currentUser.UserId);
        }
        else
        {
            // İade KORUNDU: para artık kurumda değil. Tahsilat satırları aynen geri geldiği için
            // cari "ödendi" görünür ve satış tekrar iptal edilirse AYNI para bir kez daha iade
            // edilebilirdi. Korunan tutar tahsilattan düşülür → borç yeniden doğar, ikinci iade
            // üst sınırı (tahsilat − korunmuş iade) doğru hesaplanır.
            rebuilt.Account.ApplyPreservedRefund(refunds.Sum(r => r.Amount));
        }

        archive.MarkRestored();
        await _db.SaveChangesAsync(cancellationToken);

        // ApplyAuditInfo, Added satırların CreatedAtUtc/CreatedBy alanlarını "şimdi"ye ve geri
        // yükleyen kullanıcıya çeker; ikisi de raporlarda kullanıldığı için orijinali geri yazılır.
        ApplyOriginalTimestamps(rebuilt, snapshot);
        await _db.SaveChangesAsync(cancellationToken);

        _db.ChangeTracker.Clear();
        var refundTotal = refunds.Sum(r => r.Amount);
        await _audit.LogAsync(tenantId, archive.BranchId, "Restore", "CustomerAccount", accountId,
            voidRefunds && refundTotal > 0
                ? $"Satış iptali geri alındı: {archive.Name} · {refundTotal:N2} iade kaydı da geri alındı"
                : refundTotal > 0
                    ? $"Satış iptali geri alındı: {archive.Name} · {refundTotal:N2} iade kasa çıkışı olarak KORUNDU"
                    : $"Satış iptali geri alındı: {archive.Name}",
            new
            {
                ArchiveId = archive.Id,
                RefundCount = refunds.Count,
                RefundTotal = refundTotal,
                RefundsVoided = voidRefunds,
                VoidReason = voidRefunds ? request?.VoidReason : null,
                LegacySnapshot = isLegacySnapshot,
                SkippedAppointments = skippedAppointments,
            },
            cancellationToken);

        var restored = await LoadAsync(tenantId, accountId, cancellationToken);
        if (restored is null) return Result<CustomerAccountDto>.Failure(Error.Conflict("Satış geri yüklendi ancak okunamadı."));
        var (revenue, count) = await GetAppointmentStatsAsync(tenantId, restored.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, restored, revenue, count, cancellationToken));
    }, cancellationToken);

    public async Task<Result<IReadOnlyCollection<CancelledSaleDto>>> ListCancelledAsync(
        Guid tenantId, Guid? customerId = null, Guid? servicePackageId = null, CancellationToken cancellationToken = default)
    {
        var query = _db.CancelledSales.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.RestoredAtUtc == null);
        if (customerId is { } cid && cid != Guid.Empty) query = query.Where(x => x.CustomerId == cid);
        if (servicePackageId is { } pid && pid != Guid.Empty) query = query.Where(x => x.ServicePackageId == pid);

        var rows = await query
            .OrderByDescending(x => x.CancelledAtUtc)
            .Select(x => new
            {
                x.Id, x.OriginalAccountId, x.TenantId, x.BranchId, x.CustomerId,
                CustomerName = x.Customer != null ? x.Customer.FullName : null,
                CustomerPhone = x.Customer != null ? x.Customer.Phone : null,
                x.ServicePackageId, x.Name, x.TotalAmount, x.DepositAmount, x.CollectedAmount, x.RefundedAmount,
                x.SoldAtUtc, x.SoldByStaffMemberId,
                SoldByStaffName = x.SoldByStaffMember != null ? x.SoldByStaffMember.FullName : null,
                x.IsHistorical, x.SessionsTotal, x.SessionsUsed, x.AdisyonId, x.CancelledAtUtc, x.CancellationReason,
            })
            .ToListAsync(cancellationToken);

        var result = rows.Select(x => new CancelledSaleDto(
            x.Id, x.OriginalAccountId, x.TenantId, x.BranchId, x.CustomerId,
            x.CustomerName,
            IsStaffViewer ? PhoneMask.Mask(x.CustomerPhone) : x.CustomerPhone,
            x.ServicePackageId, x.Name, x.TotalAmount, x.DepositAmount, x.CollectedAmount, x.RefundedAmount,
            Math.Max(0m, x.CollectedAmount - x.RefundedAmount),
            x.SoldAtUtc, x.SoldByStaffMemberId, x.SoldByStaffName, x.IsHistorical,
            x.SessionsTotal, x.SessionsUsed, x.AdisyonId, x.CancelledAtUtc, x.CancellationReason)).ToList();

        return Result<IReadOnlyCollection<CancelledSaleDto>>.Success(result);
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
        // Peşinat GERÇEK bir tahsilat satırına dönüşür: sadece kolonda kalırsa cari "tahsil edildi"
        // sayıyor ama kasa akışı/kâr-zarar/raporlar parayı hiç görmüyordu. DepositAmount kolonu
        // PLAN alanı olarak yerinde kalır (taksit matematiği değişmesin).
        account.RegisterDepositPayment("cash", account.SoldAtUtc);

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

        // İptal edilmiş satışın tutarı/taksiti değiştirilemez — önce iptal geri alınmalı.
        // İptalde kayıt arşive taşınıp silindiği için "bulunamadı" ile "iptal edilmiş" ayırt edilir.
        if (account is null || account.CancelledAtUtc is not null)
        {
            var wasCancelled = account?.CancelledAtUtc is not null || await IsArchivedAsync(tenantId, id, cancellationToken);
            return wasCancelled
                ? Result<CustomerAccountDto>.Failure(Error.Conflict("Bu satış iptal edilmiş; değişiklik yapılamaz. Gerekiyorsa önce iptali geri alın."))
                : Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));
        }

        // PEŞİNAT DEĞİŞTİRİLEMEZ. Peşinat açılışta gerçek bir tahsilat satırına dönüşür; kolonu
        // sonradan değiştirmek finans defterini SESSİZCE ayrıştırırdı (2.000 tahsilat dururken
        // kolon 5.000 olur, aradaki 3.000 hiçbir kasada görünmez). Para değiştiyse tahsilat/iade
        // hareketi girilmelidir — plan alanı elle oynanmaz.
        if (Math.Round(request.DepositAmount, 2) != Math.Round(account.DepositAmount, 2))
        {
            return Result<CustomerAccountDto>.Failure(Error.Validation(
                "Peşinat tutarı sonradan değiştirilemez: açılışta gerçek bir tahsilat olarak kaydedildi. " +
                "Ek para alındıysa tahsilat girin, geri ödendiyse satışı iptal edip iade kaydedin."));
        }

        var totalChanged = Math.Round(request.TotalAmount, 2) != Math.Round(account.TotalAmount, 2);

        account.Rename(request.Name);
        account.ChangeTotal(request.TotalAmount, request.DepositAmount);
        account.SetNotes(request.Notes);
        if (request.IsActive) account.Activate(); else account.Deactivate();

        // TOPLAM DEĞİŞTİYSE TAKSİT PLANI DA YENİDEN KURULUR.
        //
        // Yalnız TotalAmount güncelleniyordu; plan eski toplama göre kalıyordu. Taksit ve açık
        // alacak raporları plan toplamını kullandığı için aradaki fark HİÇBİR YERDE görünmüyordu
        // (canlıda 8.750 cari ↔ 8.500 plan = 250 TL kayıp alacak). Adisyon onayı bu senkronu zaten
        // yapıyor (bkz. AdisyonService 4. adım); elle güncelleme yolu ondan geri kalmamalı.
        // Yeniden bölmek parayı bozmaz: "ödenen" taksitte değil tahsilatlarda tutulur.
        if (totalChanged)
        {
            var activePlan = account.Installments.Where(i => i.Status != InstallmentStatus.Cancelled).ToList();
            if (activePlan.Count > 0)
                account.RebuildInstallments(activePlan.Count, activePlan.Min(i => i.DueDate));
        }

        await _db.SaveChangesAsync(cancellationToken);
        var (revenue, count) = await GetAppointmentStatsAsync(tenantId, account.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, account, revenue, count, cancellationToken));
    }

    public async Task<Result<CustomerAccountDto>> RescheduleAsync(Guid tenantId, Guid id, RescheduleAccountRequest request, CancellationToken cancellationToken = default)
    {
        // EF Core change tracker'ı bypass et — ExecuteUpdateAsync ile direkt SQL.
        // MySql.EntityFrameworkCore'un Add/Remove kombinasyonunda hatalı SQL üretip
        // DbUpdateConcurrencyException fırlatması bilinen bir bug.

        // TAKSİT SAYISI SINIRI. Negatif sayı için doğrulama yoktu: akış ÖNCE mevcut planın tamamını
        // siliyor, yeni taksitleri yalnız sayı > 0 iken oluşturuyordu → InstallmentCount = -1 planı
        // yok ediyor, yerine hiçbir şey koymuyor ve istek BAŞARILI dönüyordu (açık alacak taksit
        // raporundan kayboluyordu). 0 meşrudur: "planı kaldır, peşine çevir".
        if (request.InstallmentCount < 0)
            return Result<CustomerAccountDto>.Failure(Error.Validation("Taksit sayısı negatif olamaz."));
        if (request.InstallmentCount > 120)
            return Result<CustomerAccountDto>.Failure(Error.Validation("Taksit sayısı en fazla 120 olabilir."));

        var accountInfo = await _db.CustomerAccounts
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Id == id)
            .Select(x => new { x.TotalAmount, x.DepositAmount, x.CustomerId })
            .FirstOrDefaultAsync(cancellationToken);
        if (accountInfo is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));

        var nowUtc = DateTime.UtcNow;

        // TEK İŞLEM: eski plan silme (Step 1) ile yeni planı yazma (Step 2) ayrı ayrı commit
        // ediliyordu. İkinci adım patlarsa eski taksitler silinmiş, yenileri hiç oluşmamış
        // kalıyordu: finanse edilen tutarın plan görünürlüğü tamamen kayboluyordu.
        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        // PARENT KİLİDİ: iki eşzamanlı planlama isteği eski planı ikisi de silip İKİ SET taksit
        // oluşturabiliyordu (taksit no'su için benzersiz kısıt da yok). Cari satırı kilitlenince
        // aynı carinin planlamaları serileşir.
        if (_db.Database.IsRelational())
        {
            await RowLock.LockRowAsync(_db, "customers", accountInfo.CustomerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "customer_accounts", id, cancellationToken);
        }

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

        if (tx is not null) await tx.CommitAsync(cancellationToken);

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

        // İPTAL EDİLMİŞ SATIŞA TAHSİLAT GİRİLEMEZ. Arayüzdeki buton gizlemesi güvenlik sınırı
        // değildir (Ön Muhasebe "Tahsilat Al" yolu ve doğrudan API çağrısı bu kapıdan geçer).
        // Satış iptal edilince kayıt arşive taşınıp silindiği için hesap BULUNAMAZ; kullanıcıya
        // "yok" yerine gerçek sebebi söylemek için arşive bakılır. Yanlış iptalde önce geri alınmalı.
        if (accountInfo is null || accountInfo.CancelledAtUtc is not null)
        {
            var wasCancelled = accountInfo?.CancelledAtUtc is not null || await IsArchivedAsync(tenantId, id, cancellationToken);
            return wasCancelled
                ? Result<CustomerAccountDto>.Failure(Error.Conflict("Bu satış iptal edilmiş; tahsilat alınamaz. Gerekiyorsa önce iptali geri alın."))
                : Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));
        }

        // KAYNAK ADİSYON DOĞRULAMASI (derinlemesine savunma). HTTP ucu istemciden gelen değeri zaten
        // siler; burada da kurum sahipliği aranır ki iç çağrı da yanlış/başka kurumun fişini
        // bağlayamasın. Yanlış bağ, o fiş silindiğinde ALAKASIZ bir tahsilatı kasadan siler.
        if (request.SourceAdisyonId is Guid sourceAdisyonId)
        {
            var belongs = await _db.Adisyonlar.AsNoTracking()
                .AnyAsync(a => a.Id == sourceAdisyonId && a.TenantId == tenantId, cancellationToken);
            if (!belongs)
                return Result<CustomerAccountDto>.Failure(Error.Validation("Tahsilatın kaynak adisyonu bu kuruma ait değil."));
        }

        var occurredAt = request.OccurredAtUtc ?? DateTime.UtcNow;
        if (occurredAt.Kind != DateTimeKind.Utc) occurredAt = DateTime.SpecifyKind(occurredAt, DateTimeKind.Utc);

        // TAHSİLAT SINIRI SUNUCUDA. Eskiden yalnız "Amount > 0" bakılıyordu: iki kasa aynı 1.000 ₺
        // borç için aynı anda 1.000 ₺ girerse ikisi de kabul edilip 2.000 ₺ yazılıyordu (arayüzün
        // doğru davranması backend için koruma değildir). Cari satırı kilitlenir, kalan borç kilit
        // ALTINDA taze okunur ve üst sınır uygulanır.
        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (_db.Database.IsRelational())
        {
            await RowLock.LockRowAsync(_db, "customers", accountInfo.CustomerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "customer_accounts", id, cancellationToken);
        }

        // Sınır KİLİTTEN BAĞIMSIZ uygulanır (InMemory sağlayıcıda kilit yok ama kural aynı).
        var fresh = await LoadAsync(tenantId, id, cancellationToken);
        if (fresh is null) return Result<CustomerAccountDto>.Failure(Error.NotFound("Cari hesap bulunamadı."));
        if (fresh.CancelledAtUtc is not null)
            return Result<CustomerAccountDto>.Failure(Error.Conflict("Bu satış iptal edilmiş; tahsilat alınamaz. Gerekiyorsa önce iptali geri alın."));

        // Kuruş yuvarlaması için küçük tolerans. Fazla ödeme kredi bakiyeye SESSİZCE yazılmaz;
        // bilinçli kredi için çağıran AllowOverpayment'ı açıkça set etmelidir.
        var remaining = fresh.RemainingAmount;
        if (!request.AllowOverpayment && request.Amount > remaining + 0.005m)
        {
            return Result<CustomerAccountDto>.Failure(Error.Validation(
                $"Tahsilat tutarı kalan borcu aşamaz (kalan: {remaining:N2}). " +
                "Fazla ödemeyi kredi bakiyesi olarak kaydetmek istiyorsanız bunu açıkça onaylayın."));
        }

        // Tahsilatı kaydet (sadece INSERT). Taksit planına dokunulmaz — "ödenen/kalan",
        // okuma anında AllocatePayments ile tahsilatların vade sırasına dağıtılmasıyla hesaplanır.
        // Böylece eksik ödeme ilgili taksiti kısmen, fazla ödeme birden çok taksiti kapatır.
        var payment = new AccountPayment(id, request.Amount, request.Method, request.Reference, occurredAt, request.SourceAdisyonId);
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

        if (tx is not null) await tx.CommitAsync(cancellationToken);

        // Return hydrated
        var hydrated = await LoadAsync(tenantId, id, cancellationToken);
        var (revenue, completedCount) = await GetAppointmentStatsAsync(tenantId, accountInfo.CustomerId, cancellationToken);
        return Result<CustomerAccountDto>.Success(await PresentAsync(tenantId, hydrated!, revenue, completedCount, cancellationToken));
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
        // İptal edilen satışın seans satırları canlı tabloda YOKTUR — arşivdeki yedekten sayılır.
        var cancelledSummaries = await LoadCancelledSummariesAsync(tenantId, fromUtc, toUtc, cancellationToken);
        var cancelledSoldServiceCount = cancelledSummaries
            .SelectMany(c => c.Sessions)
            .Count(s => scopedServiceIds.Contains(s.ServiceId));

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
        //
        // PAKETSİZ HİZMET SATIŞI BU RAPORA GİRMEZ: tekil hizmet satışında da seans bakiyesi açılır
        // ama ServicePackageId = Guid.Empty olur (bkz. AdisyonService "2a-2" ve geçmiş satış).
        // Süzülmezse tek bir hizmet satışı "Toplam Paket"/"Aktif Paket" sayaçlarını artırıyordu.
        // Hizmet satışları ayrı blokta (GetServiceReportAsync) sayılır.
        var scopedSessions = sessionRows
            .Where(s => inScopeAccountIds.Contains(s.CustomerAccountId)
                        && s.ServicePackageId != Guid.Empty
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

        // İptaller yukarıdaki hesaplara girmez (satırları canlı tabloda yok); arşivden ayrı sayılır.
        // Paket örneği = (satış, paket) çifti — aynı paket 5 müşteride iptal edildiyse 5 sayılır.
        var cancelledSummaries = await LoadCancelledSummariesAsync(tenantId, fromUtc, toUtc, cancellationToken);
        var cancelledSoldPackageCount = cancelledSummaries
            .SelectMany(c => c.Sessions.Select(s => new { c.OriginalAccountId, s.PackageId }))
            // Paketsiz hizmet satışı (PackageId = Guid.Empty) paket sayacına girmez — canlı
            // taraftaki scopedSessions süzgeciyle aynı kural.
            .Where(x => x.PackageId != Guid.Empty)
            .Where(x => categoryPackageIds is null || categoryPackageIds.Contains(x.PackageId))
            .GroupBy(x => new { x.OriginalAccountId, x.PackageId })
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
            .Include(x => x.AppliedByStaffMember)
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
