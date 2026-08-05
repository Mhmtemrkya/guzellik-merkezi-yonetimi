using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain;
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
    private readonly ICustomerAccountService _accounts;

    public AppointmentService(GuzellikDbContext db, IUsageService usage, IAuditLogger audit, IWaitlistService waitlist, IDurableJobQueue jobs, IAppNotificationService notifications, ICurrentUser currentUser, IAdisyonService adisyon, ICustomerAccountService accounts)
    {
        _accounts = accounts;
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

    /// <summary>
    /// Randevu + (varsa) katalog satışı TEK transaction.
    ///
    /// <para>
    /// Ekran eskiden üç ayrı çağrı yapıyordu (adisyon aç → kalem ekle → randevu). Randevu adımı
    /// slot çakışması/yetki/ağ nedeniyle düşerse müşteriye yazılmış AÇIK SATIŞ ortada kalıyor ama
    /// randevu oluşmuyordu. Para bütünlüğü istemcinin çağrı zincirine bırakılamaz.
    /// </para>
    /// <para>
    /// SIRA: önce satış, sonra randevu — ikisi de aynı transaction'da. AdisyonService açık
    /// transaction'ı görünce kendi transaction'ını açmaz, savepoint kullanır; randevu adımı
    /// başarısız olursa commit edilmez ve satış da geri alınır.
    /// </para>
    /// </summary>
    public async Task<Result<AppointmentDto>> CreateWithSaleAsync(Guid tenantId, CreateAppointmentWithSaleRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var sale = request.Sale;
        if (sale is null)
            return await CreateAsync(tenantId, request.Appointment, cancellationToken, staffTenantUserId);

        // YETKİ: bu uç satış verildiğinde ADİSYON AÇAR + KALEM EKLER. Eski üç çağrılı akışta bu iki
        // adım /api/admin/adisyonlar altındaydı ve Accounting.Adisyon iznine tabiydi; atomik uç ise
        // yalnız Appointments izin grubunda. Kontrol olmasaydı sadece randevu açma yetkisi olan
        // personel isteğe "sale" ekleyerek satış başlatabilirdi. Onay kapısında da aynı kural var
        // (StaffApprovalGateMiddleware) — burası servisin kendi kapısı, kapı atlanırsa da geçerli.
        if (_currentUser.Role == UserRole.Staff
            && !Permissions.IsActionAllowed(_currentUser.Permissions, Permissions.AccountingAdisyon))
        {
            return Result<AppointmentDto>.Failure(Error.Forbidden(
                "Randevuyla birlikte satış yapma (adisyon açma) yetkiniz yok. Randevuyu satışsız oluşturabilir ya da kurum yöneticinizden yetki isteyebilirsiniz."));
        }

        if (sale.ServiceDefinitionId is null && sale.ServicePackageId is null)
            return Result<AppointmentDto>.Failure(Error.Validation("Satış için hizmet ya da paket seçilmeli."));
        if (sale.ServiceDefinitionId is not null && sale.ServicePackageId is not null)
            return Result<AppointmentDto>.Failure(Error.Validation("Aynı anda hem hizmet hem paket satılamaz."));

        // KAPSAM KONTROLÜ SATIŞTAN ÖNCE — "yazmadan önce yetkilendir".
        //
        // Sıra eskiden tersiydi: fiş açılıp kalem ekleniyor, randevu kapsamı ancak CreateAsync
        // içinde denetleniyordu. Reddedilen istekte satış geri alınıyordu ama YALNIZCA dıştaki
        // transaction sayesinde; yani yetkisiz bir istek önce yazıyor, sonra rollback'e güveniyordu.
        // Kapsam ihlali artık hiç yazmadan durur (aynı kontrol CreateAsync'te de kalır — orası
        // doğrudan da çağrılan kanonik giriş noktası).
        var appt = request.Appointment;
        if (await ValidateAppointmentScopeAsync(tenantId, PinnedBranchId() ?? appt.BranchId,
                appt.CustomerId, appt.StaffMemberId, appt.ServiceDefinitionId, cancellationToken) is { } scopeError)
        {
            return Result<AppointmentDto>.Failure(scopeError);
        }

        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        var sold = await SellForAppointmentAsync(
            tenantId, request.Appointment.CustomerId, request.Appointment.ServiceDefinitionId, sale, cancellationToken);
        if (sold.IsFailure) return Result<AppointmentDto>.Failure(sold.Error);

        var created = await CreateAsync(tenantId, request.Appointment, cancellationToken, staffTenantUserId);
        // Randevu açılamadıysa COMMIT YOK → satış da geri alınır.
        if (created.IsFailure) return created;

        // SATIŞ ↔ RANDEVU KALICI BAĞI. Tamamlamada tahsilatın hangi satışın carisine yazılacağı
        // buradan bilinir; bağ olmadan hedef satış kalemlerinin HİZMETİYLE tahmin ediliyordu ve
        // müşterinin AYNI hizmet için iki bekleyen satışı varsa daima en eskisi seçiliyordu
        // (ikinci randevu önce tamamlanınca para yanlış satışa yazılırdı). Aynı transaction.
        // Find: kayıt bu istekte oluşturulduğu için izleyicide DURUYOR → ne ek sorgu ne de global
        // şube süzgeci araya girer (süzgeç eşleşmezse bağ sessizce kurulmadan kalırdı).
        var appointment = await _db.Appointments.FindAsync([created.Value!.Id], cancellationToken);
        if (appointment is not null && appointment.TenantId == tenantId)
        {
            appointment.LinkToSaleAdisyon(sold.Value);
            await _db.SaveChangesAsync(cancellationToken);
        }

        if (tx is not null) await tx.CommitAsync(cancellationToken);
        return created;
    }

    /// <summary>
    /// Katalog satışını açar: kendi adisyonu (forceNew) + cariye ŞİMDİ işlenmez
    /// (autoApproveOnFirstAppointment) — randevu tamamlanınca backend otomatik onaylar.
    /// Açılan fişin kimliğini döndürür: randevu ona bağlanır (tahsilat hedefi bu bağla bulunur).
    ///
    /// <para>
    /// SATILAN ŞEY RANDEVUNUN HİZMETİNİ KARŞILAMALI. Satış ile randevu ayrı ayrı doğrulanıyor ama
    /// BİRBİRİYLE eşleştirilmiyordu: istekte "A hizmetini sat + B hizmetine randevu aç" yazılabilir,
    /// randevu B'nin eski hakkından karşılanır ve A satışının fişine bağlanırdı — tamamlamadaki
    /// tahsilat da A'nın carisine giderdi. Hizmet satışında kimlikler AYNI olmalı, paket satışında
    /// paketin İÇERİĞİNDE randevunun hizmeti bulunmalıdır.
    /// </para>
    /// </summary>
    private async Task<Result<Guid>> SellForAppointmentAsync(
        Guid tenantId, Guid customerId, Guid appointmentServiceId, AppointmentCatalogSaleDto sale, CancellationToken ct)
    {
        // ŞUBE KAPSAMI SATIŞ KALEMİNDE DE ZORLANIR: randevunun hizmeti doğrulanırken satılan
        // katalog kaydı atlanırsa, şubeye sabitlenmiş kullanıcı başka şubenin paketini/hizmetini
        // satabilirdi (bkz. IsCatalogItemInBranchScopeAsync).
        if (!await IsCatalogItemInBranchScopeAsync(tenantId, sale.ServiceDefinitionId, sale.ServicePackageId, ct))
            return Result<Guid>.Failure(Error.NotFound("Satılacak katalog kaydı bulunamadı."));

        // SATIŞ PERSONELİ DE KAPSAM İÇİNDE OLMALI — "yazmadan önce yetkilendir".
        //
        // Randevunun personeli ValidateAppointmentScopeAsync'te sabitlenmiş şubeye göre
        // doğrulanıyordu ama SATIŞ KALEMİNİN personeli (sale.staffMemberId) ayrı bir alandır ve
        // yalnız kurum üyeliğine bakılıyordu: Şube A yöneticisi Şube B'nin personelini satış
        // kalemine bağlayıp o personele prim tahakkuk ettirebiliyordu. AdisyonService.AddItemAsync
        // aynı kuralı kanonik kapı olarak uygular (o da doğrudan çağrılıyor); burada ERKEN durur
        // ki reddedilen istek fiş açmaya hiç başlamasın.
        if (sale.StaffMemberId is { } saleStaffId && saleStaffId != Guid.Empty
            && PinnedBranchId() is { } pinnedBranch
            && !await _db.StaffMembers.AsNoTracking().IgnoreQueryFilters()
                .AnyAsync(s => s.TenantId == tenantId && s.Id == saleStaffId && !s.IsDeleted
                            && s.BranchId == pinnedBranch, ct))
        {
            return Result<Guid>.Failure(Error.Validation("Seçilen satış personeli bu şubeye ait değil."));
        }

        // Katalog kaydı ve fiyatı SUNUCUDAN okunur: istemcinin gönderdiği fiyata güvenilmez.
        string description;
        decimal unitPrice;
        AdisyonItemType itemType;
        Guid refId;

        if (sale.ServicePackageId is { } packageId)
        {
            var pkg = await _db.ServicePackages.AsNoTracking()
                .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == packageId, ct);
            if (pkg is null) return Result<Guid>.Failure(Error.NotFound("Paket bulunamadı."));
            // Paket randevunun hizmetini KAPSAMALI; kapsamıyorsa randevu bu satıştan karşılanamaz.
            if (!await _db.ServicePackageItems.AsNoTracking()
                    .AnyAsync(pi => pi.ServicePackageId == pkg.Id && pi.ServiceDefinitionId == appointmentServiceId, ct))
            {
                return Result<Guid>.Failure(Error.Validation(
                    "Seçilen paket bu randevunun hizmetini içermiyor. Randevunun hizmetini kapsayan bir paket seçin."));
            }
            itemType = AdisyonItemType.PackageSale;
            refId = pkg.Id;
            description = $"Paket satışı: {pkg.Name}";
            unitPrice = pkg.TotalPrice;
        }
        else
        {
            var svc = await _db.ServiceDefinitions.AsNoTracking()
                .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == sale.ServiceDefinitionId!.Value, ct);
            if (svc is null) return Result<Guid>.Failure(Error.NotFound("Hizmet bulunamadı."));
            // Satılan hizmet randevunun hizmetiyle AYNI olmalı (bkz. metot notu).
            if (svc.Id != appointmentServiceId)
            {
                return Result<Guid>.Failure(Error.Validation(
                    "Satılan hizmet randevunun hizmetinden farklı. Randevu hangi hizmet içinse o satılmalı."));
            }
            itemType = AdisyonItemType.Service;
            refId = svc.Id;
            description = svc.Name;
            unitPrice = svc.Price;
        }

        var adisyon = await _adisyon.CreateAsync(tenantId,
            new CreateAdisyonRequest(null, customerId, null, null, ForceNew: true, AutoApproveOnFirstAppointment: true), ct);
        if (adisyon.IsFailure) return Result<Guid>.Failure(adisyon.Error);

        var item = await _adisyon.AddItemAsync(tenantId, adisyon.Value!.Id,
            new AddAdisyonItemRequest(itemType, refId, description, 1, unitPrice, sale.StaffMemberId, false), ct);
        return item.IsFailure
            ? Result<Guid>.Failure(item.Error)
            : Result<Guid>.Success(adisyon.Value!.Id);
    }

    public async Task<Result<AppointmentDto>> CreateAsync(Guid tenantId, CreateAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var limit = await _usage.CheckLimitAsync(tenantId, "appointments", cancellationToken);
        if (limit.IsFailure) return Result<AppointmentDto>.Failure(limit.Error);

        // ŞUBE KAPSAMI GÖVDEDEN GELMEZ (bkz. PinnedBranchId). Sabitlenmiş rolde istemcinin
        // gönderdiği şube yok sayılır; farklıysa iz bırakılır (arayüz bunu üretmez).
        if (PinnedBranchId() is { } pinned && pinned != request.BranchId)
        {
            await _audit.LogAsync(tenantId, pinned, "BranchScopeOverride", "Appointment", null,
                "Randevu isteğinde başka şube gönderildi; kullanıcının kendi şubesine sabitlendi.",
                new { RequestedBranchId = request.BranchId, EffectiveBranchId = pinned, _currentUser.Role }, cancellationToken);
            request = request with { BranchId = pinned };
        }

        // KURUM BÜTÜNLÜĞÜ ÖNCE: müşteri/şube/personel/hizmet bu kuruma ait olmalı (bkz. metot notu).
        if (await ValidateAppointmentScopeAsync(tenantId, request.BranchId, request.CustomerId,
                request.StaffMemberId, request.ServiceDefinitionId, cancellationToken) is { } scopeError)
        {
            return Result<AppointmentDto>.Failure(scopeError);
        }

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
            // Kilit sırası (RowLock.TableOrder): tenants → customers → … → staff_members.
            // KURUM satırı randevu NUMARASINI serileştirir (bkz. AppointmentNumbering): iki farklı
            // personele giden eşzamanlı istek aynı MAX(Number)+1'i hesaplayabiliyordu. Sıra bozulmasın
            // diye numara okuması aşağıda olsa da kilit burada, en başta alınır.
            // MÜŞTERİ kilidi seans REZERVASYONUNU serileştirir: yalnız personel kilitlenirse,
            // aynı müşterinin tek kalan seansı için FARKLI personellere açılan iki eşzamanlı
            // istek ayrı kilitler alıp ikisi de rezervasyonu boş görebiliyordu.
            await RowLock.LockRowAsync(_db, "tenants", tenantId, cancellationToken);
            await RowLock.LockRowAsync(_db, "customers", request.CustomerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "staff_members", request.StaffMemberId, cancellationToken);
        }

        var overlap = await HasOverlapAsync(tenantId, request.StaffMemberId, request.StartUtc, request.EndUtc, null, cancellationToken);
        // SlotFull kodu: frontend bunu "bekleme listesine ekle?" uyarısı için ayırt eder (kara liste 409'undan farklı).
        if (overlap) return Result<AppointmentDto>.Failure(Error.SlotFull("Bu saatte personelin uygun yeri yok. Bekleme listesine ekleyebilirsiniz."));

        var appointment = new Appointment(tenantId, request.BranchId, request.CustomerId, request.StaffMemberId, request.ServiceDefinitionId, request.StartUtc, request.EndUtc, request.Price, request.Notes);

        // Kurum içi sıralı randevu numarası (#RNDV-…): mevcut en büyük + 1 (kurum satırı yukarıda
        // kilitlendi). Global süzgeç ATLANIR: başka şubenin (ya da silinmiş) bir kaydı numarayı
        // zaten kullanıyor olabilir; süzülmüş MAX ondan haberdar olmadığı için çakışma üretiyordu.
        appointment.AssignNumber(await AppointmentNumbering.NextNumberAsync(_db, tenantId, cancellationToken));

        // KAYNAK SEANS BAĞI: randevu ücretsizse (paketten karşılanıyorsa) hangi seanstan geldiği
        // ŞİMDİ işaretlenir. Satış iptali eskiden bunu tahmin ediyordu (aynı müşteri + aynı hizmet,
        // kalan seans kadarını koru) ve müşterinin aynı hizmeti içeren ikinci bir paketi varsa yanlış
        // randevuyu kapatabiliyordu. Rezervasyon DEĞİLDİR — seans yalnız tamamlamada düşer; bağ
        // tamamlamada gerçekten tüketilen seansla düzeltilir.
        if (request.Price <= 0m)
        {
            // İSTEMCİNİN SEÇTİĞİ SEANS ÖNCELİKLİ. Arayüz paket kırılımında belirli bir satır
            // seçtiriyor; seçim sunucuya taşınmazsa aynı hizmete ait EN ESKİ seans tüketilir ve
            // kullanıcı B paketini seçse bile A paketinden düşerdi. Seçim GEÇERSİZSE (başka
            // müşteri/hizmet, bakiyesi bitmiş ya da açık randevulara ayrılmış) sessizce başka bir
            // seansa kaymak yerine hata verilir — kullanıcı neyi seçtiğini bilmeli.
            Guid? sourceSessionId;
            if (request.SourceCustomerPackageSessionId is { } requestedSession && requestedSession != Guid.Empty)
            {
                if (!await IsSessionBookableAsync(
                        tenantId, request.CustomerId, request.ServiceDefinitionId, requestedSession, null, cancellationToken))
                {
                    return Result<AppointmentDto>.Failure(Error.Validation(
                        "Seçilen paketin bu hizmet için kullanılabilir seansı kalmadı. Kalan seanslar açık " +
                        "randevulara ayrılmış olabilir; listeden başka bir paket/seans seçin."));
                }
                sourceSessionId = requestedSession;
            }
            else
            {
                sourceSessionId = await FindBookableSessionAsync(
                    tenantId, request.CustomerId, request.ServiceDefinitionId, null, cancellationToken);
            }
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
        // Numara çakışırsa (benzersiz indeks reddeder) yeniden hesapla ve dene — kurum kilidi
        // olmayan yollarla (ör. eski kayıt aktarımı) yarışa karşı güvenlik ağı. Numarayla İLGİSİZ
        // kalıcılık hataları yutulmaz (bkz. AppointmentNumbering).
        await AppointmentNumbering.SaveWithNumberRetryAsync(_db, tenantId, appointment, cancellationToken);
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
    /// <summary>
    /// İstemcinin SEÇTİĞİ seans gerçekten kullanılabilir mi? Sahiplik (tenant + müşteri + hizmet),
    /// kalan bakiye ve açık randevu rezervasyonu birlikte doğrulanır — <see cref="FindBookableSessionAsync"/>
    /// ile aynı cardinality kuralı.
    /// </summary>
    private async Task<bool> IsSessionBookableAsync(
        Guid tenantId, Guid customerId, Guid serviceDefinitionId, Guid sessionId,
        Guid? excludeAppointmentId, CancellationToken cancellationToken)
    {
        var session = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId
                     && s.Id == sessionId
                     && s.CustomerId == customerId
                     && s.ServiceDefinitionId == serviceDefinitionId)
            .Select(s => new { Remaining = s.TotalSessions - s.UsedSessions })
            .FirstOrDefaultAsync(cancellationToken);
        if (session is null || session.Remaining <= 0) return false;

        var held = await _db.Appointments.AsNoTracking()
            .CountAsync(a => a.TenantId == tenantId
                          && a.CustomerId == customerId
                          && a.SourceCustomerPackageSessionId == sessionId
                          && (excludeAppointmentId == null || a.Id != excludeAppointmentId)
                          && OpenAppointmentStatuses.Contains(a.Status), cancellationToken);
        return session.Remaining > held;
    }

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

    /// <summary>
    /// Verilen bekleyen satışlardan HANGİSİ bu hizmete aittir? (tahsilat hedefini seçmek için)
    ///
    /// <para>
    /// Tekil hizmet satışı doğrudan hizmete işaret eder; paket satışı ise paketin içeriğinde bu
    /// hizmet varsa eşleşir. Birden çok aday çıkarsa listedeki İLK (en eski) satış seçilir —
    /// pendingSaleIds zaten <c>OpenedAtUtc</c> sırasındadır. Eşleşme yoksa null döner ve çağıran
    /// HİÇBİR satışı onaylamaz (bkz. ChangeStatusInternalAsync): kanıtlanamayan bir eşleşmede
    /// rastgele fiş işlemek yanlış cariye borç, yanlış personele prim ve karşılıksız stok düşümü üretir.
    /// </para>
    /// </summary>
    private async Task<Guid?> FindSaleForServiceAsync(
        Guid tenantId, List<Guid> pendingSaleIds, Guid serviceDefinitionId, CancellationToken cancellationToken)
    {
        if (pendingSaleIds.Count <= 1) return pendingSaleIds.Count == 1 ? pendingSaleIds[0] : null;

        // (Guid listesiyle .Contains() MySQL'de çevrilemiyor → müşterinin fişleri değil, doğrudan
        // bu adisyonların kalemleri okunur ve eşleştirme BELLEKTE yapılır.)
        var items = await (
            from i in _db.AdisyonItems.AsNoTracking()
            join a in _db.Adisyonlar.AsNoTracking() on i.AdisyonId equals a.Id
            where a.TenantId == tenantId
                && a.Status == AdisyonStatus.Open
                && a.AutoApproveOnFirstAppointment
                && (i.Type == AdisyonItemType.Service || i.Type == AdisyonItemType.PackageSale)
            select new { i.AdisyonId, i.Type, i.RefId }).ToListAsync(cancellationToken);

        var scoped = items.Where(x => pendingSaleIds.Contains(x.AdisyonId)).ToList();
        if (scoped.Count == 0) return null;

        // 1) Tekil hizmet satışı — en güçlü eşleşme.
        foreach (var saleId in pendingSaleIds)
        {
            if (scoped.Any(x => x.AdisyonId == saleId
                             && x.Type == AdisyonItemType.Service
                             && x.RefId == serviceDefinitionId))
                return saleId;
        }

        // 2) Paket satışı — paketin içeriğinde bu hizmet var mı?
        var packageIds = scoped
            .Where(x => x.Type == AdisyonItemType.PackageSale && x.RefId.HasValue)
            .Select(x => x.RefId!.Value)
            .ToHashSet();
        if (packageIds.Count == 0) return null;

        var packagesWithService = (await _db.ServicePackageItems.AsNoTracking()
                .Where(pi => pi.ServiceDefinitionId == serviceDefinitionId)
                .Select(pi => pi.ServicePackageId)
                .ToListAsync(cancellationToken))
            .Where(packageIds.Contains)
            .ToHashSet();
        if (packagesWithService.Count == 0) return null;

        foreach (var saleId in pendingSaleIds)
        {
            if (scoped.Any(x => x.AdisyonId == saleId
                             && x.Type == AdisyonItemType.PackageSale
                             && x.RefId.HasValue
                             && packagesWithService.Contains(x.RefId.Value)))
                return saleId;
        }
        return null;
    }

    public Task<bool> IsSessionStillBookableAsync(
        Guid tenantId, Guid customerId, Guid serviceDefinitionId, Guid sessionId, CancellationToken cancellationToken = default)
        => sessionId == Guid.Empty
            ? Task.FromResult(false)
            : IsSessionBookableAsync(tenantId, customerId, serviceDefinitionId, sessionId, null, cancellationToken);

    public async Task<bool> HasServiceEntitlementAsync(
        Guid tenantId, Guid customerId, Guid serviceDefinitionId, CancellationToken cancellationToken = default)
        => await FindBookableSessionAsync(tenantId, customerId, serviceDefinitionId, null, cancellationToken) is not null
           || await HasPendingSaleForServiceAsync(tenantId, customerId, serviceDefinitionId, cancellationToken);

    private async Task<bool> HasApprovedSaleAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken)
    {
        var hasPackage = await _db.CustomerPackageSessions.AsNoTracking()
            .AnyAsync(s => s.TenantId == tenantId && s.CustomerId == customerId, cancellationToken);
        if (hasPackage) return true;

        // ÖNKOŞUL "PAKET/HİZMET SATIŞI"DIR: Product ve Extra kalemleri de sayılıyordu, yani
        // yalnız şampuan alan ya da fişine "ek kalem" yazılan müşteri hizmet almış sayılıyordu.
        // Kuralın adı ile davranışı ayrışıyordu.
        return await (
            from a in _db.Adisyonlar.AsNoTracking()
            join i in _db.AdisyonItems.AsNoTracking() on a.Id equals i.AdisyonId
            where a.TenantId == tenantId
                && a.CustomerId == customerId
                && (a.Status == AdisyonStatus.Approved
                    || (a.Status == AdisyonStatus.Open && a.AutoApproveOnFirstAppointment))
                && (i.Type == AdisyonItemType.Service || i.Type == AdisyonItemType.PackageSale)
            select a.Id).AnyAsync(cancellationToken);
    }

    public async Task<Result<AppointmentDto>> RescheduleAsync(Guid tenantId, Guid id, RescheduleAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null, bool returnToApproval = false)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));

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
            // KİLİT ALTINDA TAZE OKUMA (bkz. ChangeStatusAsync). Kilitten önceki okuma bayat
            // olabilir: araya giren bir tamamlama commit ettiyse, bu akış eski durumu yazıp
            // "Tamamlandı"yı eziyordu — üstelik Reschedule/ReturnToApproval korumaları da bayat
            // duruma baktığı için hiç devreye girmiyordu.
            await _db.Entry(appointment).ReloadAsync(cancellationToken);
            if (_db.Entry(appointment).State == EntityState.Detached)
                return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));
        }

        // Taze durum üzerinden karar: tamamlanmış/iptal edilmiş randevu taşınamaz.
        if (appointment.Status is AppointmentStatus.Completed or AppointmentStatus.Cancelled or AppointmentStatus.NoShow)
            return Result<AppointmentDto>.Failure(Error.Validation("Bu randevu artık taşınamaz."));

        // HEDEF PERSONEL KİLİTTEN SONRA HESAPLANIR. Eskiden bayat okumadan türetiliyordu: istek
        // yalnız saat taşıyorsa (StaffMemberId yok) hedef, randevunun O ANKİ personeliydi; araya
        // giren bir personel aktarımı commit ettiyse mesai + kapasite kontrolleri ESKİ personele
        // uygulanıyor, üstelik staff_members kilidi de yanlış satıra alınıyordu.
        var targetStaff = request.StaffMemberId ?? appointment.StaffMemberId;
        var staffChanged = request.StaffMemberId.HasValue && request.StaffMemberId.Value != appointment.StaffMemberId;
        if (staffChanged)
        {
            // KURUM + ŞUBE BÜTÜNLÜĞÜ: personel aktarımı başka kurumun personeline yapılamaz
            // (yönetici çağrısında kapsam kontrolü kaydı hiç sorgulamadan true döner) ve şubeye
            // SABİTLENMİŞ kullanıcı randevuyu başka şubenin personeline aktaramaz — oluşturmada
            // kapatılan açık taşımada açık kalırdı (bkz. ValidateAppointmentScopeAsync).
            var pinnedBranch = PinnedBranchId();
            if (!await _db.StaffMembers.AsNoTracking().IgnoreQueryFilters()
                    .AnyAsync(s => s.TenantId == tenantId && s.Id == targetStaff && !s.IsDeleted
                                && (pinnedBranch == null || s.BranchId == pinnedBranch), cancellationToken))
            {
                return Result<AppointmentDto>.Failure(Error.NotFound("Personel bulunamadı."));
            }
            if (!await IsStaffInScopeAsync(tenantId, targetStaff, staffTenantUserId, cancellationToken))
            {
                return Result<AppointmentDto>.Failure(Error.NotFound("Hedef personel kapsamı bulunamadı."));
            }
        }
        // Kilit protokolünün son halkası: hedef personel artık kesin olarak biliniyor.
        if (_db.Database.IsRelational())
            await RowLock.LockRowAsync(_db, "staff_members", targetStaff, cancellationToken);

        // Kapalı gün/saat + mesai penceresi: randevu OLUŞTURMADA olduğu gibi TAŞIMADA da geçerli;
        // aksi hâlde sürükle-bırak "Gün Kapat" ile kapatılmış bir saate randevu sokabiliyordu.
        var hoursBlock = await WorkingHoursGuard.BlockReasonAsync(_db, tenantId, targetStaff, request.StartUtc, request.EndUtc, cancellationToken);
        if (hoursBlock is not null) return Result<AppointmentDto>.Failure(Error.Validation(hoursBlock));

        var overlap = await HasOverlapAsync(tenantId, targetStaff, request.StartUtc, request.EndUtc, appointment.Id, cancellationToken);
        if (overlap) return Result<AppointmentDto>.Failure(Error.Conflict("Personelin bu saat aralığında en fazla 2 randevusu olabilir."));

        var prevStart = appointment.StartUtc;
        var prevStaff = appointment.StaffMemberId;
        if (staffChanged) appointment.ReassignStaff(targetStaff);
        appointment.Reschedule(request.StartUtc, request.EndUtc);
        if (returnToApproval) appointment.ReturnToApproval();
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

        // SIRA BİLİNÇLİ: not ÖNCE, durum EN SON. Durum geçişi yan etkilerin en ağırıdır (seans
        // tüketimi, kuyruk işi, bildirim) ve bildirimler AYRI bir DbContext'ten yazıldığı için
        // ana transaction geri alınsa bile silinmez. Durum en sonda olunca, sonrasında geri
        // alınabilecek bir adım kalmaz → "işlem iptal oldu ama bildirim gitti" durumu oluşmaz.
        if (request.NotesProvided)
        {
            last = await ChangeNotesAsync(tenantId, id,
                new ChangeAppointmentNotesRequest(request.Notes), cancellationToken, staffTenantUserId);
            if (last.IsFailure) return last;
        }

        if (request.Status is { } status)
        {
            last = await ChangeStatusAsync(tenantId, id,
                new ChangeAppointmentStatusRequest(status, request.StatusReason), cancellationToken, staffTenantUserId);
            if (last.IsFailure) return last;
        }

        if (tx is not null) await tx.CommitAsync(cancellationToken);

        // Hiçbir alan gönderilmediyse mevcut hâli döndür (istemci "değişiklik yok" ile gelebilir).
        return last ?? await GetAsync(tenantId, id, cancellationToken, staffTenantUserId);
    }

    /// <summary>
    /// Tamamlama + tahsilat TEK transaction. İki ayrı HTTP çağrısı yapıldığında ikincisi düşerse
    /// "randevu tamamlandı, para alınmadı" durumu kalıcı oluyordu; idempotency anahtarı tekrarı
    /// güvenli kılar ama atomikliği sağlamaz. Alt servisler açık transaction'ı görünce kendi
    /// transaction'larını açmaz (AdisyonService savepoint kullanır), böylece hata tümünü geri alır.
    /// </summary>
    public async Task<Result<AppointmentDto>> CompleteWithPaymentAsync(Guid tenantId, Guid id, CompleteAppointmentRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var payment = request.Payment;
        if (payment is not null && payment.Amount <= 0)
            return Result<AppointmentDto>.Failure(Error.Validation("Tahsilat tutarı 0'dan büyük olmalı."));

        // YETKİ: bu uç durum değişikliği + TAHSİLAT yapar. Onay kapısında /status ile aynı sınıfta
        // muaf tutulduğu için, ödeme içeren istek Accounting.Collect iznini ayrıca ister — aksi
        // hâlde tahsilat yetkisi olmayan personel isteğe payment ekleyip cariye/adisyona para
        // yazabilirdi (kapıyı da atlayarak).
        if (payment is not null && _currentUser.Role == UserRole.Staff
            && !Permissions.IsActionAllowed(_currentUser.Permissions, Permissions.AccountingCollect))
        {
            return Result<AppointmentDto>.Failure(Error.Forbidden(
                "Tahsilat kaydı alma yetkiniz yok. Randevuyu ödemesiz tamamlayabilir ya da kurum yöneticinizden yetki isteyebilirsiniz."));
        }

        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        // Kilit protokolü (customers → appointments) EN BAŞTA: alt çağrılar kendi kilitlerini
        // aldığında sıra çağrı sırasına bağlı kalıp deadlock üretiyordu (bkz. UpdateAsync).
        var head = await _db.Appointments.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.Id == id)
            .Select(a => new { a.CustomerId })
            .FirstOrDefaultAsync(cancellationToken);
        if (head is null) return Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı."));
        var customerId = head.CustomerId;
        if (relational)
        {
            await RowLock.LockRowAsync(_db, "customers", customerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "appointments", id, cancellationToken);
        }

        // ÇİFT TAHSİLAT KORUMASI: ChangeStatusAsync zaten Completed olan randevuda başarılı NO-OP
        // döner. Bu dönüşü "tamamladım" sanıp tahsilatı yine işlersek, aynı randevu ikinci kez
        // /complete'e gönderildiğinde (farklı idempotency anahtarı ya da kayıt düşmüşse) İKİNCİ
        // BİR TAHSİLAT yazılırdı. Kilit altında taze okunan durum zaten Completed ise hiçbir şey
        // yapmadan başarıyla döneriz — uç idempotent olur.
        var alreadyCompleted = await _db.Appointments.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.Id == id)
            .Select(a => a.Status)
            .FirstOrDefaultAsync(cancellationToken) == AppointmentStatus.Completed;
        if (alreadyCompleted)
        {
            if (tx is not null) await tx.CommitAsync(cancellationToken);
            return await GetAsync(tenantId, id, cancellationToken, staffTenantUserId);
        }

        // İstemcinin verdiği cari, HİÇBİR ŞEY DEĞİŞMEDEN önce doğrulanır (fail-fast): hatayı
        // tahsilat adımına bırakırsak randevu önce tamamlanır, sonra geri alınır — doğru sonucu
        // yalnız transaction'a borçlu oluruz. Kontrol burada olunca yanlış cari asla iş başlatmaz.
        if (payment?.AccountId is { } requestedAccount)
        {
            var owns = await _db.CustomerAccounts.AsNoTracking()
                .AnyAsync(a => a.Id == requestedAccount
                            && a.TenantId == tenantId
                            && a.CustomerId == customerId
                            && a.CancelledAtUtc == null, cancellationToken);
            if (!owns)
                return Result<AppointmentDto>.Failure(Error.Validation("Seçilen cari hesap bu randevunun müşterisine ait değil ya da iptal edilmiş."));
        }

        // Yan etkiler (denetim kaydı, bildirim, kuyruk) ERTELENİR: ChangeStatusAsync onları
        // normalde kendi commit'inden sonra çalıştırır, ama burada dış transaction henüz açık.
        // Tahsilat sonradan reddedilirse veri geri alınır — "randevu tamamlandı" denetim izi ve
        // kullanıcı bildirimi ise geri alınamazdı; gerçekle çelişen iz kalırdı.
        var outcome = await ChangeStatusInternalAsync(tenantId, id,
            new ChangeAppointmentStatusRequest(AppointmentStatus.Completed, request.Reason),
            cancellationToken, staffTenantUserId, deferSideEffects: true);
        if (outcome.Result.IsFailure) return outcome.Result;

        if (payment is not null)
        {
            var collected = await CollectOnCompleteAsync(
                tenantId, customerId, payment, outcome.AutoApprovedAccountId, cancellationToken);
            // Tahsilat başarısızsa TAMAMLAMA DA geri alınır: transaction commit edilmez ve
            // ertelenen yan etkiler HİÇ çalışmaz.
            if (collected.IsFailure) return Result<AppointmentDto>.Failure(collected.Error);
        }

        if (tx is not null) await tx.CommitAsync(cancellationToken);

        // COMMIT SONRASI: artık her şey kalıcı; yan etkiler gerçeği anlatır.
        if (outcome.RunDeferredSideEffects is not null) await outcome.RunDeferredSideEffects();
        return outcome.Result;
    }

    /// <summary>
    /// Tahsilatı doğru deftere yazar: açık cari varsa oraya (vade sırasına dağıtılır), yoksa
    /// müşterinin adisyonu üzerinden. Arayüzdeki hedef-seçme mantığı sunucuya taşındı ki
    /// çok adımlı akış tek transaction'da kalabilsin.
    /// <para>
    /// HEDEF SIRASI: (1) istemcinin seçtiği cari, (2) bu tamamlamada otomatik onaylanan SATIŞIN
    /// carisi, (3) borcu olan en eski cari, (4) adisyon defteri. (2) olmasaydı, randevu modalinden
    /// satılan hizmetin parası müşterinin aylar önceki başka bir satışına yazılıyor, yeni satış
    /// ödenmemiş görünüyordu — ekranda önerilen tutar da o satışın kalanıydı.
    /// </para>
    /// </summary>
    private async Task<Result> CollectOnCompleteAsync(
        Guid tenantId, Guid customerId, CompleteAppointmentPaymentDto payment, Guid? preferredAccountId, CancellationToken ct)
    {
        var occurredAt = payment.OccurredAtUtc ?? DateTime.UtcNow;
        var reference = string.IsNullOrWhiteSpace(payment.Reference) ? "Randevu tahsilatı" : payment.Reference;

        var accountId = payment.AccountId;
        if (accountId is { } requested)
        {
            // İSTEMCİNİN VERDİĞİ CARİ RANDEVUNUN MÜŞTERİSİNE BAĞLANIR. Doğrulanmazsa A müşterisinin
            // randevu tahsilatı B müşterisinin carisine yazılabilirdi (tenant kontrolü tek başına
            // yetmez — kurum içindeki her cari hedef olabilirdi). İptal edilmiş cariye de tahsilat
            // alınamaz. Kontrol kilit altında yapılır: müşteri satırı çağıran tarafından kilitli.
            var owns = await _db.CustomerAccounts.AsNoTracking()
                .AnyAsync(a => a.Id == requested
                            && a.TenantId == tenantId
                            && a.CustomerId == customerId
                            && a.CancelledAtUtc == null, ct);
            if (!owns)
                return Result.Failure(Error.Validation("Seçilen cari hesap bu randevunun müşterisine ait değil ya da iptal edilmiş."));
        }
        else
        {
            // Borcu olan en eski cari (RemainingAmount hesaplanan alan → ödemelerle birlikte yüklenir).
            var accounts = await _db.CustomerAccounts
                .Include(a => a.Payments)
                .Where(a => a.TenantId == tenantId && a.CustomerId == customerId && a.CancelledAtUtc == null)
                .OrderBy(a => a.CreatedAtUtc)
                .ToListAsync(ct);
            // Bu randevuyla birlikte işlenen satışın carisi öncelikli — parayı kendi satışına yaz.
            var preferred = preferredAccountId is { } pid
                ? accounts.FirstOrDefault(a => a.Id == pid && a.RemainingAmount > 0)
                : null;
            accountId = (preferred ?? accounts.FirstOrDefault(a => a.RemainingAmount > 0))?.Id;
        }

        if (accountId is { } target)
        {
            var paid = await _accounts.RegisterPaymentAsync(tenantId, target,
                new RegisterAccountPaymentRequest(payment.Amount, payment.Method, reference, occurredAt), ct);
            return paid.IsFailure ? Result.Failure(paid.Error) : Result.Success();
        }

        // Cari yok → adisyon defteri. Açık fiş varsa ona eklenir, yoksa yeni açılır.
        var open = await _adisyon.GetOpenForCustomerAsync(tenantId, customerId, ct);
        if (open.IsFailure) return Result.Failure(open.Error);

        var adisyonId = open.Value?.Id;
        if (adisyonId is null)
        {
            var created = await _adisyon.CreateAsync(tenantId,
                new CreateAdisyonRequest(null, customerId, null, "Randevu tahsilatı"), ct);
            if (created.IsFailure) return Result.Failure(created.Error);
            adisyonId = created.Value!.Id;
        }

        var item = await _adisyon.AddItemAsync(tenantId, adisyonId.Value,
            new AddAdisyonItemRequest(AdisyonItemType.Payment, null, reference, 1, payment.Amount, null, false, payment.Method), ct);
        if (item.IsFailure) return Result.Failure(item.Error);

        var approved = await _adisyon.ApproveAsync(tenantId, adisyonId.Value, ct);
        return approved.IsFailure ? Result.Failure(approved.Error) : Result.Success();
    }

    public async Task<Result<AppointmentDto>> ChangeStatusAsync(Guid tenantId, Guid id, ChangeAppointmentStatusRequest request, CancellationToken cancellationToken = default, Guid? staffTenantUserId = null)
    {
        var outcome = await ChangeStatusInternalAsync(tenantId, id, request, cancellationToken, staffTenantUserId, deferSideEffects: false);
        return outcome.Result;
    }

    /// <summary>
    /// Durum değişikliğinin sonucu + (ertelendiyse) commit sonrası çalıştırılacak yan işler.
    /// <para>
    /// <paramref name="AutoApprovedAccountId"/>: tamamlama sırasında "ilk randevuda işle" bekleyen
    /// satış otomatik onaylandıysa O SATIŞIN cari hesabı. Tahsilat hedefi bundan seçilir — aksi
    /// hâlde para, müşterinin borcu olan EN ESKİ carisine (bambaşka bir satışa) yazılıyordu.
    /// </para>
    /// </summary>
    private readonly record struct StatusChangeOutcome(
        Result<AppointmentDto> Result,
        Func<Task>? RunDeferredSideEffects,
        Guid? AutoApprovedAccountId = null);

    /// <summary>
    /// <see cref="ChangeStatusAsync"/>'in gövdesi.
    /// </summary>
    /// <param name="deferSideEffects">
    /// true → denetim kaydı/bildirim/kuyruk işleri BURADA çalıştırılmaz, çağırana döndürülür.
    /// Dış bir transaction'ın parçasıysak (tamamlama + tahsilat) bunlar ancak HEPSİ commit
    /// edildikten sonra çalışmalıdır: aksi hâlde işlem geri alınsa bile "tamamlandı" izi kalırdı.
    /// </param>
    private async Task<StatusChangeOutcome> ChangeStatusInternalAsync(Guid tenantId, Guid id, ChangeAppointmentStatusRequest request, CancellationToken cancellationToken, Guid? staffTenantUserId, bool deferSideEffects)
    {
        var appointment = await ApplyStaffScope(_db.Appointments, staffTenantUserId).FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (appointment is null) return new StatusChangeOutcome(Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı.")), null);

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
                return new StatusChangeOutcome(Result<AppointmentDto>.Failure(Error.NotFound("Randevu bulunamadı.")), null);
        }

        // Zaten istenen durumdaysa no-op — bayat/tekrar onay isteği "tamamlanamaz" hatası vermesin
        // (idempotent). Kilitten sonra bakıldığı için eşzamanlı ikinci istek BURADA durur.
        // NOT: no-op'ta yan iş YOKTUR; çağıran "geçiş oldu" sanıp tahsilat işlememelidir
        // (bkz. CompleteWithPaymentAsync'teki alreadyCompleted kontrolü).
        if (appointment.Status == request.Status)
            return new StatusChangeOutcome(Result<AppointmentDto>.Success(appointment.ToDto()), null);

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
        // Bu tamamlamada otomatik onaylanan satışın cari hesabı — tahsilat oraya yazılsın diye taşınır.
        Guid? autoApprovedAccountId = null;

        // Randevu Tamamlandı'ya geçtiyse, müşterinin bu hizmete ait paket seansından otomatik düş.
        // Complete() yalnızca Scheduled/Confirmed'dan çağrılabildiği için bu blok randevu başına tek kez çalışır.
        if (isCompleting)
        {
            // Sıra: customers → appointments → (otomatik onay: adisyonlar → products → gift_cards
            // → sessions) → sessions. Müşteri ve randevu kilitleri yukarıda, durum geçişinden
            // ÖNCE alındı; burada tekrar alınmaz.
            // Faz 2: Bu randevunun DOĞDUĞU satış "ilk randevu tamamlanınca işle" bayrağıyla açık
            // beklerse şimdi otomatik onaylanır → satış cariye borç, peşinat kasaya gelir, satılan
            // seanslar o an oluşur. Onay seansları yaratır → hemen aşağıdaki seans düşümü onları bulur.
            // best-effort: satış onaylanamazsa (ör. stok/guard) randevu tamamlanmayı engelleme, denetime yaz.
            var pendingSaleIds = await _db.Adisyonlar.AsNoTracking()
                .Where(a => a.TenantId == tenantId
                         && a.CustomerId == appointment.CustomerId
                         && a.Status == AdisyonStatus.Open
                         && a.AutoApproveOnFirstAppointment)
                .OrderBy(a => a.OpenedAtUtc)
                .Select(a => a.Id)
                .ToListAsync(cancellationToken);

            // YALNIZ BU RANDEVUNUN SATIŞI ONAYLANIR — müşterinin bekleyen TÜM satışları değil.
            //
            // Eskiden buradaki döngü müşterinin bekleyen her fişini onaylıyordu: A ve B satışları
            // (her biri kendi randevusuyla) açıkken A randevusu tamamlandığında B de cariye borç
            // yazılıyor, B'nin seansları/stok düşümü/personel primi HENÜZ GERÇEKLEŞMEMİŞ bir hizmet
            // için oluşuyordu. Müşteri B'ye hiç gelmezse borç ve prim ortada kalıyordu. Tahsilat
            // hedefi ayrıca doğru fişe yazılsa bile yan etkiler geri alınmıyordu.
            //
            // 1) KALICI BAĞ önce gelir ve BAĞLAYICIDIR: randevu satışla birlikte açıldıysa
            //    (randevu+satış atomik ucu, bekleme listesi dönüşümü) hangi fişten doğduğu KESİN
            //    bilinir. Bağlı fiş artık bekleyenler arasında değilse (zaten onaylanmış, iptal
            //    olmuş) BAŞKA fişe geçilmez — bu randevunun karşılığı çoktan işlenmiştir.
            // 2) Bağsız kayıtlarda (eski randevular, ayrı akışlar) hizmet eşleştirmesine düşülür;
            //    tek bekleyen fiş varsa o seçilir. Eşleşme kurulamazsa HİÇBİR fiş onaylanmaz:
            //    rastgele bir satışı işlemektense iz bırakıp insana bırakmak doğrudur.
            var matchingSaleId = appointment.SourceAdisyonId is { } linkedSaleId
                ? (pendingSaleIds.Contains(linkedSaleId) ? linkedSaleId : null)
                : await FindSaleForServiceAsync(
                    tenantId, pendingSaleIds, appointment.ServiceDefinitionId, cancellationToken);

            if (matchingSaleId is { } targetSaleId)
            {
                var approved = await _adisyon.ApproveAsync(tenantId, targetSaleId, cancellationToken);
                if (approved.IsSuccess)
                {
                    autoApprovedAccountId = approved.Value?.CustomerAccountId;
                }
                else
                {
                    await _audit.LogAsync(tenantId, appointment.BranchId, "AutoApproveFailed", "Adisyon", targetSaleId,
                        $"İlk randevu tamamlandı ama satış otomatik cariye işlenemedi: {approved.Error.Message}",
                        new { appointment.Id, appointment.CustomerId }, cancellationToken);
                }
            }
            else if (pendingSaleIds.Count > 0)
            {
                // Bekleyen satış VAR ama bu randevuya ait olduğu kanıtlanamadı (bağ yok + hizmet
                // eşleşmiyor). Sessizce en eskisini işlemek yanlış fişe borç/prim yazardı.
                await _audit.LogAsync(tenantId, appointment.BranchId, "AutoApproveSkipped", "Appointment", appointment.Id,
                    "Randevu tamamlandı ancak bekleyen satışlardan hangisinin bu randevuya ait olduğu belirlenemedi; " +
                    "hiçbiri otomatik cariye işlenmedi.",
                    new { appointment.CustomerId, appointment.ServiceDefinitionId, PendingSaleCount = pendingSaleIds.Count },
                    cancellationToken);
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

        // RANDEVU İPTALİ ONU DOĞURAN AÇIK SATIŞI DA KAPATIR — yaşam döngüsünün ters yönü
        // (bkz. CloseOpenSaleBoundToAppointmentAsync). Aynı SaveChanges'e girer: fiş ancak
        // randevu gerçekten iptal olduysa kapanır.
        Guid? closedSaleId = null;
        if (request.Status == AppointmentStatus.Cancelled && prevStatus != AppointmentStatus.Cancelled)
        {
            closedSaleId = await CloseOpenSaleBoundToAppointmentAsync(tenantId, appointment, cancellationToken);
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
        var capturedStatus = appointment.Status;
        async Task RunSideEffectsAsync()
        {
            try
            {
                await RunPostStatusChangeSideEffectsAsync(tenantId, appointment, request, prevStatus, staffTenantUserId, closedSaleId, cancellationToken);
            }
            catch (Exception ex)
            {
                try
                {
                    await _audit.LogAsync(tenantId, appointment.BranchId, "AppointmentStatusSideEffectFailed",
                        "Appointment", appointment.Id,
                        $"Randevu durumu değişti ({prevStatus} → {capturedStatus}) ancak yan işler tamamlanamadı: {ex.Message}",
                        new { prevStatus, NewStatus = capturedStatus }, cancellationToken);
                }
                catch { /* denetim kaydı da yazılamadıysa yutulur — asıl işlem geçerli */ }
            }
        }

        var success = Result<AppointmentDto>.Success(appointment.ToDto());
        // Dış transaction'ın parçasıysak yan işler ÇAĞIRANA bırakılır: tahsilat sonradan
        // reddedilirse hiç çalışmasınlar, yoksa gerçekle çelişen denetim/bildirim izi kalırdı.
        if (deferSideEffects) return new StatusChangeOutcome(success, RunSideEffectsAsync, autoApprovedAccountId);

        await RunSideEffectsAsync();
        return new StatusChangeOutcome(success, null, autoApprovedAccountId);
    }

    /// <summary>
    /// Durum değişikliği KALICI olduktan sonra çalışan yan işler. Ayrı metotta: çağıran tarafta
    /// tek bir try/catch ile sarılıp hatası isteğe yansıtılmaz (bkz. <see cref="ChangeStatusAsync"/>).
    /// </summary>
    private async Task RunPostStatusChangeSideEffectsAsync(
        Guid tenantId, Appointment appointment, ChangeAppointmentStatusRequest request,
        AppointmentStatus prevStatus, Guid? staffTenantUserId, Guid? closedSaleId, CancellationToken cancellationToken)
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
            $"Randevu durumu: {prevStatus} → {appointment.Status}"
                + (offeredWaitlistId is not null ? " · bekleme listesine teklif gönderildi" : string.Empty)
                + (closedSaleId is not null ? " · bağlı açık satış fişi iptal edildi" : string.Empty),
            new { prevStatus, NewStatus = appointment.Status, request.Reason, offeredWaitlistId, closedSaleId }, cancellationToken);

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

    /// <summary>
    /// RANDEVU → SATIŞ YAŞAM DÖNGÜSÜ: iptal edilen/silinen randevuyu DOĞURAN açık satış fişini kapatır;
    /// kapatıldıysa fişin kimliğini döndürür.
    ///
    /// <para>
    /// Ters yön zaten vardı (<c>AdisyonService.CancelCoreAsync</c> / <c>DeleteCoreAsync</c>: fiş
    /// kapanınca ondan doğan açık randevular da kapanır). Bu yön eksikti: randevu+satış atomik
    /// ucundan (<see cref="CreateWithSaleAsync"/>) açılan bir randevu iptal edilince/silinince fiş
    /// AÇIK kalıyordu. Sonuç para etkiliydi — müşterinin BAŞKA bir randevusu tamamlandığında
    /// "ilk randevuda cariye işle" kuralı (bkz. <see cref="ChangeStatusInternalAsync"/>) müşterinin
    /// TÜM bekleyen fişlerini onaylıyordu, dolayısıyla karşılıksız kalan bu fiş de cariye borç
    /// yazılıyor ve tahsilat hedefi yanlış fişe kayabiliyordu. O kural artık yalnız randevunun KENDİ
    /// fişini onaylar; bu temizlik ise açık kalan fişin ileride başka bir randevuya hizmet
    /// eşleştirmesiyle yanlışlıkla bağlanmasını engeller.
    /// </para>
    /// <para>
    /// ÜÇ KORUMA: (1) yalnız AÇIK fiş kapatılır — onaylı fişin parası kasaya, borcu cariye,
    /// seansı müşteriye işlenmiştir, onu geri almanın yolu satış iptali ekranıdır; (2) fiş başka
    /// canlı randevuyu da besliyorsa dokunulmaz; (3) global süzgeçler atlanır — aktif şube kapsamı
    /// yüzünden fiş "yok" sayılıp bağ sessizce kopmasın.
    /// </para>
    /// <para>
    /// Kilit sırası (<see cref="RowLock.TableOrder"/>): … → appointments → customer_accounts →
    /// adisyonlar. Çağıranlar randevu kilidini ZATEN almış olur; adisyon ondan sonra gelir.
    /// </para>
    /// </summary>
    private async Task<Guid?> CloseOpenSaleBoundToAppointmentAsync(
        Guid tenantId, Appointment appointment, CancellationToken ct)
    {
        if (appointment.SourceAdisyonId is not { } saleId) return null;
        if (!await RowLock.LockRowAsync(_db, "adisyonlar", saleId, ct)) return null;

        var sale = await _db.Adisyonlar.IgnoreQueryFilters()
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == saleId && !a.IsDeleted, ct);
        if (sale is null || sale.Status != AdisyonStatus.Open) return null;

        var feedsOtherAppointments = await _db.Appointments.IgnoreQueryFilters().AnyAsync(a =>
            a.TenantId == tenantId && a.SourceAdisyonId == saleId && a.Id != appointment.Id && !a.IsDeleted
            && a.Status != AppointmentStatus.Cancelled && a.Status != AppointmentStatus.NoShow, ct);
        if (feedsOtherAppointments) return null;

        sale.Cancel(_currentUser.UserId);
        return sale.Id;
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

        // SİLME DE ORTAK KİLİT PROTOKOLÜNE KATILIR (bkz. ChangeStatusInternalAsync). İki gerekçe:
        // (1) silme artık randevuyu doğuran açık satış fişini de kapatıyor — iki satır TEK
        // transaction'da, protokol sırasıyla (customers → appointments → adisyonlar) değişmeli;
        // (2) randevu eskiden kilitsiz okunuyordu: araya giren bir tamamlama commit ettiyse
        // "tamamlanmış silinemez" koruması BAYAT duruma bakıp silmeye izin veriyordu.
        var relational = _db.Database.IsRelational();
        await using var tx = relational && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        if (relational)
        {
            await RowLock.LockRowAsync(_db, "customers", appointment.CustomerId, cancellationToken);
            await RowLock.LockRowAsync(_db, "appointments", appointment.Id, cancellationToken);
            await _db.Entry(appointment).ReloadAsync(cancellationToken);
            if (_db.Entry(appointment).State == EntityState.Detached)
                return Result.Failure(Error.NotFound("Randevu bulunamadı."));
        }

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
        // Randevu ortadan kalkınca onu doğuran açık satışın da dayanağı kalmaz (bkz. metot notu).
        var closedSaleId = await CloseOpenSaleBoundToAppointmentAsync(tenantId, appointment, cancellationToken);
        appointment.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        if (tx is not null) await tx.CommitAsync(cancellationToken);
        await _audit.LogAsync(tenantId, appointment.BranchId, "Delete", "Appointment", appointment.Id,
            $"Randevu silindi ({appointment.StartUtc:dd.MM.yyyy HH:mm})"
                + (closedSaleId is not null ? " · bağlı açık satış fişi iptal edildi" : string.Empty),
            new { snapshot.StartUtc, snapshot.CustomerId, snapshot.StaffMemberId, closedSaleId }, cancellationToken);
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

    /// <summary>
    /// KULLANICININ SABİTLENDİĞİ ŞUBE — yoksa (kurum sahibi / platform / şubesiz kullanıcı) null.
    ///
    /// <para>
    /// <c>TenantResolutionMiddleware</c> şube yöneticisini ve personeli JWT'deki şubeye sabitler:
    /// <c>X-Branch-Id</c> başlığıyla başka şube seçemezler. Ama randevu oluşturmada şube
    /// GÖVDEDEN geliyor ve yalnız "aynı kuruma ait mi" diye bakılıyordu — Şube A yöneticisi
    /// istek gövdesine aynı kurumun Şube B kimliğini yazarak B'ye randevu açabiliyordu
    /// (başlık koruması baypas edilmiş oluyordu).
    /// </para>
    /// <para>
    /// REDDETMEK YERİNE SABİTLERİZ: kural başlıktakiyle birebir aynı olsun ("gönderilen değer yok
    /// sayılır"). Sabitlenmiş rolün zaten tek meşru şubesi vardır, dolayısıyla ezme meşru akışı
    /// bozmaz; gövdedeki değer farklıysa denetim kaydı yazılır (arayüz bunu üretmez).
    /// </para>
    /// </summary>
    private Guid? PinnedBranchId()
    {
        if (_currentUser.IsPlatformAdmin) return null;
        if (_currentUser.Role is not (UserRole.BranchManager or UserRole.Staff)) return null;
        // Şubesi atanmamış kullanıcı kurum genelindedir (middleware de ona kapsam koymaz).
        return _currentUser.BranchId;
    }

    /// <summary>
    /// Randevunun bağlanacağı TÜM varlıklar bu kuruma ait mi? (müşteri, şube, personel, hizmet)
    ///
    /// <para>
    /// Hiçbiri doğrulanmıyordu: <see cref="IsStaffInScopeAsync"/> yönetici çağrısında kaydı hiç
    /// sorgulamadan true döner, <c>StaffSkill.BlockReasonAsync</c> kayıt bulunamayınca "engel yok"
    /// der, DB tarafında da bileşik (TenantId + Id) bütünlük yoktur — ilişkiler yalın GUID FK'dır.
    /// Sonuç: doğrudan API çağrısıyla BAŞKA kuruma ait şube/personel/hizmet/müşteri kimlikleri
    /// gönderilerek kurumlar arası bağları olan randevu oluşturulabiliyordu (BOLA).
    /// </para>
    /// <para>
    /// Kontrol global süzgeçleri ATLAR ve koşulları kendisi yazar: kurum üyeliğini her rolde,
    /// ŞUBE üyeliğini ise yalnız sabitlenmiş rolde doğrular (bkz. <see cref="PinnedBranchId"/>) —
    /// kurum sahibinde aktif şube kapsamı yüzünden başka şubenin müşterisi "yok" sayılıp meşru
    /// akış kırılmasın. Silinmiş kayıtlar yine reddedilir.
    /// </para>
    /// <para>
    /// ŞUBE KONTROLÜ RANDEVUNUN KENDİ ŞUBESİYLE YETİNMEZ. Randevunun <c>BranchId</c>'si
    /// sabitleniyordu ama BAĞLANDIĞI kayıtlar yalnız "aynı kurumda mı" diye bakılıyordu: Şube A
    /// yöneticisi Şube B'nin müşteri/personel/hizmet kimliklerini gönderip Şube A'ya randevu
    /// (ve satış) açabiliyor, böylece göremeyeceği kayıtlara dokunabiliyordu. Sabitleme deliğin
    /// yalnız yarısını kapatıyordu.
    /// </para>
    /// <para>
    /// KATALOG KAYITLARI KURUM GENELİ OLABİLİR: <c>ServiceDefinition</c>/<c>ServicePackage</c>
    /// için <c>BranchId</c> null demek "tüm şubeler" demektir, o yüzden null kabul edilir.
    /// Müşteri ve personelin şubesi ise zorunludur (null olamaz).
    /// </para>
    /// </summary>
    private async Task<Error?> ValidateAppointmentScopeAsync(
        Guid tenantId, Guid branchId, Guid customerId, Guid staffMemberId, Guid serviceDefinitionId, CancellationToken ct)
    {
        // null → kurum sahibi/platform/şubesiz kullanıcı: şube kısıtı uygulanmaz.
        var pinned = PinnedBranchId();

        if (!await _db.Customers.AsNoTracking().IgnoreQueryFilters()
                .AnyAsync(x => x.TenantId == tenantId && x.Id == customerId && !x.IsDeleted
                            && (pinned == null || x.BranchId == pinned), ct))
            return Error.NotFound("Müşteri bulunamadı.");
        if (!await _db.Branches.AsNoTracking().IgnoreQueryFilters()
                .AnyAsync(x => x.TenantId == tenantId && x.Id == branchId && !x.IsDeleted, ct))
            return Error.NotFound("Şube bulunamadı.");
        if (!await _db.StaffMembers.AsNoTracking().IgnoreQueryFilters()
                .AnyAsync(x => x.TenantId == tenantId && x.Id == staffMemberId && !x.IsDeleted
                            && (pinned == null || x.BranchId == pinned), ct))
            return Error.NotFound("Personel bulunamadı.");
        if (!await _db.ServiceDefinitions.AsNoTracking().IgnoreQueryFilters()
                .AnyAsync(x => x.TenantId == tenantId && x.Id == serviceDefinitionId && !x.IsDeleted
                            && (pinned == null || x.BranchId == null || x.BranchId == pinned), ct))
            return Error.NotFound("Hizmet bulunamadı.");
        return null;
    }

    /// <summary>
    /// Katalog kaydı (hizmet/paket) sabitlenmiş rolün şubesinde mi? Kurum geneli (null şube) kayıt
    /// her şubede geçerlidir. Randevuyla birlikte SATIŞ açan uç de bu kapıdan geçer: aksi hâlde
    /// şube kapsamı randevuda zorlanırken satış kaleminde delik kalırdı.
    /// </summary>
    private async Task<bool> IsCatalogItemInBranchScopeAsync(
        Guid tenantId, Guid? serviceDefinitionId, Guid? servicePackageId, CancellationToken ct)
    {
        if (PinnedBranchId() is not { } pinned) return true;

        if (serviceDefinitionId is { } svcId
            && !await _db.ServiceDefinitions.AsNoTracking().IgnoreQueryFilters()
                .AnyAsync(x => x.TenantId == tenantId && x.Id == svcId && !x.IsDeleted
                            && (x.BranchId == null || x.BranchId == pinned), ct))
            return false;

        if (servicePackageId is { } pkgId
            && !await _db.ServicePackages.AsNoTracking().IgnoreQueryFilters()
                .AnyAsync(x => x.TenantId == tenantId && x.Id == pkgId && !x.IsDeleted
                            && (x.BranchId == null || x.BranchId == pinned), ct))
            return false;

        return true;
    }
}
