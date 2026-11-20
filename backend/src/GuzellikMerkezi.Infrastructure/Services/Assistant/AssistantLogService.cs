using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Infrastructure.Services.Assistant;

/// <summary>
/// Maydi sohbet kayıtları (platform, güvenlik kaydı). Kurallar:
/// <list type="bullet">
/// <item>Yalnız platform yöneticisi; her çağrıda gerekçe zorunlu ve erişim izine yazılır (önce iz, sonra veri).</item>
/// <item>Kullanıcı kimliği açık gösterilir (ad, e-posta, rol). Kuruma bildirim gitmez.</item>
/// <item>Sayfa en fazla 100 satır, dönem en fazla saklama süresi kadar; toplu dışa aktarma yoktur.</item>
/// </list>
/// MySQL notu: yerel koleksiyonla Contains çevrilemediğinden adlar join ile ya da kurum kapsamında çekilip
/// bellekte eşlenir (kurum adı ve kişi adı şifreli kolonlardır).
/// </summary>
public sealed class AssistantLogService(GuzellikDbContext db, ICurrentUser currentUser, IConfiguration configuration) : IAssistantLogService
{
    private int RetentionDays => new AssistantDataRetention(db, configuration).RetentionDays;

    public async Task<Result<AssistantLogPageDto>> ListAsync(AssistantLogQuery query, CancellationToken cancellationToken)
    {
        if (Deny() is { } denied) return Result<AssistantLogPageDto>.Failure(denied);
        if (InvalidReason(query.Access) is { } invalid) return Result<AssistantLogPageDto>.Failure(invalid);
        var days = Math.Clamp(query.Days, 1, RetentionDays);
        var page = Math.Max(1, query.Page);
        var size = Math.Clamp(query.PageSize, 10, 100);
        var from = DateTime.UtcNow.AddDays(-days);

        await WriteAccessAsync("list", query.Access, query.TenantId, null,
            $"days={days};outcome={query.Outcome ?? "all"};negative={query.NegativeOnly};search={(string.IsNullOrWhiteSpace(query.Search) ? "-" : "e-posta")};page={page}", cancellationToken);

        var conversations = db.AssistantConversations.AsNoTracking().IgnoreQueryFilters().Where(x => x.LastMessageAtUtc >= from);
        if (query.TenantId is Guid tenantId) conversations = conversations.Where(x => x.TenantId == tenantId);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim().ToLowerInvariant();
            conversations = from c in conversations
                            join u in db.TenantUsers.AsNoTracking().IgnoreQueryFilters() on c.UserId equals u.Id
                            where u.Email.Contains(term)
                            select c;
        }
        var messages = db.AssistantMessages.AsNoTracking().IgnoreQueryFilters();
        if (!string.IsNullOrWhiteSpace(query.Outcome))
        {
            var outcome = query.Outcome;
            conversations = conversations.Where(c => messages.Any(m => m.ConversationId == c.Id && m.Sender == "user" && m.Outcome == outcome));
        }
        if (query.NegativeOnly)
            conversations = conversations.Where(c => messages.Any(m => m.ConversationId == c.Id && m.Feedback == -1));

        var total = await conversations.CountAsync(cancellationToken);
        var pageRows = await conversations.OrderByDescending(x => x.LastMessageAtUtc)
            .Skip((page - 1) * size).Take(size)
            .Select(c => new
            {
                c.Id, c.TenantId, c.BranchId, c.UserId, c.Portal, c.Title, c.CreatedAtUtc, c.LastMessageAtUtc,
                Questions = messages.Count(m => m.ConversationId == c.Id && m.Sender == "user"),
                NotFound = messages.Count(m => m.ConversationId == c.Id && m.Sender == "user" && m.Outcome == "not_found"),
                Negative = messages.Count(m => m.ConversationId == c.Id && m.Feedback == -1),
                // Müşteri portalında kullanıcı kimliği = müşteri kaydının kimliği (ayrı kullanıcı satırı yok).
                Customer = db.Customers.IgnoreQueryFilters().Where(cu => cu.Id == c.UserId)
                    .Select(cu => new CustomerIdentity(cu.FullName, cu.Email, cu.Phone)).FirstOrDefault(),
            })
            .ToListAsync(cancellationToken);

        var names = await NamesAsync(query.TenantId, cancellationToken);
        var items = pageRows.Select(c => new AssistantLogRowDto(
                c.Id, c.TenantId, names.Tenants.GetValueOrDefault(c.TenantId, "—"),
                c.BranchId is Guid b ? names.Branches.GetValueOrDefault(b) : null,
                UserOf(c.UserId, c.Customer, names), c.Portal, c.Title, c.Questions, c.NotFound, c.Negative, c.CreatedAtUtc, c.LastMessageAtUtc))
            .ToList();
        return Result<AssistantLogPageDto>.Success(new AssistantLogPageDto(page, size, total, RetentionDays, items));
    }

    public async Task<Result<AssistantLogConversationDto>> GetConversationAsync(Guid conversationId, AssistantLogAccess access, CancellationToken cancellationToken)
    {
        if (Deny() is { } denied) return Result<AssistantLogConversationDto>.Failure(denied);
        if (InvalidReason(access) is { } invalid) return Result<AssistantLogConversationDto>.Failure(invalid);
        var conversation = await db.AssistantConversations.AsNoTracking().IgnoreQueryFilters().FirstOrDefaultAsync(x => x.Id == conversationId, cancellationToken);
        if (conversation is null) return Result<AssistantLogConversationDto>.Failure(Error.NotFound("Sohbet bulunamadı (saklama süresi dolmuş olabilir)."));

        await WriteAccessAsync("view", access, conversation.TenantId, conversation.Id, null, cancellationToken);

        var messages = await db.AssistantMessages.AsNoTracking().IgnoreQueryFilters()
            .Where(x => x.ConversationId == conversationId)
            .OrderBy(x => x.CreatedAtUtc).ThenBy(x => x.Sender == "assistant")
            .Select(x => new AssistantLogMessageDto(x.Id, x.Sender, x.Text, x.Kind, x.Intent.ToString(), x.Outcome, x.MatchedBy, x.ArticleId, x.Feedback, x.DurationMs, x.CreatedAtUtc))
            .ToListAsync(cancellationToken);
        var names = await NamesAsync(conversation.TenantId, cancellationToken);
        var customer = await db.Customers.AsNoTracking().IgnoreQueryFilters().Where(x => x.Id == conversation.UserId)
            .Select(x => new CustomerIdentity(x.FullName, x.Email, x.Phone)).FirstOrDefaultAsync(cancellationToken);
        var questions = messages.Where(x => x.Sender == "user").ToList();
        var row = new AssistantLogRowDto(
            conversation.Id, conversation.TenantId, names.Tenants.GetValueOrDefault(conversation.TenantId, "—"),
            conversation.BranchId is Guid b ? names.Branches.GetValueOrDefault(b) : null,
            UserOf(conversation.UserId, customer, names), conversation.Portal, conversation.Title,
            questions.Count, questions.Count(x => x.Outcome == "not_found"), messages.Count(x => x.Feedback == -1),
            conversation.CreatedAtUtc, conversation.LastMessageAtUtc);
        return Result<AssistantLogConversationDto>.Success(new AssistantLogConversationDto(row, messages));
    }

    public async Task<Result<IReadOnlyList<AssistantAccessLogDto>>> GetAccessLogAsync(int days, CancellationToken cancellationToken)
    {
        if (Deny() is { } denied) return Result<IReadOnlyList<AssistantAccessLogDto>>.Failure(denied);
        var from = DateTime.UtcNow.AddDays(-Math.Clamp(days, 1, 365));
        var rows = await db.AssistantAccessLogs.AsNoTracking()
            .Where(x => x.CreatedAtUtc >= from)
            .OrderByDescending(x => x.CreatedAtUtc).Take(500)
            .ToListAsync(cancellationToken);
        var names = await NamesAsync(null, cancellationToken);
        var platformUsers = await db.TenantUsers.AsNoTracking().IgnoreQueryFilters()
            .Where(x => x.Role == Domain.Enums.UserRole.PlatformAdmin)
            .Select(x => new { x.Id, x.Email }).ToDictionaryAsync(x => x.Id, x => x.Email, cancellationToken);
        return Result<IReadOnlyList<AssistantAccessLogDto>>.Success(rows.Select(x => new AssistantAccessLogDto(
                x.CreatedAtUtc, platformUsers.GetValueOrDefault(x.PlatformUserId, x.PlatformUserId.ToString()), x.Action, x.Reason, x.Note,
                x.TenantId is Guid t ? names.Tenants.GetValueOrDefault(t, "—") : null, x.ConversationId, x.Filter))
            .ToList());
    }

    // ── Yardımcılar ─────────────────────────────────────────────────────────

    private Error? Deny() => currentUser.IsPlatformAdmin ? null : Error.Forbidden("Sohbet kayıtları yalnız platform yöneticisine açıktır.");

    private static Error? InvalidReason(AssistantLogAccess access) =>
        AssistantLogAccess.Reasons.Contains(access.Reason) ? null
            : Error.Validation("Sohbet kayıtlarını açmak için erişim gerekçesi seçin (güvenlik, destek, şikâyet, kalite).");

    /// <summary>Önce iz: veri dönmeden erişim kaydı yazılır (yazılamazsa veri de dönmez).</summary>
    private async Task WriteAccessAsync(string action, AssistantLogAccess access, Guid? tenantId, Guid? conversationId, string? filter, CancellationToken ct)
    {
        db.AssistantAccessLogs.Add(new AssistantAccessLog
        {
            PlatformUserId = currentUser.UserId ?? Guid.Empty,
            Action = action,
            Reason = access.Reason,
            Note = string.IsNullOrWhiteSpace(access.Note) ? null : access.Note.Trim()[..Math.Min(access.Note.Trim().Length, 300)],
            TenantId = tenantId,
            ConversationId = conversationId,
            Filter = filter,
            IpAddress = currentUser.IpAddress,
        });
        await db.SaveChangesAsync(ct);
    }

    private sealed record CustomerIdentity(string FullName, string? Email, string Phone);

    private static AssistantLogUserDto? UserOf(Guid userId, CustomerIdentity? customer, Names names) =>
        names.Users.GetValueOrDefault(userId)
        ?? (customer is null ? null : new AssistantLogUserDto(userId, customer.FullName, customer.Email ?? customer.Phone, "Customer"));

    private sealed record Names(
        IReadOnlyDictionary<Guid, string> Tenants,
        IReadOnlyDictionary<Guid, string> Branches,
        IReadOnlyDictionary<Guid, AssistantLogUserDto> Users);

    /// <summary>Kurum, şube ve kullanıcı adları (şifreli kolonlar bellekte çözülür); kurum seçiliyse yalnız o kurum.</summary>
    private async Task<Names> NamesAsync(Guid? tenantId, CancellationToken ct)
    {
        var tenants = db.Tenants.AsNoTracking().IgnoreQueryFilters();
        var branches = db.Branches.AsNoTracking().IgnoreQueryFilters();
        var users = db.TenantUsers.AsNoTracking().IgnoreQueryFilters();
        if (tenantId is Guid id)
        {
            tenants = tenants.Where(x => x.Id == id);
            branches = branches.Where(x => x.TenantId == id);
            users = users.Where(x => x.TenantId == id);
        }
        return new Names(
            (await tenants.Select(x => new { x.Id, x.Name }).ToListAsync(ct)).ToDictionary(x => x.Id, x => x.Name),
            (await branches.Select(x => new { x.Id, x.Name }).ToListAsync(ct)).ToDictionary(x => x.Id, x => x.Name),
            (await users.Select(x => new { x.Id, x.FullName, x.Email, x.Role }).ToListAsync(ct))
                .ToDictionary(x => x.Id, x => new AssistantLogUserDto(x.Id, x.FullName, x.Email, x.Role.ToString())));
    }
}
