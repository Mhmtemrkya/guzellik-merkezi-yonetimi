using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class AppointmentService : IAppointmentService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IAuditLogger _audit;
    private readonly IWaitlistService _waitlist;
    private readonly IDurableJobQueue _jobs;
    private readonly IAppNotificationService _notifications;
    private readonly ICurrentUser _currentUser;
    private readonly IAdisyonService _adisyon;

    public AppointmentService(GuzellikDbContext db, IUsageService usage, IAuditLogger audit, IWaitlistService waitlist, IDurableJobQueue jobs, IAppNotificationService notifications, ICurrentUser currentUser, IAdisyonService adisyon)
    {
        _db = db;
        _usage = usage;
        _audit = audit;
        _waitlist = waitlist;
        _jobs = jobs;
        _notifications = notifications;
        _currentUser = currentUser;
        _adisyon = adisyon;
    }

    // Personel müşteri telefonunu yalnızca maskeli görür (PhoneMask kuralı).
    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

    /// <summary>Bildirim gövdesi için müşteri adı (şifreli kolon okuma anında çözülür). Yoksa "Müşteri".</summary>
    private async Task<string> CustomerNameAsync(Guid tenantId, Guid customerId, CancellationToken ct)
    {
        var name = await _db.Customers.AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Id == customerId)
            .Select(c => c.FullName)
            .FirstOrDefaultAsync(ct);
        return string.IsNullOrWhiteSpace(name) ? "Müşteri" : name;
    }

    /// <summary>Randevunun atandığı personelin TenantUser kimliği (hesabı yoksa null).</summary>
    private async Task<Guid?> AssignedStaffUserIdAsync(Guid tenantId, Guid staffMemberId, CancellationToken ct)
    {
        var uid = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.Id == staffMemberId)
            .Select(s => s.TenantUserId)
            .FirstOrDefaultAsync(ct);
        return uid == Guid.Empty ? null : uid;
    }

    /// <summary>
    /// Atanmış personele randevu bildirimi. Personel panelindeki bildirimler yönetici panelinden
    /// AYRIŞIR: personel yalnızca KENDİ randevu olaylarını görür (yönetim olayları rol hedeflidir).
    /// Olayı personelin kendisi tetiklediyse (actorStaffUserId) kendi kendine bildirim üretilmez.
    /// </summary>
    private async Task NotifyAssignedStaffAsync(
        Appointment appointment, Guid? actorStaffUserId,
        AppNotificationType type, AppNotificationSeverity severity,
        string title, string dedupePrefix, CancellationToken ct)
    {
        var uid = await AssignedStaffUserIdAsync(appointment.TenantId, appointment.StaffMemberId, ct);
        if (uid is null || uid == actorStaffUserId) return;
        var customerName = await CustomerNameAsync(appointment.TenantId, appointment.CustomerId, ct);
        await _notifications.NotifyUserAsync(
            appointment.TenantId, appointment.BranchId, uid.Value,
            type, severity,
            title,
            $"{customerName} · {appointment.StartUtc.AddHours(3):dd.MM.yyyy HH:mm}",
            data: new { route = "/appointments", id = appointment.Id.ToString() },
            dedupeKey: $"{dedupePrefix}:{appointment.Id}",
            ct: ct);
    }

    public async Task<Result<PagedResult<AppointmentDto>>> ListAsync(Guid tenantId, DateTime? fromUtc, DateTime? toUtc, PageRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null, Guid? customerId = null)
    {
        var query = ApplyStaffScope(_db.Appointments.AsNoTracking().Where(x => x.TenantId == tenantId), staffTenantUserId)
            .OrderBy(x => x.StartUtc)
            .AsQueryable();
        if (fromUtc.HasValue) query = query.Where(x => x.StartUtc >= fromUtc.Value);
        if (toUtc.HasValue) query = query.Where(x => x.StartUtc <= toUtc.Value);
        // Müşteri kartı: yalnız o müşterinin randevuları (tüm liste çekilmesin).
        if (customerId is { } cid && cid != Guid.Empty) query = query.Where(x => x.CustomerId == cid);
        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .Skip(request.Skip)
            .Take(request.SafePageSize)
            .Select(x => new AppointmentDto(
                x.Id,
                x.TenantId,
                x.BranchId,
                x.CustomerId,
                x.StaffMemberId,
                x.ServiceDefinitionId,
                x.StartUtc,
                x.EndUtc,
                x.Status,
                x.Price,
                x.Notes,
                x.CancellationReason,
                x.Customer != null ? x.Customer.FullName : null,
                x.StaffMember != null ? x.StaffMember.FullName : null,
                x.ServiceDefinition != null ? x.ServiceDefinition.Name : null,
                x.CustomerConfirmation,
                x.LastReminderAtUtc,
                x.IsOnline,
                x.Customer != null ? x.Customer.Phone : null,
                x.Customer != null && x.Customer.IsVip,
                x.Number))
            .ToArrayAsync(cancellationToken);
        if (IsStaffViewer)
        {
            items = items.Select(a => a with { CustomerPhone = PhoneMask.Mask(a.CustomerPhone) }).ToArray();
        }
        return Result<PagedResult<AppointmentDto>>.Success(new PagedResult<AppointmentDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<AppointmentDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId)
            .Include(x => x.Customer)
            .Include(x => x.StaffMember)
            .Include(x => x.ServiceDefinition)
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        return appointment is null ? Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı.")) : Result<AppointmentDto>.Success(appointment.ToDto());
    }

    /// <summary>
    /// Personel yalnızca yetkili olduğu kategorilerdeki hizmetlere randevu alabilir.
    /// Specialties boşsa kısıt yok; doluysa hizmetin kategorisi ya da adı listede olmalı
    /// (eski kayıtlar hizmet adı sakladığı için ad da kabul edilir). Hata yoksa null döner.
    /// </summary>
    private async Task<Error?> CheckStaffSkillAsync(Guid tenantId, Guid staffMemberId, Guid serviceDefinitionId, CancellationToken ct)
    {
        var reason = await StaffSkill.BlockReasonAsync(_db, tenantId, staffMemberId, serviceDefinitionId, ct);
        return reason is null ? null : Error.Validation(reason);
    }

    public async Task<Result<AppointmentDto>> CreateAsync(Guid tenantId, CreateAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var limit = await _usage.CheckLimitAsync(tenantId, "appointments", cancellationToken);
        if (limit.IsFailure) return Result<AppointmentDto>.Failure(limit.Error);

        if (!await IsStaffInScopeAsync(tenantId, request.StaffMemberId, staffTenantUserId, cancellationToken))
        {
            return Result<AppointmentDto>.Failure(Error.NotFound("Randevu personel kapsamı bulunamadı."));
        }

        // Kara liste: bu müşteriye randevu verilemez.
        if (await _db.Customers.AsNoTracking().AnyAsync(c => c.TenantId == tenantId && c.Id == request.CustomerId && c.IsBlacklisted, cancellationToken))
        {
            return Result<AppointmentDto>.Failure(Error.Conflict("Bu müşteri kara listede; randevu oluşturulamaz."));
        }

        // Satış şartı: randevu yalnızca onaylanmış paket/hizmet satışı olan müşteriye verilebilir.
        if (!await HasApprovedSaleAsync(tenantId, request.CustomerId, cancellationToken))
        {
            return Result<AppointmentDto>.Failure(Error.Validation(
                "Randevu oluşturmak için müşterinin kurum sahibi tarafından onaylanmış bir paket veya hizmet satışı olmalı."));
        }

        // Kategori yetkisi: personelin uzmanlık listesi (Specialties, virgüllü) doluysa
        // hizmetin kategorisi VEYA adı listede olmalı. Boş liste = kısıt yok.
        var skillCheck = await CheckStaffSkillAsync(tenantId, request.StaffMemberId, request.ServiceDefinitionId, cancellationToken);
        if (skillCheck is not null) return Result<AppointmentDto>.Failure(skillCheck);

        // Çalışma saatleri: personelin haftalık mesai penceresi dışına randevu alınamaz.
        var hoursBlock = await WorkingHoursGuard.BlockReasonAsync(_db, tenantId, request.StaffMemberId, request.StartUtc, request.EndUtc, cancellationToken);
        if (hoursBlock is not null) return Result<AppointmentDto>.Failure(Error.Validation(hoursBlock));

        // SLOT KAPASİTESİ + NUMARA YARIŞI: "önce say, sonra kaydet" iki ayrı işlemdi. İki eşzamanlı
        // istek kapasiteyi ikisi de boş görüp personelin aynı aralığına izin verilenden fazla randevu
        // koyabiliyor, MAX(Number)+1 de aynı #RNDV numarasını iki kez üretebiliyordu.
        // Çözüm: tek transaction + personel satırının kilidi (aynı personelin istekleri serileşir)
        // → sayım ile yazma arasına kimse giremez. Numara için ayrıca {TenantId, Number} benzersiz
        // indeksi var; çakışma olursa aşağıdaki döngü numarayı yeniden hesaplar.
        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (_db.Database.IsRelational())
        {
            // Kilit sırası (RowLock.TableOrder): customers → … → staff_members.
            // MÜŞTERİ kilidi seans REZERVASYONUNU serileştirir: yalnız personel kilitlenirse,
            // aynı müşterinin tek kalan seansı için FARKLI personellere açılan iki eşzamanlı
            // istek ayrı kilitler alıp ikisi de rezervasyonu boş görebiliyordu.
            await RowLock.LockRowAsync(_db, "customers", request.CustomerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "staff_members", request.StaffMemberId, cancellationToken);
        }

        var overlap = await HasOverlapAsync(tenantId, request.StaffMemberId, request.StartUtc, request.EndUtc, null, cancellationToken);
        // SlotFull kodu: frontend bunu "bekleme listesine ekle?" uyarısı için ayırt eder (kara liste 409'undan farklı).
        if (overlap) return Result<AppointmentDto>.Failure(Error.SlotFull("Bu saatte personelin uygun yeri yok. Bekleme listesine ekleyebilirsiniz."));

        var appointment = new Appointment(tenantId, request.BranchId, request.CustomerId, request.StaffMemberId, request.ServiceDefinitionId, request.StartUtc, request.EndUtc, request.Price, request.Notes);

        // Kurum içi sıralı randevu numarası (#RNDV-…): mevcut en büyük + 1, taban 10000.
        var maxNumber = await _db.Appointments.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.Number != null)
            .MaxAsync(a => (int?)a.Number, cancellationToken) ?? 10000;
        appointment.AssignNumber(maxNumber + 1);

        // KAYNAK SEANS BAĞI: randevu ücretsizse (paketten karşılanıyorsa) hangi seanstan geldiği
        // ŞİMDİ işaretlenir. Satış iptali eskiden bunu tahmin ediyordu (aynı müşteri + aynı hizmet,
        // kalan seans kadarını koru) ve müşterinin aynı hizmeti içeren ikinci bir paketi varsa yanlış
        // randevuyu kapatabiliyordu. Rezervasyon DEĞİLDİR — seans yalnız tamamlamada düşer; bağ
        // tamamlamada gerçekten tüketilen seansla düzeltilir.
        if (request.Price <= 0m)
        {
            var sourceSessionId = await FindBookableSessionAsync(
                tenantId, request.CustomerId, request.ServiceDefinitionId, null, cancellationToken);
            if (sourceSessionId is not null)
            {
                appointment.LinkToPackageSession(sourceSessionId);
            }
            // Seans yoksa tek meşru durum, satışı ilk randevuda işlenecek AÇIK adisyondur
            // (seans o an oluşur). O da yoksa müşterinin bu hizmet için hakkı YOKTUR: eskiden
            // randevu yine açılıyor, tamamlanınca hiçbir seans düşmüyor ve hizmet bedava veriliyordu.
            else if (!await HasPendingSaleForServiceAsync(tenantId, request.CustomerId, request.ServiceDefinitionId, cancellationToken))
            {
                return Result<AppointmentDto>.Failure(Error.Validation(
                    "Müşterinin bu hizmet için kullanılabilir seansı yok. Kalan seanslar açık randevulara " +
                    "ayrılmış olabilir; önce hizmeti/paketi satın veya randevuyu ücretli olarak oluşturun."));
            }
        }

        // Personel oluşturduysa randevu doğrudan aktif olmaz; taslak olarak kurum yöneticisi onayına düşer.
        var isStaffRequest = staffTenantUserId.HasValue;
        if (isStaffRequest) appointment.SubmitForApproval();

        _db.Appointments.Add(appointment);
        // Numara çakışırsa (benzersiz indeks reddeder) yeniden hesapla ve dene: personel kilidi
        // aynı personeli serileştirir ama farklı personellere giden iki istek aynı numarayı
        // hesaplayabilir.
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
                break;
            }
            catch (DbUpdateException) when (attempt < 3)
            {
                // AssignNumber "yalnız bir kez" kuralı gereği dolu numarayı DEĞİŞTİRMEZ; yeniden
                // deneme aynı numarayla tekrarlanıp dört kez patlıyordu. Retry'a özel setter.
                var next = await _db.Appointments.AsNoTracking().IgnoreQueryFilters()
                    .Where(a => a.TenantId == tenantId && a.Number != null)
                    .MaxAsync(a => (int?)a.Number, cancellationToken) ?? 10000;
                appointment.ReassignNumberForRetry(next + 1);
            }
        }
        if (tx is not null) await tx.CommitAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Create", "Appointment", appointment.Id,
            isStaffRequest
                ? $"Taslak randevu onaya gönderildi ({appointment.StartUtc:dd.MM.yyyy HH:mm})"
                : $"Randevu oluşturuldu ({appointment.StartUtc:dd.MM.yyyy HH:mm})",
            new { appointment.StartUtc, appointment.EndUtc, appointment.CustomerId, appointment.StaffMemberId, appointment.Price, appointment.Status }, cancellationToken);

        // Yönetici oluşturduysa atanmış personele "yeni randevu" bildirimi (personel paneli farkı).
        if (!isStaffRequest)
        {
            await NotifyAssignedStaffAsync(appointment, staffTenantUserId,
                AppNotificationType.AppointmentCreated, AppNotificationSeverity.Info,
                "Sana yeni randevu atandı", "appt-assigned", cancellationToken);
        }
        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    /// <summary>
    /// Müşterinin randevu verilebilecek bir satışı var mı? Onaylı satış (paket seans bakiyesi ya da onaylı
    /// adisyonda satış kalemi) VEYA Faz 2'de "ilk randevu tamamlanınca işlenecek" bekleyen açık satış.
    /// Deferred satışta henüz seans/cari oluşmaz; yine de randevu verilebilmeli ki ilk randevu tamamlanınca
    /// otomatik onay tetiklensin (aksi halde satış hiç işlenemeyeceği bir kilitlenme oluşur).
    /// </summary>
    /// <summary>Rezerve sayılan randevu durumları — henüz yaşanmamış ama seans hakkını tutan kayıtlar.</summary>
    private static readonly AppointmentStatus[] OpenAppointmentStatuses =
    [
        AppointmentStatus.Draft,
        AppointmentStatus.Scheduled,
        AppointmentStatus.Confirmed,
        AppointmentStatus.InProgress,
    ];

    /// <summary>
    /// ÜCRETSİZ (paketten karşılanan) randevu için GERÇEKTEN kullanılabilir seans bakiyesini bulur.
    ///
    /// <para>
    /// Eski kontrol yalnız "müşterinin herhangi bir satışı var mı" diye bakıyordu: kalan seansı 0
    /// olan paket, BAŞKA hizmete ait paket, hatta yalnız ürün satışı bile ücretsiz randevu hakkı
    /// veriyordu. Sadece şampuan alan müşteri bakım hizmetine randevu alabiliyor, randevu
    /// tamamlanınca hiçbir seans düşmüyordu.
    /// </para>
    ///
    /// <para>
    /// REZERVASYON (cardinality): seans bağı rezervasyon değildi, bu yüzden kalan 1 seansa üç
    /// gelecek randevu bağlanabiliyordu. Burada açık randevular (bkz. <see cref="OpenAppointmentStatuses"/>)
    /// hakkı TUTAR: kalan seans, o seansa bağlı açık randevu sayısından büyük olmalı.
    /// </para>
    /// </summary>
    private async Task<Guid?> FindBookableSessionAsync(
        Guid tenantId, Guid customerId, Guid serviceDefinitionId, Guid? excludeAppointmentId, CancellationToken cancellationToken)
    {
        var sessions = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId
                     && s.CustomerId == customerId
                     && s.ServiceDefinitionId == serviceDefinitionId
                     && (s.TotalSessions - s.UsedSessions) > 0)
            .OrderBy(s => s.CreatedAtUtc)
            .Select(s => new { s.Id, Remaining = s.TotalSessions - s.UsedSessions })
            .ToListAsync(cancellationToken);
        if (sessions.Count == 0) return null;

        // Bu müşterinin seansa bağlı açık randevuları. (Guid listesiyle .Contains() MySQL
        // sağlayıcısında sunucuda çevrilemiyor → müşteri bazında çekilip bellekte eşleştirilir.)
        var reserved = (await _db.Appointments.AsNoTracking()
                .Where(a => a.TenantId == tenantId
                         && a.CustomerId == customerId
                         && a.SourceCustomerPackageSessionId != null
                         && (excludeAppointmentId == null || a.Id != excludeAppointmentId)
                         && OpenAppointmentStatuses.Contains(a.Status))
                .Select(a => a.SourceCustomerPackageSessionId!.Value)
                .ToListAsync(cancellationToken))
            .GroupBy(x => x)
            .ToDictionary(g => g.Key, g => g.Count());

        foreach (var s in sessions)
        {
            reserved.TryGetValue(s.Id, out var held);
            if (s.Remaining > held) return s.Id;
        }
        return null;
    }

    /// <summary>
    /// Faz 2 istisnası: satış adisyonu "ilk randevu tamamlanınca cariye işlensin" diye AÇIK
    /// bekliyorsa seanslar HENÜZ OLUŞMAMIŞTIR. Bu durumda hak, bekleyen adisyonun İSTENEN HİZMETE
    /// ait kalemiyle doğrulanır — "herhangi bir bekleyen satış" yetmez.
    /// </summary>
    private async Task<bool> HasPendingSaleForServiceAsync(
        Guid tenantId, Guid customerId, Guid serviceDefinitionId, CancellationToken cancellationToken)
    {
        var pending = await (
            from a in _db.Adisyonlar.AsNoTracking()
            join i in _db.AdisyonItems.AsNoTracking() on a.Id equals i.AdisyonId
            where a.TenantId == tenantId
                && a.CustomerId == customerId
                && a.Status == AdisyonStatus.Open
                && a.AutoApproveOnFirstAppointment
                && (i.Type == AdisyonItemType.Service || i.Type == AdisyonItemType.PackageSale)
            select new { i.Type, i.RefId }).ToListAsync(cancellationToken);
        if (pending.Count == 0) return false;

        // Tekil hizmet satışı doğrudan hizmete işaret eder.
        if (pending.Any(x => x.Type == AdisyonItemType.Service && x.RefId == serviceDefinitionId)) return true;

        // Paket satışı: paketin içeriğinde bu hizmet var mı?
        var packageIds = pending
            .Where(x => x.Type == AdisyonItemType.PackageSale && x.RefId.HasValue)
            .Select(x => x.RefId!.Value)
            .ToHashSet();
        if (packageIds.Count == 0) return false;

        var packageServices = await _db.ServicePackageItems.AsNoTracking()
            .Where(pi => pi.ServiceDefinitionId == serviceDefinitionId)
            .Select(pi => pi.ServicePackageId)
            .ToListAsync(cancellationToken);
        return packageServices.Any(packageIds.Contains);
    }

    private async Task<bool> HasApprovedSaleAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken)
    {
        var hasPackage = await _db.CustomerPackageSessions.AsNoTracking()
            .AnyAsync(s => s.TenantId == tenantId && s.CustomerId == customerId, cancellationToken);
        if (hasPackage) return true;

        return await (
            from a in _db.Adisyonlar.AsNoTracking()
            join i in _db.AdisyonItems.AsNoTracking() on a.Id equals i.AdisyonId
            where a.TenantId == tenantId
                && a.CustomerId == customerId
                && (a.Status == AdisyonStatus.Approved
                    || (a.Status == AdisyonStatus.Open && a.AutoApproveOnFirstAppointment))
                && (i.Type == AdisyonItemType.Service || i.Type == AdisyonItemType.PackageSale
                    || i.Type == AdisyonItemType.Product || i.Type == AdisyonItemType.Extra)
            select a.Id).AnyAsync(cancellationToken);
    }

    public async Task<Result<AppointmentDto>> RescheduleAsync(Guid tenantId, Guid id, RescheduleAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));

        // Sürükle-bırak farklı sütuna: hedef personel değişebilir. Çakışma hedef personele göre kontrol edilir.
        var targetStaff = request.StaffMemberId ?? appointment.StaffMemberId;
        var staffChanged = request.StaffMemberId.HasValue && request.StaffMemberId.Value != appointment.StaffMemberId;
        if (staffChanged && !await IsStaffInScopeAsync(tenantId, targetStaff, staffTenantUserId, cancellationToken))
        {
            return Result<AppointmentDto>.Failure(Error.NotFound("Hedef personel kapsamı bulunamadı."));
        }

        // KAPASİTE KİLİDİ (oluşturmayla aynı protokol): "kontrol et → kaydet" iki ayrı işlemdi,
        // iki randevu aynı personele aynı slota eşzamanlı taşınabiliyordu.
        // Kilit sırası customers → appointments → staff_members; UpdateAsync bu metodu status
        // değişiminden ÖNCE çağırdığı için sıra orada da korunur (ters sıra deadlock üretiyordu).
        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (_db.Database.IsRelational())
        {
            await RowLock.LockRowAsync(_db, "customers", appointment.CustomerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "appointments", appointment.Id, cancellationToken);
            await RowLock.LockRowAsync(_db, "staff_members", targetStaff, cancellationToken);
        }

        var overlap = await HasOverlapAsync(tenantId, targetStaff, request.StartUtc, request.EndUtc, appointment.Id, cancellationToken);
        if (overlap) return Result<AppointmentDto>.Failure(Error.Conflict("Personelin bu saat aralığında en fazla 2 randevusu olabilir."));

        var prevStart = appointment.StartUtc;
        var prevStaff = appointment.StaffMemberId;
        if (staffChanged) appointment.ReassignStaff(targetStaff);
        appointment.Reschedule(request.StartUtc, request.EndUtc);
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Reschedule", "Appointment", appointment.Id,
            staffChanged
                ? $"Randevu taşındı: {prevStart:dd.MM HH:mm} → {appointment.StartUtc:dd.MM HH:mm} (personel değişti)"
                : $"Randevu yeniden planlandı: {prevStart:dd.MM HH:mm} → {appointment.StartUtc:dd.MM HH:mm}",
            new { prevStart, NewStart = appointment.StartUtc, NewEnd = appointment.EndUtc, prevStaff, NewStaff = appointment.StaffMemberId }, cancellationToken);

        // Saat değişikliğini atanmış personel de görsün (kendisi değiştirmediyse).
        await NotifyAssignedStaffAsync(appointment, staffTenantUserId,
            AppNotificationType.AppointmentUpdated, AppNotificationSeverity.Info,
            "Randevun yeniden planlandı", $"appt-resched:{appointment.StartUtc:yyyyMMddHHmm}", cancellationToken);
        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    /// <summary>
    /// Zaman + durum + notu TEK transaction'da uygular. Ekran eskiden üç ayrı uç çağırıyordu;
    /// ortadaki başarılı olup sonraki patladığında randevu tamamlanmış (ve seans düşmüş) hâlde
    /// kalırken arayüz "kaydedilemedi" gösteriyordu. Alt çağrılar açık transaction'ı görünce
    /// kendi transaction'larını açmaz ama kilit/taze-okuma korumasını uygulamayı sürdürür.
    /// </summary>
    public async Task<Result<AppointmentDto>> UpdateAsync(Guid tenantId, Guid id, UpdateAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        // KİLİTLER EN BAŞTA VE PROTOKOL SIRASINDA ALINIR (customers → appointments).
        // Alt çağrılar kendi kilitlerini aldığında sıra çağrı sırasına bağlı kalıyordu:
        // reschedule appointments üstünde X-lock bırakıp sonra status customers istiyor,
        // eşzamanlı bir status geçişi ise ters yönde ilerliyordu → deterministik deadlock.
        if (_db.Database.IsRelational())
        {
            var owner = await _db.Appointments.AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.Id == id)
                .Select(a => (Guid?)a.CustomerId)
                .FirstOrDefaultAsync(cancellationToken);
            if (owner is { } customerId) await RowLock.LockRowAsync(_db, "customers", customerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "appointments", id, cancellationToken);
        }

        Result<AppointmentDto>? last = null;

        if (request.StartUtc is { } startUtc && request.EndUtc is { } endUtc)
        {
            last = await RescheduleAsync(tenantId, id,
                new RescheduleAppointmentRequest(startUtc, endUtc, request.StaffMemberId), cancellationToken, staffTenantUserId);
            if (last.IsFailure) return last;
        }

        if (request.Status is { } status)
        {
            last = await ChangeStatusAsync(tenantId, id,
                new ChangeAppointmentStatusRequest(status, request.StatusReason), cancellationToken, staffTenantUserId);
            if (last.IsFailure) return last;
        }

        if (request.NotesProvided)
        {
            last = await ChangeNotesAsync(tenantId, id,
                new ChangeAppointmentNotesRequest(request.Notes), cancellationToken, staffTenantUserId);
            if (last.IsFailure) return last;
        }

        if (tx is not null) await tx.CommitAsync(cancellationToken);

        // Hiçbir alan gönderilmediyse mevcut hâli döndür (istemci "değişiklik yok" ile gelebilir).
        return last ?? await GetAsync(tenantId, id, cancellationToken, staffTenantUserId);
    }

    public async Task<Result<AppointmentDto>> ChangeStatusAsync(Guid tenantId, Guid id, ChangeAppointmentStatusRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));

        // DURUM GEÇİŞİ ORTAK KİLİT PROTOKOLÜNE KATILIR (bkz. RowLock) — yalnız tamamlama değil,
        // İPTAL de. Eskiden randevu kilitten ve transaction'dan ÖNCE okunup Complete() ediliyordu:
        // iki eşzamanlı "Tamamlandı" isteği randevuyu aynı bayat durumda okuyup ikisi de
        // isCompleting=true hesaplıyor, ilki bir seansı tüketiyor, ikincisi kilidi sonra alıp
        // BAŞKA bir kullanılabilir seansı tüketiyordu — tek randevu iki seans düşürüyordu.
        // Randevu satırında concurrency token da yok, o yüzden kilit tek koruma.
        // İzolasyon READ COMMITTED: kilit sonrası okuma gerçekten taze olsun (bkz. AdisyonService).
        // Dış bir transaction varsa (tek işlemli güncelleme ucu) ona KATILIRIZ; kilit + taze okuma
        // yine yapılır — koruma transaction'ın sahibi olmaya bağlı değildir.
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        if (relational)
        {
            // Kilit sırası (RowLock.TableOrder): customers → appointments → … → sessions.
            // Müşteri ÖNCE kilitlenir: otomatik satış onayı ve adisyon silme de bu sırayla
            // ilerliyor, ters sıra kilitlenme (deadlock) üretirdi.
            await RowLock.LockRowAsync(_db, "customers", appointment.CustomerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "appointments", appointment.Id, cancellationToken);
            // Kilitten önceki okuma bayat olabilir; kilit altında yeniden oku ve kararı
            // TAZE durum üzerinden ver.
            await _db.Entry(appointment).ReloadAsync(cancellationToken);
            // Reload satırı bulamazsa entity detach olur (randevu bu arada silinmiş).
            if (_db.Entry(appointment).State == EntityState.Detached)
                return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));
        }

        // Zaten istenen durumdaysa no-op — bayat/tekrar onay isteği "tamamlanamaz" hatası vermesin
        // (idempotent). Kilitten sonra bakıldığı için eşzamanlı ikinci istek BURADA durur.
        if (appointment.Status == request.Status) return Result<AppointmentDto>.Success(appointment.ToDto());

        var prevStatus = appointment.Status;
        switch (request.Status)
        {
            case AppointmentStatus.Confirmed: appointment.Confirm(); break;
            case AppointmentStatus.InProgress: appointment.StartService(); break;
            case AppointmentStatus.Completed: appointment.Complete(); break;
            case AppointmentStatus.Cancelled: appointment.Cancel(request.Reason ?? "Belirtilmedi"); break;
            case AppointmentStatus.NoShow: appointment.MarkNoShow(); break;
        }

        var isCompleting = request.Status == AppointmentStatus.Completed && prevStatus != AppointmentStatus.Completed;

        // Randevu Tamamlandı'ya geçtiyse, müşterinin bu hizmete ait paket seansından otomatik düş.
        // Complete() yalnızca Scheduled/Confirmed'dan çağrılabildiği için bu blok randevu başına tek kez çalışır.
        if (isCompleting)
        {
            // Sıra: customers → appointments → (otomatik onay: adisyonlar → products → gift_cards
            // → sessions) → sessions. Müşteri ve randevu kilitleri yukarıda, durum geçişinden
            // ÖNCE alındı; burada tekrar alınmaz.
            // Faz 2: Müşterinin "ilk randevu tamamlanınca işle" bekleyen (açık) satış adisyonları varsa
            // şimdi otomatik onayla → satış cariye borç, peşinat kasaya gelir, satılan seanslar o an oluşur.
            // Onay seansları yaratır → hemen aşağıdaki seans düşümü (satılan hizmet bu randevuysa) onları bulur.
            // best-effort: bir satış onaylanamazsa (ör. stok/guard) randevu tamamlanmayı engelleme, denetime yaz.
            var pendingSaleIds = await _db.Adisyonlar.AsNoTracking()
                .Where(a => a.TenantId == tenantId
                         && a.CustomerId == appointment.CustomerId
                         && a.Status == AdisyonStatus.Open
                         && a.AutoApproveOnFirstAppointment)
                .OrderBy(a => a.OpenedAtUtc)
                .Select(a => a.Id)
                .ToListAsync(cancellationToken);
            foreach (var saleId in pendingSaleIds)
            {
                var approved = await _adisyon.ApproveAsync(tenantId, saleId, cancellationToken);
                if (!approved.IsSuccess)
                {
                    await _audit.LogAsync(tenantId, appointment.BranchId, "AutoApproveFailed", "Adisyon", saleId,
                        $"İlk randevu tamamlandı ama satış otomatik cariye işlenemedi: {approved.Error.Message}",
                        new { appointment.Id, appointment.CustomerId }, cancellationToken);
                }
            }

            // Seans satırları KİLİTLENİR, sonra okunur — otomatik onay yeni seans açmış olabilir.
            await RowLock.LockRowsAsync(_db, "customer_package_sessions",
                await _db.CustomerPackageSessions.AsNoTracking()
                    .Where(s => s.TenantId == tenantId && s.CustomerId == appointment.CustomerId)
                    .Select(s => s.Id).ToListAsync(cancellationToken),
                cancellationToken);

            var usable = await _db.CustomerPackageSessions
                .Where(s => s.TenantId == tenantId
                         && s.CustomerId == appointment.CustomerId
                         && s.ServiceDefinitionId == appointment.ServiceDefinitionId
                         && (s.TotalSessions - s.UsedSessions) > 0)
                .OrderBy(s => s.CreatedAtUtc)
                .ToListAsync(cancellationToken);

            // Randevu bir seansa bağlıysa ÖNCE ondan düş — müşterinin aynı hizmete ait başka paketi
            // varsa doğru paketin bakiyesi erisin. Bağlı seans tükendiyse sıradakine düşülür ve bağ
            // GERÇEKTEN tüketilen seansla düzeltilir (satış iptali bu bağa güvenir).
            //
            // ÜCRETLİ RANDEVU PAKETTEN DÜŞMEZ: bağsız (SourceCustomerPackageSessionId = null) ve
            // ücretli bir randevuda "aynı hizmetten herhangi bir seans" fallback'i çalışıyordu.
            // Müşteri ücretli randevu açıp arada paket satın alırsa hem ücret tahakkuk ediyor hem
            // paketten bir seans düşüyordu — aynı iş iki kez ödetiliyordu. Ücretsiz randevuda
            // (paketten karşılanan) fallback korunur: hak oluşturmada zaten doğrulanıyor.
            var session = usable.FirstOrDefault(s => s.Id == appointment.SourceCustomerPackageSessionId)
                          ?? (appointment.Price <= 0m ? usable.FirstOrDefault() : null);
            if (session is not null && session.TryConsume())
            {
                appointment.LinkToPackageSession(session.Id);
            }
            else if (appointment.Price <= 0m)
            {
                // Ücretsiz randevu tamamlandı ama düşecek seans bulunamadı: hizmet fiilen bedava
                // verildi. Oluşturmada artık engelleniyor; buraya düşen kayıt ya oluşturma
                // kuralından ÖNCEKİ bir randevudur ya da arada seans başka yolla tükenmiştir.
                // Tamamlamayı bloklamak sahadaki randevuyu askıda bırakacağı için iz bırakılır.
                await _audit.LogAsync(tenantId, appointment.BranchId, "AppointmentCompletedWithoutSession",
                    "Appointment", appointment.Id,
                    "Ücretsiz randevu tamamlandı ancak düşülecek paket seansı bulunamadı.",
                    new { appointment.CustomerId, appointment.ServiceDefinitionId, appointment.Price }, cancellationToken);
            }
        }

        // Tamamlanınca müşteriye WhatsApp'tan değerlendirme linki (personel + salon yıldızı) gönder.
        // OUTBOX SATIRI ANA İŞLEMİN İÇİNE yazılır (kuyruk aynı DbContext'i kullanır): commit'ten
        // SONRA yazılırsa, kuyruğa yazarken hata alındığında durum değişikliği kalıcı olduğu hâlde
        // kullanıcı 500 görüyor; tekrar denemede durum aynı olduğu için baştaki no-op'a düşülüyor
        // ve değerlendirme işi bir daha HİÇ oluşmuyordu.
        if (isCompleting)
        {
            await _jobs.EnqueueAsync(Background.DurableJobTypes.RatingLink,
                new Background.RatingLinkJob(tenantId, appointment.Id), cancellationToken);
        }

        // Durum değişikliğini (+ tamamlanınca seans düşümü) önce kaydet: bekleme listesi offer akışı
        // overlap'i DB'den okuyacağı için slot boşalması kalıcı olmalı.
        await _db.SaveChangesAsync(cancellationToken);
        // Kilitler burada bırakılır; sonraki bildirim/kuyruk işleri (best-effort) kilit tutmamalı.
        if (tx is not null) await tx.CommitAsync(cancellationToken);

        // COMMIT SONRASI YARDIMCI İŞLER (bekleme listesi teklifi, denetim kaydı, bildirimler).
        // Hepsi best-effort: durum değişikliği ARTIK KALICI olduğu için buradaki bir hata
        // kullanıcıya "işlem başarısız" (500) olarak dönmemeli.
        try
        {
            await RunPostStatusChangeSideEffectsAsync(tenantId, appointment, request, prevStatus, staffTenantUserId, cancellationToken);
        }
        catch (Exception ex)
        {
            try
            {
                await _audit.LogAsync(tenantId, appointment.BranchId, "AppointmentStatusSideEffectFailed",
                    "Appointment", appointment.Id,
                    $"Randevu durumu değişti ({prevStatus} → {appointment.Status}) ancak yan işler tamamlanamadı: {ex.Message}",
                    new { prevStatus, NewStatus = appointment.Status }, cancellationToken);
            }
            catch { /* denetim kaydı da yazılamadıysa yutulur — asıl işlem geçerli */ }
        }

        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    /// <summary>
    /// Durum değişikliği KALICI olduktan sonra çalışan yan işler. Ayrı metotta: çağıran tarafta
    /// tek bir try/catch ile sarılıp hatası isteğe yansıtılmaz (bkz. <see cref="ChangeStatusAsync"/>).
    /// </summary>
    private async Task RunPostStatusChangeSideEffectsAsync(
        Guid tenantId, Appointment appointment, ChangeAppointmentStatusRequest request,
        AppointmentStatus prevStatus, Guid? staffTenantUserId, CancellationToken cancellationToken)
    {
        // İptalde yer açıldı → bekleme listesindeki ilk uygun müşteriye WhatsApp'tan "yer açıldı, ister misiniz?"
        // teklifi götür (offer-first). Best-effort: teklif/gönderim başarısız olsa da iptal geçerli kalır.
        Guid? offeredWaitlistId = null;
        if (request.Status == AppointmentStatus.Cancelled && prevStatus != AppointmentStatus.Cancelled)
        {
            var offer = await _waitlist.SelectAndMarkOfferAsync(tenantId, appointment.Id, cancellationToken);
            if (offer.IsSuccess && offer.Value is { } offeredId)
            {
                offeredWaitlistId = offeredId;
                // WhatsApp teklifini (yavaş Meta HTTP) KALICI kuyruğa yaz → iptal yanıtı beklemez,
                // restart'ta kaybolmaz, başarısızlıkta otomatik yeniden denenir.
                await _jobs.EnqueueAsync(Background.DurableJobTypes.WaitlistOffer,
                    new Background.WaitlistOfferJob(tenantId, offeredId), cancellationToken);
            }
        }

        await _audit.LogAsync(tenantId, appointment.BranchId, "ChangeStatus", "Appointment", appointment.Id,
            $"Randevu durumu: {prevStatus} → {appointment.Status}{(offeredWaitlistId is not null ? " · bekleme listesine teklif gönderildi" : "")}",
            new { prevStatus, NewStatus = appointment.Status, request.Reason, offeredWaitlistId }, cancellationToken);

        // İptal / Gelmedi → kurum/şube yöneticisine bildirim (yeni randevu için slot boşaldı / takip).
        if ((request.Status == AppointmentStatus.Cancelled || request.Status == AppointmentStatus.NoShow)
            && prevStatus != request.Status)
        {
            var customerName = await CustomerNameAsync(tenantId, appointment.CustomerId, cancellationToken);
            var isCancel = request.Status == AppointmentStatus.Cancelled;
            await _notifications.NotifyRolesAsync(
                tenantId, appointment.BranchId,
                new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
                isCancel ? AppNotificationType.AppointmentCancelled : AppNotificationType.AppointmentUpdated,
                AppNotificationSeverity.Warning,
                isCancel ? "Randevu iptal edildi" : "Müşteri gelmedi",
                $"{customerName} · {appointment.StartUtc.AddHours(3):dd.MM.yyyy HH:mm}"
                    + (offeredWaitlistId is not null ? " · bekleme listesine teklif gönderildi" : string.Empty),
                data: new { route = "/appointments", id = appointment.Id.ToString() },
                dedupeKey: $"appt-{appointment.Status}:{appointment.Id}",
                ct: cancellationToken);

            // Atanmış personel de kendi randevusunun iptalini/gelmediğini görür.
            await NotifyAssignedStaffAsync(appointment, staffTenantUserId,
                isCancel ? AppNotificationType.AppointmentCancelled : AppNotificationType.AppointmentUpdated,
                AppNotificationSeverity.Warning,
                isCancel ? "Randevun iptal edildi" : "Müşterin gelmedi",
                $"appt-staff-{appointment.Status}", cancellationToken);
        }
    }

    public async Task<Result<AppointmentDto>> ApproveAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        // Onay yalnızca kurum yöneticisinde — personel (scope'lu) onaylayamaz.
        if (staffTenantUserId.HasValue) return Result<AppointmentDto>.Failure(Error.Unauthorized("Taslak randevuyu yalnızca kurum yöneticisi onaylayabilir."));

        var appointment = await _db.Appointments.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));

        // KAPASİTE KİLİDİ (oluşturma/taşımayla aynı protokol): iki taslak eşzamanlı onaylanınca
        // ikisi de slotu boş görüp kapasiteyi aşabiliyordu. Durum da kilit altında taze okunur.
        await using var tx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (_db.Database.IsRelational())
        {
            await RowLock.LockRowAsync(_db, "customers", appointment.CustomerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "appointments", appointment.Id, cancellationToken);
            await RowLock.LockRowAsync(_db, "staff_members", appointment.StaffMemberId, cancellationToken);
            await _db.Entry(appointment).ReloadAsync(cancellationToken);
            if (_db.Entry(appointment).State == EntityState.Detached)
                return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));
        }

        if (appointment.Status != AppointmentStatus.Draft) return Result<AppointmentDto>.Failure(Error.Validation("Yalnızca taslak randevu onaylanabilir."));

        // Onay anında aktif randevularla çakışma kontrolü (taslak beklerken slot dolmuş olabilir).
        var overlap = await HasOverlapAsync(tenantId, appointment.StaffMemberId, appointment.StartUtc, appointment.EndUtc, appointment.Id, cancellationToken);
        if (overlap) return Result<AppointmentDto>.Failure(Error.Conflict("Personelin bu saat aralığında en fazla 2 randevusu olabilir; taslak onaylanamadı."));

        appointment.ApproveDraft();
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Approve", "Appointment", appointment.Id,
            $"Taslak randevu onaylandı → aktif ({appointment.StartUtc:dd.MM.yyyy HH:mm})",
            new { appointment.StartUtc, appointment.CustomerId, appointment.StaffMemberId }, cancellationToken);

        // Randevu aktifleşti → atanan personelin kullanıcı hesabına bildirim ("randevunuz onaylandı").
        var staffUserId = await _db.StaffMembers.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.Id == appointment.StaffMemberId)
            .Select(s => s.TenantUserId)
            .FirstOrDefaultAsync(cancellationToken);
        if (staffUserId is Guid uid && uid != Guid.Empty)
        {
            var customerName = await CustomerNameAsync(tenantId, appointment.CustomerId, cancellationToken);
            await _notifications.NotifyUserAsync(
                tenantId, appointment.BranchId, uid,
                AppNotificationType.AppointmentUpdated, AppNotificationSeverity.Success,
                "Randevu onaylandı",
                $"{customerName} · {appointment.StartUtc.AddHours(3):dd.MM.yyyy HH:mm}",
                data: new { route = "/appointments", id = appointment.Id.ToString() },
                dedupeKey: $"appt-approve:{appointment.Id}",
                ct: cancellationToken);
        }

        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    public async Task<Result<AppointmentInboxDto>> GetInboxAsync(Guid tenantId, DateTime nowUtc, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        if (nowUtc.Kind != DateTimeKind.Utc) nowUtc = DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc);
        var scoped = ApplyStaffScope(_db.Appointments.AsNoTracking().Where(x => x.TenantId == tenantId), staffTenantUserId);

        // Saati gelmiş ama hâlâ açık (sonuç girilmemiş) randevular — yöneticiye "şimdi karar ver" bildirimi.
        var awaitingOutcome = await scoped
            .Where(x => x.StartUtc <= nowUtc && (x.Status == AppointmentStatus.Scheduled || x.Status == AppointmentStatus.Confirmed))
            .OrderBy(x => x.StartUtc)
            .Take(50)
            .Select(ToInboxDto)
            .ToArrayAsync(cancellationToken);

        // Personelin onaya gönderdiği taslaklar.
        var awaitingApproval = await scoped
            .Where(x => x.Status == AppointmentStatus.Draft)
            .OrderBy(x => x.StartUtc)
            .Take(50)
            .Select(ToInboxDto)
            .ToArrayAsync(cancellationToken);

        return Result<AppointmentInboxDto>.Success(new AppointmentInboxDto(awaitingOutcome, awaitingApproval));
    }

    // Inbox projeksiyonu — isimleri navigation'dan çeker (ListAsync ile aynı şekil).
    private static readonly System.Linq.Expressions.Expression<Func<Appointment, AppointmentDto>> ToInboxDto = x => new AppointmentDto(
        x.Id, x.TenantId, x.BranchId, x.CustomerId, x.StaffMemberId, x.ServiceDefinitionId,
        x.StartUtc, x.EndUtc, x.Status, x.Price, x.Notes, x.CancellationReason,
        x.Customer != null ? x.Customer.FullName : null,
        x.StaffMember != null ? x.StaffMember.FullName : null,
        x.ServiceDefinition != null ? x.ServiceDefinition.Name : null,
        x.CustomerConfirmation,
        x.LastReminderAtUtc,
        x.IsOnline,
        x.Customer != null ? x.Customer.Phone : null,
        x.Customer != null && x.Customer.IsVip,
        x.Number);

    public async Task<Result<AppointmentDto>> ChangeNotesAsync(Guid tenantId, Guid id, ChangeAppointmentNotesRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));
        appointment.ChangeNotes(request.Notes);
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "ChangeNotes", "Appointment", appointment.Id,
            "Randevu notu güncellendi", null, cancellationToken);
        return Result<AppointmentDto>.Success(appointment.ToDto());
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result.Failure(Error.NotFound("Randevu bulunamadı."));

        // TAMAMLANMIŞ RANDEVU SİLİNEMEZ: seans tüketildi, prim/rapor ona dayanıyor. Silmek
        // tüketimi geride bırakıp geçmişi yok ediyordu (ters kayıt da uygulanmıyor).
        // "Yanlış tamamlandı" durumunun doğru yolu durumu geri almaktır.
        if (appointment.Status == AppointmentStatus.Completed)
        {
            return Result.Failure(Error.Conflict(
                "Tamamlanmış randevu silinemez: seans düşüldü ve geçmiş kaydı buna dayanıyor. " +
                "Yanlışlıkla tamamlandıysa önce randevunun durumunu geri alın."));
        }

        var snapshot = new { appointment.StartUtc, appointment.CustomerId, appointment.StaffMemberId };
        appointment.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Delete", "Appointment", appointment.Id,
            $"Randevu silindi ({appointment.StartUtc:dd.MM.yyyy HH:mm})", snapshot, cancellationToken);
        return Result.Success();
    }

    /// <summary>Bir personel aynı saat aralığında en fazla bu kadar aktif randevu alabilir.</summary>
    private const int MaxConcurrentAppointmentsPerStaff = 2;

    private async Task<bool> HasOverlapAsync(Guid tenantId, Guid staffMemberId, DateTime startUtc, DateTime endUtc, Guid? excludingAppointmentId, CancellationToken cancellationToken)
    {
        // Taslak (onay bekleyen) randevular slotu bloke etmez; yalnızca aktif randevular çakışır.
        // Aynı personel aynı slotta en fazla 2 aktif randevu alabilir; 3.'sü engellenir.
        var overlapping = await _db.Appointments.CountAsync(x => x.TenantId == tenantId && x.StaffMemberId == staffMemberId &&
            (!excludingAppointmentId.HasValue || x.Id != excludingAppointmentId.Value) &&
            x.Status != AppointmentStatus.Cancelled && x.Status != AppointmentStatus.NoShow && x.Status != AppointmentStatus.Draft &&
            x.StartUtc < endUtc && startUtc < x.EndUtc, cancellationToken);
        return overlapping >= MaxConcurrentAppointmentsPerStaff;
    }

    private IQueryable<Appointment> ApplyStaffScope(IQueryable<Appointment> query, Guid? staffTenantUserId)
    {
        if (!staffTenantUserId.HasValue) return query;
        var tenantUserId = staffTenantUserId.Value;
        return query.Where(x => _db.StaffMembers.Any(s =>
            s.TenantId == x.TenantId &&
            s.Id == x.StaffMemberId &&
            s.TenantUserId == tenantUserId));
    }

    private Task<bool> IsStaffInScopeAsync(Guid tenantId, Guid staffMemberId, Guid? staffTenantUserId, CancellationToken cancellationToken)
    {
        if (!staffTenantUserId.HasValue) return Task.FromResult(true);
        var tenantUserId = staffTenantUserId.Value;
        return _db.StaffMembers.AnyAsync(x => x.TenantId == tenantId && x.Id == staffMemberId && x.TenantUserId == tenantUserId, cancellationToken);
    }
}
