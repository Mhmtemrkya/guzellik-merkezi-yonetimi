using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class NotificationService : INotificationService
{
    private readonly GuzellikDbContext _db;
    private readonly IUsageService _usage;
    private readonly IFeatureService _features;
    private readonly IPlatformMessagingService _messaging;

    public NotificationService(GuzellikDbContext db, IUsageService usage, IFeatureService features, IPlatformMessagingService messaging)
    {
        _db = db;
        _usage = usage;
        _features = features;
        _messaging = messaging;
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

        // Aylık kota kontrolü — gönderim ÖNCESİ. SMS ve E-posta metrelidir (kota dolmuşsa 409 döner).
        if (template.Channel == NotificationChannel.Sms)
        {
            var limit = await _usage.CheckLimitAsync(tenantId, "sms", ct);
            if (limit.IsFailure) return Result<SendNotificationResultDto>.Failure(limit.Error);
        }
        else if (template.Channel == NotificationChannel.Email)
        {
            var limit = await _usage.CheckLimitAsync(tenantId, "email", ct);
            if (limit.IsFailure) return Result<SendNotificationResultDto>.Failure(limit.Error);
        }

        // Hedef müşteri listesi
        var customers = await ResolveAudienceAsync(tenantId, req, ct);
        if (customers.Count == 0)
            return Result<SendNotificationResultDto>.Failure(Error.Validation("Hedef kitlede uygun müşteri bulunamadı."));

        var now = DateTime.UtcNow;
        var sent = 0; var failed = 0; var skipped = 0;
        var logsCreated = new List<NotificationLog>();

        foreach (var c in customers)
        {
            var recipient = template.Channel == NotificationChannel.Email ? (c.Email ?? string.Empty) : (c.Phone ?? string.Empty);
            var body = RenderBody(template.Body, c);
            if (string.IsNullOrWhiteSpace(recipient))
            {
                skipped++;
                var skipLog = new NotificationLog(tenantId, c.BranchId, template.Id, c.Id, template.Channel, "-", body,
                    NotificationLogStatus.Failed, $"{(template.Channel == NotificationChannel.Email ? "E-posta" : "Telefon")} eksik.");
                _db.NotificationLogs.Add(skipLog);
                logsCreated.Add(skipLog);
                continue;
            }

            // GERÇEK gönderim: SMS/E-posta platform mesajlaşma servisinden gider (sağlayıcı yapılandırılmamışsa
            // simülasyon). Durum GERÇEK sonuca göre işaretlenir — başarısız gönderim artık "Sent" gösterilmez,
            // dolayısıyla kota sayımı da (Status==Sent) doğru olur.
            bool ok;
            string? error;
            switch (template.Channel)
            {
                case NotificationChannel.Sms:
                {
                    var r = await _messaging.SendSmsAsync(recipient, body, ct);
                    ok = r.Success; error = r.Error;
                    break;
                }
                case NotificationChannel.Email:
                {
                    var r = await _messaging.SendEmailAsync(recipient, template.Name, body, ct);
                    ok = r.Success; error = r.Error;
                    break;
                }
                default:
                    // WhatsApp vb. kendi dedike modülünden gönderilir; burada gönderilmiş kabul edilir.
                    ok = true; error = null;
                    break;
            }

            var status = ok ? NotificationLogStatus.Sent : NotificationLogStatus.Failed;
            var log = new NotificationLog(tenantId, c.BranchId, template.Id, c.Id, template.Channel, recipient, body, status, error);
            _db.NotificationLogs.Add(log);
            logsCreated.Add(log);
            if (ok) { sent++; template.RecordSent(now); }
            else { failed++; }
        }

        await _db.SaveChangesAsync(ct);

        // DTO'lara dönüştür (template adı + müşteri adı in-memory)
        var custDict = customers.ToDictionary(x => x.Id, x => x.FullName);
        var logDtos = logsCreated.Select(l => ToDto(l, template.Name,
            l.CustomerId.HasValue && custDict.TryGetValue(l.CustomerId.Value, out var cn) ? cn : null)).ToArray();

        return Result<SendNotificationResultDto>.Success(new SendNotificationResultDto(sent, failed, skipped, logDtos));
    }

    private async Task<List<Customer>> ResolveAudienceAsync(Guid tenantId, SendNotificationRequest req, CancellationToken ct)
    {
        // Explicit ID listesi gelirse onları kullan
        if (req.CustomerIds is { Count: > 0 })
        {
            var ids = req.CustomerIds.ToHashSet();
            return (await _db.Customers.Where(x => x.TenantId == tenantId).ToListAsync(ct))
                .Where(x => ids.Contains(x.Id)).ToList();
        }

        var audience = (req.Audience ?? "all").ToLowerInvariant();
        var customers = await _db.Customers.Where(x => x.TenantId == tenantId).ToListAsync(ct);

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

    private static string RenderBody(string body, Customer c)
    {
        // Token sözlüğü — eksik anahtarlar boş bırakılır.
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["ad"] = c.FullName,
            ["isim"] = c.FullName,
            ["telefon"] = c.Phone ?? string.Empty,
            ["tarih"] = DateTime.UtcNow.ToString("dd.MM.yyyy"),
            ["saat"] = DateTime.UtcNow.ToString("HH:mm"),
        };
        return Regex.Replace(body, @"\{\{\s*(\w+)\s*\}\}", m => dict.TryGetValue(m.Groups[1].Value, out var v) ? v : string.Empty);
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
        l.Status, l.ErrorMessage, l.SentAtUtc, l.CreatedAtUtc);
}
