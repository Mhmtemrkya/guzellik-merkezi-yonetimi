using GuzellikMerkezi.Domain.Assistant;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Maydi sohbeti — kişiye özeldir (başkası okuyamaz). Şube yöneticisinin "Maydi Soruları" ekranı yalnız kendi
/// şubesindeki cevaplanamayan soruları görür (BranchId). Yalnız eklenir/arşivlenir; denetim alanları gerekmez.
/// </summary>
public sealed class AssistantConversation
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid? BranchId { get; set; }
    public Guid UserId { get; set; }
    /// <summary>owner, branch, staff, customer (bkz. <see cref="AssistantPortals"/>).</summary>
    public string Portal { get; set; } = string.Empty;
    public string Title { get; set; } = "Yeni sohbet";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime LastMessageAtUtc { get; set; } = DateTime.UtcNow;
    public bool IsArchived { get; set; }
}

/// <summary>
/// Maydi sohbetindeki tek mesaj. KVKK: buluta giden maskeli metin BURADA SAKLANMAZ; saklanan, kullanıcının kendi
/// kurumunun veritabanındaki sorusu ve Maydi'nin cevabıdır. Cevap verisi (kart) JSON olarak tutulur.
/// </summary>
public sealed class AssistantMessage
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid? BranchId { get; set; }
    public Guid ConversationId { get; set; }
    public Guid UserId { get; set; }
    /// <summary>"user" ya da "assistant".</summary>
    public string Sender { get; set; } = "user";
    public string Text { get; set; } = string.Empty;
    public AssistantIntent Intent { get; set; }
    /// <summary>answered, how_to, other_portal, not_found, denied, advice_refused, small_talk, error.</summary>
    public string Outcome { get; set; } = string.Empty;
    /// <summary>Yardım cevabında makale nasıl seçildi: ai, rule, rule_spelling.</summary>
    public string MatchedBy { get; set; } = string.Empty;
    public string? ArticleId { get; set; }
    /// <summary>Cevap türü: text, how_to, data, quick_actions.</summary>
    public string Kind { get; set; } = "text";
    public string PayloadJson { get; set; } = "{}";
    /// <summary>👍 = 1, 👎 = -1, yok = null.</summary>
    public short? Feedback { get; set; }
    public Guid? ClientMessageId { get; set; }
    public int DurationMs { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Platform yöneticisinin Maydi sohbet kayıtlarına erişim izi: kim, hangi kurumun/sohbetin kaydını, ne zaman,
/// hangi gerekçeyle açtı. Yalnız eklenir; kurum silinse bile KALIR (TenantPurge.KeepTables) — erişimin
/// hesabı, erişilen verinin kendisinden uzun yaşamalıdır.
/// </summary>
public sealed class AssistantAccessLog
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid PlatformUserId { get; set; }
    /// <summary>list (sohbet listesi) ya da view (sohbet detayı).</summary>
    public string Action { get; set; } = string.Empty;
    /// <summary>security, support, complaint, quality.</summary>
    public string Reason { get; set; } = string.Empty;
    public string? Note { get; set; }
    public Guid? TenantId { get; set; }
    public Guid? ConversationId { get; set; }
    /// <summary>Liste filtrelerinin özeti (gün, sonuç vb.) — kişisel veri içermez.</summary>
    public string? Filter { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}
