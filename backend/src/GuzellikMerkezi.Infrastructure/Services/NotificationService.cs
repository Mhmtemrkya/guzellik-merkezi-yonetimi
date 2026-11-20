using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class NotificationService : INotificationService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IFeatureService _features;
    private readonly IPlatformMessagingService _messaging;

    /// <summary>
    /// WhatsApp gönderimi kendi modülünden (kontör rezervasyonu, 24 saat penceresi, mesaj defteri)
    /// geçer. Çalışma anında çözülür: <c>IWhatsAppService</c> zinciri (waitlist → randevu → …)
    /// ctor bağımlılığında dairesellik riski taşır; aynı scope'tan çözmek bu riski tümden kaldırır.
    /// </summary>
    private readonly IServiceProvider _services;

    public NotificationService(GuzellikDbContext db, IUsageService usage, IFeatureService features, IPlatformMessagingService messaging, IServiceProvider services)
    {
        _db = db;
        _usage = usage;
        _features = features;
        _messaging = messaging;
        _services = services;
    }

    // ---------------- Templates ----------------

    public async Task<Result<PagedResult<NotificationTemplateDto>>> ListTemplatesAsync(Guid tenantId, PageRequest page, CancellationToken ct = default)
    {
        var query = _db.NotificationTemplates.AsNoTracking()
            .Where(x => x.TenantId == tenantId)
            .OrderByDescending(x => x.CreatedAtUtc);
        var total = await query.CountAsync(ct);
        var rows = await query.Skip(page.Skip).Take(page.SafePageSize).ToListAsync(ct);
        var items = rows.Select(ToDto).ToArray();
        return Result<PagedResult<NotificationTemplateDto>>.Success(new PagedResult<NotificationTemplateDto>(items, total, page.SafePage, page.SafePageSize));
    }

    public async Task<Result<NotificationTemplateDto>> GetTemplateAsync(Guid tenantId, Guid id, CancellationToken ct = default)
    {
        var t = await _db.NotificationTemplates.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, ct);
        return t is null ? Result<NotificationTemplateDto>.Failure(Error.NotFound("Şablon bulunamadı.")) : Result<NotificationTemplateDto>.Success(ToDto(t));
    }

    public async Task<Result<NotificationTemplateDto>> CreateTemplateAsync(Guid tenantId, CreateNotificationTemplateRequest req, CancellationToken ct = default)
    {
        try
        {
            var t = new NotificationTemplate(tenantId, req.BranchId, req.Name, req.Channel, req.Trigger, req.Body, req.Status);
            _db.NotificationTemplates.Add(t);
            await _db.SaveChangesAsync(ct);
            return Result<NotificationTemplateDto>.Success(ToDto(t));
        }
        catch (Exception ex)
        {
            return Result<NotificationTemplateDto>.Failure(Error.Validation(ex.Message));
        }
    }

    public async Task<Result<NotificationTemplateDto>> UpdateTemplateAsync(Guid tenantId, Guid id, UpdateNotificationTemplateRequest req, CancellationToken ct = default)
    {
        var t = await _db.NotificationTemplates.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, ct);
        if (t is null) return Result<NotificationTemplateDto>.Failure(Error.NotFound("Şablon bulunamadı."));
        try
        {
            t.Rename(req.Name);
            t.ChangeChannel(req.Channel);
            t.ChangeTrigger(req.Trigger);
            t.UpdateBody(req.Body);
            switch (req.Status)
            {
                case NotificationTemplateStatus.Active: t.Activate(); break;
                case NotificationTemplateStatus.PendingApproval: t.MarkPendingApproval(); break;
                default: t.Draft(); break;
            }
            await _db.SaveChangesAsync(ct);
            return Result<NotificationTemplateDto>.Success(ToDto(t));
        }
        catch (Exception ex)
        {
            return Result<NotificationTemplateDto>.Failure(Error.Validation(ex.Message));
        }
    }

    public async Task<Result> DeleteTemplateAsync(Guid tenantId, Guid id, CancellationToken ct = default)
    {
        var t = await _db.NotificationTemplates.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, ct);
        if (t is null) return Result.Failure(Error.NotFound("Şablon bulunamadı."));
        t.SoftDelete();
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }

    // ---------------- Logs ----------------

    public async Task<Result<PagedResult<NotificationLogDto>>> ListLogsAsync(Guid tenantId, Guid? templateId, PageRequest page, CancellationToken ct = default)
    {
        var query = _db.NotificationLogs.AsNoTracking().Where(x => x.TenantId == tenantId);
        if (templateId.HasValue) query = query.Where(x => x.TemplateId == templateId.Value);

        var total = await query.CountAsync(ct);
        var rows = await query
            .OrderByDescending(x => x.CreatedAtUtc)
            .Skip(page.Skip)
            .Take(page.SafePageSize)
            .ToListAsync(ct);

        // Şablon adı + müşteri adı için ayrı çek; in-memory join (encryption sebebiyle).
        var templateIds = rows.Where(r => r.TemplateId.HasValue).Select(r => r.TemplateId!.Value).Distinct().ToList();
        var customerIds = rows.Where(r => r.CustomerId.HasValue).Select(r => r.CustomerId!.Value).Distinct().ToList();

        var tplMap = templateIds.Count == 0 ? new Dictionary<Guid, string>()
            : (await _db.NotificationTemplates.AsNoTracking().Where(x => x.TenantId == tenantId).Select(x => new { x.Id, x.Name }).ToListAsync(ct))
                .Where(x => templateIds.Contains(x.Id)).ToDictionary(x => x.Id, x => x.Name);

        var custMap = customerIds.Count == 0 ? new Dictionary<Guid, string>()
            : (await _db.Customers.AsNoTracking().Where(x => x.TenantId == tenantId).Select(x => new { x.Id, x.FullName }).ToListAsync(ct))
                .Where(x => customerIds.Contains(x.Id)).ToDictionary(x => x.Id, x => x.FullName);

        var items = rows.Select(r => ToDto(r,
            r.TemplateId.HasValue && tplMap.TryGetValue(r.TemplateId.Value, out var tn) ? tn : null,
            r.CustomerId.HasValue && custMap.TryGetValue(r.CustomerId.Value, out var cn) ? cn : null)).ToArray();

        return Result<PagedResult<NotificationLogDto>>.Success(new PagedResult<NotificationLogDto>(items, total, page.SafePage, page.SafePageSize));
    }

    public async Task<Result<NotificationSummaryDto>> GetSummaryAsync(Guid tenantId, CancellationToken ct = default)
    {
        var dayStart = DateTime.UtcNow.Date;
        var dayEnd = dayStart.AddDays(1);

        var totalTemplates = await _db.NotificationTemplates.CountAsync(x => x.TenantId == tenantId, ct);
        var activeTemplates = await _db.NotificationTemplates.CountAsync(x => x.TenantId == tenantId && x.Status == NotificationTemplateStatus.Active, ct);

        var todayLogs = _db.NotificationLogs.Where(x => x.TenantId == tenantId && x.CreatedAtUtc >= dayStart && x.CreatedAtUtc < dayEnd);
        var todaySent = await todayLogs.CountAsync(x => x.Status == NotificationLogStatus.Sent, ct);
        var todayFailed = await todayLogs.CountAsync(x => x.Status == NotificationLogStatus.Failed, ct);
        var todayQueued = await todayLogs.CountAsync(x => x.Status == NotificationLogStatus.Queued, ct);

        return Result<NotificationSummaryDto>.Success(new NotificationSummaryDto(totalTemplates, activeTemplates, todaySent, todayFailed, todayQueued));
    }

    // ---------------- Send ----------------

    public async Task<Result<SendNotificationResultDto>> SendAsync(Guid tenantId, SendNotificationRequest req, CancellationToken ct = default)
    {
        var template = await _db.NotificationTemplates.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == req.TemplateId, ct);
        if (template is null) return Result<SendNotificationResultDto>.Failure(Error.NotFound("Şablon bulunamadı."));
        if (template.Status != NotificationTemplateStatus.Active)
            return Result<SendNotificationResultDto>.Failure(Error.Conflict("Sadece aktif şablonlar gönderilebilir."));

        // KİTLE GÖNDERİMİ (tüm müşteriler / doğum günü haftası) paketin "toplu gönderim" özelliğidir.
        // Seçili müşterilere gönderim ve otomatik taramalar (müşteri listesi + zaman kovası taşır)
        // bu kapıya takılmaz. Kapı yalnız arayüzdeydi; doğrudan API çağrısı paketi aşabiliyordu.
        if (req.CustomerIds is not { Count: > 0 }
            && !await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsBulk, ct))
            return Result<SendNotificationResultDto>.Failure(Error.Conflict(
                "Tüm müşterilere toplu gönderim paketinizde yok. Müşteri seçerek gönderebilir ya da üst pakete geçebilirsiniz."));

        // Aylık kota kontrolü — gönderim ÖNCESİ. SMS ve E-posta metrelidir (kota dolmuşsa 409 döner).
        //
        // SMS artık kota bitince MESAJ KREDİSİNDEN devam edebilir (kurum izin verdiyse); ön kontrol
        // bu yüzden düz kota değil "şu an HİÇ SMS gidebilir mi?" sorusudur. Alıcı başına karar
        // (kota / kredi / tavan) aşağıda, her mesajın kendi kaydında verilir.
        IWhatsAppBillingService? smsBilling = null;
        var smsLive = false;
        if (template.Channel == NotificationChannel.Sms)
        {
            // PAKET KAPISI (WhatsApp'taki kuralın aynısı). Eskiden SMS'i yalnız plan kotası
            // sınırlıyordu ve SMS'siz pakette kota 0'dı; kredi gelince kotası 0 olan paket krediyle
            // SMS gönderebilir hâle gelirdi. Özellik kapalıysa kredi olsa da gönderilmez.
            if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsSms, ct))
                return Result<SendNotificationResultDto>.Failure(Error.Conflict("SMS gönderimi paketinizde yok. Üst pakete geçerek kullanabilirsiniz."));
            smsBilling = _services.GetRequiredService<IWhatsAppBillingService>();
            var blocked = await smsBilling.SmsAvailabilityBlockReasonAsync(tenantId, ct);
            if (blocked is not null) return Result<SendNotificationResultDto>.Failure(Error.Conflict(blocked));
            // Kendi SMS hesabı etkin kurum, platform hattı kapalı olsa da gerçekten gönderir.
            smsLive = await smsBilling.IsSmsLiveForTenantAsync(tenantId, ct);
        }
        else if (template.Channel == NotificationChannel.Email)
        {
            var limit = await _usage.CheckLimitAsync(tenantId, UsageMetricKeys.Email, ct);
            if (limit.IsFailure) return Result<SendNotificationResultDto>.Failure(limit.Error);
        }

        // Hedef müşteri listesi
        var customers = await ResolveAudienceAsync(tenantId, req, ct);
        if (customers.Count == 0)
            return Result<SendNotificationResultDto>.Failure(Error.Validation("Hedef kitlede uygun müşteri bulunamadı."));

        var now = DateTime.UtcNow;
        var sent = 0; var failed = 0; var skipped = 0;
        // Kurumun kendi SMS hesabı — kimlik bilgisi toplu gönderimde BİR KEZ çözülür (alıcı başına değil).
        SmsAccountCredentials? ownSms = null;
        var ownSmsResolved = false;
        var logsCreated = new List<NotificationLog>();
        var render = await BuildRenderContextAsync(tenantId, template.Trigger, customers, ct);

        foreach (var c in customers)
        {
            var recipient = template.Channel == NotificationChannel.Email ? (c.Email ?? string.Empty) : (c.Phone ?? string.Empty);
            var body = render.Render(template.Body, c);
            // Otomatik gönderimin tekilleştirme anahtarı (H9). Elle gönderimde boştur.
            var dedupeKey = string.IsNullOrWhiteSpace(req.DedupeBucket)
                ? null
                : $"{template.Id:N}:{c.Id:N}:{req.DedupeBucket}";

            if (string.IsNullOrWhiteSpace(recipient))
            {
                skipped++;
                var skipLog = new NotificationLog(tenantId, c.BranchId, template.Id, c.Id, template.Channel, "-", body,
                    NotificationLogStatus.Failed, $"{(template.Channel == NotificationChannel.Email ? "E-posta" : "Telefon")} eksik.",
                    dedupeKey);
                var reservedSkip = await TryReserveAsync(skipLog, ct);
                if (reservedSkip is null) continue;
                logsCreated.Add(reservedSkip);
                continue;
            }

            // KAYIT SAĞLAYICIDAN ÖNCE REZERVE EDİLİR (H9).
            //
            // Eskiden sıra tersti: önce SMS/e-posta gönderiliyor, log satırı en sonda toplu
            // SaveChanges ile yazılıyordu. Sağlayıcı mesajı ilettikten SONRA süreç çökerse (ya da
            // kayıt yazılamazsa) hiçbir iz kalmıyor, bir sonraki tarama tekilleştirmede "gönderilmemiş"
            // görüp AYNI mesajı müşteriye TEKRAR gönderiyordu. Satır önce "Queued" olarak yazılıp
            // COMMIT edilir; benzersiz indeks ikinci denemeyi eler (iki backend örneği dahil).
            var log = new NotificationLog(tenantId, c.BranchId, template.Id, c.Id, template.Channel,
                recipient, body, NotificationLogStatus.Queued, null, dedupeKey);
            var reserved = await TryReserveAsync(log, ct);
            if (reserved is null)
            {
                // Aynı anahtar başka bir tarama/örnek tarafından alınmış → mesaj zaten gidiyor.
                skipped++;
                continue;
            }
            // Bayat rezervasyon devralınmış olabilir; sonuç DEVRALINAN satıra yazılır.
            log = reserved;

            // SMS ÜCRETİ — dış etkiden ve gönderim damgasından ÖNCE.
            //
            // Rezervasyon damgadan ÖNCE yazılır: arada çöken satır damgasız kalır, kurtarma onu
            // "sağlayıcıya hiç gidilmemiş" sayıp devralır ve AYNI rezervasyonla gönderir
            // (ReserveSmsAsync bağlı rezervasyonu tanır, ikinci kez ayırmaz). Sonra yazılsaydı
            // rezerv ile damga arasında çöken satır "gidildi" görünür, SMS bir daha hiç gönderilmezdi.
            // Parça, şablon değişkenleri DOLDURULMUŞ metinden sayılır (sağlayıcıya giden budur).
            // Engellenen gönderim (kota/kredi/tavan) sağlayıcıya hiç gitmez; sebep satıra yazılır.
            if (smsBilling is not null)
            {
                var decision = await smsBilling.ReserveSmsAsync(tenantId, log, SmsSegments.Count(body), smsLive, ct);
                if (!decision.Allowed)
                {
                    log.MarkFailed(decision.BlockReason ?? "SMS gönderilemedi.");
                    logsCreated.Add(log);
                    failed++;
                    if (log.DedupeKey is not null)
                    {
                        try
                        {
                            await _db.SaveChangesAsync(ct);
                        }
                        catch (DbUpdateException)
                        {
                            // Yazılamadıysa satır Queued kalır ve bayatlama yolundan kurtarılır.
                        }
                    }
                    continue;
                }
            }

            // DIŞ ETKİDEN ÖNCE İZ BIRAK.
            //
            // Anahtarlı (otomatik) gönderimde sağlayıcıya gitmeden hemen önce "gidiliyor" damgası
            // COMMIT edilir. Çökme bundan SONRA olursa kurtarma satırı tekrar göndermez, "sonucu
            // bilinmiyor" diye kapatır; ÖNCE olursa damga yoktur ve satır güvenle devralınıp
            // gönderilir. Damganın tek işi bu iki hâli ayırt edilebilir kılmaktır
            // (bkz. NotificationLog.MarkDispatching ve TryReserveAsync).
            if (log.DedupeKey is not null)
            {
                log.MarkDispatching();
                try
                {
                    await _db.SaveChangesAsync(ct);
                }
                catch (DbUpdateException)
                {
                    // DAMGASIZ GÖNDERİM YAPILMAZ. Gönderseydik ve hemen ardından çökseydik, satır
                    // damgasız "Queued" kalır ve kurtarma onu "hiç gidilmemiş" sayıp mesajı ikinci
                    // kez yollardı. Satır Queued kalıyor: bayatlayınca güvenle devralınacak.
                    _db.Entry(log).State = EntityState.Unchanged;
                    skipped++;
                    continue;
                }
            }

            logsCreated.Add(log);

            // GERÇEK gönderim: SMS/E-posta platform mesajlaşma servisinden gider (sağlayıcı yapılandırılmamışsa
            // simülasyon). Durum GERÇEK sonuca göre işaretlenir — başarısız gönderim artık "Sent" gösterilmez,
            // dolayısıyla kota sayımı da (Status==Sent) doğru olur.
            bool ok;
            string? error;

            // SİMÜLASYON TESLİMAT DEĞİLDİR.
            //
            // Sağlayıcı kurulu değilse (ör. SMS kapalı) PlatformMessagingService "Success=true,
            // Simulated=true" döner. Bunu "gönderildi" saymak iki yerde birden yalan üretiyordu:
            // bildirim geçmişinde müşteriye ulaşmamış mesaj "Sent" görünüyor, aylık kota da
            // (Status==Sent sayıldığı için) hiç gönderilmemiş mesajları düşüyordu.
            static (bool Ok, string? Error) Judge(MessagingTestResult r) =>
                r.Success && !r.Simulated
                    ? (true, null)
                    : (false, r.Error ?? (r.Simulated
                        ? "Sağlayıcı yapılandırılmamış (simülasyon) — mesaj gönderilmedi."
                        : "Bilinmeyen hata"));

            switch (template.Channel)
            {
                case NotificationChannel.Sms:
                {
                    // GÖNDERİM YOLU REZERVASYON KARARINDAN OKUNUR (satırın ücret kaynağı), ikinci bir
                    // sorgudan değil: kendi hesaba bağlanmış satır kendi hesaptan gider; bağlantı bu
                    // arada kaldırıldıysa başarısız yazılır, platforma (krediye) DÜŞÜLMEZ.
                    if (log.BillingSource == WhatsAppBillingSource.OwnAccount)
                    {
                        if (!ownSmsResolved)
                        {
                            ownSms = await _services.GetRequiredService<ITenantSmsConnectionService>().ResolveActiveAsync(tenantId, ct);
                            ownSmsResolved = true;
                        }
                        (ok, error) = ownSms is null
                            ? (false, OwnSmsAccountGoneError)
                            : Judge(await _messaging.SendSmsWithAccountAsync(ownSms, recipient, body, ct));
                    }
                    else
                    {
                        (ok, error) = Judge(await _messaging.SendSmsAsync(recipient, body, ct));
                    }
                    break;
                }
                case NotificationChannel.Email:
                {
                    (ok, error) = Judge(await _messaging.SendEmailAsync(recipient, template.Name, body, ct));
                    break;
                }
                case NotificationChannel.WhatsApp:
                {
                    /*
                     * GÖNDERİLMEDEN "GÖNDERİLDİ" DEMEK YOK.
                     *
                     * Burası eskiden `default` dalıydı ve "kendi dedike modülünden gönderilir" diyerek
                     * `ok = true` işaretliyordu. Ama hiçbir yerde gönderilmiyordu: WhatsApp kanalıyla
                     * otomatik hatırlatma kuran kurum, geçmişte "Gönderildi" görüyor, müşteriye hiçbir
                     * şey ulaşmıyordu. Artık gerçek gönderim yapılır ve sonuç ne ise o yazılır.
                     *
                     * KATEGORİ = Meta'nın faturalama sınıfı. Hatırlatma ve ödeme bildirimi işlemseldir
                     * (Utility, ucuz); doğum günü / geri kazanım / seans yenileme / elle kampanya
                     * pazarlamadır (Marketing, ~10 kat pahalı) ve kurumun açık iznini gerektirir.
                     */
                    var marketing = template.Trigger is not (NotificationTrigger.AppointmentReminder or NotificationTrigger.PaymentDue);
                    var whatsApp = _services.GetRequiredService<Application.Features.WhatsApp.IWhatsAppService>();
                    // RANDEVU HATIRLATMASI RANDEVUYA BAĞLI GİDER: genel bildirim olarak gitseydi müşterinin
                    // EVET/HAYIR/ERTELE yanıtı hiçbir randevuya işlenmez, otomatik tarama da aynı randevuyu
                    // ikinci kez hatırlatırdı (20 Kas 2026 canlı testinde yaşandı).
                    (ok, error) = template.Trigger == NotificationTrigger.AppointmentReminder
                        ? Judge(await whatsApp.SendCustomerAppointmentReminderAsync(tenantId, c.Id, body, ct))
                        : Judge(await whatsApp.SendNotificationAsync(tenantId, c.Id, body, marketing, ct));
                    break;
                }
                default:
                    ok = false;
                    error = $"Desteklenmeyen bildirim kanalı: {template.Channel}.";
                    break;
            }

            // Sonuç REZERVE EDİLMİŞ satıra yazılır — yeni satır açılmaz, mükerrer log oluşmaz.
            if (ok) log.MarkSent();
            else log.MarkFailed(error ?? "Bilinmeyen hata");
            if (ok) { sent++; template.RecordSent(now); }
            else { failed++; }

            // SMS KREDİSİ SONUÇLANIR: kabul → kesinleşir, red/simülasyon → iade. Krediden karşılanan
            // satırda gönderim durumu cüzdanla AYNI kayıtta yazılır; kota/simülasyon satırında hiçbir
            // şey yapmaz (durum aşağıdaki olağan kayıtla yazılır). Burada çökülürse satır kredisi
            // askıda kalır ve süpürme onu satırın durumuna göre kesinleştirir ya da iade eder.
            if (smsBilling is not null)
                await smsBilling.SettleSmsAsync(log, ok, ct);

            // SONUÇ HEMEN KALICI OLUR (anahtarlı = otomatik gönderim).
            //
            // Sonuç eskiden döngü bittikten sonra TOPLU yazılıyordu: sağlayıcı mesajı kabul ettikten
            // sonra süreç çökerse satır "Queued" kalıyor, bayat rezervasyon devralma penceresi
            // açılınca aynı mesaj müşteriye TEKRAR gidiyordu. Anahtarsız (elle/kampanya) gönderimde
            // eski toplu yazma korunur: orada tekrar zaten yöneticinin kararıdır ve satır başına
            // yazma binlerce kişilik listede gereksiz maliyettir.
            if (log.DedupeKey is not null)
            {
                try
                {
                    await _db.SaveChangesAsync(ct);
                }
                catch (DbUpdateException)
                {
                    // Yazılamadıysa satır Queued kalır ve bayatlama yolundan kurtarılır;
                    // kalan alıcıların gönderimi bu yüzden durmamalı.
                }
            }
        }

        await _db.SaveChangesAsync(ct);

        // DTO'lara dönüştür (template adı + müşteri adı in-memory)
        var custDict = customers.ToDictionary(x => x.Id, x => x.FullName);
        var logDtos = logsCreated.Select(l => ToDto(l, template.Name,
            l.CustomerId.HasValue && custDict.TryGetValue(l.CustomerId.Value, out var cn) ? cn : null)).ToArray();

        return Result<SendNotificationResultDto>.Success(new SendNotificationResultDto(sent, failed, skipped, logDtos));
    }

    /// <summary>
    /// Log satırını KALICI olarak rezerve eder (sağlayıcı çağrısından önce). Benzersiz indeks
    /// (TenantId, DedupeKey) çakışırsa false döner: aynı mesaj başka bir tarama/örnek tarafından
    /// zaten üstlenilmiştir — ikinci kez GÖNDERİLMEZ.
    /// </summary>
    /// <returns>Kullanılacak satır; null ise mesaj GÖNDERİLMEMELİ (başkası üstlenmiş).</returns>
    private async Task<NotificationLog?> TryReserveAsync(NotificationLog log, CancellationToken ct)
    {
        _db.NotificationLogs.Add(log);

        // ANAHTARSIZ (elle) GÖNDERİMDE SATIR SATIR YAZILMAZ. Rezervasyonun amacı OTOMATİK
        // taramanın aynı mesajı tekrar göndermesini engellemektir; elle gönderimde tekrar zaten
        // yöneticinin kararıdır. Binlerce kişilik bir kampanyada müşteri başına ayrı SaveChanges
        // gereksiz maliyettir — o satırlar sonda toplu yazılır (eski davranış).
        if (log.DedupeKey is null) return log;

        try
        {
            await _db.SaveChangesAsync(ct);
            return log;
        }
        catch (DbUpdateException)
        {
            _db.Entry(log).State = EntityState.Detached;

            // TAKILI REZERVASYON KALICI BASTIRMA YAPMAZ.
            //
            // SOMUT AÇIK: satır "Queued" olarak yazılıp commit edildikten SONRA süreç çökerse
            // (ya da sağlayıcı çağrısı hiç başlamazsa) kayıt sonsuza dek Queued kalıyordu. Benzersiz
            // anahtar yüzünden sonraki her tarama "zaten gönderilmiş" sayıp mesajı bir daha HİÇ
            // göndermiyordu: müşteri hatırlatmasını hiç almıyor, hiçbir yerde de hata görünmüyordu.
            //
            // Terminal durumdaki satır (Sent/Failed) gerçekten "işlendi" demektir ve bastırır.
            // Queued satır ise ancak BAYATLADIYSA devralınır: yaşayan bir gönderim varsa
            // (birkaç saniyelik pencere) ona dokunulmaz, çift mesaj üretilmez.
            var existing = await _db.NotificationLogs
                .FirstOrDefaultAsync(l => l.TenantId == log.TenantId && l.DedupeKey == log.DedupeKey, ct);
            if (existing is null || existing.Status != NotificationLogStatus.Queued) return null;

            var staleBefore = DateTime.UtcNow - StaleReservationTimeout;
            if ((existing.UpdatedAtUtc ?? existing.CreatedAtUtc) > staleBefore) return null;

            // SONUCU BİLİNMEYEN GÖNDERİM KÖRLEMESİNE TEKRARLANMAZ.
            //
            // Damgalı (UpdatedAtUtc dolu) bayat bir Queued satır, sağlayıcıya GİDİLDİĞİNİ söyler.
            // Sağlayıcı mesajı kabul etmiş ama sonuç yazılamadan süreç çökmüş olabilir; tekrar
            // göndermek müşteriye İKİNCİ mesajı yollamaktır. Bu, hatırlatma/ödeme bildirimi gibi
            // kanallarda doğrudan kuruma şikâyet olarak döner ve WhatsApp'ta kontör de yakar.
            //
            // Satır burada TERMİNAL hâle getirilir: geçmişte görünür olur, kota "Sent" saydığı
            // için şişmez ve tekilleştirme anahtarı bir daha gönderim açmaz. Sessizce Queued
            // bırakmak, aynı belirsizliği her turda yeniden yaşatırdı.
            //
            // Damgasız satır ise sağlayıcıya HİÇ gidilmemiş demektir; onu devralıp göndermek
            // DOĞRUDUR — çökmüş bir rezervasyonun mesajının hiç gitmemesi, önceki denetim turunun
            // kapattığı hatanın ta kendisiydi.
            //
            // BİLİNEN DAR PENCERE: devralma (TryTakeOverStaleAsync) da damga yazar. Devralma
            // commit edildikten sonra, gönderim damgası commit edilmeden ÖNCE süreç çökerse ortada
            // "gidilmemiş ama damgalı" bir satır kalır ve burada "sonucu bilinmiyor" sayılır —
            // mesaj bir daha gönderilmez. Pencere milisaniyelerdir ve yönü BİLEREK böyledir:
            // şüphede kalındığında ikinci mesajı YOLLAMAMAK yollamaktan iyidir. Sonuç sessiz de
            // değildir; satır gerekçesiyle birlikte bildirim geçmişinde görünür.
            if (existing.UpdatedAtUtc is not null)
            {
                await ResolveUnknownOutcomeAsync(existing, staleBefore, ct);
                return null;
            }

            // Devralma ATOMİK olmalı; sonuç BU satıra yazılır (çağıranın elindeki detached nesneye değil).
            return await TryTakeOverStaleAsync(existing, staleBefore, ct) ? existing : null;
        }
    }

    /// <summary>
    /// SONUCU DOĞRULANAMAYAN bayat rezervasyonu ATOMİK olarak terminal hâle getirir.
    /// </summary>
    /// <remarks>
    /// Koşul UPDATE'in WHERE'indedir: iki tarama (ya da iki backend örneği) aynı satırı aynı anda
    /// görse bile yalnız biri yazar.
    /// <para>
    /// Durum <c>Failed</c> seçilir çünkü <c>Sent</c> YALNIZ DOĞRULANMIŞ teslimat demektir; aylık
    /// kota da (<c>Status == Sent</c>) bu satırı saymamalıdır. Mesaj gerçekten ulaşmış olabilir —
    /// hata metni bunu açıkça söyler, böylece geçmişi okuyan kişi "gitmedi" ile "doğrulanamadı"yı
    /// karıştırmaz.
    /// </para>
    /// </remarks>
    private async Task ResolveUnknownOutcomeAsync(NotificationLog existing, DateTime staleBefore, CancellationToken ct)
    {
        const string reason =
            "Sağlayıcıya iletildi ancak sonuç doğrulanamadı (gönderim sırasında kesinti). " +
            "Mükerrer mesaj riskine karşı TEKRAR GÖNDERİLMEDİ.";

        if (!_db.Database.IsRelational())
        {
            existing.MarkFailed(reason);
            await _db.SaveChangesAsync(ct);
            return;
        }

        await _db.Database.ExecuteSqlRawAsync(
            "UPDATE `notification_logs` SET `Status` = 'Failed', `ErrorMessage` = {0}, `UpdatedAtUtc` = {1} " +
            "WHERE `Id` = {2} AND `Status` = 'Queued' AND COALESCE(`UpdatedAtUtc`, `CreatedAtUtc`) <= {3}",
            new object[] { reason, DateTime.UtcNow, existing.Id.ToString(), staleBefore }, ct);
    }

    /// <summary>
    /// BAYAT REZERVASYONU ATOMİK DEVRALIR.
    ///
    /// <para>
    /// Devralma "oku → bayat mı? → damgayı tazele" biçimindeydi: iki tarama turu (ya da iki backend
    /// örneği) aynı satırı aynı anda bayat görüp İKİSİ de devralıyor, müşteriye AYNI mesaj iki kez
    /// gidiyordu — rezervasyonun tüm amacı buydu. Koşul artık tek bir UPDATE'in WHERE'inde: satırı
    /// güncelleyebilen tek taraf işi üstlenir, kaybeden 0 satır etkiler ve hiç göndermez.
    /// </para>
    /// <para>
    /// HAM SQL: <c>ExecuteUpdateAsync</c> DEĞİL — ürettiği takma adlı UPDATE'i canlı MariaDB
    /// reddediyor (kodda yerleşik tuzak, bkz. <c>BackgroundJobMaintenance</c>). InMemory sağlayıcıda
    /// (birim testleri) eşzamanlılık yoktur; orada izleyici üzerinden yazılır.
    /// </para>
    /// </summary>
    private async Task<bool> TryTakeOverStaleAsync(NotificationLog existing, DateTime staleBefore, CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            existing.Touch();
            await _db.SaveChangesAsync(ct);
            return true;
        }

        var affected = await _db.Database.ExecuteSqlRawAsync(
            "UPDATE `notification_logs` SET `UpdatedAtUtc` = {0} " +
            "WHERE `Id` = {1} AND `Status` = 'Queued' AND COALESCE(`UpdatedAtUtc`, `CreatedAtUtc`) <= {2}",
            new object[] { DateTime.UtcNow, existing.Id.ToString(), staleBefore }, ct);
        if (affected == 0) return false;

        // İzleyicideki nesne ham UPDATE'i görmez; sonraki yazmalar doğru sürümle gitsin.
        await _db.Entry(existing).ReloadAsync(ct);
        return true;
    }

    /// <summary>
    /// "Queued" bir rezervasyonun terk edilmiş sayılacağı süre. Gerçek gönderim saniyeler sürer;
    /// bu eşik yalnız çökme/yeniden başlatma sonrası kalan satırları kurtarmak içindir.
    /// </summary>
    public static readonly TimeSpan StaleReservationTimeout = TimeSpan.FromMinutes(15);

    /// <summary>Kendi SMS hesabına bağlanmış mesaj, gönderim anında bağlantı artık etkin değilse.</summary>
    public const string OwnSmsAccountGoneError =
        "SMS hesabı bağlantınız kapatıldı ya da kaldırıldı — mesaj gönderilmedi (BeautyAsist hattından da gönderilmez).";

    public async Task<Result<NotificationSendEstimateDto>> EstimateAsync(Guid tenantId, SendNotificationRequest req, CancellationToken ct = default)
    {
        var template = await _db.NotificationTemplates.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == req.TemplateId, ct);
        if (template is null) return Result<NotificationSendEstimateDto>.Failure(Error.NotFound("Şablon bulunamadı."));

        // Gönderimle AYNI kitle ve AYNI metin kuralı — tahmin ile gerçek gönderim ayrışmasın.
        var customers = await ResolveAudienceAsync(tenantId, req, ct);
        var render = await BuildRenderContextAsync(tenantId, template.Trigger, customers, ct);
        var reachable = customers
            .Where(c => template.Channel == NotificationChannel.Email
                ? !string.IsNullOrWhiteSpace(c.Email)
                : !string.IsNullOrWhiteSpace(c.Phone))
            .ToList();
        var units = template.Channel == NotificationChannel.Sms
            ? reachable.Select(c => Math.Max(1, SmsSegments.Count(render.Render(template.Body, c)))).ToList()
            : reachable.Select(_ => 1).ToList();

        // WhatsApp faturalama sınıfı gönderimdekiyle aynı: hatırlatma ve ödeme bildirimi işlemsel, gerisi kampanya.
        var marketing = template.Trigger is not (NotificationTrigger.AppointmentReminder or NotificationTrigger.PaymentDue);
        var billing = _services.GetRequiredService<IWhatsAppBillingService>();
        var cost = await billing.EstimateCostAsync(tenantId, template.Channel, marketing, units, ct);

        // Gönderimdeki paket kapılarının aynısı: tahmin "gider" demesin, gönderim reddetsin.
        var channelFeature = template.Channel switch
        {
            NotificationChannel.Sms => FeatureCatalog.NotificationsSms,
            NotificationChannel.WhatsApp => FeatureCatalog.NotificationsWhatsApp,
            _ => FeatureCatalog.NotificationsEmail,
        };
        if (!await _features.IsFeatureAllowedAsync(tenantId, channelFeature, ct))
        {
            var label = template.Channel switch { NotificationChannel.Sms => "SMS", NotificationChannel.WhatsApp => "WhatsApp", _ => "E-posta" };
            cost = cost with { ExpectedToSend = 0, Warnings = new[] { $"{label} gönderimi paketinizde yok — üst pakete geçerek kullanabilirsiniz." } };
        }
        else if (req.CustomerIds is not { Count: > 0 } && !await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsBulk, ct))
        {
            cost = cost with { ExpectedToSend = 0, Warnings = cost.Warnings.Prepend("Tüm müşterilere toplu gönderim paketinizde yok — müşteri seçerek gönderebilirsiniz.").ToList() };
        }

        var sample = reachable.FirstOrDefault() ?? customers.FirstOrDefault();
        return Result<NotificationSendEstimateDto>.Success(new NotificationSendEstimateDto(
            template.Channel, marketing, customers.Count, reachable.Count,
            template.Channel == NotificationChannel.Sms ? units.Sum() : 0,
            template.Channel == NotificationChannel.Sms && units.Count > 0 ? units.Max() : 0,
            cost.QuotaRemaining, cost.QuotaCovered, cost.CreditMessages, cost.CreditsNeeded, cost.AvailableCredits,
            cost.CostPerUnit, cost.ExpectedToSend, cost.Live, cost.Warnings,
            sample is null ? template.Body : render.Render(template.Body, sample),
            sample?.FullName,
            cost.OwnAccount));
    }

    private async Task<List<Customer>> ResolveAudienceAsync(Guid tenantId, SendNotificationRequest req, CancellationToken ct)
    {
        // Explicit ID listesi gelirse onları kullan (kullanıcının bilerek seçtiği kişiler — kara liste
        // dahil; seçimi kullanıcı yaptı).
        if (req.CustomerIds is { Count: > 0 })
        {
            var ids = req.CustomerIds.ToHashSet();
            return (await _db.Customers.Where(x => x.TenantId == tenantId).ToListAsync(ct))
                .Where(x => ids.Contains(x.Id)).ToList();
        }

        // KİTLE GÖNDERİMİ KARA LİSTEYİ ATLAR: "tüm müşterilere" duyuru, kurumun hizmet vermediği
        // müşterilere gitmemeli (geri kazanım/seans yenileme hedefleri de aynı kuralı uygular).
        var audience = (req.Audience ?? "all").ToLowerInvariant();
        var customers = await _db.Customers.Where(x => x.TenantId == tenantId && !x.IsBlacklisted).ToListAsync(ct);

        return audience switch
        {
            "birthdayweek" => customers.Where(c =>
            {
                if (!c.BirthDate.HasValue) return false;
                var today = DateOnly.FromDateTime(DateTime.UtcNow);
                var bday = new DateOnly(today.Year, c.BirthDate.Value.Month, c.BirthDate.Value.Day);
                var diff = bday.DayNumber - today.DayNumber;
                return diff >= 0 && diff <= 7;
            }).ToList(),
            "active90" => customers, // MVP: gerçek aktiflik için appointments join lazım
            "inactive30" => customers,
            _ => customers,
        };
    }

    /// <summary>
    /// Şablon değişkenlerini dolduran bağlam — kanal, kitle ve tetikleyiciden bağımsız TEK kural.
    ///
    /// <para>
    /// RANDEVU HATIRLATMASINDA {{tarih}}/{{saat}}/{{hizmet}} RANDEVUNUN KENDİSİNDEN gelir. Eskiden
    /// her şablon gönderim ANINI (üstelik UTC) basıyordu: SMS/e-posta hatırlatması "yarın 14:00"
    /// randevusu için "bugün 11:00" yazıyor, müşteriye yanlış saat gidiyordu. Saatler Türkiye
    /// saatidir (UTC+3) — kodun geri kalanındaki randevu metinleriyle aynı kural.
    /// </para>
    /// </summary>
    private sealed class RenderContext
    {
        private readonly IReadOnlyDictionary<Guid, (DateTime StartUtc, string? Service)> _upcoming;
        private readonly IReadOnlyDictionary<Guid, string> _branchNames;
        private readonly string _tenantName;

        public RenderContext(IReadOnlyDictionary<Guid, (DateTime StartUtc, string? Service)> upcoming,
            IReadOnlyDictionary<Guid, string> branchNames, string tenantName)
        {
            _upcoming = upcoming;
            _branchNames = branchNames;
            _tenantName = tenantName;
        }

        public string Render(string body, Customer c)
        {
            var hasAppointment = _upcoming.TryGetValue(c.Id, out var appt);
            var when = (hasAppointment ? appt.StartUtc : DateTime.UtcNow).AddHours(3);
            var salon = c.BranchId is { } bid && _branchNames.TryGetValue(bid, out var branchName) && !string.IsNullOrWhiteSpace(branchName)
                ? branchName
                : _tenantName;

            // Eksik anahtarlar boş bırakılır.
            var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["ad"] = c.FullName,
                ["isim"] = c.FullName,
                ["telefon"] = c.Phone ?? string.Empty,
                ["tarih"] = when.ToString("dd.MM.yyyy"),
                ["saat"] = when.ToString("HH:mm"),
                ["hizmet"] = hasAppointment ? appt.Service ?? string.Empty : string.Empty,
                ["salon"] = salon,
            };
            return Regex.Replace(body, @"\{\{\s*(\w+)\s*\}\}", m => dict.TryGetValue(m.Groups[1].Value, out var v) ? v : string.Empty);
        }
    }

    private async Task<RenderContext> BuildRenderContextAsync(Guid tenantId, NotificationTrigger trigger, IReadOnlyCollection<Customer> customers, CancellationToken ct)
    {
        var upcoming = new Dictionary<Guid, (DateTime StartUtc, string? Service)>();
        if (trigger == NotificationTrigger.AppointmentReminder && customers.Count > 0)
        {
            // Hatırlatma penceresi 24 saattir; 7 gün geniş bir güvenlik payıdır. Müşteri filtresi
            // BELLEKTE uygulanır — yerel Guid listesiyle .Contains() MySQL sağlayıcısında 500 verir.
            var nowUtc = DateTime.UtcNow;
            var until = nowUtc.AddDays(7);
            var wanted = customers.Select(c => c.Id).ToHashSet();
            var rows = await _db.Appointments.AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.StartUtc > nowUtc && a.StartUtc <= until
                         && a.Status != AppointmentStatus.Completed && a.Status != AppointmentStatus.Cancelled)
                .OrderBy(a => a.StartUtc)
                .Select(a => new { a.CustomerId, a.StartUtc, Service = a.ServiceDefinition != null ? a.ServiceDefinition.Name : null })
                .ToListAsync(ct);
            foreach (var r in rows)
            {
                // En YAKIN randevu: sıralı listede ilk görülen kazanır.
                if (wanted.Contains(r.CustomerId) && !upcoming.ContainsKey(r.CustomerId))
                    upcoming[r.CustomerId] = (r.StartUtc, r.Service);
            }
        }

        var branchNames = (await _db.Branches.IgnoreQueryFilters().AsNoTracking()
                .Where(b => b.TenantId == tenantId)
                .Select(b => new { b.Id, b.Name })
                .ToListAsync(ct))
            .ToDictionary(b => b.Id, b => b.Name);
        var tenantName = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? "Salonumuz";

        return new RenderContext(upcoming, branchNames, tenantName);
    }

    // ---------------- Ödeme (vadesi geçen taksit) hatırlatma ----------------

    /// <summary>
    /// Vadesi gelmiş/geçmiş ve allocation'a göre KALANI>0 olan taksiti bulunan müşteri Id'leri.
    /// Taksit "ödendi" Status'ta tutulmadığından (tahsilatlar allocation ile dağıtılır) bu hesap
    /// bellekte AllocatePayments üzerinden yapılır — ödenmiş taksitler hariç tutulur.
    /// </summary>
    public async Task<IReadOnlyList<Guid>> GetPaymentDueTargetsAsync(Guid tenantId, DateOnly today, CancellationToken ct = default)
    {
        var accounts = await _db.CustomerAccounts
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId)
            .Include(a => a.Installments)
            .Include(a => a.Payments)
            .ToListAsync(ct);

        var targets = new List<Guid>();
        foreach (var acc in accounts)
        {
            var allocation = acc.AllocatePayments();
            var hasUnpaidDue = acc.Installments.Any(inst =>
                inst.Status != InstallmentStatus.Cancelled
                && inst.DueDate <= today
                && (inst.Amount - (allocation.TryGetValue(inst.Id, out var paid) ? paid : 0m)) > 0m);
            if (hasUnpaidDue) targets.Add(acc.CustomerId);
        }
        return targets.Distinct().ToList();
    }

    /// <summary>
    /// Geri kazanım (win-back) hedefi: uzun süredir (PassiveCustomerThresholdDays) randevu/paket işlemi
    /// olmayan, kara listede olmayan müşteriler. Pasif müşteri tespitiyle aynı "son aktivite" mantığı.
    /// </summary>
    public async Task<IReadOnlyList<Guid>> GetWinBackTargetsAsync(Guid tenantId, CancellationToken ct = default)
    {
        var thresholdDays = await _db.Tenants.AsNoTracking().Where(t => t.Id == tenantId)
            .Select(t => t.PassiveCustomerThresholdDays).FirstOrDefaultAsync(ct);
        if (thresholdDays < 1) thresholdDays = 60;
        var cutoff = DateTime.UtcNow.AddDays(-thresholdDays);

        var query =
            from c in _db.Customers.AsNoTracking()
            where c.TenantId == tenantId && !c.IsBlacklisted
            let lastAppt = _db.Appointments.Where(a => a.TenantId == tenantId && a.CustomerId == c.Id).Max(a => (DateTime?)a.CreatedAtUtc)
            let lastPkg = _db.CustomerPackageSessions.Where(s => s.TenantId == tenantId && s.CustomerId == c.Id).Max(s => (DateTime?)s.CreatedAtUtc)
            select new { c.Id, Created = c.CreatedAtUtc, lastAppt, lastPkg };
        var rows = await query.ToListAsync(ct);
        return rows
            .Select(r => new { r.Id, last = new[] { (DateTime?)r.Created, r.lastAppt, r.lastPkg }.Where(d => d.HasValue).Select(d => d!.Value).Max() })
            .Where(r => r.last <= cutoff)
            .Select(r => r.Id)
            .ToList();
    }

    /// <summary>
    /// Seans yenileme hedefi: paket almış ve TOPLAM kalan seansı 1 ya da 0'a düşmüş (ama paketi
    /// son 30 gün içinde hâlâ kullanan) müşteriler — "paketin bitiyor, yenileyelim mi?" teklifi.
    /// Kara listedekiler hariç.
    /// </summary>
    public async Task<IReadOnlyList<Guid>> GetSessionRenewalTargetsAsync(Guid tenantId, CancellationToken ct = default)
    {
        var recentCutoff = DateTime.UtcNow.AddDays(-30);
        var rows = await _db.CustomerPackageSessions.AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.TotalSessions > 1)
            .Select(s => new { s.CustomerId, s.TotalSessions, s.UsedSessions, s.UpdatedAtUtc })
            .ToListAsync(ct);
        var candidates = rows
            .GroupBy(r => r.CustomerId)
            .Where(g =>
            {
                var remaining = g.Sum(x => x.TotalSessions - x.UsedSessions);
                var lastUse = g.Max(x => x.UpdatedAtUtc);
                // Kalan 0-1 VE yakın zamanda kullanım var (çok eski bitmiş paketlere spam yok).
                return remaining <= 1 && lastUse >= recentCutoff;
            })
            .Select(g => g.Key)
            .ToList();
        if (candidates.Count == 0) return candidates;

        // Kara listede olmayanlar (şifreli olmayan bool alan — bellekte süz, Guid Contains MySQL tuzağına girme).
        var blacklisted = (await _db.Customers.AsNoTracking()
                .Where(c => c.TenantId == tenantId && c.IsBlacklisted)
                .Select(c => c.Id)
                .ToListAsync(ct))
            .ToHashSet();
        return candidates.Where(id => !blacklisted.Contains(id)).ToList();
    }

    /// <summary>
    /// Vadesi geçen taksit hatırlatmasını ŞİMDİ çalıştırır (arka plan taramasını beklemeden).
    /// Aktif "Ödeme hatırlatma" şablonlarını, ödenmemiş vadesi gelmiş taksiti olan müşterilere
    /// gönderir; aynı gün dedupe uygular.
    /// </summary>
    public async Task<Result<int>> RunPaymentDueRemindersAsync(Guid tenantId, CancellationToken ct = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsAutomation, ct))
            return Result<int>.Failure(Error.Conflict("Otomatik bildirim özelliği paketinizde yok."));

        var templates = await _db.NotificationTemplates
            .Where(x => x.TenantId == tenantId && x.Status == NotificationTemplateStatus.Active && x.Trigger == NotificationTrigger.PaymentDue)
            .ToListAsync(ct);
        if (templates.Count == 0)
            return Result<int>.Failure(Error.Validation("Aktif 'Ödeme hatırlatma' şablonu yok. Bildirimler sayfasından oluşturup aktifleştirin."));

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var dayStart = DateTime.UtcNow.Date;
        var targets = (await GetPaymentDueTargetsAsync(tenantId, today, ct)).ToList();
        if (targets.Count == 0) return Result<int>.Success(0);

        var totalSent = 0;
        foreach (var template in templates)
        {
            var alreadySent = (await _db.NotificationLogs
                    .Where(l => l.TenantId == tenantId && l.TemplateId == template.Id && l.CustomerId != null && l.CreatedAtUtc >= dayStart)
                    .Select(l => l.CustomerId).ToListAsync(ct))
                .Where(id => id.HasValue).Select(id => id!.Value).ToHashSet();
            var toSend = targets.Where(id => !alreadySent.Contains(id)).Distinct().ToList();
            if (toSend.Count == 0) continue;
            var res = await SendAsync(tenantId, new SendNotificationRequest(template.Id, toSend, null), ct);
            if (res.IsSuccess && res.Value is not null) totalSent += res.Value.Sent;
        }
        return Result<int>.Success(totalSent);
    }

    // ---------------- Mapping ----------------

    private static NotificationTemplateDto ToDto(NotificationTemplate t) => new(
        t.Id, t.TenantId, t.BranchId, t.Name, t.Channel, t.Trigger, t.Body, t.Status, t.TotalSentCount, t.LastSentAtUtc, t.CreatedAtUtc);

    private static NotificationLogDto ToDto(NotificationLog l, string? templateName, string? customerName) => new(
        l.Id, l.TenantId, l.BranchId, l.TemplateId, templateName, l.CustomerId, customerName, l.Channel, l.Recipient, l.Body,
        l.Status, l.ErrorMessage, l.SentAtUtc, l.CreatedAtUtc,
        l.Purpose, l.BillingSource, l.ChargedCredits, l.SmsParts);

    // ---------------- Şablonsuz sistem SMS'i ----------------

    /// <inheritdoc />
    public async Task<SystemSmsOutcome> SendSystemSmsAsync(SystemSmsRequest request, CancellationToken ct = default)
    {
        var body = (request.Body ?? string.Empty).Trim();
        var parts = SmsSegments.Count(body);
        if (parts == 0)
            return new SystemSmsOutcome(SystemSmsStatus.Failed, body, 0, 0m, false, "Boş mesaj gönderilmez.");
        if (string.IsNullOrWhiteSpace(request.Phone))
            return new SystemSmsOutcome(SystemSmsStatus.Blocked, body, parts, 0m, false, "Müşterinin telefon numarası yok.");
        // Paket kapısı (şablonlu SMS ile aynı kural): özellik kapalıysa kredi olsa da gönderilmez.
        if (!await _features.IsFeatureAllowedAsync(request.TenantId, FeatureCatalog.NotificationsSms, ct))
            return new SystemSmsOutcome(SystemSmsStatus.Blocked, body, parts, 0m, false, "SMS gönderimi paketinizde yok.");

        var billing = _services.GetRequiredService<IWhatsAppBillingService>();
        var live = await billing.IsSmsLiveForTenantAsync(request.TenantId, ct);

        // 1) KAYIT SAĞLAYICIDAN ÖNCE (şablonlu gönderimle aynı protokol, bkz. TryReserveAsync).
        //    Anahtarlı istekte benzersiz indeks ikinci denemeyi eler: iş kuyruğu yeniden denese
        //    bile müşteriye aynı SMS iki kez gitmez.
        var log = new NotificationLog(request.TenantId, request.BranchId, templateId: null, request.CustomerId,
            NotificationChannel.Sms, request.Phone, body, NotificationLogStatus.Queued, null,
            request.DedupeKey, request.Purpose);
        var reserved = await TryReserveAsync(log, ct);
        if (reserved is null)
            return new SystemSmsOutcome(SystemSmsStatus.AlreadyHandled, body, parts, 0m, false, null);
        log = reserved;

        // 2) KOTA / KREDİ — dış etkiden ve gönderim damgasından ÖNCE (bkz. SendAsync'teki not).
        var decision = await billing.ReserveSmsAsync(request.TenantId, log, parts, live, ct);
        if (!decision.Allowed)
        {
            var reason = decision.BlockReason ?? "SMS gönderilemedi.";
            log.MarkFailed(reason);
            await _db.SaveChangesAsync(ct);
            return new SystemSmsOutcome(SystemSmsStatus.Blocked, body, parts, 0m, false, reason);
        }

        // 3) DIŞ ETKİDEN ÖNCE İZ: anahtarlı gönderimde "sağlayıcıya gidiliyor" damgası commit edilir.
        //    Anahtarsız (elle) gönderimde satır yukarıdaki kayıtlarla zaten yazıldı; damga yine
        //    basılır ki çökme sonrası satır "sonucu bilinmiyor" olarak kapansın, körlemesine tekrar
        //    gönderilmesin.
        log.MarkDispatching();
        await _db.SaveChangesAsync(ct);

        // 4) Gönderim. Simülasyon teslimat DEĞİLDİR: başarılı dönse de "gönderilmedi" sayılır.
        //    Yol rezervasyon kararından okunur (bkz. SendAsync): kendi hesaba bağlanan satır platforma düşmez.
        MessagingTestResult result;
        if (log.BillingSource == WhatsAppBillingSource.OwnAccount)
        {
            var own = await _services.GetRequiredService<ITenantSmsConnectionService>().ResolveActiveAsync(request.TenantId, ct);
            result = own is null
                ? new MessagingTestResult(false, false, null, OwnSmsAccountGoneError)
                : await _messaging.SendSmsWithAccountAsync(own, request.Phone, body, ct);
        }
        else
        {
            result = await _messaging.SendSmsAsync(request.Phone, body, ct);
        }
        var ok = result.Success && !result.Simulated;
        var error = ok
            ? null
            : result.Error ?? (result.Simulated
                ? "SMS sağlayıcısı yapılandırılmamış (simülasyon) — mesaj gönderilmedi."
                : "Bilinmeyen hata");

        if (ok) log.MarkSent();
        else log.MarkFailed(error!);

        // 5) Kredi: kabul → kesinleşir, red → iade; gönderim durumu ile AYNI kayıtta yazılır.
        //    Krediden karşılanmayan (kota/simülasyon) satırda ayar yapmaz; durum aşağıda yazılır.
        await billing.SettleSmsAsync(log, ok, ct);
        await _db.SaveChangesAsync(ct);

        return new SystemSmsOutcome(
            ok ? SystemSmsStatus.Sent : SystemSmsStatus.Failed,
            body, parts, ok ? decision.Credits : 0m, result.Simulated, error);
    }
}
