using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Destek talebindeki TEK bir mesaj (yazışmanın bir satırı).
///
/// <para>
/// Yalnızca <see cref="SupportTicket.AddMessage"/> üzerinden oluşturulur: mesaj eklemenin
/// talebin durumunu ve okunmamış rozetlerini de ilerletmesi gerekir ve o karar tek yerde durur.
/// Doğrudan kurulabilseydi, mesaj eklenip talep "yeni" kalırdı.
/// </para>
/// </summary>
public sealed class SupportTicketMessage : Entity
{
    private SupportTicketMessage() { }

    internal SupportTicketMessage(
        Guid ticketId, SupportAuthorSide side, string body, Guid? authorUserId, string? authorName, DateTime nowUtc)
    {
        if (ticketId == Guid.Empty) throw new DomainException("Talep kimliği zorunlu.");
        var trimmed = body?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed)) throw new DomainException("Mesaj boş olamaz.");

        SupportTicketId = ticketId;
        Side = side;
        Body = trimmed.Length <= MaxBodyLength ? trimmed : trimmed[..MaxBodyLength];
        AuthorUserId = authorUserId == Guid.Empty ? null : authorUserId;
        AuthorName = string.IsNullOrWhiteSpace(authorName)
            ? null
            : (authorName.Trim().Length <= MaxAuthorNameLength ? authorName.Trim() : authorName.Trim()[..MaxAuthorNameLength]);
        SentAtUtc = nowUtc;
    }

    public const int MaxBodyLength = 4000;
    public const int MaxAuthorNameLength = 160;

    public Guid SupportTicketId { get; private set; }
    public SupportTicket? Ticket { get; private set; }

    /// <summary>Mesajı hangi TARAF yazdı (rol değil — bkz. <see cref="SupportAuthorSide"/>).</summary>
    public SupportAuthorSide Side { get; private set; }

    public string Body { get; private set; } = string.Empty;

    /// <summary>Yazan kullanıcı (varsa). Ziyaretçi mesajında ve sistem notunda null.</summary>
    public Guid? AuthorUserId { get; private set; }

    /// <summary>
    /// Yazanın görünen adı — mesaj anında KOPYALANIR.
    /// </summary>
    /// <remarks>
    /// Kullanıcı tablosundan okunsaydı, kullanıcı silindiğinde ya da adını değiştirdiğinde
    /// geçmiş yazışma ya boşalır ya da geriye dönük değişirdi. Yazışma bir KAYITTIR; yazıldığı
    /// andaki hâliyle durmalıdır.
    /// </remarks>
    public string? AuthorName { get; private set; }

    public DateTime SentAtUtc { get; private set; }
}
