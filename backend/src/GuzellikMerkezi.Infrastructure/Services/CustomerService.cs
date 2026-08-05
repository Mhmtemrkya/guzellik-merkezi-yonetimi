using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Background;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class CustomerService : ICustomerService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _currentUser;
    private readonly IFeatureService _features;
    private readonly ISearchIndexService _search;
    private readonly IDurableJobQueue _jobs;

    public CustomerService(GuzellikDbContext db, IUsageService usage, IAuditLogger audit, ICurrentUser currentUser, IFeatureService features, ISearchIndexService search, IDurableJobQueue jobs)
    {
        _db = db;
        _usage = usage;
        _audit = audit;
        _currentUser = currentUser;
        _features = features;
        _search = search;
        _jobs = jobs;
    }

    /// <summary>
    /// Ham SQL (toplu sayaç, FULLTEXT arama, satır zenginleştirme) yalnızca ilişkisel sağlayıcıda
    /// çalışır. Birim testleri InMemory sağlayıcı kullandığından bu yollar orada LINQ'e düşer.
    /// </summary>
    private bool IsRelational => _db.Database.IsRelational();

    // Personel rolü müşteri telefonunu yalnızca son 4 hane görür (müşteri çalmayı önleme).
    // Ham numara API'den hiç çıkmaz; kurum yöneticisi/şube yöneticisi tam görür.
    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

    private CustomerDto Mask(CustomerDto dto) =>
        IsStaffViewer ? dto with { Phone = MaskPhone(dto.Phone), Email = EmailMask.Mask(dto.Email) } : dto;

    private static string MaskPhone(string? phone) => PhoneMask.Mask(phone);

    // Mükerrer telefon karşılaştırması için rakam-normalize (import ve blind index ile aynı mantık):
    // yalnızca rakamlar, son 10 hane; baştaki 0'lar atılır.
    private static string DigitsOf(string? value) => SearchText.NormalizePhone(value);

    /// <summary>
    /// Sorguyu blind index ile aday kümesine daraltır. Henüz indekslenmemiş (SearchIndex NULL) kayıt
    /// varsa daraltma YAPILMAZ — backfill tamamlanana kadar arama yavaş ama DOĞRU çalışır. Sessizce
    /// eksik sonuç dönmek, yavaş dönmekten çok daha kötüdür.
    /// </summary>
    /// <summary>
    /// Aramada aday kümesini blind index üzerinden daraltır.
    ///
    /// ÖLÇEK: `LIKE '%anahtar%'` indeks kullanamaz — her arama tam tablo taraması olurdu (9 bin
    /// müşteride ~270 ms, 1 milyonda dakikalar). Blind index "|hash|hash|" biçiminde saklandığından
    /// FULLTEXT indeksi her hash'i ayrı kelime görür; MATCH ... AGAINST (BOOLEAN MODE) indeksten okur.
    /// FULLTEXT yoksa (migration uygulanmamış) eski LIKE yoluna düşülür — sonuç doğru, sadece yavaş.
    /// </summary>
    private async Task<IQueryable<Customer>> NarrowBySearchIndexAsync(IQueryable<Customer> query, string term, CancellationToken ct)
    {
        var keys = _search.BuildLookupKeys(term);
        if (keys.Count == 0) return query;
        if (await HasUnindexedAsync(query, ct)) return query;

        var tokens = keys.Select(k => k.Trim('|')).Where(k => k.Length > 0).ToArray();
        if (tokens.Length == 0) return query;
        var booleanTerms = string.Join(' ', tokens.Select(t => "+" + t));

        if (IsRelational)
        {
            try
            {
                // Aday kümesi FULLTEXT indeksinden gelir; şifreli alanlar EF materializasyonunda çözülür.
                // LIMIT: aynı ön-ekten binlerce kayıt varsa bile bellek sabit kalır.
                return _db.Customers
                    .FromSqlInterpolated($@"
SELECT * FROM customers
WHERE IsDeleted = 0
  AND MATCH(SearchIndex) AGAINST ({booleanTerms} IN BOOLEAN MODE)
LIMIT 2000")
                    .AsNoTracking();
            }
            catch (Exception)
            {
                // FULLTEXT indeksi yoksa aşağıdaki LIKE yoluna düşülür (doğru sonuç, yavaş).
            }
        }

        foreach (var k in keys)
        {
            var key = k; // closure capture — her Where kendi anahtarını görmeli
            query = query.Where(x => x.SearchIndex != null && x.SearchIndex.Contains(key));
        }
        return query;
    }

    /// <summary>Backfill henüz bitmemiş mi? İlk eşleşmede kısa devre yapar; backfill sonrası hep false.</summary>
    private static Task<bool> HasUnindexedAsync(IQueryable<Customer> query, CancellationToken ct) =>
        query.AnyAsync(x => x.SearchIndex == null, ct);

    /// <summary>
    /// Bu telefon numarası kurumda başka bir müşteride var mı? Blind index'in tam-telefon anahtarıyla
    /// aday çekilir, eşitlik çözülmüş numarada doğrulanır. İndekslenmemiş kayıt varsa (backfill sürüyor)
    /// eski tam-tarama davranışına düşer — mükerrer kaydın sızmasındansa yavaş olmak yeğdir.
    /// </summary>
    private async Task<bool> PhoneExistsAsync(Guid tenantId, string? phone, string digits, Guid? excludeId, CancellationToken ct)
    {
        var baseQuery = _db.Customers.AsNoTracking().Where(x => x.TenantId == tenantId);
        if (excludeId is not null) baseQuery = baseQuery.Where(x => x.Id != excludeId.Value);

        var key = _search.BuildPhoneKey(phone);
        var query = key is not null && !await HasUnindexedAsync(baseQuery, ct)
            ? baseQuery.Where(x => x.SearchIndex != null && x.SearchIndex.Contains(key))
            : baseQuery;

        var phones = await query.Select(x => x.Phone).ToListAsync(ct);
        return phones.Any(p => DigitsOf(p) == digits);
    }

    /// <summary>
    /// Aramanın kesin (bellekte) filtresi — blind index yalnızca aday üretir.
    /// </summary>
    /// <remarks>
    /// Kurallar blind index ile BİREBİR aynı olmalıdır, aksi halde indeks kaydı aday gösterir ve filtre eler:
    /// <list type="bullet">
    ///   <item>Ad/e-posta: aksan + büyük-küçük duyarsız ("seyma" → "Şeyma").</item>
    ///   <item>Telefon: iki taraf da rakam-normalize edilir. Aksi halde "+90 555 111 22 33" kaydı
    ///         "5551112233" aramasıyla BULUNAMAZ (boşluk/artı işareti yüzünden) — eski davranıştaki hata.</item>
    ///   <item>Telefon karşılaştırması yalnızca terimde harf YOKSA yapılır (indeksin telefon yolu da öyle).</item>
    /// </list>
    /// </remarks>
    private static bool MatchesSearch(string? fullName, string? phone, string? email, string term, string digits) =>
        SearchText.FoldedContains(fullName, term)
        || (digits.Length > 0 && !term.Any(char.IsLetter) && SearchText.NormalizePhone(phone).Contains(digits, StringComparison.Ordinal))
        || (!string.IsNullOrEmpty(email) && SearchText.FoldedContains(email, term));

    /// <summary>
    /// Müşteri listesi — SUNUCU TARAFI sayfalama + sekme filtresi + sıralama + satır zenginleştirme.
    ///
    /// Ölçek kuralı: istemci hiçbir zaman tüm müşteri/cari/randevu listesini çekmez. Borç, harcama,
    /// son ziyaret ve randevu sayısı yalnızca DÖNEN SAYFANIN satırları için ilişkili alt sorgularla
    /// hesaplanır; böylece 12 bin de 1 milyon müşteri de aynı sürede açılır (maliyet sayfa boyutuna bağlı).
    /// </summary>
    public async Task<Result<PagedResult<CustomerDto>>> ListAsync(Guid tenantId, CustomerListQuery query, CancellationToken cancellationToken = default)
    {
        var request = new PageRequest(query.Page, query.PageSize, query.Search);
        // Performans: base64 fotoğraf (LONGTEXT) liste sorgusuna DAHİL EDİLMEZ — payload'ı 10-100x küçültür.
        // Fotoğraf yalnızca tekil müşteri (GetAsync) çağrısında döner; liste grid'i baş harf avatarı gösterir.
        var entityQuery = ApplyListFilter(_db.Customers.AsNoTracking().Where(x => x.TenantId == tenantId), tenantId, query.Filter);

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            // ŞİFRELİ alanlarda (ad/telefon/e-posta) SQL `.Contains()` ciphertext'te arar → çalışmaz.
            // Çözüm: blind index (bkz. ISearchIndexService). SQL yalnızca ADAY kümesini daraltır;
            // kesin eşleşme aşağıda çözülmüş değerler üzerinde doğrulanır (prefix eşleşmesi yaklaşıktır).
            var search = request.Search.Trim();
            // Telefon karşılaştırması normalize edilmiş rakamlar üzerinden yapılır (bkz. MatchesSearch).
            var digits = SearchText.NormalizePhone(search);

            var candidateQuery = await NarrowBySearchIndexAsync(entityQuery, search, cancellationToken);
            var candidates = await candidateQuery
                .Select(x => new CustomerDto(x.Id, x.TenantId, x.BranchId, x.FullName, x.Phone, x.Email, x.BirthDate, x.Gender, x.KvkkConsent, x.Notes, null, x.IsBlacklisted, x.BlacklistReason, x.CreatedAtUtc, x.IsVip))
                .ToArrayAsync(cancellationToken);

            var filtered = candidates
                .Where(c => MatchesSearch(c.FullName, c.Phone, c.Email, search, digits))
                .OrderBy(c => c.FullName, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var pageItems = filtered.Skip(request.Skip).Take(request.SafePageSize).ToArray();
            // Arama sonucu da liste satırıyla aynı bilgileri göstersin (borç/son ziyaret).
            pageItems = await EnrichAsync(tenantId, pageItems, cancellationToken);
            if (IsStaffViewer) pageItems = pageItems.Select(Mask).ToArray();
            return Result<PagedResult<CustomerDto>>.Success(new PagedResult<CustomerDto>(pageItems, filtered.Length, request.SafePage, request.SafePageSize));
        }

        // Aramasız liste: sıralama ENTITY üzerinde (Select'ten ÖNCE) yapılır. Projekte edilmiş DTO üzerinde
        // OrderBy, EF Core tarafından çevrilemez ve 500 üretir; bu yüzden ORDER BY entity kolonuna/alt sorguya uygulanır.
        var total = await entityQuery.CountAsync(cancellationToken);
        var ordered = ApplyListSort(entityQuery, tenantId, query.Sort);
        var page = await ordered
            .Skip(request.Skip).Take(request.SafePageSize)
            .Select(x => new CustomerDto(x.Id, x.TenantId, x.BranchId, x.FullName, x.Phone, x.Email, x.BirthDate, x.Gender, x.KvkkConsent, x.Notes, null, x.IsBlacklisted, x.BlacklistReason, x.CreatedAtUtc, x.IsVip))
            .ToArrayAsync(cancellationToken);

        var items = await EnrichAsync(tenantId, page, cancellationToken);
        if (IsStaffViewer) items = items.Select(Mask).ToArray();
        return Result<PagedResult<CustomerDto>>.Success(new PagedResult<CustomerDto>(items, total, request.SafePage, request.SafePageSize));
    }

    /// <summary>Sekme filtresi — hepsi DB tarafında (istemci tüm listeyi süzmez).</summary>
    private IQueryable<Customer> ApplyListFilter(IQueryable<Customer> q, Guid tenantId, CustomerListFilter filter)
    {
        var since30 = DateTime.UtcNow.AddDays(-30);
        return filter switch
        {
            CustomerListFilter.Vip => q.Where(x => x.IsVip),
            CustomerListFilter.KvkkApproved => q.Where(x => x.KvkkConsent),
            CustomerListFilter.KvkkPending => q.Where(x => !x.KvkkConsent),
            CustomerListFilter.Blacklist => q.Where(x => x.IsBlacklisted),
            CustomerListFilter.Recent => q.Where(x => x.CreatedAtUtc >= since30),
            // İptal edilen satış borç doğurmaz — "Borçlu" sekmesine düşmemeli.
            CustomerListFilter.Debt => q.Where(x => _db.CustomerAccounts
                .Where(a => a.TenantId == tenantId && a.CustomerId == x.Id && a.CancelledAtUtc == null)
                .Any(a => a.TotalAmount + a.RefundedAmount - a.Payments.Sum(p => p.Amount) > 0)),
            _ => q,
        };
    }

    /// <summary>
    /// Sıralama. Ad ŞİFRELİ (AES-GCM, rastgele nonce) olduğundan alfabetik sıralama SQL'de mümkün değil;
    /// bu yüzden varsayılan "en yeni kayıt" ve diğer ölçütler tarih/tutar üzerinden yapılır.
    /// </summary>
    private IQueryable<Customer> ApplyListSort(IQueryable<Customer> q, Guid tenantId, CustomerListSort sort) => sort switch
    {
        CustomerListSort.Oldest => q.OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.Id),
        CustomerListSort.Debt => q
            .OrderByDescending(x => _db.CustomerAccounts
                .Where(a => a.TenantId == tenantId && a.CustomerId == x.Id && a.CancelledAtUtc == null)
                .Sum(a => (decimal?)(a.TotalAmount + a.RefundedAmount - a.Payments.Sum(p => p.Amount))) ?? 0m)
            .ThenByDescending(x => x.CreatedAtUtc),
        CustomerListSort.Spent => q
            .OrderByDescending(x => _db.CustomerAccounts
                .Where(a => a.TenantId == tenantId && a.CustomerId == x.Id)
                .Sum(a => (decimal?)(a.Payments.Sum(p => p.Amount) - a.RefundedAmount)) ?? 0m)
            .ThenByDescending(x => x.CreatedAtUtc),
        CustomerListSort.LastVisit => q
            .OrderByDescending(x => _db.Appointments
                .Where(a => a.TenantId == tenantId && a.CustomerId == x.Id)
                .Max(a => (DateTime?)a.StartUtc))
            .ThenByDescending(x => x.CreatedAtUtc),
        _ => q.OrderByDescending(x => x.CreatedAtUtc).ThenBy(x => x.Id),
    };

    /// <summary>
    /// Sayfadaki satırlara borç / harcama / son ziyaret / randevu sayısını ekler.
    /// Tek bir gruplu sorgu ile (sayfa kadar müşteri) — N+1 yok, tüm liste çekilmez.
    /// </summary>
    /// <summary>MySQL sürücüsü Guid kolonunu Guid ya da string döndürebilir — ikisini de kabul et.</summary>
    private static Guid ReadGuid(System.Data.Common.DbDataReader reader, int ordinal)
    {
        var value = reader.GetValue(ordinal);
        return value is Guid guid ? guid : Guid.Parse(Convert.ToString(value)!);
    }

    private async Task<CustomerDto[]> EnrichAsync(Guid tenantId, CustomerDto[] items, CancellationToken cancellationToken)
    {
        if (items.Length == 0 || !IsRelational) return items;
        var ids = items.Select(x => x.Id).ToArray();

        // MySQL sağlayıcısı Guid listesiyle .Contains()'i çeviremiyor (bkz. proje notu) →
        // sayfadaki id'ler için tek seferlik ham SQL IN listesi kurulur (değerler Guid, enjeksiyon riski yok).
        var inList = string.Join(",", ids.Select(id => $"'{id}'"));

        var money = new Dictionary<Guid, (decimal Debt, decimal Spent)>();
        var visits = new Dictionary<Guid, (DateTime? Last, int Count)>();

        await using (var command = _db.Database.GetDbConnection().CreateCommand())
        {
            command.CommandText = $@"
-- İPTAL EDİLEN SATIŞ BORÇ DOĞURMAZ: CancelledAtUtc doluysa kalan alacak 0 sayılır.
-- Tahsil edilen tutar (Spent) korunur — para gerçekten alınmıştır, yalnızca alacak düşer.
--
-- ARŞİVLENMİŞ TAHSİLAT + İADE DE SAYILIR: iptalde cari/tahsilat satırları canlı tablodan SİLİNİP
-- arşive taşınıyor, bu yüzden yalnız customer_accounts'a bakan hesap o parayı göremiyordu. Genel
-- rapor arşivi sayarken müşteri kartı 0 gösteriyordu (aynı gerçek, iki farklı rakam).
-- İade satırları YALNIZ arşivlenmiş (iptal) satışlara aittir → canlı a.RefundedAmount ile çakışmaz.
SELECT t.CustomerId, COALESCE(SUM(t.Debt), 0) AS Debt, COALESCE(SUM(t.Spent), 0) AS Spent
FROM (
  SELECT a.CustomerId AS CustomerId,
         SUM(CASE WHEN a.CancelledAtUtc IS NULL
                  THEN GREATEST(a.TotalAmount + a.RefundedAmount - COALESCE(p.Paid, 0), 0)
                  ELSE 0 END) AS Debt,
         SUM(COALESCE(p.Paid, 0) - a.RefundedAmount) AS Spent
  FROM customer_accounts a
  LEFT JOIN (SELECT CustomerAccountId, SUM(Amount) AS Paid FROM account_payments WHERE IsDeleted = 0 GROUP BY CustomerAccountId) p
         ON p.CustomerAccountId = a.Id
  WHERE a.IsDeleted = 0 AND a.TenantId = '{tenantId}' AND a.CustomerId IN ({inList})
  GROUP BY a.CustomerId
  UNION ALL
  SELECT ap.CustomerId, 0 AS Debt, SUM(ap.Amount) AS Spent
  FROM archived_sale_payments ap
  WHERE ap.IsDeleted = 0 AND ap.TenantId = '{tenantId}' AND ap.CustomerId IN ({inList})
  GROUP BY ap.CustomerId
  UNION ALL
  SELECT r.CustomerId, 0 AS Debt, -SUM(r.Amount) AS Spent
  FROM refund_transactions r
  WHERE r.IsDeleted = 0 AND r.TenantId = '{tenantId}' AND r.CustomerId IN ({inList})
  GROUP BY r.CustomerId
) t
GROUP BY t.CustomerId;";
            if (command.Connection!.State != System.Data.ConnectionState.Open)
                await command.Connection.OpenAsync(cancellationToken);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var id = ReadGuid(reader, 0);
                money[id] = (Convert.ToDecimal(reader.GetValue(1)), Convert.ToDecimal(reader.GetValue(2)));
            }
        }

        await using (var command = _db.Database.GetDbConnection().CreateCommand())
        {
            command.CommandText = $@"
SELECT CustomerId, MAX(StartUtc) AS LastVisit, COUNT(*) AS Cnt
FROM appointments
WHERE IsDeleted = 0 AND TenantId = '{tenantId}' AND CustomerId IN ({inList})
GROUP BY CustomerId;";
            if (command.Connection!.State != System.Data.ConnectionState.Open)
                await command.Connection.OpenAsync(cancellationToken);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var id = ReadGuid(reader, 0);
                var last = reader.IsDBNull(1) ? (DateTime?)null : DateTime.SpecifyKind(reader.GetDateTime(1), DateTimeKind.Utc);
                visits[id] = (last, Convert.ToInt32(reader.GetValue(2)));
            }
        }

        // Son işlem adı: hizmet adı ŞİFRELİ kolondur → ham SQL ile okunamaz (ciphertext döner).
        // Bu yüzden ham SQL yalnız son randevunun hizmet Id'sini verir; ad EF üzerinden çözülür.
        var lastServiceIds = new Dictionary<Guid, Guid>();
        var withVisit = visits.Where(v => v.Value.Last.HasValue).Select(v => v.Key).ToArray();
        if (withVisit.Length > 0)
        {
            var visitIn = string.Join(",", withVisit.Select(id => $"'{id}'"));
            await using var command = _db.Database.GetDbConnection().CreateCommand();
            command.CommandText = $@"
SELECT a.CustomerId, a.ServiceDefinitionId
FROM appointments a
JOIN (SELECT CustomerId, MAX(StartUtc) AS MaxStart FROM appointments
      WHERE IsDeleted = 0 AND TenantId = '{tenantId}' AND CustomerId IN ({visitIn})
      GROUP BY CustomerId) m
  ON m.CustomerId = a.CustomerId AND m.MaxStart = a.StartUtc
WHERE a.IsDeleted = 0 AND a.TenantId = '{tenantId}';";
            if (command.Connection!.State != System.Data.ConnectionState.Open)
                await command.Connection.OpenAsync(cancellationToken);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var customerId = ReadGuid(reader, 0);
                if (!reader.IsDBNull(1)) lastServiceIds[customerId] = ReadGuid(reader, 1);
            }
        }

        var lastServiceNames = new Dictionary<Guid, string>();
        if (lastServiceIds.Count > 0)
        {
            // Hizmet kataloğu küçük (yüzler mertebesi) — tek sorgu, EF şifre çözümüyle.
            var neededIds = lastServiceIds.Values.ToHashSet();
            var services = await _db.ServiceDefinitions.AsNoTracking()
                .Where(x => x.TenantId == tenantId)
                .Select(x => new { x.Id, x.Name })
                .ToListAsync(cancellationToken);
            var nameById = services.Where(x => neededIds.Contains(x.Id)).ToDictionary(x => x.Id, x => x.Name);
            foreach (var (customerId, serviceId) in lastServiceIds)
                if (nameById.TryGetValue(serviceId, out var name)) lastServiceNames[customerId] = name;
        }

        return items.Select(dto =>
        {
            var m = money.TryGetValue(dto.Id, out var mv) ? mv : (Debt: 0m, Spent: 0m);
            var v = visits.TryGetValue(dto.Id, out var vv) ? vv : (Last: (DateTime?)null, Count: 0);
            lastServiceNames.TryGetValue(dto.Id, out var lastService);
            return dto with
            {
                Debt = m.Debt,
                TotalSpent = m.Spent,
                LastVisitUtc = v.Last,
                AppointmentCount = v.Count,
                LastServiceName = lastService,
            };
        }).ToArray();
    }

    public async Task<Result<CustomerDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return customer is null ? Result<CustomerDto>.Failure(Error.NotFound("Müşteri bulunamadı.")) : Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    public async Task<Result<CustomerDialDto>> GetDialPhoneAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result<CustomerDialDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        var digits = PhoneMask.DigitsOnly(customer.Phone);
        if (digits.Length == 0) return Result<CustomerDialDto>.Failure(Error.Validation("Müşterinin kayıtlı telefon numarası yok."));

        // Ham numara personele maskesiz döndüğü için her erişim iz bırakır.
        await _audit.LogAsync(tenantId, customer.BranchId, "PhoneDial", "Customer", customer.Id,
            $"Müşteri arama başlatıldı: {customer.FullName}",
            new { customer.FullName, MaskedPhone = MaskPhone(customer.Phone) }, cancellationToken);

        return Result<CustomerDialDto>.Success(new CustomerDialDto(customer.Id, customer.FullName, digits));
    }

    public async Task<Result<CustomerStatsDto>> GetStatsAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var baseQuery = _db.Customers.AsNoTracking().Where(x => x.TenantId == tenantId);

        // Sayaçların TAMAMI tek tablo taramasıyla gelir (eskiden 6 ayrı COUNT vardı;
        // 1M müşteride her biri ayrı tam tarama demekti).
        var nowUtc = DateTime.UtcNow;
        var since90 = nowUtc.AddDays(-90);
        var monthStart = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var prevMonthStart = monthStart.AddMonths(-1);
        var thisMonth = nowUtc.Month;

        int total = 0, blacklisted = 0, kvkkPending = 0, vip = 0, birthdayThisMonth = 0;
        int newLast90 = 0, newThisMonth = 0, newPrevMonth = 0;
        var ageBuckets = new Dictionary<string, int>();

        if (!IsRelational)
        {
            // InMemory (testler): sayaçlar LINQ ile — ölçek kaygısı yok.
            var rows = await baseQuery.Select(x => new { x.IsBlacklisted, x.KvkkConsent, x.IsVip, x.BirthDate, x.CreatedAtUtc }).ToListAsync(cancellationToken);
            total = rows.Count;
            blacklisted = rows.Count(x => x.IsBlacklisted);
            kvkkPending = rows.Count(x => !x.KvkkConsent);
            vip = rows.Count(x => x.IsVip);
            birthdayThisMonth = rows.Count(x => x.BirthDate.HasValue && x.BirthDate.Value.Month == thisMonth);
            newLast90 = rows.Count(x => x.CreatedAtUtc >= since90);
            newThisMonth = rows.Count(x => x.CreatedAtUtc >= monthStart);
            newPrevMonth = rows.Count(x => x.CreatedAtUtc >= prevMonthStart && x.CreatedAtUtc < monthStart);
            var newByDayMemory = rows
                .GroupBy(x => x.CreatedAtUtc.AddHours(3).Date)
                .Select(g => new CustomerDailyCountDto(g.Key.ToString("yyyy-MM-dd"), g.Count()))
                .OrderBy(x => x.Date)
                .ToArray();
            return Result<CustomerStatsDto>.Success(new CustomerStatsDto(
                total, birthdayThisMonth, kvkkPending, blacklisted, newByDayMemory,
                vip, newLast90, newThisMonth, newPrevMonth, 0m, 0, 0m, null, 0, 0, 0));
        }

        await using (var command = _db.Database.GetDbConnection().CreateCommand())
        {
            command.CommandText = $@"
SELECT COUNT(*) AS Total,
       COALESCE(SUM(IsBlacklisted = 1), 0) AS Blacklisted,
       COALESCE(SUM(KvkkConsent = 0), 0) AS KvkkPending,
       COALESCE(SUM(IsVip = 1), 0) AS Vip,
       COALESCE(SUM(BirthDate IS NOT NULL AND MONTH(BirthDate) = {thisMonth}), 0) AS BirthdayThisMonth,
       COALESCE(SUM(CreatedAtUtc >= '{since90:yyyy-MM-dd HH:mm:ss}'), 0) AS NewLast90,
       COALESCE(SUM(CreatedAtUtc >= '{monthStart:yyyy-MM-dd HH:mm:ss}'), 0) AS NewThisMonth,
       COALESCE(SUM(CreatedAtUtc >= '{prevMonthStart:yyyy-MM-dd HH:mm:ss}' AND CreatedAtUtc < '{monthStart:yyyy-MM-dd HH:mm:ss}'), 0) AS NewPrevMonth
FROM customers
WHERE IsDeleted = 0 AND TenantId = '{tenantId}';";
            if (command.Connection!.State != System.Data.ConnectionState.Open)
                await command.Connection.OpenAsync(cancellationToken);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                total = Convert.ToInt32(reader.GetValue(0));
                blacklisted = Convert.ToInt32(reader.GetValue(1));
                kvkkPending = Convert.ToInt32(reader.GetValue(2));
                vip = Convert.ToInt32(reader.GetValue(3));
                birthdayThisMonth = Convert.ToInt32(reader.GetValue(4));
                newLast90 = Convert.ToInt32(reader.GetValue(5));
                newThisMonth = Convert.ToInt32(reader.GetValue(6));
                newPrevMonth = Convert.ToInt32(reader.GetValue(7));
            }
        }

        // Yaş segmenti: gruplama veritabanında (müşteri satırları belleğe alınmaz).
        // Kovalar GERÇEK doğum tarihinden TIMESTAMPDIFF ile hesaplanır — sabit/örnek veri yoktur.
        // ÖNEMLİ: eskiden 25 yaş altındaki HERKES (çocuklar dahil) "18–24 Yaş" etiketini alıyordu;
        // 18 altı ayrı kovaya alındı ve yaşlı müşteriler için 55–64 / 65+ ayrımı eklendi
        // (önceden 55 üstü tek kovada toplanıyordu).
        await using (var command = _db.Database.GetDbConnection().CreateCommand())
        {
            command.CommandText = $@"
SELECT CASE
         WHEN age < 18 THEN '18 Yaş Altı'
         WHEN age < 25 THEN '18–24 Yaş'
         WHEN age < 35 THEN '25–34 Yaş'
         WHEN age < 45 THEN '35–44 Yaş'
         WHEN age < 55 THEN '45–54 Yaş'
         WHEN age < 65 THEN '55–64 Yaş'
         ELSE '65+ Yaş' END AS Segment,
       COUNT(*) AS Cnt
FROM (SELECT TIMESTAMPDIFF(YEAR, BirthDate, CURDATE()) AS age
      FROM customers
      WHERE IsDeleted = 0 AND TenantId = '{tenantId}' AND BirthDate IS NOT NULL) t
WHERE age >= 0 AND age < 120
GROUP BY Segment;";
            if (command.Connection!.State != System.Data.ConnectionState.Open)
                await command.Connection.OpenAsync(cancellationToken);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                ageBuckets[reader.GetString(0)] = Convert.ToInt32(reader.GetValue(1));
        }

        // Gün bazında yeni müşteri sayıları. Paneller yerel (TR, UTC+3) güne göre sayar; UTC gününe
        // göre gruplarsak 21:00 sonrası kayıtlar ertesi güne düşer ve "bugün/bu hafta" sayaçları tutmaz.
        // ÖLÇEK: yalnız son 400 gün taranır (yıllık görünümü fazlasıyla kapsar) — (TenantId, CreatedAtUtc)
        // indeksiyle aralık taraması olur; tüm geçmişi taramak 1M müşteride gereksiz maliyetti.
        var trendSince = nowUtc.AddDays(-400);
        var newByDay = await baseQuery
            .Where(x => x.CreatedAtUtc >= trendSince)
            .GroupBy(x => x.CreatedAtUtc.AddHours(3).Date)
            .Select(g => new { Date = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        // Borç / harcama: TEK satır dönen toplu sorgu. (Eskiden müşteri başına satır belleğe alınıyordu;
        // 1M müşteride bu yüz binlerce satır demekti — sayaçlar artık veritabanında toplanıyor.)
        decimal totalDebt = 0m; var debtorCount = 0; decimal avgSpent = 0m; var spenderCount = 0;
        await using (var command = _db.Database.GetDbConnection().CreateCommand())
        {
            command.CommandText = $@"
-- ORTALAMA YALNIZ HARCAYAN MÜŞTERİLER ÜZERİNDEN (bkz. GetSpendingStatsAsync'teki aynı ifade).
-- NULLIF(t.Spent, 0) yalnız TAM SIFIRI eliyor, NEGATİFİ paydaya katıyordu: iadesi tahsilatını
-- aşan müşteri (Spent < 0) ortalamayı aşağı çekiyordu. A 100 TL, B −50 TL ise kart 25 TL
-- gösteriyordu — oysa harcayan sayısı 1 ve toplam 100 TL, dolayısıyla ortalama 100 TL olmalı.
SELECT COALESCE(SUM(GREATEST(t.Debt, 0)), 0) AS TotalDebt,
       COALESCE(SUM(CASE WHEN t.Debt > 0 THEN 1 ELSE 0 END), 0) AS Debtors,
       COALESCE(AVG(CASE WHEN t.Spent > 0 THEN t.Spent END), 0) AS AvgSpent,
       COALESCE(SUM(CASE WHEN t.Spent > 0 THEN 1 ELSE 0 END), 0) AS Spenders
FROM (
  -- Müşteri başına tek satır: canlı cariler + arşivlenmiş (iptal) tahsilatlar − iadeler.
  -- Arşiv dahil edilmezse iptal edilmiş satışın gerçekten alınmış parası hiçbir müşteri
  -- istatistiğinde görünmüyor, genel rapor ise onu sayıyordu (bkz. EnrichAsync).
  SELECT u.CustomerId, SUM(u.Debt) AS Debt, SUM(u.Spent) AS Spent
  FROM (
    -- İptal edilen satış borç doğurmaz (bkz. LoadDebtSpent); tahsil edilen tutar korunur.
    SELECT a.CustomerId AS CustomerId,
           SUM(CASE WHEN a.CancelledAtUtc IS NULL
                    THEN a.TotalAmount + a.RefundedAmount - COALESCE(p.Paid, 0)
                    ELSE 0 END) AS Debt,
           SUM(COALESCE(p.Paid, 0) - a.RefundedAmount) AS Spent
    FROM customer_accounts a
    LEFT JOIN (SELECT CustomerAccountId, SUM(Amount) AS Paid FROM account_payments WHERE IsDeleted = 0 GROUP BY CustomerAccountId) p
           ON p.CustomerAccountId = a.Id
    WHERE a.IsDeleted = 0 AND a.TenantId = '{tenantId}'
    GROUP BY a.CustomerId
    UNION ALL
    SELECT ap.CustomerId, 0 AS Debt, SUM(ap.Amount) AS Spent
    FROM archived_sale_payments ap
    WHERE ap.IsDeleted = 0 AND ap.TenantId = '{tenantId}'
    GROUP BY ap.CustomerId
    UNION ALL
    SELECT r.CustomerId, 0 AS Debt, -SUM(r.Amount) AS Spent
    FROM refund_transactions r
    WHERE r.IsDeleted = 0 AND r.TenantId = '{tenantId}'
    GROUP BY r.CustomerId
  ) u
  GROUP BY u.CustomerId
) t;";
            if (command.Connection!.State != System.Data.ConnectionState.Open)
                await command.Connection.OpenAsync(cancellationToken);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                totalDebt = Convert.ToDecimal(reader.GetValue(0));
                debtorCount = Convert.ToInt32(reader.GetValue(1));
                avgSpent = Math.Round(Convert.ToDecimal(reader.GetValue(2)), 2);
                spenderCount = Convert.ToInt32(reader.GetValue(3));
            }
        }

        var segmentTotal = ageBuckets.Values.Sum();
        var topSegment = ageBuckets.OrderByDescending(x => x.Value).Select(x => (Segment: x.Key, Count: x.Value)).FirstOrDefault();

        return Result<CustomerStatsDto>.Success(new CustomerStatsDto(
            total,
            birthdayThisMonth,
            kvkkPending,
            blacklisted,
            newByDay
                .OrderBy(x => x.Date)
                .Select(x => new CustomerDailyCountDto(x.Date.ToString("yyyy-MM-dd"), x.Count))
                .ToArray(),
            vip,
            newLast90,
            newThisMonth,
            newPrevMonth,
            totalDebt,
            debtorCount,
            avgSpent,
            topSegment.Segment,
            segmentTotal > 0 && topSegment.Segment is not null ? (int)Math.Round(topSegment.Count * 100.0 / segmentTotal) : 0,
            spenderCount,
            segmentTotal));
    }

    /// <summary>Dönem seçiminin üst sınırı (gün). Değer ham SQL'e enterpole edildiği için sınırlıdır.</summary>
    private const int MaxSpendingWindowDays = 3650;

    public async Task<Result<CustomerSpendingStatsDto>> GetSpendingStatsAsync(Guid tenantId, int? days, CancellationToken cancellationToken = default)
    {
        // 0 / negatif / null = "tüm zamanlar". Pencere varsa ölçüt TAHSİLAT tarihidir: dönemde
        // fiilen kasaya giren para sayılır (satış tarihi değil — geçmiş satışın bu ay yapılan
        // taksit ödemesi de bu aya düşer).
        var window = days is > 0 ? Math.Min(days.Value, MaxSpendingWindowDays) : (int?)null;
        var since = window.HasValue ? DateTime.UtcNow.AddDays(-window.Value) : (DateTime?)null;

        decimal avgSpent = 0m, totalSpent = 0m;
        var spenderCount = 0;

        if (!IsRelational)
        {
            // InMemory (testler): aynı hesap LINQ ile — ölçek kaygısı yok.
            var accounts = await _db.CustomerAccounts.AsNoTracking()
                .Where(x => x.TenantId == tenantId)
                .Select(x => new { x.Id, x.CustomerId, x.RefundedAmount })
                .ToListAsync(cancellationToken);
            var payments = await _db.AccountPayments.AsNoTracking()
                .Select(x => new { x.CustomerAccountId, x.Amount, x.OccurredAtUtc })
                .ToListAsync(cancellationToken);
            var spentPerCustomer = accounts
                .GroupBy(a => a.CustomerId)
                .Select(g => g.Sum(a =>
                    payments
                        .Where(p => p.CustomerAccountId == a.Id && (since is null || p.OccurredAtUtc >= since))
                        .Sum(p => p.Amount)
                    // Korunmuş iadenin tarihi yoktur; yalnız tüm-zamanlar hesabından düşülür.
                    - (since is null ? a.RefundedAmount : 0m)))
                .Where(x => x > 0)
                .ToList();
            spenderCount = spentPerCustomer.Count;
            totalSpent = spentPerCustomer.Sum();
            avgSpent = spenderCount > 0 ? Math.Round(totalSpent / spenderCount, 2) : 0m;
            return Result<CustomerSpendingStatsDto>.Success(
                new CustomerSpendingStatsDto(window, avgSpent, spenderCount, totalSpent));
        }

        // Tüm zamanlar hesabı /stats ile BİREBİR aynı ifadeyi kullanır (kart dönem değiştirip
        // "Tüm zamanlar"a döndüğünde değer oynamasın).
        var refundTerm = since is null ? " - a.RefundedAmount" : string.Empty;
        var paymentFilter = since is null ? string.Empty : $" AND OccurredAtUtc >= '{since:yyyy-MM-dd HH:mm:ss}'";
        // Arşiv/iade satırlarının GERÇEK tarihi vardır → pencere onlara da uygulanır (canlı
        // carideki korunmuş iadenin tarihi yoktur, o yüzden orada yalnız tüm-zamanlarda düşülür).
        var archivedFilter = since is null ? string.Empty : $" AND ap.OccurredAtUtc >= '{since:yyyy-MM-dd HH:mm:ss}'";
        var refundFilter = since is null ? string.Empty : $" AND r.RefundedAtUtc >= '{since:yyyy-MM-dd HH:mm:ss}'";

        await using var command = _db.Database.GetDbConnection().CreateCommand();
        command.CommandText = $@"
-- ÜÇ SAYAÇ AYNI KÜMEYE BAKAR (harcaması pozitif müşteriler): ortalama = toplam ÷ harcayan.
-- NULLIF(t.Spent, 0) negatifi paydaya katıyor, toplam ve sayaç ise (GREATEST/CASE) katmıyordu:
-- iadesi tahsilatını aşan tek bir müşteri kartı kendi içinde tutarsız hâle getiriyordu.
-- InMemory yolu zaten pozitifleri süzüyordu (Where x > 0) — iki yol artık aynı sonucu verir.
SELECT COALESCE(AVG(CASE WHEN t.Spent > 0 THEN t.Spent END), 0) AS AvgSpent,
       COALESCE(SUM(CASE WHEN t.Spent > 0 THEN 1 ELSE 0 END), 0) AS Spenders,
       COALESCE(SUM(GREATEST(t.Spent, 0)), 0) AS TotalSpent
FROM (
  SELECT u.CustomerId, SUM(u.Spent) AS Spent
  FROM (
    SELECT a.CustomerId AS CustomerId,
           SUM(COALESCE(p.Paid, 0){refundTerm}) AS Spent
    FROM customer_accounts a
    LEFT JOIN (SELECT CustomerAccountId, SUM(Amount) AS Paid
               FROM account_payments
               WHERE IsDeleted = 0{paymentFilter}
               GROUP BY CustomerAccountId) p
           ON p.CustomerAccountId = a.Id
    WHERE a.IsDeleted = 0 AND a.TenantId = '{tenantId}'
    GROUP BY a.CustomerId
    UNION ALL
    -- İptal edilen satışın arşivlenmiş tahsilatı (canlı satır silinmiştir).
    SELECT ap.CustomerId, SUM(ap.Amount) AS Spent
    FROM archived_sale_payments ap
    WHERE ap.IsDeleted = 0 AND ap.TenantId = '{tenantId}'{archivedFilter}
    GROUP BY ap.CustomerId
    UNION ALL
    SELECT r.CustomerId, -SUM(r.Amount) AS Spent
    FROM refund_transactions r
    WHERE r.IsDeleted = 0 AND r.TenantId = '{tenantId}'{refundFilter}
    GROUP BY r.CustomerId
  ) u
  GROUP BY u.CustomerId
) t;";
        if (command.Connection!.State != System.Data.ConnectionState.Open)
            await command.Connection.OpenAsync(cancellationToken);
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                avgSpent = Math.Round(Convert.ToDecimal(reader.GetValue(0)), 2);
                spenderCount = Convert.ToInt32(reader.GetValue(1));
                totalSpent = Math.Round(Convert.ToDecimal(reader.GetValue(2)), 2);
            }
        }

        return Result<CustomerSpendingStatsDto>.Success(
            new CustomerSpendingStatsDto(window, avgSpent, spenderCount, totalSpent));
    }

    public async Task<Result<CustomerDto>> CreateAsync(Guid tenantId, UpsertCustomerRequest request, CancellationToken cancellationToken = default)
    {
        var limit = await _usage.CheckLimitAsync(tenantId, "customers", cancellationToken);
        if (limit.IsFailure) return Result<CustomerDto>.Failure(limit.Error);

        if (!await _db.Branches.AnyAsync(x => x.TenantId == tenantId && x.Id == request.BranchId, cancellationToken))
        {
            return Result<CustomerDto>.Failure(Error.NotFound("Şube bulunamadı."));
        }

        // Mükerrer telefon engeli: telefon şifreli saklandığından (AES-GCM rastgele nonce) DB'de
        // UNIQUE index kurulamaz; blind index ile aday bulunur, eşitlik rakam-normalize karşılaştırmayla doğrulanır.
        var newDigits = DigitsOf(request.Phone);
        if (newDigits.Length >= 7 && await PhoneExistsAsync(tenantId, request.Phone, newDigits, null, cancellationToken))
        {
            return Result<CustomerDto>.Failure(Error.Conflict("Bu telefon numarasıyla kayıtlı bir müşteri zaten var."));
        }

        // Ad yazımı tek standarda çekilir: Ad SOYAD (bkz. PersonNameFormatter).
        var customer = new Customer(tenantId, request.BranchId, PersonNameFormatter.Format(request.FullName), request.Phone, request.Email);
        customer.UpdateProfile(request.BirthDate, request.Gender, request.KvkkConsent, request.Notes);
        customer.SetPhoto(request.PhotoUrl);

        _db.Customers.Add(customer);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, "Create", "Customer", customer.Id,
            $"Müşteri oluşturuldu: {customer.FullName}",
            new { customer.FullName, customer.Phone, customer.Email }, cancellationToken);

        // KVKK açık rızası kayıt sırasında işaretlenmediyse müşteriye WhatsApp'tan onay isteği gider;
        // "ONAYLIYORUM" yanıtı webhook'ta otomatik işlenir (bkz. WhatsAppService → kvkk-consent).
        // Yalnızca TEK müşteri ekleme yolunda çalışır — Excel içeri aktarma Customer'ı doğrudan
        // oluşturduğu için binlerce mesaj atılmaz.
        if (!customer.KvkkConsent && !string.IsNullOrWhiteSpace(customer.Phone))
        {
            await _jobs.EnqueueAsync(DurableJobTypes.KvkkConsent,
                new KvkkConsentJob(tenantId, customer.Id), cancellationToken);
        }

        return Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    /// <summary>
    /// Seçili müşterilere KVKK açık rıza mesajı kuyruklar. Zaten onaylı ya da telefonsuz kayıtlar
    /// atlanır; sonuç kaç mesajın kuyruğa girdiğini raporlar.
    /// </summary>
    public async Task<Result<KvkkRequestResultDto>> SendKvkkRequestAsync(Guid tenantId, SendKvkkRequestRequest request, CancellationToken cancellationToken = default)
    {
        var ids = (request.CustomerIds ?? Array.Empty<Guid>()).Distinct().ToList();
        if (ids.Count == 0) return Result<KvkkRequestResultDto>.Failure(Error.Validation("Müşteri seçilmedi."));
        if (ids.Count > 500) return Result<KvkkRequestResultDto>.Failure(Error.Validation("Tek seferde en fazla 500 müşteriye gönderilebilir."));

        // MySql sağlayıcısı Guid listesi .Contains()'i sunucuda çeviremez → bellekte süz.
        var all = await _db.Customers.AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .Select(c => new { c.Id, c.KvkkConsent, c.Phone })
            .ToListAsync(cancellationToken);
        var wanted = ids.ToHashSet();
        var rows = all.Where(c => wanted.Contains(c.Id)).ToList();

        int queued = 0, approved = 0, noPhone = 0;
        foreach (var row in rows)
        {
            if (row.KvkkConsent) { approved++; continue; }
            if (string.IsNullOrWhiteSpace(row.Phone)) { noPhone++; continue; }
            await _jobs.EnqueueAsync(DurableJobTypes.KvkkConsent, new KvkkConsentJob(tenantId, row.Id), cancellationToken);
            queued++;
        }

        if (queued > 0)
        {
            await _audit.LogAsync(tenantId, null, "KvkkRequest", "Customer", null,
                $"{queued} müşteriye KVKK onay mesajı gönderildi.", new { queued, approved, noPhone }, cancellationToken);
        }

        return Result<KvkkRequestResultDto>.Success(new KvkkRequestResultDto(queued, approved, noPhone));
    }

    public async Task<Result<CustomerDto>> UpdateAsync(Guid tenantId, Guid id, UpsertCustomerRequest request, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result<CustomerDto>.Failure(Error.NotFound("Müşteri bulunamadı."));

        customer.AssignBranch(request.BranchId);
        // Personelin gördüğü maskeli numara (•••…son4) güncelleme isteğinde geri gelirse mevcut
        // gerçek numara korunur — maskeli değer asla kalıcılaştırılmaz. Personel tam yeni bir numara
        // yazarsa (maske yok) normal güncellenir.
        var phone = PhoneMask.IsMasked(request.Phone) ? customer.Phone : request.Phone;
        var email = EmailMask.IsMasked(request.Email) ? customer.Email : request.Email;

        // Telefon değişiyorsa başka bir müşteride kullanılmadığını doğrula (kendisi hariç).
        var updatedDigits = DigitsOf(phone);
        if (updatedDigits.Length >= 7 && updatedDigits != DigitsOf(customer.Phone)
            && await PhoneExistsAsync(tenantId, phone, updatedDigits, id, cancellationToken))
        {
            return Result<CustomerDto>.Failure(Error.Conflict("Bu telefon numarasıyla kayıtlı başka bir müşteri var."));
        }

        customer.UpdateContact(PersonNameFormatter.Format(request.FullName), phone, email);
        customer.UpdateProfile(request.BirthDate, request.Gender, request.KvkkConsent, request.Notes);
        if (request.PhotoUrl is not null) customer.SetPhoto(request.PhotoUrl);

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, "Update", "Customer", customer.Id,
            $"Müşteri güncellendi: {customer.FullName}",
            new { customer.FullName, customer.Phone, customer.Email }, cancellationToken);
        return Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result.Failure(Error.NotFound("Müşteri bulunamadı."));
        var snapshot = new { customer.FullName, customer.Phone };
        customer.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, "Delete", "Customer", customer.Id,
            $"Müşteri silindi: {customer.FullName}", snapshot, cancellationToken);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyCollection<Guid>>> GetCustomerIdsWithApprovedSalesAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        // Paket satışı onaylandığında müşteriye seans bakiyesi tanımlanır.
        var packageCustomers = _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => s.CustomerId);

        // Hizmet/ürün satışı: onaylanmış adisyonda satış kalemi (Service/Product/Extra) olan müşteriler.
        var saleCustomers =
            from a in _db.Adisyonlar.AsNoTracking()
            join i in _db.AdisyonItems.AsNoTracking() on a.Id equals i.AdisyonId
            where a.TenantId == tenantId
                && a.Status == AdisyonStatus.Approved
                && (i.Type == AdisyonItemType.Service || i.Type == AdisyonItemType.Product || i.Type == AdisyonItemType.Extra)
            select a.CustomerId;

        var ids = await packageCustomers.Union(saleCustomers).Distinct().ToArrayAsync(cancellationToken);
        var blacklisted = await GetBlacklistedIdsAsync(tenantId, cancellationToken);
        return Result<IReadOnlyCollection<Guid>>.Success(ids.Where(id => !blacklisted.Contains(id)).ToArray());
    }

    public async Task<Result<IReadOnlyCollection<Guid>>> GetCustomerIdsWithBookableSessionsAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        // Yalnızca kalan seansı (TotalSessions - UsedSessions > 0) olan müşteriler — yeni randevu modalı için.
        var ids = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId && (s.TotalSessions - s.UsedSessions) > 0)
            .Select(s => s.CustomerId)
            .Distinct()
            .ToArrayAsync(cancellationToken);
        // Kara listedeki müşteriler randevu modalında görünmez.
        var blacklisted = await GetBlacklistedIdsAsync(tenantId, cancellationToken);
        return Result<IReadOnlyCollection<Guid>>.Success(ids.Where(id => !blacklisted.Contains(id)).ToArray());
    }

    private async Task<HashSet<Guid>> GetBlacklistedIdsAsync(Guid tenantId, CancellationToken ct)
    {
        var ids = await _db.Customers.AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.IsBlacklisted)
            .Select(c => c.Id)
            .ToListAsync(ct);
        return ids.ToHashSet();
    }

    public async Task<Result<CustomerDto>> SetBlacklistAsync(Guid tenantId, Guid id, SetBlacklistRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.CustomersBlacklist, cancellationToken))
            return Result<CustomerDto>.Failure(Error.Conflict("Kara liste özelliği paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));

        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result<CustomerDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        if (request.Blacklisted) customer.Blacklist(request.Reason);
        else customer.RemoveFromBlacklist();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, request.Blacklisted ? "Blacklist" : "Unblacklist", "Customer", customer.Id,
            request.Blacklisted ? $"Kara listeye alındı: {customer.FullName}" : $"Kara listeden çıkarıldı: {customer.FullName}",
            new { request.Reason }, cancellationToken);
        return Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    public async Task<Result<CustomerDto>> SetVipAsync(Guid tenantId, Guid id, SetVipRequest request, CancellationToken cancellationToken = default)
    {
        var customer = await _db.Customers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (customer is null) return Result<CustomerDto>.Failure(Error.NotFound("Müşteri bulunamadı."));
        customer.SetVip(request.Vip);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, customer.BranchId, request.Vip ? "SetVip" : "RemoveVip", "Customer", customer.Id,
            request.Vip ? $"VIP etiketi eklendi: {customer.FullName}" : $"VIP etiketi kaldırıldı: {customer.FullName}",
            null, cancellationToken);
        return Result<CustomerDto>.Success(Mask(customer.ToDto()));
    }

    public async Task<Result<PagedResult<CustomerDto>>> GetVipAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        // FullName şifreli olduğundan sıralama deterministik ciphertext sırası — sayfalama tutarlı (bkz. ListAsync notu).
        var query = _db.Customers.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsVip)
            .OrderBy(x => x.FullName);
        var total = await query.CountAsync(cancellationToken);
        var items = await query.Skip(request.Skip).Take(request.SafePageSize)
            .Select(x => new CustomerDto(x.Id, x.TenantId, x.BranchId, x.FullName, x.Phone, x.Email, x.BirthDate, x.Gender, x.KvkkConsent, x.Notes, null, x.IsBlacklisted, x.BlacklistReason, x.CreatedAtUtc, x.IsVip))
            .ToArrayAsync(cancellationToken);
        if (IsStaffViewer) items = items.Select(Mask).ToArray();
        return Result<PagedResult<CustomerDto>>.Success(new PagedResult<CustomerDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<PagedResult<CustomerDto>>> GetBlacklistedAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default)
    {
        var query = _db.Customers.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.IsBlacklisted)
            .OrderByDescending(x => x.BlacklistedAtUtc);
        var total = await query.CountAsync(cancellationToken);
        var items = await query.Skip(request.Skip).Take(request.SafePageSize)
            .Select(x => new CustomerDto(x.Id, x.TenantId, x.BranchId, x.FullName, x.Phone, x.Email, x.BirthDate, x.Gender, x.KvkkConsent, x.Notes, null, x.IsBlacklisted, x.BlacklistReason, x.CreatedAtUtc, x.IsVip))
            .ToArrayAsync(cancellationToken);
        if (IsStaffViewer) items = items.Select(Mask).ToArray();
        return Result<PagedResult<CustomerDto>>.Success(new PagedResult<CustomerDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<PassiveCustomerListDto>> GetPassiveCustomersAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.CustomersPassive, cancellationToken))
            return Result<PassiveCustomerListDto>.Failure(Error.Conflict("Pasif müşteri listesi paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));

        var thresholdDays = await _db.Tenants.AsNoTracking().Where(t => t.Id == tenantId)
            .Select(t => t.PassiveCustomerThresholdDays).FirstOrDefaultAsync(cancellationToken);
        if (thresholdDays < 1) thresholdDays = 60;
        var now = DateTime.UtcNow;
        var cutoff = now.AddDays(-thresholdDays);

        // Son aktivite = max(müşteri oluşturulma, son randevu, son paket seansı). Cutoff'tan önceyse pasif.
        // Şube filtresi global query filter ile otomatik uygulanır (kuruma + şubeye özel).
        var query =
            from c in _db.Customers.AsNoTracking()
            where c.TenantId == tenantId && !c.IsBlacklisted
            let lastAppt = _db.Appointments.Where(a => a.TenantId == tenantId && a.CustomerId == c.Id).Max(a => (DateTime?)a.CreatedAtUtc)
            let lastPkg = _db.CustomerPackageSessions.Where(s => s.TenantId == tenantId && s.CustomerId == c.Id).Max(s => (DateTime?)s.CreatedAtUtc)
            select new { c.Id, c.BranchId, c.FullName, c.Phone, c.Email, Created = c.CreatedAtUtc, lastAppt, lastPkg };

        var rows = await query.ToListAsync(cancellationToken);
        var items = rows
            .Select(r =>
            {
                var last = new[] { (DateTime?)r.Created, r.lastAppt, r.lastPkg }.Where(d => d.HasValue).Select(d => d!.Value).Max();
                return new { r.Id, r.BranchId, r.FullName, r.Phone, r.Email, last };
            })
            .Where(r => r.last <= cutoff)
            .OrderBy(r => r.last)
            .Select(r => new PassiveCustomerDto(r.Id, r.BranchId, r.FullName,
                IsStaffViewer ? MaskPhone(r.Phone) : r.Phone,
                IsStaffViewer ? EmailMask.Mask(r.Email) : r.Email,
                r.last, (int)Math.Floor((now - r.last).TotalDays)))
            .ToArray();
        return Result<PassiveCustomerListDto>.Success(new PassiveCustomerListDto(thresholdDays, items));
    }

    public async Task<Result<PassiveThresholdDto>> GetPassiveThresholdAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var days = await _db.Tenants.AsNoTracking().Where(t => t.Id == tenantId)
            .Select(t => t.PassiveCustomerThresholdDays).FirstOrDefaultAsync(cancellationToken);
        return Result<PassiveThresholdDto>.Success(new PassiveThresholdDto(days < 1 ? 60 : days));
    }

    public async Task<Result<PassiveThresholdDto>> SetPassiveThresholdAsync(Guid tenantId, SetPassiveThresholdRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.CustomersPassive, cancellationToken))
            return Result<PassiveThresholdDto>.Failure(Error.Conflict("Pasif müşteri listesi paketinizde yok."));

        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);
        if (tenant is null) return Result<PassiveThresholdDto>.Failure(Error.NotFound("Kurum bulunamadı."));
        tenant.SetPassiveCustomerThreshold(request.Days);
        await _db.SaveChangesAsync(cancellationToken);
        return Result<PassiveThresholdDto>.Success(new PassiveThresholdDto(tenant.PassiveCustomerThresholdDays));
    }
}
