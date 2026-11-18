using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Connector;
using GuzellikMerkezi.Application.Features.TenantSignup;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// KAYIT MAYDANOZ'DA (kullanıcı kararı 18 Kas 2026). Kurum maydanozasist.com/kayit/beauty'de belgeleriyle
/// başvurur; e-posta (ve açıksa telefon) sahipliği BURADAKİ kayıt akışıyla doğrulanır — aynı kod üretimi,
/// aynı frenler, aynı mükerrer kapısı — ama doğrulama sonunda kurum AÇILMAZ (<see cref="SignupDraft.ApplicationOnly"/>).
/// Maydanoz yöneticisi onaylayınca <see cref="ApproveAsync"/> kurumu açar: deneme paketi, sayaç kurum sahibinin
/// İLK girişinde başlar (platformdan açılan kurumlarla aynı kural), parola yok — "Şifremi unuttum" ile belirlenir.
/// </summary>
public sealed partial class TenantSignupService : IConnectorApplications
{
    private const string DefaultBranchName = "Merkez";

    /// <summary>Maydanoz başvuru kimliği (önek + ULID).</summary>
    [GeneratedRegex("^app_[0-9a-z]{26}$", RegexOptions.CultureInvariant, 100)]
    private static partial Regex ApplicationIdPattern();

    private string DefaultLoginUrl => $"{(_config["App:PublicBaseUrl"] ?? "https://beautyasist.com").TrimEnd('/')}/login";

    /// <summary>
    /// Başvurudan TÜRETİLEN sabit kurum kimliği. Aynı başvuru ikinci kez onaylanırsa (Maydanoz yeniden denedi)
    /// ikinci kurum açılmaz: kimlik zaten vardır ve o kurum döner; eşzamanlı iki onay birincil anahtara takılır.
    /// </summary>
    internal static Guid ApplicationTenantId(string applicationId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes("maydanoz-application:" + applicationId));
        return new Guid(hash.AsSpan(0, 16));
    }

    public Task<Result<TenantSignupReadinessDto>> ReadinessAsync(CancellationToken ct = default) => GetReadinessAsync(ct);

    public async Task<Result<ConnectorApplicationStartDto>> StartVerificationAsync(ConnectorApplicationStartRequest request, CancellationToken ct = default)
    {
        var started = await StartCoreAsync(new TenantSignupStartRequest(
            request.TenantName ?? string.Empty,
            request.OwnerName ?? string.Empty,
            request.Email ?? string.Empty,
            request.Phone ?? string.Empty,
            string.IsNullOrWhiteSpace(request.BranchName) ? DefaultBranchName : request.BranchName,
            request.City ?? string.Empty,
            request.PhoneChannel), applicationOnly: true, ct);
        return started.IsSuccess
            ? Result<ConnectorApplicationStartDto>.Success(new ConnectorApplicationStartDto(started.Value!.SignupId, started.Value.MaskedEmail, started.Value.DevCode))
            : Result<ConnectorApplicationStartDto>.Failure(started.Error);
    }

    public async Task<Result<ConnectorApplicationStepDto>> VerifyApplicationEmailAsync(ConnectorApplicationCodeRequest request, CancellationToken ct = default)
    {
        var id = request.VerificationId ?? string.Empty;
        var (draft, failure) = await TakeDraftAsync(id, SignupStage.AwaitingEmail, ct, applicationOnly: true);
        if (failure is not null) return Result<ConnectorApplicationStepDto>.Failure(failure);

        var check = await CheckCodeAsync(request.Code, id, ct);
        if (check is not null) return Result<ConnectorApplicationStepDto>.Failure(check);

        // Kodu doğru giren adresin sahibidir: "hesabınız zaten var" demek kendi bilgisini vermektir (bkz. VerifyEmailAsync).
        if (draft!.EmailAlreadyRegistered)
        {
            await _store.RemoveAsync(DraftKey(id), ct);
            return Result<ConnectorApplicationStepDto>.Failure(Error.Conflict(
                "Bu e-posta adresiyle zaten bir BeautyAsist hesabınız var. Giriş yapın ya da şifrenizi sıfırlayın."));
        }

        if (!_requirePhoneVerification)
        {
            await _store.RemoveAsync(DraftKey(id), ct);
            return Result<ConnectorApplicationStepDto>.Success(new ConnectorApplicationStepDto(ConnectorApplicationStepDto.StepDone));
        }

        var code = NewCode();
        var (channel, sent) = await SendPhoneCodeAsync(draft.Form, code, draft.PreferredPhoneChannel, ct);
        if (!sent)
        {
            return Result<ConnectorApplicationStepDto>.Failure(Error.Unauthorized(
                "Telefonunuza doğrulama kodu gönderilemedi. Numaranızı kontrol edip tekrar deneyin."));
        }

        draft.Stage = SignupStage.AwaitingPhone;
        draft.Code = code;
        draft.Attempts = 0;
        draft.PhoneChannel = channel;
        await _store.SetAsync(DraftKey(id), draft, DraftLifetime, ct);
        return Result<ConnectorApplicationStepDto>.Success(new ConnectorApplicationStepDto(
            ConnectorApplicationStepDto.StepPhone, PhoneMask.Mask(draft.Form.Phone), channel, _env.IsDevelopment ? code : null));
    }

    public async Task<Result<ConnectorApplicationStepDto>> VerifyApplicationPhoneAsync(ConnectorApplicationCodeRequest request, CancellationToken ct = default)
    {
        var id = request.VerificationId ?? string.Empty;
        var (_, failure) = await TakeDraftAsync(id, SignupStage.AwaitingPhone, ct, applicationOnly: true);
        if (failure is not null) return Result<ConnectorApplicationStepDto>.Failure(failure);

        var check = await CheckCodeAsync(request.Code, id, ct);
        if (check is not null) return Result<ConnectorApplicationStepDto>.Failure(check);

        await _store.RemoveAsync(DraftKey(id), ct);
        return Result<ConnectorApplicationStepDto>.Success(new ConnectorApplicationStepDto(ConnectorApplicationStepDto.StepDone));
    }

    public Task<Result<object>> ResendApplicationCodeAsync(ConnectorApplicationResendRequest request, CancellationToken ct = default) =>
        ResendCoreAsync(request.VerificationId ?? string.Empty, applicationOnly: true, ct);

    public async Task<Result<ConnectorApplicationApprovedDto>> ApproveAsync(ConnectorApplicationApproveRequest request, CancellationToken ct = default)
    {
        var applicationId = (request.ApplicationId ?? string.Empty).Trim();
        if (!ApplicationIdPattern().IsMatch(applicationId))
            return Result<ConnectorApplicationApprovedDto>.Failure(Error.Validation("Başvuru kimliği geçersiz."));

        var loginUrl = SafeLink(request.LoginUrl) ?? DefaultLoginUrl;
        var tenantId = ApplicationTenantId(applicationId);

        // TEKRAR: bu başvuruyla açılmış kurum varsa o döner (yeni kurum, yeni e-posta yok).
        var existingCode = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == tenantId).Select(t => t.Code).FirstOrDefaultAsync(ct);
        if (existingCode is not null)
            return Result<ConnectorApplicationApprovedDto>.Success(new ConnectorApplicationApprovedDto(tenantId, existingCode, loginUrl, Created: false, EmailSent: false));

        var form = new TenantSignupStartRequest(
            TenantName: TenantTextHelper.NormalizeText(request.TenantName),
            OwnerName: TenantTextHelper.NormalizeText(request.OwnerName),
            Email: TenantTextHelper.NormalizeEmail(request.Email),
            Phone: TenantTextHelper.NormalizeText(request.Phone),
            BranchName: TenantTextHelper.NormalizeText(string.IsNullOrWhiteSpace(request.BranchName) ? DefaultBranchName : request.BranchName),
            City: TenantTextHelper.NormalizeText(request.City),
            PhoneChannel: null);
        if (Validate(form) is { } invalid) return Result<ConnectorApplicationApprovedDto>.Failure(Error.Validation(invalid));

        // ONAY ANINDA MÜKERRER KONTROLÜ TEKRAR: başvurudan bu yana (günler geçebilir) aynı e-posta, telefon
        // ya da işletme adıyla kurum açılmış olabilir.
        if (await IsEmailRegisteredAsync(form.Email, ct) || await IsDuplicateAsync(form, ct))
            return Result<ConnectorApplicationApprovedDto>.Failure(Error.Conflict(DuplicateMessage));

        var plan = await ResolveTrialPlanAsync(ct);
        if (plan is null)
        {
            _logger.LogError("Maydanoz başvurusu onaylanamadı: deneme paketi bulunamadı.");
            return Result<ConnectorApplicationApprovedDto>.Failure(Error.Conflict("Deneme paketi bulunamadı; hesap açılmadı."));
        }

        var slug = await AllocateSlugAsync(form.TenantName, ct);
        for (var attempt = 0; attempt < MaxCodeAttempts; attempt++)
        {
            var code = await TenantCodeAllocator.NextAsync(_db, attempt, ct);
            // Deneme: sayaç kurum sahibinin İLK girişinde başlar (Tenant kurucusu; AuthService).
            var tenant = new Tenant(form.TenantName, slug, plan.Name, TenantStatus.Trial);
            tenant.UseIdentity(tenantId);
            tenant.AssignCode(code);
            tenant.MarkSelfSignup();
            tenant.SetProfile(null, form.OwnerName);
            tenant.SetContact(form.Phone, Clean(request.TaxNumber, 20));
            tenant.SetProfileExtras(Clean(request.LegalName, 200), Clean(request.TaxOffice, 100), form.Email);
            tenant.SetPhoneIndex(_search.BuildPhoneKey(form.Phone));
            tenant.AssignSubscriptionPlan(plan);

            var branch = tenant.AddBranch(form.BranchName, form.City, isDefault: true);
            var owner = tenant.GrantAccess(form.Email, UserRole.InstitutionOwner, null, form.OwnerName);
            // Kimsenin bilmediği geçici parola: kurum sahibi "Şifremi unuttum" ile kendi parolasını belirler.
            owner.SetTemporaryPassword(_passwordHasher.Hash(TenantTextHelper.GenerateTempPassword()));
            _db.Tenants.Add(tenant);
            _db.TenantSignupReservations.Add(new TenantSignupReservation(
                tenant.Id, form.Email, _search.BuildPhoneKey(form.Phone) ?? PhoneMask.LoginKey(form.Phone)));

            await _audit.LogAsync(tenant.Id, branch.Id, "MaydanozApplication", "Tenant", tenant.Id,
                $"Kurum maydanozasist.com başvurusu onaylanarak açıldı ({code}); {TrialDays} günlük deneme ilk girişte başlar.",
                new { applicationId }, ct);

            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (TenantCodeAllocator.IsDuplicateCodeError(ex) && attempt < MaxCodeAttempts - 1)
            {
                _db.ChangeTracker.Clear();
                continue;
            }
            catch (Exception ex) when (IsReservationConflict(ex))
            {
                _db.ChangeTracker.Clear();
                return Result<ConnectorApplicationApprovedDto>.Failure(Error.Conflict(DuplicateMessage));
            }
            catch (DbUpdateException)
            {
                // Aynı başvuru eşzamanlı iki kez onaylandıysa diğeri açtı (birincil anahtar): o kurum döner.
                _db.ChangeTracker.Clear();
                if (await _db.Tenants.IgnoreQueryFilters().AsNoTracking().AnyAsync(t => t.Id == tenantId, ct))
                    return await ApproveAsync(request, ct);
                throw;
            }

            var sent = await SendApprovedAsync(form, code, plan.Name, loginUrl, ct);
            _logger.LogInformation("Maydanoz başvurusu onaylandı, kurum açıldı: {Code}.", code);
            return Result<ConnectorApplicationApprovedDto>.Success(new ConnectorApplicationApprovedDto(tenantId, code, loginUrl, Created: true, sent));
        }

        return Result<ConnectorApplicationApprovedDto>.Failure(Error.Conflict("Hesap şu anda açılamadı (kurum kodu ayrılamadı). Lütfen tekrar deneyin."));
    }

    public async Task<Result<ConnectorApplicationNotifyDto>> NotifyAsync(ConnectorApplicationNotifyRequest request, CancellationToken ct = default)
    {
        var email = TenantTextHelper.NormalizeEmail(request.Email);
        var owner = Clean(request.OwnerName, 120);
        var tenantName = Clean(request.TenantName, 160);
        var reason = Clean(request.Reason, 1000);
        var kind = (request.Kind ?? string.Empty).Trim();
        if (!ApplicationIdPattern().IsMatch((request.ApplicationId ?? string.Empty).Trim()) || email.Length is < 5 or > 254 || !email.Contains('@')
            || owner is null || tenantName is null || kind is not ("received" or "rejected") || (kind == "rejected" && reason is null))
        {
            return Result<ConnectorApplicationNotifyDto>.Failure(Error.Validation("Bildirim bilgileri eksik ya da geçersiz."));
        }

        var link = SafeLink(request.Link);
        var greeting = $"Merhaba {owner},";
        // ŞIK ŞABLON (kullanıcı isteği 18 Kas 2026): doğrulama kodu e-postasıyla aynı görsel dil — NoticeEmailTemplate.
        var (subject, content) = kind == "received"
            ? ("BeautyAsist başvurunuz alındı", new NoticeEmailContent(
                Title: "BAŞVURUNUZ ALINDI",
                Preheader: $"{tenantName} için başvurunuz incelemede; hesabınız açılınca giriş bilgilerini göndereceğiz.",
                Greeting: greeting,
                Paragraphs:
                [
                    $"{tenantName} için BeautyAsist başvurunuzu ve belgelerinizi aldık. Ekibimiz belgeleri inceledikten sonra (genellikle 1 iş günü) hesabınızı açacak ve bu adrese giriş bilgilerini göndereceğiz.",
                    "Hesabınız açıldığında BeautyAsist'i 14 gün ücretsiz deneyebilirsiniz.",
                ],
                TenantName: tenantName,
                CardTitle: "BAŞVURU BİLGİLERİ",
                Rows: [new("Kurum", tenantName), new("E-Posta", email), new("Durum", "İnceleniyor")],
                StepsTitle: "SIRADAKİ ADIMLAR",
                Steps: ["Belgeleriniz incelenir.", "Hesabınız açılır.", "Giriş bilgileri e-postanıza gelir.", "14 gün ücretsiz denersiniz."],
                Notes: ["Belgelerinizde eksik olursa sizinle bu adresten iletişime geçeriz.", "Güvenlik gereği şifre e-postayla gönderilmez; ilk girişte kendiniz belirlersiniz."]))
            : ("BeautyAsist başvurunuz hakkında", new NoticeEmailContent(
                Title: "BAŞVURU SONUCU",
                Preheader: $"{tenantName} için başvurunuz bu haliyle onaylanamadı.",
                Greeting: greeting,
                Paragraphs:
                [
                    $"{tenantName} için yaptığınız başvuruyu bu haliyle onaylayamadık.",
                    link is null ? string.Empty : "Eksikleri tamamlayıp yeniden başvurabilirsiniz.",
                ],
                TenantName: tenantName,
                CalloutLabel: "Gerekçe",
                Callout: reason,
                ActionText: link is null ? null : "Yeniden başvur",
                ActionUrl: link,
                Notes: ["Sorularınız için bu e-postayı aldığınız adresle destek ekibimize yazabilirsiniz."]));
        var html = NoticeEmailTemplate.Build(content);
        var sent = await TrySendAsync(() => _messaging.SendEmailAsync(email, subject, html, ct), kind == "received" ? "başvuru alındı e-postası" : "başvuru red e-postası");
        return Result<ConnectorApplicationNotifyDto>.Success(new ConnectorApplicationNotifyDto(sent));
    }

    /// <summary>Hesap açıldı e-postası (best-effort). PAROLA YAZILMAZ: ilk giriş "Şifremi unuttum" ile.</summary>
    private async Task<bool> SendApprovedAsync(TenantSignupStartRequest form, string tenantCode, string planName, string loginUrl, CancellationToken ct)
    {
        // ŞIK ŞABLON (kullanıcı isteği 18 Kas 2026): doğrulama kodu e-postasıyla aynı görsel dil; kurum kodu kod kutusunda.
        var body = NoticeEmailTemplate.Build(new NoticeEmailContent(
            Title: "HESABINIZ AÇILDI",
            Preheader: $"{form.TenantName} için BeautyAsist hesabınız hazır. İlk girişte şifrenizi siz belirlersiniz.",
            Greeting: $"Merhaba {form.OwnerName},",
            Paragraphs:
            [
                $"Başvurunuz onaylandı. {form.TenantName} için {planName} hesabınız hazır.",
                $"İlk giriş: {loginUrl} adresinde “Şifremi unuttum” bağlantısıyla bu e-posta adresine gelen kodu girip kendi şifrenizi belirleyin. Güvenlik gereği şifre e-postayla gönderilmez.",
                "14 günlük ücretsiz deneme panele ilk girişinizde başlar. Deneme bitiminde paketinizi maydanozasist.com'dan aylık ya da yıllık satın alabilirsiniz.",
            ],
            TenantName: form.TenantName,
            HighlightLabel: "Kurum Kodu",
            Highlight: tenantCode,
            CardTitle: "HESAP BİLGİLERİ",
            Rows: [new("E-Posta", form.Email), new("Paket", planName), new("Deneme", "14 gün ücretsiz (ilk girişte başlar)")],
            StepsTitle: "İLK GİRİŞ NASIL YAPILIR?",
            Steps: ["Giriş sayfasını açın.", "“Şifremi unuttum” bağlantısına basın.", "E-postanıza gelen kodu girin.", "Kendi şifrenizi belirleyin."],
            ActionText: "Giriş sayfasını aç",
            ActionUrl: loginUrl,
            Notes: ["Güvenlik gereği şifre e-postayla gönderilmez.", $"Destek almak için kurum kodunuzu ({tenantCode}) belirtmeniz yeterlidir."]));

        return await TrySendAsync(() => _messaging.SendEmailAsync(form.Email, $"BeautyAsist hesabınız açıldı ({tenantCode})", body, ct), "başvuru onayı e-postası");
    }

    /// <summary>E-postaya konacak bağlantı yalnız https olabilir (bağlayıcı güvenilir olsa da biçim denetlenir).</summary>
    private static string? SafeLink(string? value) =>
        Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && string.IsNullOrEmpty(uri.UserInfo) && value!.Trim().Length <= 300
            ? uri.AbsoluteUri
            : null;

    private static string? Clean(string? value, int max)
    {
        var text = TenantTextHelper.NormalizeText(value);
        return text.Length == 0 ? null : text.Length > max ? text[..max] : text;
    }
}
