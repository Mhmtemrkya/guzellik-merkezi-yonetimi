using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// DESTEK TALEBİ — landing sayfasındaki Destek formundan ve panelden açılır, platform
/// yönetiminde kuyruk olarak görünür.
///
/// <para>
/// <b>TENANT ZORUNLU DEĞİLDİR.</b> Talep, henüz müşterisi olmayan bir ziyaretçiden de gelebilir
/// (tanıtım sayfasındaki form) — hatta en değerlileri odur. <c>TenantId</c> bu yüzden
/// <c>null</c> olabilir ve kayıt <b>kiracı kapsamına alınmaz</b>; global sorgu filtresi
/// uygulansaydı oturumsuz gelen talepler hiçbir listede görünmezdi.
/// </para>
///
/// <para>
/// <b>TenantId bir FK DEĞİL, kapsam kolonudur</b> (audit_logs ile aynı tercih). Kurum silinince
/// talep yetim kalır ama OKUNABİLİR kalır: kurum adı ve kodu <see cref="TenantNameSnapshot"/>
/// alanına talep açılırken yazılır. FK olsaydı kurum silme ya FK ihlaliyle patlar ya da destek
/// geçmişini sessizce yok ederdi.
/// </para>
///
/// <para>
/// <b>Takip kodu (<see cref="Code"/>) kimlik değildir.</b> Kullanıcının telefonda söyleyeceği
/// okunabilir bir referanstır: <c>DST-26-0042</c>. Kodu bilen birinin talebi görebilmesi için
/// ayrıca <see cref="AccessToken"/> gerekir — kod tahmin edilebilir (sıralı), jeton değildir.
/// </para>
/// </summary>
public sealed class SupportTicket : Entity
{
    private SupportTicket() { }

    public SupportTicket(
        string subject,
        string requesterName,
        string requesterEmail,
        SupportTicketCategory category,
        SupportTicketPriority priority,
        Guid? tenantId,
        string? tenantNameSnapshot,
        Guid? requesterUserId,
        string? requesterPhone)
    {
        Subject = Require(subject, MaxSubjectLength, "Konu");
        RequesterName = Require(requesterName, MaxNameLength, "Ad soyad");
        RequesterEmail = NormalizeEmail(requesterEmail);
        Category = category;
        Priority = priority;
        TenantId = tenantId == Guid.Empty ? null : tenantId;
        TenantNameSnapshot = Trim(tenantNameSnapshot, MaxNameLength);
        RequesterUserId = requesterUserId == Guid.Empty ? null : requesterUserId;
        RequesterPhone = Trim(requesterPhone, MaxPhoneLength);
        Status = SupportTicketStatus.Open;
    }

    public const int MaxSubjectLength = 180;
    public const int MaxNameLength = 160;
    public const int MaxEmailLength = 180;
    public const int MaxPhoneLength = 40;
    public const int MaxCodeLength = 20;
    public const int MaxTokenLength = 64;

    /// <summary>
    /// Okunabilir takip kodu — <c>DST-26-0042</c>. Kurum kodu (<see cref="Tenant.Code"/>) ile aynı
    /// gerekçe: telefonda söylenebilir, e-postada aranabilir, GUID'den insanca.
    /// </summary>
    public string Code { get; private set; } = string.Empty;

    /// <summary>
    /// Talebi OTURUMSUZ görüntülemek için gereken jeton.
    /// </summary>
    /// <remarks>
    /// Ziyaretçi talebini takip edebilmeli ama giriş yapamaz. Kod sıralı ve tahmin edilebilir
    /// olduğundan tek başına yetmez; jeton rastgeledir ve yalnız talep sahibine (e-postasına ve
    /// form sonrası ekranda) verilir.
    /// </remarks>
    public string AccessToken { get; private set; } = string.Empty;

    public string Subject { get; private set; } = string.Empty;
    public SupportTicketCategory Category { get; private set; }
    public SupportTicketPriority Priority { get; private set; }
    public SupportTicketStatus Status { get; private set; }

    /// <summary>Kapsam kolonu — FK DEĞİL (bkz. sınıf notu). Ziyaretçi talebinde null.</summary>
    public Guid? TenantId { get; private set; }

    /// <summary>
    /// Talep açılırken kopyalanan kurum adı/kodu. Kurum silinse bile kaydın okunabilir kalması için.
    /// </summary>
    public string? TenantNameSnapshot { get; private set; }

    /// <summary>Talebi açan panel kullanıcısı (varsa). Ziyaretçi talebinde null.</summary>
    public Guid? RequesterUserId { get; private set; }

    public string RequesterName { get; private set; } = string.Empty;
    public string RequesterEmail { get; private set; } = string.Empty;
    public string? RequesterPhone { get; private set; }

    /// <summary>Talebi üstlenen platform kullanıcısı.</summary>
    public Guid? AssignedToUserId { get; private set; }

    /// <summary>En son mesaj anı — kuyruk sıralaması bunun üzerinden yapılır.</summary>
    public DateTime LastMessageAtUtc { get; private set; } = DateTime.UtcNow;

    /// <summary>Platform ilk kez ne zaman yanıt verdi? (Yanıt süresi ölçümü.)</summary>
    public DateTime? FirstResponseAtUtc { get; private set; }

    public DateTime? ResolvedAtUtc { get; private set; }
    public DateTime? ClosedAtUtc { get; private set; }

    /// <summary>
    /// Talep sahibinin OKUMADIĞI platform mesajı var mı? (Ziyaretçi takip ekranındaki rozet.)
    /// </summary>
    public bool HasUnreadForRequester { get; private set; }

    /// <summary>Platformun okumadığı talep sahibi mesajı var mı? (Kuyruktaki rozet.)</summary>
    public bool HasUnreadForPlatform { get; private set; } = true;

    public ICollection<SupportTicketMessage> Messages { get; private set; } = new List<SupportTicketMessage>();

    // ------------------------------------------------------------------ kod + jeton

    /// <summary>Takip kodunu ve erişim jetonunu atar (yalnız oluşturma sırasında).</summary>
    public void AssignCode(string code, string accessToken)
    {
        if (!string.IsNullOrWhiteSpace(Code)) throw new DomainException("Takip kodu zaten atanmış.");
        if (string.IsNullOrWhiteSpace(code)) throw new DomainException("Takip kodu boş olamaz.");
        if (string.IsNullOrWhiteSpace(accessToken)) throw new DomainException("Erişim jetonu boş olamaz.");
        Code = code.Trim().ToUpperInvariant();
        AccessToken = accessToken.Trim();
    }

    // ------------------------------------------------------------------ mesaj

    /// <summary>
    /// Talebe mesaj ekler ve durumu mesajın tarafına göre ilerletir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>DURUM GEÇİŞİ MESAJIN YAN ETKİSİDİR, ayrı bir çağrı değil.</b> İkisini ayırmak,
    /// "yanıt yazdım ama durumu değiştirmeyi unuttum" halini üretir: talep sahibi yanıtı görür,
    /// kuyruk hâlâ "yeni" der ve ikinci bir temsilci aynı işe başlar.
    /// </para>
    /// <para>
    /// <b>ÇÖZÜLDÜ SAYILAN TALEBE GELEN YANIT ONU YENİDEN AÇAR.</b> "Hayır, hâlâ sorun var"
    /// diyen bir mesajın kapalı bir kutuya düşüp kimsenin görmemesi, destek sisteminin en sık
    /// ve en pahalı arızasıdır.
    /// </para>
    /// </remarks>
    public SupportTicketMessage AddMessage(SupportAuthorSide side, string body, Guid? authorUserId, string? authorName, DateTime nowUtc)
    {
        if (Status == SupportTicketStatus.Closed && side == SupportAuthorSide.Requester)
            throw new DomainException("Bu talep kapatıldı. Lütfen yeni bir talep oluşturun.");

        var message = new SupportTicketMessage(Id, side, body, authorUserId, authorName, nowUtc);
        Messages.Add(message);
        LastMessageAtUtc = nowUtc;

        switch (side)
        {
            case SupportAuthorSide.Platform:
                FirstResponseAtUtc ??= nowUtc;
                HasUnreadForRequester = true;
                HasUnreadForPlatform = false;
                // Platform yanıt yazdıysa iş ondan çıkmış, talep sahibine geçmiştir.
                if (Status is SupportTicketStatus.Open or SupportTicketStatus.InProgress)
                    Status = SupportTicketStatus.WaitingCustomer;
                break;

            case SupportAuthorSide.Requester:
                HasUnreadForPlatform = true;
                HasUnreadForRequester = false;
                // Çözüldü sanılan talep yeniden açılır (bkz. remarks).
                if (Status is SupportTicketStatus.WaitingCustomer or SupportTicketStatus.Resolved)
                {
                    Status = SupportTicketStatus.InProgress;
                    ResolvedAtUtc = null;
                }
                break;

            case SupportAuthorSide.System:
                // Sistem notu okunmamış saymaz: kimse ona yanıt beklemez.
                break;
        }

        Touch(nowUtc, authorUserId);
        return message;
    }

    // ------------------------------------------------------------------ durum

    /// <summary>Durumu platform ekibinin kararıyla değiştirir.</summary>
    public void ChangeStatus(SupportTicketStatus status, DateTime nowUtc, Guid? actorId)
    {
        if (Status == status) return;

        Status = status;
        ResolvedAtUtc = status == SupportTicketStatus.Resolved ? nowUtc : null;
        ClosedAtUtc = status == SupportTicketStatus.Closed ? nowUtc : null;

        // Sonuç talep sahibini ilgilendirir: rozeti yak ki takip ekranında fark etsin.
        if (status is SupportTicketStatus.Resolved or SupportTicketStatus.Closed)
            HasUnreadForRequester = true;

        Touch(nowUtc, actorId);
    }

    public void Assign(Guid? userId, DateTime nowUtc, Guid? actorId)
    {
        AssignedToUserId = userId == Guid.Empty ? null : userId;
        // Üstlenmek işin başladığı andır; "Açık" bırakmak kuyrukta iki kişinin aynı işe
        // başlamasına yol açardı.
        if (AssignedToUserId is not null && Status == SupportTicketStatus.Open)
            Status = SupportTicketStatus.InProgress;
        Touch(nowUtc, actorId);
    }

    public void SetPriority(SupportTicketPriority priority, DateTime nowUtc, Guid? actorId)
    {
        Priority = priority;
        Touch(nowUtc, actorId);
    }

    /// <summary>Platform kuyruğu açtı — okunmamış rozetini düşür.</summary>
    public void MarkReadByPlatform()
    {
        if (!HasUnreadForPlatform) return;
        HasUnreadForPlatform = false;
        Touch();
    }

    /// <summary>Talep sahibi takip ekranını açtı — okunmamış rozetini düşür.</summary>
    public void MarkReadByRequester()
    {
        if (!HasUnreadForRequester) return;
        HasUnreadForRequester = false;
        Touch();
    }

    // ------------------------------------------------------------------ yardımcılar

    private static string Require(string? value, int max, string field)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed)) throw new DomainException($"{field} zorunludur.");
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }

    private static string? Trim(string? value, int max)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed)) return null;
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }

    private static string NormalizeEmail(string? email)
    {
        var trimmed = email?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(trimmed) || !trimmed.Contains('@') || !trimmed.Contains('.'))
            throw new DomainException("Geçerli bir e-posta adresi zorunludur.");
        return trimmed.Length <= MaxEmailLength ? trimmed : trimmed[..MaxEmailLength];
    }
}
