using System.Security.Cryptography;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.Support;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// DESTEK TALEPLERİ (bkz. <see cref="ISupportService"/>).
///
/// <para>
/// <b>ÜÇ GİRİŞ, TEK KUYRUK.</b> Ziyaretçi (oturumsuz form), kurum kullanıcısı (panel) ve platform
/// aynı tabloyu kullanır. Ziyaretçi taleplerini ayrı bir "iletişim formu" tablosuna koymak,
/// müşteri olmadan yazan bir işletmenin ikinci mesajının bambaşka bir yere düşmesi demekti.
/// </para>
///
/// <para>
/// <b>YETKİ AYRIMI KESİNDİR:</b> kurum kullanıcısı YALNIZ kendi kurumunun taleplerini görür,
/// ziyaretçi yalnız kod + jetonla eşleşen tek talebi, platform ise hepsini. Bu üç yol ayrı
/// metotlardır; tek bir "GetAsync" yazıp içinde rol dallanması yapmak, yeni bir çağrı yerinde
/// kontrolün atlanmasını kolaylaştırırdı.
/// </para>
///
/// <para>
/// <b>Kurum kapsamı EF global filtresine bırakılmaz.</b> <see cref="SupportTicket.TenantId"/>
/// isteğe bağlıdır (ziyaretçi talebinde null) ve tablo kiracıya kapsanmaz; filtre uygulansaydı
/// oturumsuz gelen talepler hiçbir listede görünmezdi. Kapsam bu yüzden her sorguda AÇIKÇA yazılır.
/// </para>
/// </summary>
public sealed class SupportService : ISupportService
{
    /// <summary>Jeton uzunluğu (bayt) — base64url ile ~43 karakter.</summary>
    private const int TokenBytes = 32;

    /// <summary>Kod çakışmasında kaç kez yeniden denenecek (bkz. TenantCodeAllocator ile aynı desen).</summary>
    private const int MaxCodeAttempts = 5;

    private readonly GuzellikDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IPlatformMessagingService _messaging;
    private readonly IDateTimeProvider _clock;
    private readonly IConfiguration _config;
    private readonly ILogger<SupportService> _logger;

    public SupportService(
        GuzellikDbContext db,
        ICurrentUser currentUser,
        IPlatformMessagingService messaging,
        IDateTimeProvider clock,
        IConfiguration configuration,
        ILogger<SupportService> logger)
    {
        _db = db;
        _currentUser = currentUser;
        _messaging = messaging;
        _clock = clock;
        _config = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Talep tablosu — kiracı filtresi UYGULANMAZ (bkz. sınıf notu). Kapsam her sorguda açıkça yazılır.
    /// </summary>
    private IQueryable<SupportTicket> Tickets => _db.SupportTickets.IgnoreQueryFilters();

    // ================================================================= oluşturma

    public async Task<Result<SupportTicketCreatedDto>> CreateAsync(CreateSupportTicketRequest request, CancellationToken ct = default)
    {
        var subject = request.Subject?.Trim() ?? string.Empty;
        var message = request.Message?.Trim() ?? string.Empty;
        if (subject.Length < 3) return Result<SupportTicketCreatedDto>.Failure(Error.Validation("Konu en az 3 karakter olmalı."));
        if (message.Length < 10) return Result<SupportTicketCreatedDto>.Failure(Error.Validation("Lütfen sorununuzu biraz daha ayrıntılı anlatın (en az 10 karakter)."));

        // ══ KİMLİK SUNUCUDAN GELİR, İSTEMCİDEN DEĞİL ═══════════════════════════════════════
        // Oturum varsa ad/e-posta/kurum oturumdan okunur ve formdaki değerler GÖZ ARDI EDİLİR.
        // Aksi hâlde giriş yapmış bir personel, başka birinin adına talep açıp yanıtları o
        // adrese yönlendirebilirdi. Oturum yoksa tek kaynak formdur.
        Guid? tenantId = null;
        string? tenantSnapshot = null;
        Guid? userId = null;
        string name;
        string email;

        if (_currentUser.IsAuthenticated && _currentUser.UserId is { } uid && !_currentUser.IsPlatformAdmin)
        {
            var user = await _db.TenantUsers.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == uid, ct);
            if (user is null) return Result<SupportTicketCreatedDto>.Failure(Error.Unauthorized("Kullanıcı bulunamadı."));

            userId = user.Id;
            tenantId = user.TenantId;
            name = string.IsNullOrWhiteSpace(user.FullName) ? user.Email : user.FullName!;
            email = user.Email;
            tenantSnapshot = await TenantSnapshotAsync(user.TenantId, ct);
        }
        else
        {
            name = request.Name?.Trim() ?? string.Empty;
            email = request.Email?.Trim().ToLowerInvariant() ?? string.Empty;
            if (name.Length < 2) return Result<SupportTicketCreatedDto>.Failure(Error.Validation("Ad soyad zorunludur."));
            if (!email.Contains('@') || !email.Contains('.'))
                return Result<SupportTicketCreatedDto>.Failure(Error.Validation("Geçerli bir e-posta adresi girin."));
        }

        // ÖNCELİK İSTEMCİYE BIRAKILMAZ. Herkes kendi talebini "Acil" işaretlerse öncelik
        // sıralaması anlamını yitirir ve gerçekten iş durduran talepler kuyrukta kaybolur.
        // Sıralamayı platform yapar (bkz. UpdateAsync); giriş her zaman Normal'dir.
        const SupportTicketPriority initialPriority = SupportTicketPriority.Normal;

        var ticket = new SupportTicket(
            subject, name, email, request.Category, initialPriority,
            tenantId, tenantSnapshot, userId, request.Phone);

        var now = _clock.UtcNow;
        ticket.AddMessage(SupportAuthorSide.Requester, message, userId, name, now);

        var token = NewToken();

        for (var attempt = 0; attempt < MaxCodeAttempts; attempt++)
        {
            var code = await NextCodeAsync(now, attempt, ct);
            ticket.AssignCode(code, token);
            _db.SupportTickets.Add(ticket);

            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (IsDuplicateCodeError(ex) && attempt < MaxCodeAttempts - 1)
            {
                // Eşzamanlı bir talep aynı numarayı aldı. Takılan grafiği bırak ve sıradaki
                // numarayla baştan kur — aksi hâlde EF aynı Added grafiğini yeniden gönderir.
                _db.ChangeTracker.Clear();
                ticket = new SupportTicket(
                    subject, name, email, request.Category, initialPriority,
                    tenantId, tenantSnapshot, userId, request.Phone);
                ticket.AddMessage(SupportAuthorSide.Requester, message, userId, name, now);
                continue;
            }

            // Bildirim BEST-EFFORT: gönderilemezse talep geri alınmaz — kullanıcı takip kodunu
            // zaten ekranda görüyor ve kayıt kuyrukta duruyor.
            await SendCreatedEmailAsync(ticket, ct);

            _logger.LogInformation("Yeni destek talebi: {Code} ({Category}).", ticket.Code, ticket.Category);

            return Result<SupportTicketCreatedDto>.Success(new SupportTicketCreatedDto(
                ticket.Id, ticket.Code, token, BuildTrackUrl(ticket.Code, token)));
        }

        return Result<SupportTicketCreatedDto>.Failure(Error.Conflict(
            "Talep şu anda oluşturulamadı. Lütfen tekrar deneyin."));
    }

    // ================================================================= oturumsuz takip

    public async Task<Result<SupportTicketDetailDto>> GetByTokenAsync(string code, string token, CancellationToken ct = default)
    {
        var (ticket, failure) = await LoadByTokenAsync(code, token, ct);
        if (failure is not null) return Result<SupportTicketDetailDto>.Failure(failure);

        ticket!.MarkReadByRequester();
        await _db.SaveChangesAsync(ct);
        return Result<SupportTicketDetailDto>.Success(await ToDetailAsync(ticket, ct));
    }

    public async Task<Result<SupportTicketDetailDto>> ReplyByTokenAsync(
        string code, string token, SupportReplyRequest request, CancellationToken ct = default)
    {
        var (ticket, failure) = await LoadByTokenAsync(code, token, ct);
        if (failure is not null) return Result<SupportTicketDetailDto>.Failure(failure);

        return await AppendAsync(ticket!, SupportAuthorSide.Requester, request.Message, null, ticket!.RequesterName, ct);
    }

    /// <summary>
    /// Kod + jetonla talebi yükler.
    /// </summary>
    /// <remarks>
    /// <b>JETON SABİT SÜREDE KARŞILAŞTIRILIR.</b> Sıradan string eşitliği ilk farklı karakterde
    /// çıkar; yanıt süresindeki fark, jetonu karakter karakter tahmin etmeye yarayan ölçülebilir
    /// bir sızıntıdır. Kod tahmin edilebilir (sıralı) olduğu için tek gerçek engel jetondur.
    /// </remarks>
    private async Task<(SupportTicket? Ticket, Error? Failure)> LoadByTokenAsync(string? code, string? token, CancellationToken ct)
    {
        var normalized = code?.Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(normalized) || string.IsNullOrWhiteSpace(token))
            return (null, Error.NotFound("Talep bulunamadı."));

        var ticket = await Tickets.Include(t => t.Messages).FirstOrDefaultAsync(t => t.Code == normalized, ct);

        // BULUNAMADI ile JETON YANLIŞ AYNI yanıtı verir: fark, geçerli kodları tarayarak
        // hangi taleplerin var olduğunu keşfetmeye yarardı.
        if (ticket is null || !FixedTimeEquals(ticket.AccessToken, token))
            return (null, Error.NotFound("Talep bulunamadı. Takip bağlantınızı kontrol edin."));

        return (ticket, null);
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        var x = System.Text.Encoding.UTF8.GetBytes(a);
        var y = System.Text.Encoding.UTF8.GetBytes(b);
        // Uzunluk farkı zaten sızar (ve sızması zararsızdır); içerik karşılaştırması sabit sürelidir.
        return x.Length == y.Length && CryptographicOperations.FixedTimeEquals(x, y);
    }

    // ================================================================= kurum paneli

    public async Task<Result<PagedResult<SupportTicketListItemDto>>> ListMineAsync(SupportTicketQuery query, CancellationToken ct = default)
    {
        if (_currentUser.TenantId is not { } tenantId)
            return Result<PagedResult<SupportTicketListItemDto>>.Failure(Error.Unauthorized("Kurum oturumu bulunamadı."));

        return Result<PagedResult<SupportTicketListItemDto>>.Success(
            await PageAsync(Tickets.Where(t => t.TenantId == tenantId), query, ct));
    }

    public async Task<Result<SupportTicketDetailDto>> GetMineAsync(Guid id, CancellationToken ct = default)
    {
        var (ticket, failure) = await LoadMineAsync(id, ct);
        if (failure is not null) return Result<SupportTicketDetailDto>.Failure(failure);
        ticket!.MarkReadByRequester();
        await _db.SaveChangesAsync(ct);
        return Result<SupportTicketDetailDto>.Success(await ToDetailAsync(ticket, ct));
    }

    public async Task<Result<SupportTicketDetailDto>> ReplyMineAsync(Guid id, SupportReplyRequest request, CancellationToken ct = default)
    {
        var (ticket, failure) = await LoadMineAsync(id, ct);
        if (failure is not null) return Result<SupportTicketDetailDto>.Failure(failure);

        var name = await CurrentUserNameAsync(ct);
        return await AppendAsync(ticket!, SupportAuthorSide.Requester, request.Message, _currentUser.UserId, name, ct);
    }

    /// <summary>
    /// Kurumun KENDİ talebini yükler.
    /// </summary>
    /// <remarks>
    /// Kapsam WHERE'e AÇIKÇA yazılır ve "bulunamadı" ile "senin değil" AYNI yanıtı verir:
    /// farklı yanıt, başka kurumların talep kimliklerinin var olduğunu doğrulardı (BOLA).
    /// </remarks>
    private async Task<(SupportTicket? Ticket, Error? Failure)> LoadMineAsync(Guid id, CancellationToken ct)
    {
        if (_currentUser.TenantId is not { } tenantId)
            return (null, Error.Unauthorized("Kurum oturumu bulunamadı."));

        var ticket = await Tickets.Include(t => t.Messages)
            .FirstOrDefaultAsync(t => t.Id == id && t.TenantId == tenantId, ct);
        return ticket is null ? (null, Error.NotFound("Talep bulunamadı.")) : (ticket, null);
    }

    // ================================================================= platform

    public async Task<Result<PagedResult<SupportTicketListItemDto>>> ListAllAsync(SupportTicketQuery query, CancellationToken ct = default)
        => Result<PagedResult<SupportTicketListItemDto>>.Success(await PageAsync(Tickets, query, ct));

    public async Task<Result<SupportTicketDetailDto>> GetAsync(Guid id, CancellationToken ct = default)
    {
        var ticket = await Tickets.Include(t => t.Messages).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Result<SupportTicketDetailDto>.Failure(Error.NotFound("Talep bulunamadı."));

        ticket.MarkReadByPlatform();
        await _db.SaveChangesAsync(ct);
        return Result<SupportTicketDetailDto>.Success(await ToDetailAsync(ticket, ct));
    }

    public async Task<Result<SupportTicketDetailDto>> ReplyAsync(Guid id, SupportReplyRequest request, CancellationToken ct = default)
    {
        var ticket = await Tickets.Include(t => t.Messages).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Result<SupportTicketDetailDto>.Failure(Error.NotFound("Talep bulunamadı."));

        var name = await CurrentUserNameAsync(ct);
        var result = await AppendAsync(ticket, SupportAuthorSide.Platform, request.Message, _currentUser.UserId, name, ct);

        // Yanıt yazıldı — talep sahibine haber ver (best-effort; gönderilemezse yanıt kaybolmaz,
        // kullanıcı takip ekranından görür).
        if (result.IsSuccess) await SendReplyEmailAsync(ticket, request.Message, ct);

        return result;
    }

    public async Task<Result<SupportTicketDetailDto>> UpdateAsync(Guid id, UpdateSupportTicketRequest request, CancellationToken ct = default)
    {
        var ticket = await Tickets.Include(t => t.Messages).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (ticket is null) return Result<SupportTicketDetailDto>.Failure(Error.NotFound("Talep bulunamadı."));

        var now = _clock.UtcNow;
        var actor = _currentUser.UserId;
        var actorName = await CurrentUserNameAsync(ct);

        if (request.Priority is { } priority && priority != ticket.Priority)
        {
            ticket.SetPriority(priority, now, actor);
            ticket.AddMessage(SupportAuthorSide.System, $"Öncelik “{PriorityLabel(priority)}” olarak güncellendi.", actor, actorName, now);
        }

        // Guid.Empty = atamayı KALDIR. null = dokunma. İkisini ayırmak gerekir; tek değer
        // kullanılsaydı "atamayı kaldır" ile "bu alanı göndermedim" birbirine karışırdı.
        if (request.AssignedToUserId is { } assignee)
        {
            var target = assignee == Guid.Empty ? (Guid?)null : assignee;
            if (target != ticket.AssignedToUserId)
            {
                ticket.Assign(target, now, actor);
                var label = target is null ? "Atama kaldırıldı." : $"Talep {await UserNameAsync(target, ct) ?? "platform ekibine"} üzerine alındı.";
                ticket.AddMessage(SupportAuthorSide.System, label, actor, actorName, now);
            }
        }

        if (request.Status is { } status && status != ticket.Status)
        {
            ticket.ChangeStatus(status, now, actor);
            ticket.AddMessage(SupportAuthorSide.System, $"Durum “{StatusLabel(status)}” olarak güncellendi.", actor, actorName, now);

            // Kapanış/çözülme talep sahibini ilgilendirir — e-postayla bildir (best-effort).
            if (status is SupportTicketStatus.Resolved or SupportTicketStatus.Closed)
                await SendStatusEmailAsync(ticket, status, ct);
        }

        await _db.SaveChangesAsync(ct);
        return Result<SupportTicketDetailDto>.Success(await ToDetailAsync(ticket, ct));
    }

    public async Task<Result<SupportSummaryDto>> GetSummaryAsync(CancellationToken ct = default)
    {
        var now = _clock.UtcNow;
        var weekAgo = now.AddDays(-7);
        var monthAgo = now.AddDays(-30);

        var open = await Tickets.CountAsync(t => t.Status == SupportTicketStatus.Open, ct);
        var inProgress = await Tickets.CountAsync(t => t.Status == SupportTicketStatus.InProgress, ct);
        var waiting = await Tickets.CountAsync(t => t.Status == SupportTicketStatus.WaitingCustomer, ct);
        var unread = await Tickets.CountAsync(t => t.HasUnreadForPlatform, ct);
        var urgent = await Tickets.CountAsync(t =>
            t.Priority == SupportTicketPriority.Urgent &&
            t.Status != SupportTicketStatus.Closed && t.Status != SupportTicketStatus.Resolved, ct);
        var resolved = await Tickets.CountAsync(t => t.ResolvedAtUtc != null && t.ResolvedAtUtc >= weekAgo, ct);

        // İLK YANIT SÜRESİ: veritabanında saat farkı hesaplatmak sağlayıcıya özel SQL gerektirir;
        // son 30 günün yanıtlanmış talepleri (en fazla birkaç yüz satır) belleğe çekilip
        // ortalanır. Tablo büyüdüğünde bu blok bir rapor sorgusuna taşınmalıdır.
        var responded = await Tickets
            .Where(t => t.FirstResponseAtUtc != null && t.CreatedAtUtc >= monthAgo)
            .Select(t => new { t.CreatedAtUtc, t.FirstResponseAtUtc })
            .ToListAsync(ct);
        double? avgHours = responded.Count == 0
            ? null
            : Math.Round(responded.Average(r => (r.FirstResponseAtUtc!.Value - r.CreatedAtUtc).TotalHours), 1);

        return Result<SupportSummaryDto>.Success(new SupportSummaryDto(
            open, inProgress, waiting, unread, urgent, resolved, avgHours));
    }

    // ================================================================= ortak

    /// <summary>Mesaj ekler, kaydeder ve güncel ayrıntıyı döner (üç çağıranın ortak gövdesi).</summary>
    private async Task<Result<SupportTicketDetailDto>> AppendAsync(
        SupportTicket ticket, SupportAuthorSide side, string? body, Guid? authorId, string? authorName, CancellationToken ct)
    {
        var message = body?.Trim();
        if (string.IsNullOrWhiteSpace(message))
            return Result<SupportTicketDetailDto>.Failure(Error.Validation("Mesaj boş olamaz."));

        try
        {
            ticket.AddMessage(side, message, authorId, authorName, _clock.UtcNow);
        }
        catch (Domain.Exceptions.DomainException ex)
        {
            // Kapalı talebe yanıt gibi kural ihlalleri kullanıcı hatasıdır, 500 değil.
            return Result<SupportTicketDetailDto>.Failure(Error.Validation(ex.Message));
        }

        await _db.SaveChangesAsync(ct);
        return Result<SupportTicketDetailDto>.Success(await ToDetailAsync(ticket, ct));
    }

    private async Task<PagedResult<SupportTicketListItemDto>> PageAsync(
        IQueryable<SupportTicket> source, SupportTicketQuery query, CancellationToken ct)
    {
        var page = new PageRequest(query.Page, query.PageSize, query.Search);

        if (query.Status is { } status) source = source.Where(t => t.Status == status);
        if (query.Priority is { } priority) source = source.Where(t => t.Priority == priority);
        if (query.Category is { } category) source = source.Where(t => t.Category == category);

        source = (query.Scope?.Trim().ToLowerInvariant()) switch
        {
            "open" => source.Where(t => t.Status == SupportTicketStatus.Open
                                     || t.Status == SupportTicketStatus.InProgress
                                     || t.Status == SupportTicketStatus.WaitingCustomer),
            "unread" => source.Where(t => t.HasUnreadForPlatform),
            "closed" => source.Where(t => t.Status == SupportTicketStatus.Resolved
                                       || t.Status == SupportTicketStatus.Closed),
            "mine" => _currentUser.UserId is { } me ? source.Where(t => t.AssignedToUserId == me) : source,
            _ => source,
        };

        // ARAMA yalnız ŞİFRELENMEMİŞ kolonlarda: kod, konu, ad ve e-posta düz metin saklanır.
        // Kurum adı (Tenant.Name) AES-GCM ile şifrelidir ve SQL'de aranamaz — burada denemek
        // sessizce boş sonuç verirdi. TenantNameSnapshot ise düz kolondur, o aranabilir.
        var search = page.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            source = source.Where(t =>
                t.Code.Contains(search) ||
                t.Subject.Contains(search) ||
                t.RequesterName.Contains(search) ||
                t.RequesterEmail.Contains(search) ||
                (t.TenantNameSnapshot != null && t.TenantNameSnapshot.Contains(search)));
        }

        var total = await source.CountAsync(ct);

        // SIRALAMA: acil olanlar üstte, sonra en son hareket eden. Yalnız tarihe göre sıralamak,
        // iş durduran bir talebi sıradan bir soru tarafından aşağı itilebilir hâle getirirdi.
        var rows = await source
            .OrderByDescending(t => t.Priority)
            .ThenByDescending(t => t.LastMessageAtUtc)
            .Skip(page.Skip).Take(page.SafePageSize)
            .Select(t => new
            {
                t.Id, t.Code, t.Subject, t.Status, t.Priority, t.Category,
                t.RequesterName, t.RequesterEmail, t.TenantNameSnapshot, t.TenantId,
                t.AssignedToUserId, t.CreatedAtUtc, t.LastMessageAtUtc,
                t.HasUnreadForPlatform, t.HasUnreadForRequester,
                MessageCount = t.Messages.Count,
            })
            .ToListAsync(ct);

        // Atanan kişilerin adları TEK sorguda çözülür (satır başına sorgu N+1 olurdu).
        var assigneeIds = rows.Where(r => r.AssignedToUserId != null).Select(r => r.AssignedToUserId!.Value).Distinct().ToList();
        var names = assigneeIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await _db.TenantUsers.IgnoreQueryFilters().AsNoTracking()
                .Where(u => assigneeIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, u => u.FullName ?? u.Email, ct);

        var items = rows.Select(r => new SupportTicketListItemDto(
            r.Id, r.Code, r.Subject, r.Status, r.Priority, r.Category,
            r.RequesterName, r.RequesterEmail, r.TenantNameSnapshot, r.TenantId,
            r.AssignedToUserId,
            r.AssignedToUserId is { } a && names.TryGetValue(a, out var n) ? n : null,
            r.CreatedAtUtc, r.LastMessageAtUtc,
            r.HasUnreadForPlatform, r.HasUnreadForRequester, r.MessageCount)).ToList();

        return new PagedResult<SupportTicketListItemDto>(items, total, page.SafePage, page.SafePageSize);
    }

    private async Task<SupportTicketDetailDto> ToDetailAsync(SupportTicket ticket, CancellationToken ct) => new(
        ticket.Id, ticket.Code, ticket.Subject, ticket.Status, ticket.Priority, ticket.Category,
        ticket.RequesterName, ticket.RequesterEmail, ticket.RequesterPhone,
        ticket.TenantNameSnapshot, ticket.TenantId,
        ticket.AssignedToUserId, await UserNameAsync(ticket.AssignedToUserId, ct),
        ticket.CreatedAtUtc, ticket.LastMessageAtUtc, ticket.FirstResponseAtUtc, ticket.ResolvedAtUtc,
        ticket.Messages.OrderBy(m => m.SentAtUtc)
            .Select(m => new SupportMessageDto(m.Id, m.Side, m.Body, m.AuthorName, m.SentAtUtc)).ToList());

    private async Task<string?> UserNameAsync(Guid? userId, CancellationToken ct)
    {
        if (userId is not { } id || id == Guid.Empty) return null;
        return await _db.TenantUsers.IgnoreQueryFilters().AsNoTracking()
            .Where(u => u.Id == id).Select(u => u.FullName ?? u.Email).FirstOrDefaultAsync(ct);
    }

    private Task<string?> CurrentUserNameAsync(CancellationToken ct) => UserNameAsync(_currentUser.UserId, ct);

    /// <summary>
    /// Kurum adı + kodu — talep açılırken KOPYALANIR (kurum silinse de okunabilir kalsın).
    /// </summary>
    /// <remarks>
    /// <c>Tenant.Name</c> AES-GCM ile şifrelidir; burada EF üzerinden okunduğu için çözülmüş
    /// gelir ve düz bir kolona yazılır. Bu bilinçli bir seçimdir: destek kuyruğunda kurum adının
    /// aranabilir olması gerekir ve ad zaten kurumun kendi beyan ettiği ticari unvandır.
    /// </remarks>
    private async Task<string?> TenantSnapshotAsync(Guid tenantId, CancellationToken ct)
    {
        if (tenantId == Guid.Empty) return null;
        try
        {
            var t = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.Id == tenantId).Select(x => new { x.Name, x.Code }).FirstOrDefaultAsync(ct);
            if (t is null) return null;
            return string.IsNullOrWhiteSpace(t.Code) ? t.Name : $"{t.Name} ({t.Code})";
        }
        catch (Exception ex)
        {
            // Kurum adı okunamadı diye talep açılmamazlık edilmez.
            _logger.LogWarning(ex, "Destek talebi için kurum adı okunamadı.");
            return null;
        }
    }

    // ================================================================= kod + jeton

    /// <summary>
    /// Sıradaki takip kodu: <c>DST-26-0042</c> (önek - yıl - sıra).
    /// </summary>
    /// <remarks>
    /// <b>SAYAÇ YILA GÖRE SIFIRLANIR</b> ve numara o yılın talepleri içinde aranır: kod yıl
    /// taşıdığı için kendini tekrar etmez, ama numara da sonsuza kadar büyümez. Yarış koşulunda
    /// son söz UNIQUE indekstedir; çağıran bir sonraki numarayla yeniden dener
    /// (bkz. <see cref="TenantCodeAllocator"/> ile aynı desen).
    /// </remarks>
    private async Task<string> NextCodeAsync(DateTime now, int attempt, CancellationToken ct)
    {
        var year = now.Year % 100;
        var prefix = $"DST-{year:D2}-";
        var codes = await Tickets.AsNoTracking()
            .Where(t => t.Code.StartsWith(prefix))
            .Select(t => t.Code)
            .ToListAsync(ct);

        var max = 0;
        foreach (var code in codes)
        {
            var tail = code[prefix.Length..];
            if (int.TryParse(tail, out var n) && n > max) max = n;
        }

        return $"{prefix}{(max + 1 + attempt):D4}";
    }

    /// <summary>Base64url jeton — URL'de kaçış gerektirmesin (takip bağlantısında geçiyor).</summary>
    private static string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(TokenBytes))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    /// <summary>Bu hata "takip kodu zaten var" mı? (bkz. TenantCodeAllocator.IsDuplicateCodeError)</summary>
    private static bool IsDuplicateCodeError(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException!)
        {
            if (e.Message.Contains("Duplicate entry", StringComparison.OrdinalIgnoreCase)
                && e.Message.Contains("Code", StringComparison.OrdinalIgnoreCase))
                return true;
            if (e.InnerException is null) break;
        }
        return false;
    }

    // ================================================================= bildirim

    private string BuildTrackUrl(string code, string token)
    {
        var baseUrl = VerificationEmailTemplate.BuildLink("/destek/takip",
            _config["App:PublicBaseUrl"], _config["Frontend:PublicBaseUrl"], _config["WhatsApp:PublicBaseUrl"]);
        return string.IsNullOrWhiteSpace(baseUrl)
            ? $"/destek/takip?kod={Uri.EscapeDataString(code)}&jeton={Uri.EscapeDataString(token)}"
            : $"{baseUrl}?kod={Uri.EscapeDataString(code)}&jeton={Uri.EscapeDataString(token)}";
    }

    private Task SendCreatedEmailAsync(SupportTicket ticket, CancellationToken ct)
    {
        var url = BuildTrackUrl(ticket.Code, ticket.AccessToken);
        var body = Wrap(
            $"<p>Merhaba {Esc(ticket.RequesterName)},</p>" +
            $"<p>Destek talebiniz alındı. Takip kodunuz: <b>{Esc(ticket.Code)}</b></p>" +
            $"<p><b>Konu:</b> {Esc(ticket.Subject)}</p>" +
            $"<p>Talebinizin durumunu aşağıdaki bağlantıdan izleyebilir ve yanıt yazabilirsiniz:</p>" +
            $"<p><a href=\"{Esc(url)}\" style=\"color:#c85776;font-weight:600\">Talebimi görüntüle</a></p>" +
            "<p style=\"color:#7c6170;font-size:13px\">Bu bağlantı size özeldir; paylaşmayın.</p>");

        return SendAsync(ticket.RequesterEmail, $"Destek talebiniz alındı ({ticket.Code})", body, ct);
    }

    private Task SendReplyEmailAsync(SupportTicket ticket, string message, CancellationToken ct)
    {
        var url = BuildTrackUrl(ticket.Code, ticket.AccessToken);
        var body = Wrap(
            $"<p>Merhaba {Esc(ticket.RequesterName)},</p>" +
            $"<p><b>{Esc(ticket.Code)}</b> numaralı talebinize yanıt verildi:</p>" +
            $"<blockquote style=\"margin:14px 0;padding:12px 16px;border-left:3px solid #efbfd0;background:#fff7fa;white-space:pre-wrap\">{Esc(message)}</blockquote>" +
            $"<p><a href=\"{Esc(url)}\" style=\"color:#c85776;font-weight:600\">Talebi görüntüle ve yanıtla</a></p>");

        return SendAsync(ticket.RequesterEmail, $"Destek talebinize yanıt verildi ({ticket.Code})", body, ct);
    }

    private Task SendStatusEmailAsync(SupportTicket ticket, SupportTicketStatus status, CancellationToken ct)
    {
        var url = BuildTrackUrl(ticket.Code, ticket.AccessToken);
        var body = Wrap(
            $"<p>Merhaba {Esc(ticket.RequesterName)},</p>" +
            $"<p><b>{Esc(ticket.Code)}</b> numaralı talebiniz <b>{Esc(StatusLabel(status))}</b> olarak işaretlendi.</p>" +
            (status == SupportTicketStatus.Resolved
                ? $"<p>Sorun devam ediyorsa aşağıdaki bağlantıdan yanıt yazmanız yeterli — talep yeniden açılır.</p>"
                : "<p>Yeni bir konu için yeni bir talep oluşturabilirsiniz.</p>") +
            $"<p><a href=\"{Esc(url)}\" style=\"color:#c85776;font-weight:600\">Talebi görüntüle</a></p>");

        return SendAsync(ticket.RequesterEmail, $"Destek talebiniz güncellendi ({ticket.Code})", body, ct);
    }

    /// <summary>
    /// E-posta gönderir — <b>BEST-EFFORT</b>: hata talebi geri almaz, yalnız loglanır.
    /// </summary>
    /// <remarks>
    /// Destek talebi, bildirim gönderilemedi diye kaybolmamalıdır: kullanıcı takip kodunu zaten
    /// ekranda görüyor ve kayıt kuyrukta duruyor. Gönderimi zorunlu kılmak, SMTP arızasında
    /// destek sisteminin tamamen durması demekti.
    /// </remarks>
    private async Task SendAsync(string email, string subject, string body, CancellationToken ct)
    {
        try
        {
            await _messaging.SendEmailAsync(email, subject, body, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Destek bildirimi gönderilemedi: {Subject}", subject);
        }
    }

    private static string Wrap(string inner) =>
        $"<div style=\"font-family:sans-serif;font-size:15px;color:#2f1724;line-height:1.55\">{inner}</div>";

    /// <summary>
    /// HTML KAÇIŞI ZORUNLUDUR: konu ve mesaj KULLANICI GİRDİSİDİR ve doğrudan gövdeye
    /// yazılırsa e-posta istemcisinde HTML enjeksiyonuna açık olur.
    /// </summary>
    /// <remarks>
    /// <b><see cref="System.Net.WebUtility.HtmlEncode"/> KULLANILMAZ:</b> o, ASCII dışındaki HER
    /// karakteri sayısal varlığa çevirir ve "Seans düşmüyor" gövdeye "Seans d&amp;#252;şm&amp;#252;yor"
    /// olarak girer — Türkçe bir destek yazışmasının neredeyse tamamı. Ortak kaçış yalnız
    /// tehlikeli beş karakteri değiştirir; kodlamayı MIME katmanı taşır
    /// (bkz. VerificationEmailTemplate.HtmlEscape).
    /// </remarks>
    private static string Esc(string? value) => VerificationEmailTemplate.HtmlEscape(value);

    public static string StatusLabel(SupportTicketStatus status) => status switch
    {
        SupportTicketStatus.Open => "Açık",
        SupportTicketStatus.InProgress => "İnceleniyor",
        SupportTicketStatus.WaitingCustomer => "Yanıtınız bekleniyor",
        SupportTicketStatus.Resolved => "Çözüldü",
        SupportTicketStatus.Closed => "Kapatıldı",
        _ => status.ToString(),
    };

    private static string PriorityLabel(SupportTicketPriority priority) => priority switch
    {
        SupportTicketPriority.Low => "Düşük",
        SupportTicketPriority.Normal => "Normal",
        SupportTicketPriority.High => "Yüksek",
        SupportTicketPriority.Urgent => "Acil",
        _ => priority.ToString(),
    };
}
