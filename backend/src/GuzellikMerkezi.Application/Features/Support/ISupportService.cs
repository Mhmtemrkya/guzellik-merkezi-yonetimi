using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Support;

/// <summary>
/// DESTEK TALEPLERİ — tanıtım sayfasındaki Destek formu + panelden açılan talepler, platform
/// yönetiminde tek kuyrukta toplanır.
///
/// <para>
/// ÜÇ AYRI GİRİŞ, TEK KUYRUK:
/// <list type="bullet">
///   <item><b>Ziyaretçi</b> (oturumsuz): tanıtım sayfasındaki form. Takip, kod + jetonla yapılır.</item>
///   <item><b>Kurum kullanıcısı</b> (oturumlu): panelden açar, kendi taleplerini listeler.</item>
///   <item><b>Platform</b>: tüm kuyruğu görür, yanıtlar, durum ve öncelik değiştirir.</item>
/// </list>
/// </para>
/// </summary>
public interface ISupportService
{
    // ---------------------------------------------------------------- herkese açık (anonim)

    /// <summary>
    /// Yeni talep açar. Oturum varsa kurum ve kullanıcı bilgisi ondan alınır; yoksa formdaki
    /// ad/e-posta kullanılır. Yanıt takip kodunu VE jetonunu taşır — jeton bir daha gösterilmez.
    /// </summary>
    Task<Result<SupportTicketCreatedDto>> CreateAsync(CreateSupportTicketRequest request, CancellationToken ct = default);

    /// <summary>Kod + jetonla talebi görüntüler (oturumsuz takip).</summary>
    Task<Result<SupportTicketDetailDto>> GetByTokenAsync(string code, string token, CancellationToken ct = default);

    /// <summary>Kod + jetonla talebe yanıt yazar (oturumsuz).</summary>
    Task<Result<SupportTicketDetailDto>> ReplyByTokenAsync(string code, string token, SupportReplyRequest request, CancellationToken ct = default);

    // ---------------------------------------------------------------- kurum paneli

    /// <summary>Oturumdaki kurumun talepleri.</summary>
    Task<Result<PagedResult<SupportTicketListItemDto>>> ListMineAsync(SupportTicketQuery query, CancellationToken ct = default);

    /// <summary>Kurumun KENDİ talebinin ayrıntısı (başka kurumun talebi görünmez).</summary>
    Task<Result<SupportTicketDetailDto>> GetMineAsync(Guid id, CancellationToken ct = default);

    /// <summary>Kurumun kendi talebine yanıt yazar.</summary>
    Task<Result<SupportTicketDetailDto>> ReplyMineAsync(Guid id, SupportReplyRequest request, CancellationToken ct = default);

    // ---------------------------------------------------------------- platform

    Task<Result<PagedResult<SupportTicketListItemDto>>> ListAllAsync(SupportTicketQuery query, CancellationToken ct = default);
    Task<Result<SupportTicketDetailDto>> GetAsync(Guid id, CancellationToken ct = default);
    Task<Result<SupportTicketDetailDto>> ReplyAsync(Guid id, SupportReplyRequest request, CancellationToken ct = default);
    Task<Result<SupportTicketDetailDto>> UpdateAsync(Guid id, UpdateSupportTicketRequest request, CancellationToken ct = default);

    /// <summary>Kuyruk özeti — platform panelindeki sayaçlar.</summary>
    Task<Result<SupportSummaryDto>> GetSummaryAsync(CancellationToken ct = default);
}

/// <param name="TenantId">
/// Oturumsuz akışta istemci kurum SEÇEMEZ; alan yalnız oturumlu akışta sunucu tarafından
/// doldurulur. İstemciden gelen değer GÖZ ARDI EDİLİR — aksi hâlde bir ziyaretçi başka bir
/// kurumun adına talep açıp o kurumun destek geçmişine satır ekleyebilirdi.
/// </param>
public sealed record CreateSupportTicketRequest(
    string Subject,
    string Message,
    string? Name,
    string? Email,
    string? Phone,
    SupportTicketCategory Category = SupportTicketCategory.General,
    SupportTicketPriority Priority = SupportTicketPriority.Normal);

public sealed record SupportReplyRequest(string Message);

public sealed record UpdateSupportTicketRequest(
    SupportTicketStatus? Status,
    SupportTicketPriority? Priority,
    /// <summary>Üstlenen platform kullanıcısı. <c>Guid.Empty</c> göndermek atamayı KALDIRIR.</summary>
    Guid? AssignedToUserId);

/// <param name="Scope">
/// <c>"open"</c> (Açık + Devam ediyor + Müşteri bekleniyor), <c>"mine"</c> (bana atanan),
/// <c>"unread"</c> (okunmamış), <c>"closed"</c> (Çözüldü + Kapalı) ya da boş (tümü).
/// </param>
public sealed record SupportTicketQuery(
    string? Scope = null,
    string? Search = null,
    SupportTicketStatus? Status = null,
    SupportTicketPriority? Priority = null,
    SupportTicketCategory? Category = null,
    int Page = 1,
    int PageSize = 25);

/// <param name="AccessToken">
/// YALNIZ BURADA döner. Talep listesinde ve ayrıntısında asla yer almaz: jetonu gören herkes
/// talebi açabilir, dolayısıyla yalnız onu üreten isteğin yanıtında verilir.
/// </param>
public sealed record SupportTicketCreatedDto(Guid Id, string Code, string AccessToken, string TrackUrl);

public sealed record SupportTicketListItemDto(
    Guid Id,
    string Code,
    string Subject,
    SupportTicketStatus Status,
    SupportTicketPriority Priority,
    SupportTicketCategory Category,
    string RequesterName,
    string RequesterEmail,
    string? TenantName,
    Guid? TenantId,
    Guid? AssignedToUserId,
    string? AssignedToName,
    DateTime CreatedAtUtc,
    DateTime LastMessageAtUtc,
    bool HasUnreadForPlatform,
    bool HasUnreadForRequester,
    int MessageCount);

public sealed record SupportTicketDetailDto(
    Guid Id,
    string Code,
    string Subject,
    SupportTicketStatus Status,
    SupportTicketPriority Priority,
    SupportTicketCategory Category,
    string RequesterName,
    string RequesterEmail,
    string? RequesterPhone,
    string? TenantName,
    Guid? TenantId,
    Guid? AssignedToUserId,
    string? AssignedToName,
    DateTime CreatedAtUtc,
    DateTime LastMessageAtUtc,
    DateTime? FirstResponseAtUtc,
    DateTime? ResolvedAtUtc,
    IReadOnlyList<SupportMessageDto> Messages);

public sealed record SupportMessageDto(
    Guid Id,
    SupportAuthorSide Side,
    string Body,
    string? AuthorName,
    DateTime SentAtUtc);

/// <summary>Platform kuyruğunun özeti — sayfanın üstündeki sayaçlar.</summary>
public sealed record SupportSummaryDto(
    int Open,
    int InProgress,
    int WaitingCustomer,
    int Unread,
    int Urgent,
    int ResolvedLast7Days,
    /// <summary>Ortalama ilk yanıt süresi (saat) — son 30 günde yanıtlanan talepler.</summary>
    double? AvgFirstResponseHours);
