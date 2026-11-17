using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <inheritdoc cref="ICustomerSmsService" />
public sealed class CustomerSmsService : ICustomerSmsService
{
    // METİNLER KISA TUTULUR: SMS parça başına ücretlenir (Unicode: 70 karakter 1 parça, üstü 67'lik
    // parçalar). Emoji yok — iki karakterlik yer kaplar. Link en sonda: bazı telefonlar ancak
    // boşlukla ayrılmış son kelimeyi tıklanabilir yapar.
    private const string RatingLinkText = "{salon}: Ziyaretiniz için teşekkürler {ad}! Deneyiminizi puanlayın: {link}";
    private const string WaitlistActivatedText = "Merhaba {ad}, {tarih} {saat} {hizmet}randevunuz oluşturuldu. {salon}";
    private const string KvkkInfoText = "{salon}: Kişisel verilerinize ilişkin KVKK aydınlatma metnimiz: {link}";
    private const string GiftCardText = "Merhaba{ad}, {salon} hediye kartınız hazır! Kod: {kod}.{gecerlilik} İşletmemizde kodu göstermeniz yeterli.";

    private readonly GuzellikDbContext _db;
    private readonly INotificationService _notifications;
    private readonly IConfiguration _config;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<CustomerSmsService> _logger;

    public CustomerSmsService(
        GuzellikDbContext db,
        INotificationService notifications,
        IConfiguration config,
        ICurrentUser currentUser,
        ILogger<CustomerSmsService> logger)
    {
        _db = db;
        _notifications = notifications;
        _config = config;
        _currentUser = currentUser;
        _logger = logger;
    }

    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

    public async Task<NotificationChannel> ResolveChannelAsync(Guid tenantId, OneWayMessageKind kind, CancellationToken ct = default)
    {
        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && !s.IsDeleted, ct);
        if (settings is null) return NotificationChannel.WhatsApp;
        return kind switch
        {
            OneWayMessageKind.RatingLink => settings.RatingLinkChannel,
            OneWayMessageKind.WaitlistActivated => settings.WaitlistActivatedChannel,
            OneWayMessageKind.Kvkk => settings.KvkkChannel,
            _ => NotificationChannel.WhatsApp,
        };
    }

    public async Task<WhatsAppDispatchReport> SendRatingLinkAsync(Guid tenantId, Guid appointmentId, Guid ratingToken, CancellationToken ct = default)
    {
        var appt = await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
            .Include(a => a.Customer)
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId, ct);
        if (appt?.Customer is null || string.IsNullOrWhiteSpace(appt.Customer.Phone)) return WhatsAppDispatchReport.Skipped;

        var salon = await TenantNameAsync(tenantId, ct);
        var body = RatingLinkText
            .Replace("{salon}", salon)
            .Replace("{ad}", FirstName(appt.Customer.FullName))
            .Replace("{link}", $"{FrontendBaseUrl()}/rate/{ratingToken}");

        // Randevu başına TEK değerlendirme SMS'i: iş kuyruğu yeniden denese de ikinci SMS gitmez.
        return Report(await _notifications.SendSystemSmsAsync(new SystemSmsRequest(
            tenantId, appt.BranchId, appt.CustomerId, appt.Customer.Phone!, body,
            "rating-link", $"sms:rating:{appointmentId:N}"), ct), "rating-link", appointmentId);
    }

    public async Task<WhatsAppDispatchReport> SendWaitlistActivatedAsync(Guid tenantId, Guid appointmentId, CancellationToken ct = default)
    {
        var appt = await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
            .Include(a => a.Customer).Include(a => a.ServiceDefinition).Include(a => a.Branch)
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId, ct);
        if (appt?.Customer is null || string.IsNullOrWhiteSpace(appt.Customer.Phone)) return WhatsAppDispatchReport.Skipped;

        var salon = string.IsNullOrWhiteSpace(appt.Branch?.Name) ? await TenantNameAsync(tenantId, ct) : appt.Branch!.Name;
        var local = appt.StartUtc.AddHours(3); // Türkiye UTC+3 (WhatsApp metniyle aynı kural)
        var service = (appt.ServiceDefinition?.Name ?? string.Empty).Trim();
        var body = WaitlistActivatedText
            .Replace("{ad}", FirstName(appt.Customer.FullName))
            .Replace("{tarih}", local.ToString("dd.MM.yyyy"))
            .Replace("{saat}", local.ToString("HH:mm"))
            .Replace("{hizmet}", service.Length == 0 ? string.Empty : $"{service} ")
            .Replace("{salon}", salon);

        return Report(await _notifications.SendSystemSmsAsync(new SystemSmsRequest(
            tenantId, appt.BranchId, appt.CustomerId, appt.Customer.Phone!, body,
            "waitlist-activated", $"sms:waitlist-activated:{appointmentId:N}"), ct), "waitlist-activated", appointmentId);
    }

    public async Task<WhatsAppDispatchReport> SendKvkkInfoAsync(Guid tenantId, Guid customerId, CancellationToken ct = default)
    {
        var customer = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == customerId && !c.IsDeleted, ct);
        if (customer is null || string.IsNullOrWhiteSpace(customer.Phone)) return WhatsAppDispatchReport.Skipped;
        // Zaten onaylıysa tekrar rahatsız etme (WhatsApp yoluyla aynı kural).
        if (customer.KvkkConsent) return WhatsAppDispatchReport.Skipped;

        // SMS'in tek içeriği linktir: link kurulamıyorsa (App:PublicBaseUrl tanımsız) boş bir
        // bilgilendirme göndermek yerine gönderim atlanır ve sebebi loglanır.
        var link = await KvkkLinkAsync(tenantId, ct);
        if (link is null)
        {
            _logger.LogWarning(
                "KVKK SMS'i gönderilmedi: aydınlatma metni linki kurulamadı (App:PublicBaseUrl ya da kurum slug'ı yok). Kurum {Tenant}",
                tenantId);
            return WhatsAppDispatchReport.Skipped;
        }

        var salon = await SalonNameAsync(tenantId, customer.BranchId, ct);
        var body = KvkkInfoText.Replace("{salon}", salon).Replace("{link}", link);

        // Gün kovası: kuyruğun yeniden denemesi aynı gün ikinci SMS üretmez; kurum toplu isteği
        // sonraki bir gün bilerek yinelerse gönderim yapılabilir.
        var day = DateTime.UtcNow.ToString("yyyyMMdd");
        return Report(await _notifications.SendSystemSmsAsync(new SystemSmsRequest(
            tenantId, customer.BranchId, customer.Id, customer.Phone!, body,
            "kvkk-info", $"sms:kvkk:{customerId:N}:{day}"), ct), "kvkk-info", customerId);
    }

    public async Task<Result<SmsSendResultDto>> SendGiftCardAsync(Guid tenantId, SendGiftCardSmsRequest request, CancellationToken ct = default)
    {
        /*
         * ŞUBE KAPSAMI KORUNUR — `IgnoreQueryFilters` YOK (WhatsApp gönderimiyle aynı gerekçe):
         * istek bağlamında global filtre tenant VE şubeyi uygular; aynı kurumun BAŞKA şubesine ait
         * bir kart kimliği bilinse bile gönderilemez. Bulunamamak = yetkisiz; ayrı mesaj verilmez.
         */
        var card = await _db.GiftCards.AsNoTracking()
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == request.GiftCardId, ct);
        if (card is null) return Result<SmsSendResultDto>.Failure(Error.NotFound("Hediye kartı bulunamadı."));

        if (!card.IsValid(DateTime.UtcNow))
            return Result<SmsSendResultDto>.Failure(Error.Validation("Kart geçerli değil (pasif, süresi dolmuş, hakkı bitmiş veya bakiyesi yok)."));

        var phone = (request.Phone ?? string.Empty).Trim();
        Domain.Entities.Customer? customer = null;
        if (card.CustomerId.HasValue)
        {
            customer = await _db.Customers.AsNoTracking()
                .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == card.CustomerId.Value, ct);
            if (phone.Length == 0) phone = customer?.Phone ?? string.Empty;
        }
        if (phone.Length == 0)
            return Result<SmsSendResultDto>.Failure(Error.Validation("Gönderilecek telefon numarası yok."));

        // NUMARA KEYFİ OLAMAZ: müşteriye bağlı kart YALNIZ o müşterinin kayıtlı numarasına gider;
        // aksi hâlde uç, kurumun kredisiyle değerli bir kodu istenen numaraya gönderen bir kanal olurdu.
        if (customer is not null)
        {
            var registered = PhoneMask.LoginKey(customer.Phone);
            if (registered.Length == 0)
                return Result<SmsSendResultDto>.Failure(Error.Validation("Karta bağlı müşterinin kayıtlı telefonu yok."));
            if (PhoneMask.LoginKey(phone) != registered)
                return Result<SmsSendResultDto>.Failure(Error.Validation(
                    "Bu kart bir müşteriye tanımlı; yalnızca o müşterinin kayıtlı numarasına gönderilebilir."));
            phone = customer.Phone!;
        }

        var salon = await SalonNameAsync(tenantId, card.BranchId, ct);
        var firstName = customer is null ? string.Empty : FirstName(customer.FullName);
        var validity = card.ValidUntilUtc.HasValue
            ? $" Son kullanma: {card.ValidUntilUtc.Value.AddHours(3):dd.MM.yyyy}."
            : string.Empty;
        var body = GiftCardText
            .Replace("{ad}", firstName.Length == 0 ? string.Empty : $" {firstName}")
            .Replace("{salon}", salon)
            .Replace("{kod}", card.Code)
            .Replace("{gecerlilik}", validity);

        // DAKİKA KOVASI: çift tıklama / ağ tekrarı aynı kodu iki kez göndermesin (ikincisi kredi de
        // harcardı). Kurum bir dakika sonra bilerek yeniden gönderebilir.
        var minute = DateTime.UtcNow.ToString("yyyyMMddHHmm");
        var outcome = await _notifications.SendSystemSmsAsync(new SystemSmsRequest(
            tenantId, card.BranchId, card.CustomerId, phone, body,
            "gift-card", $"sms:gift-card:{card.Id:N}:{minute}"), ct);

        var shownPhone = IsStaffViewer ? PhoneMask.Mask(phone) : phone;
        return outcome.Status switch
        {
            SystemSmsStatus.Sent => Result<SmsSendResultDto>.Success(new SmsSendResultDto(
                true, false, shownPhone, outcome.Body, outcome.Parts, outcome.ChargedCredits, null)),
            SystemSmsStatus.AlreadyHandled => Result<SmsSendResultDto>.Failure(Error.Conflict(
                "Bu kart az önce gönderildi. Tekrar göndermek için bir dakika bekleyin.")),
            SystemSmsStatus.Blocked => Result<SmsSendResultDto>.Failure(Error.Conflict(outcome.Error ?? "SMS gönderilemedi.")),
            // Simülasyon (sağlayıcı kurulu değil) hata değil bilgi olarak döner: arayüz "gönderilmedi"
            // diye gösterir; sahte "gönderildi" yazılmaz.
            _ when outcome.Simulated => Result<SmsSendResultDto>.Success(new SmsSendResultDto(
                false, true, shownPhone, outcome.Body, outcome.Parts, 0m, outcome.Error)),
            _ => Result<SmsSendResultDto>.Failure(Error.Validation(outcome.Error ?? "SMS gönderilemedi.")),
        };
    }

    /// <summary>
    /// Sistem SMS sonucunu iş kuyruğunun diline çevirir. Bilerek atlanan (zaten gönderilmiş,
    /// kota/kredi izin vermedi, sağlayıcı kurulu değil) başarıdır; yalnız sağlayıcının gerçek
    /// reddi "başarısız" döner ki dead-letter'da görünsün. Yeniden deneme aynı anahtara çarpar ve
    /// ikinci SMS GÖNDERMEZ (kayıt terminal).
    /// </summary>
    private WhatsAppDispatchReport Report(SystemSmsOutcome outcome, string purpose, Guid entityId)
    {
        switch (outcome.Status)
        {
            case SystemSmsStatus.Sent:
                return WhatsAppDispatchReport.Sent;
            case SystemSmsStatus.AlreadyHandled:
                return WhatsAppDispatchReport.Skipped;
            case SystemSmsStatus.Blocked:
                _logger.LogInformation("SMS ({Purpose}) gönderilmedi: {Reason} ({Entity})", purpose, outcome.Error, entityId);
                return WhatsAppDispatchReport.Skipped;
            default:
                if (outcome.Simulated) return WhatsAppDispatchReport.Skipped;
                return WhatsAppDispatchReport.Failed(outcome.Error);
        }
    }

    private async Task<string> TenantNameAsync(Guid tenantId, CancellationToken ct) =>
        await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? "Salonumuz";

    /// <summary>Şube adı yoksa kurum adına düşer — imzasız mesaj gitmesin.</summary>
    private async Task<string> SalonNameAsync(Guid tenantId, Guid? branchId, CancellationToken ct)
    {
        var name = branchId is { } bid
            ? await _db.Branches.IgnoreQueryFilters().AsNoTracking().Where(b => b.Id == bid).Select(b => b.Name).FirstOrDefaultAsync(ct)
            : null;
        return string.IsNullOrWhiteSpace(name) ? await TenantNameAsync(tenantId, ct) : name!;
    }

    /// <summary>Herkese açık KVKK metni sayfası (WhatsApp mesajındaki linkle aynı adres).</summary>
    private async Task<string?> KvkkLinkAsync(Guid tenantId, CancellationToken ct)
    {
        var baseUrl = _config["App:PublicBaseUrl"]?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl)) return null;
        var slug = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.Slug).FirstOrDefaultAsync(ct);
        return string.IsNullOrWhiteSpace(slug) ? null : $"{baseUrl}/kvkk/{slug}";
    }

    /// <summary>Değerlendirme sayfasının tabanı (WhatsApp linkiyle aynı kaynak sırası).</summary>
    private string FrontendBaseUrl() =>
        (_config["Frontend:PublicBaseUrl"] ?? _config["WhatsApp:PublicBaseUrl"] ?? "http://localhost:3000").TrimEnd('/');

    private static string FirstName(string? fullName) =>
        string.IsNullOrWhiteSpace(fullName) ? "Değerli müşterimiz" : fullName.Trim().Split(' ')[0];
}
