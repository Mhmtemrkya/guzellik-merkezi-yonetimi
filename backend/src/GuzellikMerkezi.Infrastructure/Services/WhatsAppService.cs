using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class WhatsAppService : IWhatsAppService
{
    private const string DefaultTemplate =
        "Merhaba {ad}, {tarih} {saat} tarihli {hizmet} randevunuzu hatırlatırız. " +
        "Onaylıyorsanız EVET, iptal için HAYIR, ertelemek için ERTELE yazın. — {salon}";

    // Bekleme listesi otomasyonu şablonları (sabit — hatırlatma şablonundan bağımsız).
    // {hizmet} boş gelebildiğinden şablonlarda "{hizmet}" yerine hizmet cümleciği ({hizmetcumle})
    // kullanılır: hizmet varsa "Lazer Epilasyon randevusu", yoksa sadece "randevu" yazılır.
    private const string WaitlistOfferTemplate =
        "Merhaba {ad}, bekleme listesinde olduğunuz {tarih} {saat} için yer açıldı! " +
        "{hizmetcumlei} istiyorsanız EVET, vazgeçmek için HAYIR yazın.{salonimza}";
    private const string WaitlistActivatedTemplate =
        "Merhaba {ad}, {tarih} {saat} için {hizmetcumlen} oluşturuldu. Sizi bekliyoruz!{salonimza}";
    /// <summary>KVKK açık rıza isteği. Müşteri ONAYLIYORUM yazınca kayıt otomatik onaylanır.</summary>
    /// <summary>KVKK isteği mesajının şablon adı — gelen yanıt bununla eşleştirilir.</summary>
    private const string KvkkTemplateName = "kvkk-consent";
    private const string KvkkConsentTemplate =
        "Merhaba {ad}, {salon} olarak kişisel verilerinizi (ad, telefon, işlem geçmişi) randevu ve " +
        "hizmet süreçlerinizi yürütmek için işliyoruz. Aydınlatma metnimiz ekteki PDF'tedir. " +
        "KVKK kapsamında açık rızanızı veriyorsanız ONAYLIYORUM yazmanız yeterlidir; dilediğiniz " +
        "zaman geri çekebilirsiniz.{link}";
    /// <summary>Onay alındıktan sonra müşteriye gönderilen teşekkür/bilgi mesajı.</summary>
    private const string KvkkThanksTemplate =
        "Teşekkürler {ad}, KVKK onayınız kaydedildi. İyi günler dileriz! — {salon}";
    private const string RatingLinkTemplate =
        "Merhaba {ad}! {salon} ziyaretiniz için teşekkür ederiz 💐 Deneyiminizi 1 dakikada değerlendirir misiniz? " +
        "Hem personelimizi hem salonumuzu puanlayabilirsiniz: {link} (Bağlantı 24 saat geçerlidir.)";

    private readonly GuzellikDbContext _db;
    private readonly IEncryptionService _encryption;
    private readonly IHttpClientFactory _httpFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<WhatsAppService> _logger;
    private readonly IFeatureService _features;
    private readonly IWhatsAppBillingService _billing;
    private readonly ICurrentUser _currentUser;
    private readonly IWaitlistService _waitlist;
    private readonly Application.Features.AppNotifications.IAppNotificationService _notifications;
    private readonly Application.Features.PublicSalons.IKvkkDocumentService _kvkkDocuments;

    /// <summary>
    /// Randevu durum geçişleri KANONİK servisten geçer (kilit + taze okuma). Çalışma anında
    /// çözülür: AppointmentService → IWaitlistService → … zinciri ctor bağımlılığında döngü riski taşır.
    /// </summary>
    private readonly IServiceProvider _services;

    public WhatsAppService(GuzellikDbContext db, IEncryptionService encryption, IHttpClientFactory httpFactory, IConfiguration config, ILogger<WhatsAppService> logger, IFeatureService features, IWhatsAppBillingService billing, ICurrentUser currentUser, IWaitlistService waitlist, Application.Features.AppNotifications.IAppNotificationService notifications, Application.Features.PublicSalons.IKvkkDocumentService kvkkDocuments, IServiceProvider services)
    {
        _db = db;
        _encryption = encryption;
        _httpFactory = httpFactory;
        _config = config;
        _logger = logger;
        _features = features;
        _billing = billing;
        _currentUser = currentUser;
        _waitlist = waitlist;
        _notifications = notifications;
        _kvkkDocuments = kvkkDocuments;
        _services = services;
    }

    // Personel müşteri telefonunu yalnızca son 4 hane görür; ham numara API'den hiç çıkmaz.
    private bool IsStaffViewer => _currentUser.Role == UserRole.Staff;

    // ==================== KURUM: AYAR (içerik + faturalama tercihleri) ====================

    public async Task<Result<WhatsAppSettingsDto>> GetSettingsAsync(Guid tenantId, CancellationToken ct = default)
    {
        var s = await _db.WhatsAppSettings.AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        return Result<WhatsAppSettingsDto>.Success(BuildSettingsDto(s));
    }

    public async Task<Result<WhatsAppSettingsDto>> SaveSettingsAsync(Guid tenantId, SaveWhatsAppSettingsRequest request, CancellationToken ct = default)
    {
        var s = await _db.WhatsAppSettings.FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        if (s is null)
        {
            s = new WhatsAppSettings(tenantId);
            _db.WhatsAppSettings.Add(s);
        }
        s.UpdateContent(request.ReminderTemplate);
        s.UpdateBillingPreferences(request.MarketingEnabled, request.AllowWalletOverage, request.MonthlySpendCapTry);
        s.UpdateTemplateBindings(request.KvkkTemplateName, request.ReminderTemplateName, request.TemplateLanguageCode);
        await _db.SaveChangesAsync(ct);
        return Result<WhatsAppSettingsDto>.Success(BuildSettingsDto(s));
    }

    // ==================== PLATFORM: BAĞLANTI YÖNETİMİ ====================

    public async Task<Result<IReadOnlyCollection<WhatsAppConnectionDto>>> GetConnectionsAsync(CancellationToken ct = default)
    {
        var webhookUrl = BuildWebhookUrl();
        var tenants = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Include(t => t.SubscriptionPlan)
            .Where(t => !t.IsDeleted)
            .Select(t => new { t.Id, t.Name, PlanName = t.SubscriptionPlan != null ? t.SubscriptionPlan.Name : null })
            .ToListAsync(ct);

        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
            .Where(x => !x.IsDeleted)
            .ToListAsync(ct);
        var byTenant = settings.ToDictionary(x => x.TenantId);

        var list = tenants.Select(t =>
        {
            byTenant.TryGetValue(t.Id, out var s);
            return new WhatsAppConnectionDto(
                t.Id, t.Name, t.PlanName,
                s?.PhoneNumberId, s?.BusinessAccountId, s?.DisplayPhoneNumber,
                (s?.ConnectionStatus ?? WhatsAppConnectionStatus.NotConnected).ToString(),
                s?.IsConnected ?? false,
                !string.IsNullOrWhiteSpace(s?.AccessTokenEncrypted),
                webhookUrl);
        }).OrderBy(x => x.TenantName).ToList();

        return Result<IReadOnlyCollection<WhatsAppConnectionDto>>.Success(list);
    }

    public async Task<Result<WhatsAppConnectionDto>> BindConnectionAsync(Guid tenantId, BindWhatsAppConnectionRequest request, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.IgnoreQueryFilters().Include(t => t.SubscriptionPlan)
            .FirstOrDefaultAsync(t => t.Id == tenantId && !t.IsDeleted, ct);
        if (tenant is null) return Result<WhatsAppConnectionDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var s = await _db.WhatsAppSettings.IgnoreQueryFilters().FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        if (s is null)
        {
            s = new WhatsAppSettings(tenantId);
            _db.WhatsAppSettings.Add(s);
        }

        if (!Enum.TryParse<WhatsAppConnectionStatus>(request.ConnectionStatus, ignoreCase: true, out var status))
            status = string.IsNullOrWhiteSpace(request.PhoneNumberId) ? WhatsAppConnectionStatus.NotConnected : WhatsAppConnectionStatus.Connected;

        // Aynı phone_number_id başka kuruma bağlı mı? (webhook tenant çözümü tekilliğe dayanır)
        if (!string.IsNullOrWhiteSpace(request.PhoneNumberId))
        {
            var clash = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(x => x.TenantId != tenantId && !x.IsDeleted && x.PhoneNumberId == request.PhoneNumberId.Trim(), ct);
            if (clash) return Result<WhatsAppConnectionDto>.Failure(Error.Conflict("Bu numara (phone_number_id) başka bir kuruma bağlı."));
        }

        s.BindConnection(request.PhoneNumberId, request.BusinessAccountId, request.DisplayPhoneNumber, status, request.VerifyToken);
        if (request.AccessTokenOverride is not null)
        {
            var enc = string.IsNullOrWhiteSpace(request.AccessTokenOverride) ? null : _encryption.Encrypt(request.AccessTokenOverride.Trim());
            s.SetAccessTokenOverride(enc);
        }
        await _db.SaveChangesAsync(ct);

        return Result<WhatsAppConnectionDto>.Success(new WhatsAppConnectionDto(
            tenant.Id, tenant.Name, tenant.SubscriptionPlan?.Name,
            s.PhoneNumberId, s.BusinessAccountId, s.DisplayPhoneNumber,
            s.ConnectionStatus.ToString(), s.IsConnected,
            !string.IsNullOrWhiteSpace(s.AccessTokenEncrypted), BuildWebhookUrl()));
    }

    public async Task<Result<ReminderResultDto>> SendTestMessageAsync(Guid tenantId, SendTestMessageRequest request, CancellationToken ct = default)
    {
        var toPhone = NormalizePhone(request.ToPhone);
        if (toPhone.Length == 0) return Result<ReminderResultDto>.Failure(Error.Validation("Geçerli bir telefon numarası girin."));

        var salon = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? "Salonumuz";
        var body = string.IsNullOrWhiteSpace(request.Text)
            ? $"Merhaba! {salon} WhatsApp bağlantısı başarıyla test edildi. ✅"
            : request.Text!.Trim();

        var ctx = await ResolveSendContextAsync(tenantId, ct);
        if (!ctx.Live)
            return Result<ReminderResultDto>.Failure(Error.Conflict("Kurumun WhatsApp bağlantısı aktif değil. Önce numarayı bağlayın ve durumu 'Connected' yapın."));

        var outcome = await SendViaMetaAsync(ctx.PhoneNumberId!, ctx.Token, toPhone, body, ct);
        _db.WhatsAppMessages.Add(new WhatsAppMessage(
            tenantId, null, null, null, WhatsAppMessageDirection.Outbound,
            toPhone, body, outcome.Success ? WhatsAppMessageStatus.Sent : WhatsAppMessageStatus.Failed,
            templateName: "connection-test", providerMessageId: outcome.ProviderMessageId, error: outcome.Error,
            category: WhatsAppMessageCategory.Utility, billingSource: WhatsAppBillingSource.None));
        await _db.SaveChangesAsync(ct);

        return Result<ReminderResultDto>.Success(new ReminderResultDto(outcome.Success, false, toPhone, body, outcome.ProviderMessageId, outcome.Error));
    }

    // ==================== GÖNDERİM ====================

    public async Task<Result<ReminderResultDto>> SendReminderAsync(Guid tenantId, Guid appointmentId, CancellationToken ct = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsWhatsApp, ct))
            return Result<ReminderResultDto>.Failure(Error.Conflict("WhatsApp gönderimi paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));

        var appt = await _db.Appointments
            .Include(a => a.Customer)
            .Include(a => a.ServiceDefinition)
            .Include(a => a.Branch)
            .Include(a => a.StaffMember)
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId, ct);
        if (appt is null) return Result<ReminderResultDto>.Failure(Error.NotFound("Randevu bulunamadı."));

        var phone = appt.Customer?.Phone;
        if (string.IsNullOrWhiteSpace(phone))
            return Result<ReminderResultDto>.Failure(Error.Validation("Müşterinin telefon numarası yok; hatırlatma gönderilemez."));

        var settings = await _db.WhatsAppSettings.FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        var body = RenderTemplate(settings?.ReminderTemplate ?? DefaultTemplate, appt);

        var result = await DispatchAsync(tenantId, appt.BranchId, appt.Id, appt.CustomerId, waitlistEntryId: null,
            phone!, body, WhatsAppMessageCategory.Utility, templateName: "reminder", ct);

        if (result.Blocked)
            return Result<ReminderResultDto>.Failure(Error.Conflict(result.BlockReason!));

        if (result.Success)
        {
            appt.MarkReminderSent();
            await _db.SaveChangesAsync(ct);
        }

        var resultPhone = IsStaffViewer ? PhoneMask.Mask(result.ToPhone) : result.ToPhone;
        return Result<ReminderResultDto>.Success(new ReminderResultDto(result.Success, result.Simulated, resultPhone, body, result.ProviderMessageId, result.Error));
    }

    public async Task<Result<IReadOnlyCollection<WhatsAppMessageDto>>> RecentMessagesAsync(Guid tenantId, Guid? appointmentId, CancellationToken ct = default)
    {
        var q = _db.WhatsAppMessages.AsNoTracking().Where(m => m.TenantId == tenantId);
        if (appointmentId.HasValue) q = q.Where(m => m.AppointmentId == appointmentId.Value);
        var rows = await q.OrderByDescending(m => m.CreatedAtUtc).Take(50)
            .Select(m => new WhatsAppMessageDto(m.Id, m.AppointmentId, m.CustomerId, m.Direction, m.Phone, m.Body, m.Status, m.Intent, m.ProviderMessageId, m.ErrorMessage, m.CreatedAtUtc, m.Category, m.BillingSource, m.ChargedAmountTry))
            .ToListAsync(ct);
        if (IsStaffViewer) rows = rows.Select(r => r with { Phone = PhoneMask.Mask(r.Phone) }).ToList();
        return Result<IReadOnlyCollection<WhatsAppMessageDto>>.Success(rows);
    }

    /// <summary>
    /// GÖNDERİM SONUCUNU ÇAĞIRANA (kuyruğa) BİLDİRİR.
    ///
    /// <para>
    /// Bu yol eskiden her hatayı yutup normal dönüyordu; kalıcı iş kuyruğu bunu BAŞARI sayıp işi
    /// kapatıyor, gönderilemeyen teklif hiç yeniden denenmeden kayboluyordu. Artık "bilerek
    /// atlandı" ile "gönderilemedi" ayrılır; ikincisinde kuyruk yeniden dener, tükenirse
    /// dead-letter'a düşer ve sistem sayfasında görünür.
    /// </para>
    /// </summary>
    public async Task<WhatsAppDispatchReport> SendWaitlistOfferAsync(Guid tenantId, Guid waitlistEntryId, CancellationToken ct = default)
    {
        try
        {
            var entry = await _db.WaitlistEntries.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(w => w.TenantId == tenantId && w.Id == waitlistEntryId && !w.IsDeleted, ct);
            if (entry is null || entry.PreferredStartUtc is not { } startUtc) return WhatsAppDispatchReport.Skipped;

            var customer = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == entry.CustomerId, ct);
            if (customer is null || string.IsNullOrWhiteSpace(customer.Phone)) return WhatsAppDispatchReport.Skipped;

            var serviceName = entry.ServiceDefinitionId is { } sid
                ? await _db.ServiceDefinitions.IgnoreQueryFilters().AsNoTracking().Where(s => s.Id == sid).Select(s => s.Name).FirstOrDefaultAsync(ct) ?? string.Empty
                : string.Empty;
            // Şube adı yoksa kurum adına düş — imzasız mesaj gitmesin.
            var salonName = entry.BranchId is { } bid
                ? await _db.Branches.IgnoreQueryFilters().AsNoTracking().Where(b => b.Id == bid).Select(b => b.Name).FirstOrDefaultAsync(ct) ?? string.Empty
                : string.Empty;
            if (string.IsNullOrWhiteSpace(salonName))
                salonName = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? string.Empty;

            var body = RenderSlotTemplate(WaitlistOfferTemplate, customer.FullName, startUtc, serviceName, salonName);
            return Report(await DispatchAsync(tenantId, entry.BranchId, appointmentId: null, entry.CustomerId, waitlistEntryId: entry.Id, customer.Phone!, body, WhatsAppMessageCategory.Utility, templateName: "waitlist-offer", ct));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bekleme teklifi gönderilemedi: {Entry}", waitlistEntryId);
            return WhatsAppDispatchReport.Failed(ex.Message);
        }
    }

    /// <summary>
    /// Gönderim sonucunu kuyruğun anlayacağı üç durumdan birine çevirir.
    /// ENGELLENEN gönderim (paket/kota/kontör) bir HATA DEĞİLDİR: tekrar denemek aynı duvara
    /// çarpar, iş başarıyla kapanmalıdır. Sağlayıcının reddettiği gönderim ise yeniden denenir.
    /// </summary>
    private static WhatsAppDispatchReport Report(DispatchResult result)
    {
        if (result.Blocked) return WhatsAppDispatchReport.Skipped;
        // Kayıt yok + engellenmemiş = gönderim hiç DENENMEDİ (telefon çözümlenemedi) → atlandı.
        if (result.Message is null) return WhatsAppDispatchReport.Skipped;
        return result.Success
            ? WhatsAppDispatchReport.Sent
            : WhatsAppDispatchReport.Failed(result.Error ?? "WhatsApp gönderimi başarısız.");
    }


    /// <summary>Hediye kartı mesajının şablon adı — mükerrer koruması bununla eşleşir.</summary>
    private const string GiftCardTemplateName = "gift-card";
    private const string GiftCardMessageTemplate =
        "Merhaba{ad}, {salon} hediye kartınız hazır! 🎁 Kart ekteki PDF'tedir; " +
        "işletmemizde kart üzerindeki kodu göstermeniz yeterlidir.{gecerlilik}";

    /// <summary>
    /// Hediye kartını PDF olarak gönderir.
    ///
    /// PDF'İ İSTEMCİ ÜRETİR ama SUNUCU DOĞRULAR: gelen `giftCardId` gerçekten bu kuruma ait mi,
    /// kart geçerli mi, numara kime ait? Aksi hâlde uç, herhangi bir PDF'i herhangi bir numaraya
    /// kurumun kontöründen gönderen açık bir kapı olurdu.
    /// </summary>
    public async Task<Result<ReminderResultDto>> SendGiftCardAsync(Guid tenantId, SendGiftCardRequest request, CancellationToken ct = default)
    {
        /*
         * ŞUBE KAPSAMI KORUNUR — `IgnoreQueryFilters` YOK.
         *
         * Bu bir İSTEK BAĞLAMI ucudur (arka plan işi değil): global query filter tenant VE şube
         * kapsamını uygular. Filtreyi kapatıp yalnız TenantId'yi elle kontrol etmek, aynı kurumun
         * BAŞKA ŞUBESİNE ait bir kart kimliği bilinirse o kartın gönderilmesine izin verirdi
         * (BOLA). Kartı bulamamak = yetkisi yok; ayrı bir "yetkisiz" mesajı da kartın varlığını
         * sızdırmamak için verilmez.
         */
        var card = await _db.GiftCards.AsNoTracking()
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == request.GiftCardId, ct);
        if (card is null) return Result<ReminderResultDto>.Failure(Error.NotFound("Hediye kartı bulunamadı."));

        // GEÇERSİZ KART GÖNDERİLMEZ: süresi dolmuş ya da bakiyesi bitmiş bir kartı müşteriye
        // yollamak, kontörü boşa harcamanın yanında müşteriyi de işletmeye boşuna getirir.
        if (!card.IsValid(DateTime.UtcNow))
            return Result<ReminderResultDto>.Failure(Error.Validation("Kart geçerli değil (pasif, süresi dolmuş, hakkı bitmiş veya bakiyesi yok)."));

        // Numara: istekte verilen ya da karta bağlı müşterinin kayıtlı numarası.
        var phone = (request.Phone ?? string.Empty).Trim();
        Customer? customer = null;
        if (card.CustomerId.HasValue)
        {
            // Müşteri de kapsam içinden okunur (aynı gerekçe).
            customer = await _db.Customers.AsNoTracking()
                .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == card.CustomerId.Value, ct);
            if (phone.Length == 0) phone = customer?.Phone ?? string.Empty;
        }
        if (phone.Length == 0)
            return Result<ReminderResultDto>.Failure(Error.Validation("Gönderilecek telefon numarası yok."));

        /*
         * NUMARA KEYFİ OLAMAZ.
         *
         * Kart bir müşteriye bağlıysa gönderim YALNIZ o müşterinin kayıtlı numarasına yapılır:
         * aksi hâlde uç, kurumun kontörüyle istenen numaraya belge gönderen bir kanala dönerdi
         * (kartın kendisi de değerli bir belgedir). Kart müşterisizse serbest numara kabul edilir —
         * o kart zaten kime verileceği belli olmayan basılı bir karttır.
         */
        if (customer is not null)
        {
            var registered = NormalizePhone(customer.Phone ?? string.Empty);
            var requested = NormalizePhone(phone);
            if (registered.Length == 0)
                return Result<ReminderResultDto>.Failure(Error.Validation("Karta bağlı müşterinin kayıtlı telefonu yok."));
            if (requested.Length > 0 && requested != registered)
                return Result<ReminderResultDto>.Failure(Error.Validation(
                    "Bu kart bir müşteriye tanımlı; yalnızca o müşterinin kayıtlı numarasına gönderilebilir."));
            phone = registered;
        }

        byte[] pdf;
        try
        {
            pdf = Convert.FromBase64String(request.PdfBase64 ?? string.Empty);
        }
        catch (FormatException)
        {
            return Result<ReminderResultDto>.Failure(Error.Validation("Kart dosyası okunamadı."));
        }
        // Boş/absürt boyut reddedilir: Meta 100 MB'a kadar kabul eder ama kart PDF'i birkaç yüz KB'dir.
        if (pdf.Length < 512 || pdf.Length > 8 * 1024 * 1024)
            return Result<ReminderResultDto>.Failure(Error.Validation("Kart dosyası geçersiz boyutta."));
        // İçerik gerçekten PDF mi? ("%PDF-" imzası) Aksi hâlde uç, keyfi dosya taşıyan bir kanal olur.
        if (pdf.Length < 5 || pdf[0] != 0x25 || pdf[1] != 0x50 || pdf[2] != 0x44 || pdf[3] != 0x46)
            return Result<ReminderResultDto>.Failure(Error.Validation("Kart dosyası PDF değil."));

        var salonName = await SalonNameAsync(tenantId, card.BranchId, ct);
        var firstName = customer is null ? string.Empty : FirstName(customer.FullName);
        var validity = card.ValidUntilUtc.HasValue
            ? $" Son kullanma: {card.ValidUntilUtc.Value.ToLocalTime():dd.MM.yyyy}."
            : string.Empty;

        var body = GiftCardMessageTemplate
            .Replace("{ad}", firstName.Length == 0 ? string.Empty : $" {firstName}")
            .Replace("{salon}", salonName)
            .Replace("{gecerlilik}", validity);

        // Ek ZORUNLU: mesaj kartın ekte olduğunu söylüyor, eksiz gitmesi anlamsız (bkz. OutboundAttachment).
        var attachment = new OutboundAttachment(pdf, $"Hediye-Karti-{card.Code}.pdf", Required: true);

        var dispatch = await DispatchAsync(tenantId, card.BranchId, appointmentId: null, card.CustomerId, waitlistEntryId: null,
            phone, body, WhatsAppMessageCategory.Marketing, templateName: GiftCardTemplateName, ct, attachment,
            /*
             * ŞABLON YEDEĞİ YOK — BİLEREK.
             *
             * Meta şablonları ONAYLI METİNLE gelir; KVKK ya da hatırlatma şablonunu hediye kartı
             * yerine kullanmak, müşteriye tamamen alakasız bir metin göndermek olurdu. Hediye
             * kartına özel onaylı şablon tanımlanana kadar, pencere kapalıyken gönderim
             * denenmez ve kullanıcı sebebi açıkça görür (aşağıdaki bayrak).
             */
            templateFallback: null,
            requireTemplateOutsideWindow: true);

        // Engellendi (paket kapalı / kontör yetersiz / sonucu bilinmeyen önceki deneme):
        // sebep kullanıcıya AYNEN aktarılır, "başarısız" diye yuvarlanmaz.
        if (dispatch.Blocked)
            return Result<ReminderResultDto>.Failure(Error.Conflict(dispatch.BlockReason ?? "Gönderim engellendi."));
        if (dispatch.Message is null)
            return Result<ReminderResultDto>.Failure(Error.Validation("Telefon numarası çözümlenemedi."));
        if (!dispatch.Success)
            return Result<ReminderResultDto>.Failure(Error.Validation(dispatch.Error ?? "WhatsApp gönderimi başarısız."));

        return Result<ReminderResultDto>.Success(new ReminderResultDto(
            true, dispatch.Simulated, dispatch.ToPhone, dispatch.Body, dispatch.ProviderMessageId, dispatch.Error));
    }

    /// <inheritdoc cref="SendWaitlistOfferAsync" />
    public async Task<WhatsAppDispatchReport> SendKvkkConsentRequestAsync(Guid tenantId, Guid customerId, CancellationToken ct = default)
    {
        try
        {
            var customer = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == customerId && !c.IsDeleted, ct);
            if (customer is null || string.IsNullOrWhiteSpace(customer.Phone)) return WhatsAppDispatchReport.Skipped;
            // Zaten onaylıysa tekrar rahatsız etme.
            if (customer.KvkkConsent) return WhatsAppDispatchReport.Skipped;

            var salonName = await SalonNameAsync(tenantId, customer.BranchId, ct);
            var firstName = FirstName(customer.FullName);

            // KURUMA ÖZEL aydınlatma metni: PDF olarak eklenir, ayrıca herkese açık sayfa
            // linki mesaja konur (PDF'i açamayan müşteri metni tarayıcıda okuyabilsin).
            var link = await KvkkLinkAsync(tenantId, ct);
            byte[]? pdf = null;
            try { pdf = await _kvkkDocuments.BuildPdfAsync(tenantId, customer.FullName, ct); }
            catch (Exception ex) { _logger.LogWarning(ex, "KVKK PDF üretilemedi, mesaj eksiz gönderilecek: {Tenant}", tenantId); }

            var body = KvkkConsentTemplate
                .Replace("{ad}", firstName)
                .Replace("{salon}", salonName)
                // Link EN SONDA durur: hem cümleleri bölmez hem WhatsApp önizlemesi doğru çalışır.
                .Replace("{link}", string.IsNullOrEmpty(link) ? string.Empty : $"\n\nMetnin tamamı: {link}");

            var attachment = pdf is null
                ? null
                : new OutboundAttachment(pdf, $"KVKK-Aydinlatma-Metni-{Slugify(salonName)}.pdf");

            return Report(await DispatchAsync(tenantId, customer.BranchId, appointmentId: null, customer.Id, waitlistEntryId: null,
                customer.Phone!, body, WhatsAppMessageCategory.Utility, templateName: KvkkTemplateName, ct,
                attachment,
                // 24 saat penceresi kapalıysa Meta yalnızca onaylı şablon kabul eder.
                settings => string.IsNullOrWhiteSpace(settings?.KvkkTemplateName)
                    ? null
                    : new TemplateFallback(settings.KvkkTemplateName!, settings.TemplateLanguageCode,
                        new[] { firstName, salonName, link ?? string.Empty })));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "KVKK onay isteği gönderilemedi: {Customer}", customerId);
            return WhatsAppDispatchReport.Failed(ex.Message);
        }
    }

    /// <summary>
    /// Herkese açık KVKK metni sayfasının adresi (WhatsApp mesajındaki link).
    /// Taban adres <c>App:PublicBaseUrl</c> ayarından gelir; tanımlı değilse link konmaz —
    /// çalışmayan bir link göndermek, hiç link göndermemekten kötüdür.
    /// </summary>
    private async Task<string?> KvkkLinkAsync(Guid tenantId, CancellationToken ct)
    {
        var baseUrl = _config["App:PublicBaseUrl"]?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl)) return null;
        var slug = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.Slug).FirstOrDefaultAsync(ct);
        return string.IsNullOrWhiteSpace(slug) ? null : $"{baseUrl}/kvkk/{slug}";
    }

    /// <summary>Dosya adı için güvenli sadeleştirme (Türkçe karakterler dosya adında sorun çıkarır).</summary>
    private static string Slugify(string value)
    {
        var map = new Dictionary<char, char> { ['ç'] = 'c', ['ğ'] = 'g', ['ı'] = 'i', ['ö'] = 'o', ['ş'] = 's', ['ü'] = 'u', ['Ç'] = 'C', ['Ğ'] = 'G', ['İ'] = 'I', ['Ö'] = 'O', ['Ş'] = 'S', ['Ü'] = 'U' };
        var sb = new StringBuilder(value.Length);
        foreach (var ch in value)
        {
            var c = map.TryGetValue(ch, out var m) ? m : ch;
            if (char.IsLetterOrDigit(c)) sb.Append(c);
            else if (c is ' ' or '-' or '_') sb.Append('-');
        }
        var slug = sb.ToString().Trim('-');
        return slug.Length == 0 ? "kurum" : slug;
    }

    /// <summary>Şube adı yoksa kurum adına düşer — imzasız mesaj gitmesin.</summary>
    private async Task<string> SalonNameAsync(Guid tenantId, Guid? branchId, CancellationToken ct)
    {
        var name = branchId is { } bid
            ? await _db.Branches.IgnoreQueryFilters().AsNoTracking().Where(b => b.Id == bid).Select(b => b.Name).FirstOrDefaultAsync(ct)
            : null;
        if (!string.IsNullOrWhiteSpace(name)) return name!;
        return await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? "Salonumuz";
    }

    /// <inheritdoc cref="SendWaitlistOfferAsync" />
    public async Task<WhatsAppDispatchReport> SendRatingLinkAsync(Guid tenantId, Guid appointmentId, Guid ratingToken, CancellationToken ct = default)
    {
        try
        {
            var appt = await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Include(a => a.Customer)
                .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId, ct);
            if (appt?.Customer is null || string.IsNullOrWhiteSpace(appt.Customer.Phone)) return WhatsAppDispatchReport.Skipped;

            var salonName = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
                .Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? "Salonumuz";

            var link = $"{FrontendBaseUrl()}/rate/{ratingToken}";
            var body = RatingLinkTemplate
                .Replace("{ad}", FirstName(appt.Customer.FullName))
                .Replace("{salon}", salonName)
                .Replace("{link}", link);
            return Report(await DispatchAsync(tenantId, appt.BranchId, appt.Id, appt.CustomerId, waitlistEntryId: null, appt.Customer.Phone!, body, WhatsAppMessageCategory.Utility, templateName: "rating-link", ct));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Değerlendirme linki gönderilemedi: {Appointment}", appointmentId);
            return WhatsAppDispatchReport.Failed(ex.Message);
        }
    }

    /// <inheritdoc cref="SendWaitlistOfferAsync" />
    public async Task<WhatsAppDispatchReport> SendWaitlistActivatedAsync(Guid tenantId, Guid appointmentId, CancellationToken ct = default)
    {
        try
        {
            var appt = await _db.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Include(a => a.Customer).Include(a => a.ServiceDefinition).Include(a => a.Branch)
                .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == appointmentId, ct);
            if (appt?.Customer is null || string.IsNullOrWhiteSpace(appt.Customer.Phone)) return WhatsAppDispatchReport.Skipped;

            var salonName = appt.Branch?.Name;
            if (string.IsNullOrWhiteSpace(salonName))
                salonName = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct);
            var body = RenderSlotTemplate(WaitlistActivatedTemplate, appt.Customer.FullName, appt.StartUtc,
                appt.ServiceDefinition?.Name ?? string.Empty, salonName ?? string.Empty);
            return Report(await DispatchAsync(tenantId, appt.BranchId, appt.Id, appt.CustomerId, waitlistEntryId: null, appt.Customer.Phone!, body, WhatsAppMessageCategory.Utility, templateName: "waitlist-activated", ct));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Aktifleşti mesajı gönderilemedi: {Appt}", appointmentId);
            return WhatsAppDispatchReport.Failed(ex.Message);
        }
    }

    /// <summary>Bağlantı çözümü: canlı gönderim yapılabilir mi, hangi numara ve token ile?</summary>
    private async Task<SendContext> ResolveSendContextAsync(Guid tenantId, CancellationToken ct)
    {
        var settings = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId && !x.IsDeleted, ct);
        if (settings is null || !settings.IsConnected || string.IsNullOrWhiteSpace(settings.PhoneNumberId))
            return SendContext.Offline;

        // Token: önce kuruma özel override, yoksa platform sistem token'ı (tek Business Manager).
        string? token = null;
        if (!string.IsNullOrWhiteSpace(settings.AccessTokenEncrypted))
            token = _encryption.Decrypt(settings.AccessTokenEncrypted);
        else
        {
            var platform = await _db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync(ct);
            if (platform is { WhatsAppEnabled: true } && !string.IsNullOrWhiteSpace(platform.WhatsAppAccessTokenEncrypted))
                token = _encryption.Decrypt(platform.WhatsAppAccessTokenEncrypted);
        }
        if (string.IsNullOrWhiteSpace(token)) return SendContext.Offline;
        return new SendContext(true, settings.PhoneNumberId, token!, settings);
    }

    /// <summary>
    /// Ortak gönderim: bağlantı çözümü → faturalama rezervasyonu (kota/kontör) → canlı/sim gönderim → mesaj kaydı.
    /// Engellenirse (kota/kontör/izin) mesaj gönderilmez; sonuç Blocked=true döner (reminder yolu kullanıcıya iletir,
    /// best-effort yollar yok sayar).
    /// </summary>
    /// <summary>
    /// Sonucu bilinmeyen (Queued kalmış) bir denemenin tekrar gönderimi bloklayacağı süre.
    /// Kuyruk kirasından (5 dk) ve makul yeniden deneme aralıklarından belirgin şekilde uzun;
    /// buna rağmen sonsuz değil ki eski bir kayıt gelecekteki meşru gönderimleri kilitlemesin.
    /// </summary>
    private static readonly TimeSpan UnknownOutcomeWindow = TimeSpan.FromMinutes(30);

    private async Task<DispatchResult> DispatchAsync(
        Guid tenantId, Guid? branchId, Guid? appointmentId, Guid? customerId, Guid? waitlistEntryId,
        string phone, string body, WhatsAppMessageCategory category, string? templateName, CancellationToken ct,
        OutboundAttachment? attachment = null, Func<WhatsAppSettings?, TemplateFallback?>? templateFallback = null,
        bool requireTemplateOutsideWindow = false)
    {
        var toPhone = NormalizePhone(phone);
        if (toPhone.Length == 0) return DispatchResult.Skipped;

        // Paket kapısı: WhatsApp özelliği açık değilse hiç gönderme (best-effort yollar sessizce atlar).
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsWhatsApp, ct))
            return new DispatchResult(true, "WhatsApp gönderimi paketinizde yok.", null, false, false, IsStaffViewer ? PhoneMask.Mask(toPhone) : toPhone, body, null, null);

        var ctx = await ResolveSendContextAsync(tenantId, ct);

        // SONUCU BİLİNMEYEN ÖNCEKİ DENEME VARSA KÖRLEMESİNE TEKRAR GÖNDERİLMEZ.
        //
        // Aşağıda mesaj satırı gönderimden ÖNCE `Queued` olarak yazılıp commit ediliyor. Sağlayıcı
        // mesajı kabul ettikten sonra süreç çökerse satır `Queued` kalır: gerçekten gidip gitmediği
        // BİLİNMEZ. Kuyruk işi yeniden denediğinde eskiden aynı mesaj müşteriye ikinci kez
        // gidiyordu; artık durum "bilinmiyor" olarak raporlanır, satır listede görünür kalır ve
        // karar insana bırakılır. (Meta teslim webhook'u gelirse satır kendiliğinden Delivered'a
        // geçer ve pencere kapanır.)
        var inFlightSince = DateTime.UtcNow - UnknownOutcomeWindow;
        var inFlight = await _db.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(m => m.TenantId == tenantId
                           && m.Direction == WhatsAppMessageDirection.Outbound
                           && m.Status == WhatsAppMessageStatus.Queued
                           && m.TemplateName == templateName
                           && m.AppointmentId == appointmentId
                           && m.CustomerId == customerId
                           && m.WaitlistEntryId == waitlistEntryId
                           && m.CreatedAtUtc >= inFlightSince, ct);
        if (inFlight)
        {
            _logger.LogWarning(
                "[WhatsApp] Önceki denemenin sonucu bilinmiyor; tekrar gönderilmedi ({Tenant}/{Template}).",
                tenantId, templateName);
            return new DispatchResult(true,
                "Önceki gönderim denemesinin sonucu bilinmiyor; mükerrer mesaj göndermemek için tekrar denenmedi.",
                null, false, false, IsStaffViewer ? PhoneMask.Mask(toPhone) : toPhone, body, null, null);
        }

        /*
         * 24 SAAT PENCERESİ KONTROLÜ — REZERVASYONDAN ÖNCE.
         *
         * Meta, müşteri son 24 saatte yazmadıysa serbest metni (ve ekini) İLETMEZ; yalnız
         * onaylı şablon kabul eder. Şablon tanımlı değilken denemek, kontörü rezerve edip
         * sağlayıcıdan anlaşılmaz bir hata almak demekti. Zorunlu-şablon isteyen akışlarda
         * (hediye kartı) durum ÖNCEDEN anlaşılır bir sebeple engellenir.
         */
        if (requireTemplateOutsideWindow && ctx.Live)
        {
            var sessionOpen = await IsSessionOpenAsync(tenantId, toPhone, ct);
            if (!sessionOpen && templateFallback?.Invoke(ctx.Settings) is null)
            {
                return new DispatchResult(true,
                    "Müşteri son 24 saatte yazmadığı için WhatsApp yalnızca onaylı şablonla gönderime izin veriyor; " +
                    "bu gönderim için tanımlı şablon yok. Müşteri size yazdıktan sonra tekrar deneyin.",
                    null, false, false, IsStaffViewer ? PhoneMask.Mask(toPhone) : toPhone, body, null, null);
            }
        }

        // ---- KONTÖR REZERVASYONU + "GÖNDERİLİYOR" İZİ: TEK ATOMİK ADIM ----
        //
        // DEĞİŞMEZ: cüzdanda rezerve görünen tutar, karşılığı olan mesaj satırlarının toplamına
        // eşit olmalıdır. Rezervasyon ayrı, mesaj satırı ayrı commit edilseydi, aradaki bir hata
        // KARŞILIĞI OLMAYAN bir rezervasyon bırakırdı: 48 saatlik süpürge yalnız MESAJ satırlarını
        // taradığı için böyle bir tutar hiç iade edilmez, kurumun bakiyesinde sonsuza dek kilitli
        // kalırdı. İkisi aynı transaction'da kalıcı olur.
        //
        // Transaction dış çağrıdan (Meta) ÖNCE kapanır: satır kilidini bir ağ çağrısı boyunca
        // tutmak, tüm kurumun gönderimlerini yavaş bir sağlayıcının arkasında sıraya sokardı.
        var writeTx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;

        BillingDecision decision;
        WhatsAppMessage msg;
        try
        {
            decision = await _billing.ReserveAsync(tenantId, category, ctx.Live, ct);
            if (!decision.Allowed)
            {
                _logger.LogInformation("[WhatsApp] Gönderim engellendi ({Tenant}/{Category}): {Reason}", tenantId, category, decision.BlockReason);
                return new DispatchResult(true, decision.BlockReason, null, false, false, IsStaffViewer ? PhoneMask.Mask(toPhone) : toPhone, body, null, null);
            }

            // DIŞ ETKİDEN ÖNCE İZ: satır `Queued` yazılır — sağlayıcı mesajı kabul ettikten sonra
            // süreç çökerse geriye "denendi, sonucu bilinmiyor" izi kalsın.
            msg = new WhatsAppMessage(
                tenantId, branchId, appointmentId, customerId, WhatsAppMessageDirection.Outbound,
                toPhone, body, WhatsAppMessageStatus.Queued, templateName: templateName,
                waitlistEntryId: waitlistEntryId,
                category: decision.Category, billingSource: decision.Source, chargedAmountTry: decision.AmountTry);
            _db.WhatsAppMessages.Add(msg);
            await _db.SaveChangesAsync(ct);
            if (writeTx is not null) await writeTx.CommitAsync(ct);
        }
        finally
        {
            // Commit edilmediyse rezervasyon da geri alınır (dispose → rollback).
            if (writeTx is not null) await writeTx.DisposeAsync();
        }

        WhatsAppSendOutcome outcome;
        bool simulated;
        if (ctx.Live)
        {
            // Meta kuralı: müşteri son 24 saatte yazmadıysa serbest metin İLETİLMEZ; yalnızca
            // önceden onaylanmış şablonla gönderilebilir. Pencere kapalıysa (ve şablon
            // tanımlıysa) şablon yoluna geçilir.
            var template = await IsSessionOpenAsync(tenantId, toPhone, ct)
                ? null
                : templateFallback?.Invoke(ctx.Settings);

            outcome = await SendViaMetaAsync(ctx.PhoneNumberId!, ctx.Token, toPhone, body, ct, attachment, template);
            simulated = false;
        }
        else
        {
            var extra = attachment is null ? string.Empty : $" [ek: {attachment.FileName}, {attachment.Content.Length} bayt]";
            _logger.LogInformation("[WhatsApp SIM] {Tenant} -> {Phone}: {Body}{Extra}", tenantId, toPhone, body, extra);
            outcome = new WhatsAppSendOutcome(true, $"sim-{Guid.NewGuid():N}", null);
            simulated = true;
        }

        // ---- SONUCUN YAZILMASI + OLASI İADE: TEK ATOMİK ADIM ----
        //
        // İade cüzdanın rezerve tutarını düşürür; mesajın "başarısız" damgası ile aynı kayıtta
        // kalmalıdır. Ayrı yazılsalardı biri olup diğeri olmayabilir ve rezerve tutar ile mesaj
        // satırları arasındaki denklik bozulurdu. Transaction ayrıca cüzdan satır kilidinin
        // (bkz. WhatsAppBillingService.GetOrCreateWalletAsync) gerçekten tutulmasını sağlar —
        // kilit yalnız bir transaction içinde yaşar.
        var resultTx = _db.Database.IsRelational() && _db.Database.CurrentTransaction is null
            ? await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;
        try
        {
            // Sonuç KESİNLEŞTİ: `Queued` satırı gerçek duruma çekilir.
            if (outcome.Success) msg.MarkSent(outcome.ProviderMessageId, simulated);
            else msg.MarkFailed(outcome.Error);

            // Canlı gönderim ANINDA başarısızsa (Meta hata döndü) kontör rezervasyonunu geri al.
            if (!outcome.Success)
                await _billing.RefundInlineAsync(tenantId, msg, ct);

            await _db.SaveChangesAsync(ct);
            if (resultTx is not null) await resultTx.CommitAsync(ct);
        }
        finally
        {
            if (resultTx is not null) await resultTx.DisposeAsync();
        }

        var outPhone = IsStaffViewer ? PhoneMask.Mask(toPhone) : toPhone;
        return new DispatchResult(false, null, msg, outcome.Success, simulated, outPhone, body, outcome.ProviderMessageId, outcome.Error);
    }

    // ==================== WEBHOOK ====================

    public async Task<string?> VerifyWebhookAsync(string? mode, string? verifyToken, string? challenge, CancellationToken ct = default)
    {
        if (!string.Equals(mode, "subscribe", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(verifyToken))
            return null;

        // 1) Platform geneli verify token (DB) — tek Business Manager modeli.
        var platformToken = await _db.PlatformIntegrationSettings.AsNoTracking().Select(p => p.WhatsAppVerifyToken).FirstOrDefaultAsync(ct);
        if (!string.IsNullOrEmpty(platformToken) && verifyToken == platformToken) return challenge;

        // 2) Config fallback.
        var appToken = _config["WhatsApp:VerifyToken"];
        if (!string.IsNullOrEmpty(appToken) && verifyToken == appToken) return challenge;

        // 3) Eski kuruma özel verify token (geriye uyumluluk).
        var matches = await _db.WhatsAppSettings.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(s => !s.IsDeleted && s.VerifyToken == verifyToken, ct);
        return matches ? challenge : null;
    }

    public async Task HandleInboundAsync(string payloadJson, string? signatureHeader, CancellationToken ct = default)
    {
        if (!await VerifyInboundSignatureAsync(payloadJson, signatureHeader, ct))
        {
            _logger.LogWarning("WhatsApp webhook imza doğrulaması başarısız — istek işlenmeden yok sayıldı.");
            return;
        }

        JsonDocument doc;
        try { doc = JsonDocument.Parse(payloadJson); }
        catch (JsonException) { return; }
        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("entry", out var entries)) return;
            foreach (var entry in entries.EnumerateArray())
            {
                if (!entry.TryGetProperty("changes", out var changes)) continue;
                foreach (var change in changes.EnumerateArray())
                {
                    if (!change.TryGetProperty("value", out var value)) continue;

                    // 1) Teslim/okundu/başarısız durum bildirimleri → kontör kesinleşme/iade.
                    if (value.TryGetProperty("statuses", out var statuses))
                    {
                        foreach (var st in statuses.EnumerateArray())
                        {
                            var wamid = st.TryGetProperty("id", out var sid) ? sid.GetString() : null;
                            var statusStr = st.TryGetProperty("status", out var ss) ? ss.GetString() : null;
                            if (string.IsNullOrWhiteSpace(wamid) || string.IsNullOrWhiteSpace(statusStr)) continue;
                            await ProcessStatusAsync(wamid!, statusStr!, ct);
                        }
                    }

                    // 2) Gelen mesajlar → niyet motoru (onay/iptal/erteleme).
                    var phoneNumberId = value.TryGetProperty("metadata", out var meta) && meta.TryGetProperty("phone_number_id", out var pnid) ? pnid.GetString() : null;
                    if (string.IsNullOrWhiteSpace(phoneNumberId)) continue;
                    if (!value.TryGetProperty("messages", out var messages)) continue;

                    var settings = await _db.WhatsAppSettings.IgnoreQueryFilters()
                        .FirstOrDefaultAsync(s => !s.IsDeleted && s.PhoneNumberId == phoneNumberId, ct);
                    if (settings is null) continue;
                    var tenantId = settings.TenantId;

                    foreach (var msg in messages.EnumerateArray())
                    {
                        var type = msg.TryGetProperty("type", out var t) ? t.GetString() : null;
                        if (type != "text") continue;
                        var from = msg.TryGetProperty("from", out var f) ? f.GetString() : null;
                        var text = msg.TryGetProperty("text", out var txt) && txt.TryGetProperty("body", out var b) ? b.GetString() : null;
                        if (string.IsNullOrWhiteSpace(from) || text is null) continue;

                        await ProcessInboundMessageAsync(tenantId, from!, text, ct);
                    }
                }
            }
        }
    }

    /// <summary>Meta teslim durumu (delivered/read/failed) → mesajı işaretle + kontörü kesinleştir/iade et.</summary>
    private async Task ProcessStatusAsync(string wamid, string status, CancellationToken ct)
    {
        var msg = await _db.WhatsAppMessages.IgnoreQueryFilters()
            .FirstOrDefaultAsync(m => m.ProviderMessageId == wamid && m.Direction == WhatsAppMessageDirection.Outbound, ct);
        if (msg is null) return;

        switch (status.ToLowerInvariant())
        {
            case "delivered":
            case "read":
            {
                var firstDelivery = msg.MarkDelivered();
                if (status.Equals("read", StringComparison.OrdinalIgnoreCase)) msg.MarkRead();
                await _db.SaveChangesAsync(ct);
                if (firstDelivery) await _billing.CaptureAsync(msg, ct); // kontörü kesinleştir (teslim edildi)
                break;
            }
            case "failed":
            {
                if (msg.MarkFailed("Meta: teslim edilemedi"))
                {
                    await _db.SaveChangesAsync(ct);
                    await _billing.RefundAsync(msg, ct); // rezervasyonu iade et
                }
                break;
            }
        }
    }

    /// <summary>
    /// Meta webhook imzasını doğrular. Anahtar kaynağı: önce platform App Secret (DB, şifreli), yoksa
    /// <c>WhatsApp:AppSecret</c> config.
    /// <para>
    /// FAIL-CLOSED — her ortamda. Eskiden App Secret yoksa <c>Development</c>'ta imzasız gövde KABUL
    /// ediliyordu; webhook mesaj durumu değiştirebiliyor, kontör kesinleştirip iade edebiliyor, KVKK
    /// onayı işleyebiliyor ve randevu iptal edebiliyor. Yanlışlıkla Development olarak çalışan ya da
    /// dışarı açılmış bir staging kopyası imzasız payload'larla veri bütünlüğünü bozabilirdi.
    /// </para>
    /// </summary>
    private async Task<bool> VerifyInboundSignatureAsync(string rawBody, string? signatureHeader, CancellationToken ct)
    {
        string? appSecret = null;
        var platformSecretEnc = await _db.PlatformIntegrationSettings.AsNoTracking().Select(p => p.WhatsAppAppSecretEncrypted).FirstOrDefaultAsync(ct);
        if (!string.IsNullOrWhiteSpace(platformSecretEnc))
            appSecret = _encryption.Decrypt(platformSecretEnc);
        appSecret ??= _config["WhatsApp:AppSecret"];

        if (string.IsNullOrWhiteSpace(appSecret))
        {
            _logger.LogError("WhatsApp App Secret tanımlı değil — webhook imzası doğrulanamıyor, istek reddedildi. " +
                             "Platform ayarlarından App Secret girin ya da WhatsApp__AppSecret ortam değişkenini tanımlayın.");
            return false;
        }

        const string prefix = "sha256=";
        if (string.IsNullOrWhiteSpace(signatureHeader) ||
            !signatureHeader.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return false;

        byte[] provided;
        try { provided = Convert.FromHexString(signatureHeader[prefix.Length..].Trim()); }
        catch (FormatException) { return false; }

        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(appSecret), Encoding.UTF8.GetBytes(rawBody));
        return CryptographicOperations.FixedTimeEquals(provided, expected);
    }

    private async Task ProcessInboundMessageAsync(Guid tenantId, string fromPhone, string text, CancellationToken ct)
    {
        var since = DateTime.UtcNow.AddDays(-3);
        var recentOutbound = await _db.WhatsAppMessages.IgnoreQueryFilters()
            .Where(m => m.TenantId == tenantId && m.Direction == WhatsAppMessageDirection.Outbound && m.CreatedAtUtc >= since)
            .OrderByDescending(m => m.CreatedAtUtc).Take(25).ToListAsync(ct);
        var match = recentOutbound.FirstOrDefault(m => PhonesMatch(m.Phone, fromPhone));

        var intent = Interpret(text);
        _db.WhatsAppMessages.Add(new WhatsAppMessage(
            tenantId, match?.BranchId, match?.AppointmentId, match?.CustomerId, WhatsAppMessageDirection.Inbound,
            NormalizePhone(fromPhone), text, WhatsAppMessageStatus.Received, intent: intent, waitlistEntryId: match?.WaitlistEntryId,
            category: WhatsAppMessageCategory.Service, billingSource: WhatsAppBillingSource.None));
        await _db.SaveChangesAsync(ct);

        if (match is null || intent == WhatsAppReplyIntent.Unknown) return;

        // 0) KVKK açık rıza isteğine yanıt: son giden mesaj KVKK şablonuysa ve müşteri onayladıysa
        //    kayıt otomatik onaylanır (yönetici elle işaretlemek zorunda kalmaz).
        if (match.TemplateName == KvkkTemplateName && match.CustomerId is { } kvkkCustomerId)
        {
            if (intent == WhatsAppReplyIntent.Confirm)
            {
                var customer = await _db.Customers.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == kvkkCustomerId && !c.IsDeleted, ct);
                if (customer is not null && !customer.KvkkConsent)
                {
                    customer.UpdateProfile(customer.BirthDate, customer.Gender, kvkkConsent: true, customer.Notes);
                    await _db.SaveChangesAsync(ct);

                    var salon = await SalonNameAsync(tenantId, customer.BranchId, ct);
                    await DispatchAsync(tenantId, customer.BranchId, null, customer.Id, null, customer.Phone!,
                        KvkkThanksTemplate.Replace("{ad}", FirstName(customer.FullName)).Replace("{salon}", salon),
                        WhatsAppMessageCategory.Utility, templateName: "kvkk-thanks", ct);

                    await _notifications.NotifyRolesAsync(
                        tenantId, customer.BranchId,
                        new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
                        AppNotificationType.WhatsAppReply, AppNotificationSeverity.Success,
                        "KVKK onayı alındı",
                        $"{customer.FullName} WhatsApp üzerinden KVKK açık rızasını verdi.",
                        data: new { route = "/customers", id = customer.Id.ToString() },
                        dedupeKey: $"kvkk-consent:{customer.Id}",
                        ct: ct);
                }
            }
            return;
        }

        // 1) Bekleme listesi teklifine yanıt.
        if (match.WaitlistEntryId is { } waitlistId)
        {
            if (intent == WhatsAppReplyIntent.Confirm)
            {
                var res = await _waitlist.AcceptOfferAsync(tenantId, waitlistId, ct);
                if (res.IsSuccess && res.Value is { } newApptId) await SendWaitlistActivatedAsync(tenantId, newApptId, ct);
            }
            else if (intent == WhatsAppReplyIntent.Cancel)
            {
                var next = await _waitlist.DeclineOfferAsync(tenantId, waitlistId, ct);
                if (next.IsSuccess && next.Value is { } nextId) await SendWaitlistOfferAsync(tenantId, nextId, ct);
            }
            return;
        }

        // 2) Randevu hatırlatmasına yanıt.
        if (match.AppointmentId is { } apptId)
        {
            var appt = await _db.Appointments.IgnoreQueryFilters()
                .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == apptId, ct);
            if (appt is null) return;

            appt.SetCustomerConfirmation(intent switch
            {
                WhatsAppReplyIntent.Confirm => WhatsAppConfirmationStatus.Confirmed,
                WhatsAppReplyIntent.Cancel => WhatsAppConfirmationStatus.Declined,
                WhatsAppReplyIntent.Reschedule => WhatsAppConfirmationStatus.RescheduleRequested,
                _ => WhatsAppConfirmationStatus.Pending,
            });

            if (intent == WhatsAppReplyIntent.Cancel &&
                appt.Status is not (AppointmentStatus.Cancelled or AppointmentStatus.Completed or AppointmentStatus.NoShow))
            {
                // Müşteri onay bilgisi (Declined) önce kalıcı olsun; iptal kanonik servisten.
                await _db.SaveChangesAsync(ct);
                // İPTAL KANONİK SERVİSTEN: doğrudan Cancel()+SaveChanges kilit/taze-okuma
                // protokolünü atlıyordu — webhook eski nesneyi okurken yönetici randevuyu
                // tamamlayıp seansı tüketirse, webhook bayat nesneyi "İptal" yazıyordu.
                // Bekleme listesi teklifi de artık orada (tek yerde) tetikleniyor.
                var appointments = _services.GetRequiredService<Application.Features.Appointments.IAppointmentService>();
                await appointments.ChangeStatusAsync(tenantId, appt.Id,
                    new Application.Features.Appointments.ChangeAppointmentStatusRequest(
                        AppointmentStatus.Cancelled, "Müşteri WhatsApp ile iptal etti"),
                    ct);
            }
            else
            {
                await _db.SaveChangesAsync(ct);
            }

            var (title, severity) = intent switch
            {
                WhatsAppReplyIntent.Confirm => ("Müşteri randevusunu onayladı", AppNotificationSeverity.Success),
                WhatsAppReplyIntent.Cancel => ("Müşteri randevusunu iptal etti", AppNotificationSeverity.Warning),
                WhatsAppReplyIntent.Reschedule => ("Müşteri erteleme istedi", AppNotificationSeverity.Warning),
                _ => (string.Empty, AppNotificationSeverity.Info),
            };
            if (!string.IsNullOrEmpty(title))
            {
                var custName = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
                    .Where(c => c.Id == appt.CustomerId).Select(c => c.FullName).FirstOrDefaultAsync(ct);
                await _notifications.NotifyRolesAsync(
                    tenantId, appt.BranchId,
                    new[] { UserRole.InstitutionOwner, UserRole.BranchManager },
                    AppNotificationType.WhatsAppReply, severity,
                    title,
                    $"{(string.IsNullOrWhiteSpace(custName) ? "Müşteri" : custName)} · {appt.StartUtc.AddHours(3):dd.MM.yyyy HH:mm}",
                    data: new { route = "/appointments", id = appt.Id.ToString() },
                    dedupeKey: $"wa-reply:{appt.Id}:{intent}",
                    ct: ct);
            }
        }
    }

    /// <summary>
    /// Son 24 saatte müşteriden gelen mesaj var mı? (Meta "customer service window").
    /// Açıksa serbest metin gönderilebilir; kapalıysa yalnızca onaylı şablon iletilir.
    /// </summary>
    private async Task<bool> IsSessionOpenAsync(Guid tenantId, string toPhone, CancellationToken ct)
    {
        var since = DateTime.UtcNow.AddHours(-24);
        var digits = SearchText.NormalizePhone(toPhone);
        if (digits.Length == 0) return false;

        // Telefon şifreli saklandığı için karşılaştırma bellekte yapılır; pencere zaten dar (24 saat).
        var recent = await _db.WhatsAppMessages.IgnoreQueryFilters().AsNoTracking()
            .Where(m => m.TenantId == tenantId && !m.IsDeleted
                        && m.Direction == WhatsAppMessageDirection.Inbound
                        && m.CreatedAtUtc >= since)
            .Select(m => m.Phone)
            .ToListAsync(ct);

        return recent.Any(p => SearchText.NormalizePhone(p) == digits);
    }

    /// <summary>
    /// PDF'i Meta medya deposuna yükler ve media id döner. Başarısızsa null — çağıran
    /// eksiz gönderime düşer (onay isteği hiç gitmemektense eksiz gitsin).
    /// </summary>
    private async Task<string?> UploadMediaAsync(string phoneNumberId, string accessToken, OutboundAttachment attachment, CancellationToken ct)
    {
        try
        {
            var client = _httpFactory.CreateClient("WhatsApp");
            using var form = new MultipartFormDataContent();
            var file = new ByteArrayContent(attachment.Content);
            file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(attachment.MimeType);
            form.Add(file, "file", attachment.FileName);
            form.Add(new StringContent("whatsapp"), "messaging_product");
            form.Add(new StringContent(attachment.MimeType), "type");

            using var req = new HttpRequestMessage(HttpMethod.Post, $"https://graph.facebook.com/v21.0/{phoneNumberId}/media") { Content = form };
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using var resp = await client.SendAsync(req, ct);
            var raw = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("[WhatsApp] Medya yüklenemedi ({Status}): {Body}", (int)resp.StatusCode, raw.Length > 200 ? raw[..200] : raw);
                return null;
            }
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.TryGetProperty("id", out var id) ? id.GetString() : null;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[WhatsApp] Medya yükleme hatası.");
            return null;
        }
    }

    private async Task<WhatsAppSendOutcome> SendViaMetaAsync(string phoneNumberId, string accessToken, string toPhone, string body, CancellationToken ct,
        OutboundAttachment? attachment = null, TemplateFallback? template = null)
    {
        try
        {
            var client = _httpFactory.CreateClient("WhatsApp");
            var url = $"https://graph.facebook.com/v21.0/{phoneNumberId}/messages";

            // Ek varsa önce medya deposuna yüklenir; id hem serbest belge mesajında hem
            // şablonun belge başlığında kullanılır.
            string? mediaId = null;
            if (attachment is not null)
            {
                mediaId = await UploadMediaAsync(phoneNumberId, accessToken, attachment, ct);
                // FAIL-CLOSED: ek zorunluysa ve yüklenemediyse mesaj HİÇ gönderilmez. Yarım
                // teslimat (eki olmayan "ekte" mesajı) sessiz başarıdan daha kötüdür; çağıran
                // hata alır, rezerve kontör iade edilir (bkz. DispatchAsync sonuç bloğu).
                if (mediaId is null && attachment.Required)
                {
                    _logger.LogWarning("[WhatsApp] Zorunlu ek yüklenemedi, gönderim iptal: {File}", attachment.FileName);
                    return new WhatsAppSendOutcome(false, null, "Kart dosyası WhatsApp'a yüklenemedi; mesaj gönderilmedi.");
                }
            }

            object payload;
            if (template is not null)
            {
                var components = new List<object>();
                if (mediaId is not null && attachment is not null)
                {
                    components.Add(new
                    {
                        type = "header",
                        parameters = new object[] { new { type = "document", document = new { id = mediaId, filename = attachment.FileName } } },
                    });
                }
                if (template.BodyParameters.Count > 0)
                {
                    components.Add(new
                    {
                        type = "body",
                        parameters = template.BodyParameters.Select(v => new { type = "text", text = v }).ToArray(),
                    });
                }
                payload = new
                {
                    messaging_product = "whatsapp",
                    recipient_type = "individual",
                    to = toPhone,
                    type = "template",
                    template = new
                    {
                        name = template.Name,
                        language = new { code = template.LanguageCode },
                        components = components.ToArray(),
                    },
                };
            }
            else if (mediaId is not null && attachment is not null)
            {
                payload = new
                {
                    messaging_product = "whatsapp",
                    recipient_type = "individual",
                    to = toPhone,
                    type = "document",
                    document = new { id = mediaId, filename = attachment.FileName, caption = Truncate(body, 1024) },
                };
            }
            else
            {
                payload = new { messaging_product = "whatsapp", recipient_type = "individual", to = toPhone, type = "text", text = new { preview_url = true, body } };
            }
            using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(payload) };
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using var resp = await client.SendAsync(req, ct);
            var raw = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                var trimmed = raw.Length > 300 ? raw[..300] : raw;
                return new WhatsAppSendOutcome(false, null, $"Meta {(int)resp.StatusCode}: {trimmed}");
            }
            string? messageId = null;
            try
            {
                using var d = JsonDocument.Parse(raw);
                if (d.RootElement.TryGetProperty("messages", out var m) && m.GetArrayLength() > 0 && m[0].TryGetProperty("id", out var id))
                    messageId = id.GetString();
            }
            catch (JsonException) { /* id parse edilemese de gönderim başarılı */ }
            return new WhatsAppSendOutcome(true, messageId, null);
        }
        catch (Exception ex)
        {
            return new WhatsAppSendOutcome(false, null, ex.Message);
        }
    }

    // ---- yardımcılar ----

    private WhatsAppSettingsDto BuildSettingsDto(WhatsAppSettings? s)
    {
        var webhookUrl = BuildWebhookUrl();
        if (s is null)
            return new WhatsAppSettingsDto(false, null, null, WhatsAppConnectionStatus.NotConnected.ToString(), false, null, null, "Meta", webhookUrl, false, false, null, null, null, "tr");
        return new WhatsAppSettingsDto(
            s.Enabled, s.PhoneNumberId, s.DisplayPhoneNumber, s.ConnectionStatus.ToString(), s.IsConnected,
            s.BusinessAccountId, s.ReminderTemplate, s.Provider, webhookUrl,
            s.MarketingEnabled, s.AllowWalletOverage, s.MonthlySpendCapTry,
            s.KvkkTemplateName, s.ReminderTemplateName, s.TemplateLanguageCode);
    }

    private string BuildWebhookUrl()
    {
        var baseUrl = _config["WhatsApp:PublicBaseUrl"]
            ?? _config["Urls"]?.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault()
            ?? "http://localhost:5019";
        return $"{baseUrl.TrimEnd('/')}/api/whatsapp/webhook";
    }

    /// <summary>Rate sayfasının (Next.js) tabanı — API tabanından farklı olabilir.</summary>
    private string FrontendBaseUrl() =>
        (_config["Frontend:PublicBaseUrl"] ?? _config["WhatsApp:PublicBaseUrl"] ?? "http://localhost:3000").TrimEnd('/');

    private static string FirstName(string? fullName) =>
        string.IsNullOrWhiteSpace(fullName) ? "Değerli müşterimiz" : fullName.Trim().Split(' ')[0];

    /// <summary>
    /// Bekleme/slot mesajlarını yazar. Hizmet ya da salon adı boş olabildiğinden metin
    /// boşluklu/asılı kalmasın diye cümlecik olarak üretilir:
    ///  {hizmetcumlei} → "Lazer Epilasyon randevusunu" / "randevuyu"  (belirtme hâli)
    ///  {hizmetcumlen} → "Lazer Epilasyon randevunuz" / "randevunuz"  (iyelik)
    ///  {salonimza}    → " — Salon Adı" / ""  (ad yoksa hiç yazılmaz)
    /// </summary>
    private static string RenderSlotTemplate(string template, string? name, DateTime startUtc, string serviceName, string salonName)
    {
        var local = startUtc.AddHours(3); // Türkiye UTC+3
        var service = (serviceName ?? string.Empty).Trim();
        var salon = (salonName ?? string.Empty).Trim();
        return template
            .Replace("{ad}", FirstName(name))
            .Replace("{tarih}", local.ToString("dd.MM.yyyy"))
            .Replace("{saat}", local.ToString("HH:mm"))
            .Replace("{hizmetcumlei}", service.Length > 0 ? $"{service} randevusunu" : "randevuyu")
            .Replace("{hizmetcumlen}", service.Length > 0 ? $"{service} randevunuz" : "randevunuz")
            .Replace("{hizmet}", service)
            .Replace("{personel}", string.Empty)
            .Replace("{salonimza}", salon.Length > 0 ? $" — {salon}" : string.Empty)
            .Replace("{salon}", salon);
    }

    private static string RenderTemplate(string template, Appointment appt)
    {
        var local = appt.StartUtc.AddHours(3); // Türkiye UTC+3
        return template
            .Replace("{ad}", appt.Customer?.FullName ?? "")
            .Replace("{tarih}", local.ToString("dd.MM.yyyy"))
            .Replace("{saat}", local.ToString("HH:mm"))
            .Replace("{hizmet}", appt.ServiceDefinition?.Name ?? "")
            .Replace("{personel}", appt.StaffMember?.FullName ?? "")
            .Replace("{salon}", appt.Branch?.Name ?? "");
    }

    private static string NormalizePhone(string? p) => new string((p ?? string.Empty).Where(char.IsDigit).ToArray());

    private static bool PhonesMatch(string a, string b)
    {
        var na = NormalizePhone(a);
        var nb = NormalizePhone(b);
        if (na.Length == 0 || nb.Length == 0) return false;
        if (na == nb) return true;
        var min = Math.Min(Math.Min(na.Length, nb.Length), 10);
        return na[^min..] == nb[^min..];
    }

    private static WhatsAppReplyIntent Interpret(string text)
    {
        var t = NormalizeTr(text);
        if (t.Length == 0) return WhatsAppReplyIntent.Unknown;
        var words = t.Split(new[] { ' ', '\t', '\n', '\r', '.', ',', '!', '?', ';' }, StringSplitOptions.RemoveEmptyEntries);
        bool Has(params string[] keys) => keys.Contains(t) || words.Any(w => keys.Contains(w));
        if (t is "e" or "1" || Has("evet", "onay", "onayliyorum", "onayla", "tamam", "olur", "geliyorum", "katiliyorum", "geldim")) return WhatsAppReplyIntent.Confirm;
        if (t is "h" or "2" || Has("hayir", "iptal", "gelemeyecegim", "gelemeyecem", "gelmiyorum", "gelemiyorum", "gelemem")) return WhatsAppReplyIntent.Cancel;
        if (t is "3" || Has("ertele", "ertelensin", "erteleme", "erteleyelim", "degistir", "baska")) return WhatsAppReplyIntent.Reschedule;
        return WhatsAppReplyIntent.Unknown;
    }

    private static string NormalizeTr(string? text)
    {
        var s = (text ?? string.Empty).Trim().Replace('İ', 'i').Replace('I', 'i').Replace('ı', 'i').ToLowerInvariant();
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (var ch in s)
        {
            switch (ch)
            {
                case 'ı': sb.Append('i'); break;
                case 'ş': sb.Append('s'); break;
                case 'ğ': sb.Append('g'); break;
                case 'ü': sb.Append('u'); break;
                case 'ö': sb.Append('o'); break;
                case 'ç': sb.Append('c'); break;
                case '̇': break;
                default: sb.Append(ch); break;
            }
        }
        return sb.ToString();
    }

    private readonly record struct SendContext(bool Live, string? PhoneNumberId, string Token, WhatsAppSettings? Settings = null)
    {
        public static readonly SendContext Offline = new(false, null, string.Empty);
    }

    /// <summary>Mesaja iliştirilecek belge (KVKK aydınlatma metni PDF'i).</summary>
    /// <summary>
    /// Giden mesaj eki.
    ///
    /// <para><b>Required</b>: ek olmadan mesajın ANLAMI BOZULUYORSA true verilir. Hediye kartı
    /// mesajı "kart ekteki PDF'tedir" der; PDF yüklenemediğinde metin tek başına gidince müşteri
    /// olmayan bir eki arar, personel ise "gönderildi" görür — üstelik kontör harcanmıştır.
    /// KVKK aydınlatmasında ise metnin içinde ayrıca link vardır, ek olmadan da mesaj işini görür;
    /// orada "hiç gitmemektense eksiz gitsin" tercihi korunur (false).</para>
    /// </summary>
    private sealed record OutboundAttachment(byte[] Content, string FileName, string MimeType = "application/pdf", bool Required = false);

    /// <summary>Meta belge açıklaması (caption) 1024 karakterle sınırlıdır.</summary>
    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..(max - 1)] + "…";

    /// <summary>
    /// 24 saat penceresi kapalıyken kullanılacak Meta onaylı şablon.
    /// <paramref name="BodyParameters"/> şablondaki {{1}}, {{2}}… sırasıyla eşlenir.
    /// </summary>
    private sealed record TemplateFallback(string Name, string LanguageCode, IReadOnlyList<string> BodyParameters);

    private sealed record DispatchResult(bool Blocked, string? BlockReason, WhatsAppMessage? Message, bool Success, bool Simulated, string ToPhone, string Body, string? ProviderMessageId, string? Error)
    {
        public static readonly DispatchResult Skipped = new(false, null, null, false, false, string.Empty, string.Empty, null, null);
    }
}

internal sealed record WhatsAppSendOutcome(bool Success, string? ProviderMessageId, string? Error);
