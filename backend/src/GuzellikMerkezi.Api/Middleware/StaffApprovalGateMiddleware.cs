using System.Text;
using System.Text.Json;
using GuzellikMerkezi.Api.Approval;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Middleware;

/// <summary>
/// Evrensel personel onay kapısı. Staff rolünün TÜM yazma isteklerini (POST/PUT/PATCH/DELETE, /api/admin/*)
/// yakalar; çalıştırmak yerine PendingOperation (taslak) olarak kuyruğa alır ve "onaya gönderildi" yanıtı döner.
/// Kurum yöneticisi onaylayınca <see cref="IApprovalReplayer"/> isteği aynen uygular; reddedilirse hiç işlenmez.
/// İstisnalar: pending-operations (özyineleme) ve adisyonlar (kendi onay akışı var).
/// </summary>
public sealed class StaffApprovalGateMiddleware
{
    private readonly RequestDelegate _next;

    // Kendi onay/akışı olan ya da özyinelemeye yol açacak yollar — kapı bunları yakalamaz.
    // NOT: adisyon muafiyeti ONAY ucunu KAPSAMAZ (bkz. IsAdisyonApprovePath).
    private static readonly string[] ExemptPrefixes =
    {
        "/api/admin/pending-operations",
        "/api/admin/adisyonlar",
    };

    public StaffApprovalGateMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext http, ICurrentUser currentUser, ITenantContext tenantContext, IPendingOperationService pendingOps)
    {
        // İŞLEM (AKSİYON) İZNİ — REPLAY DE DAHİL.
        //
        // SOMUT AÇIK: kontrol ShouldGate'ten SONRA yapılıyordu ve ShouldGate, replay claim'i görünce
        // false dönüyordu. Sonuç yetki AKLAMASIydı: personel yetkisi varken istek gönderir, yönetici
        // yetkiyi geri alır, sonra bekleyen isteği onaylar → replay kapıya hiç uğramadan çalışır ve
        // ARTIK OLMAYAN yetkiyle iş uygulanırdı (ör. geri alınmış "tahsilat alma" izniyle para
        // işlenmesi). Onay "bu işi yap" demektir, "yetki denetimini atla" demek değildir.
        //
        // Kontrol artık kapının EN BAŞINDA, replay'den bağımsız yapılır. Replay token'ı istek
        // sahibinin GÜNCEL izinleriyle üretildiği için (bkz. IApprovalRequesterScope) geri alınmış
        // izin burada gerçekten yakalanır.
        var requiredAction = RequiredAction(http.Request.Method, http.Request.Path.Value ?? string.Empty);
        if (requiredAction is not null
            && currentUser.IsAuthenticated
            && currentUser.Role == UserRole.Staff
            && !Permissions.IsActionAllowed(currentUser.Permissions, requiredAction))
        {
            await WriteForbiddenAsync(http, "Bu işlem için yetkiniz yok. Kurum yöneticinizden yetki isteyin.");
            return;
        }

        if (!ShouldGate(http, currentUser))
        {
            await _next(http);
            return;
        }

        var tenantId = currentUser.TenantId ?? Guid.Empty;
        if (tenantId == Guid.Empty)
        {
            await _next(http); // tenant yoksa normal akışta uygun hata döner
            return;
        }

        // İstek gövdesini oku (kısa devre yapacağımız için stream'i geri sarmaya gerek yok).
        http.Request.EnableBuffering();
        string body = string.Empty;
        if (http.Request.ContentLength is > 0)
        {
            using var reader = new StreamReader(http.Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
            body = await reader.ReadToEndAsync(http.RequestAborted);
            http.Request.Body.Position = 0;
        }

        // GÖVDEYE BAĞLI İZİN: yol tek ama iş iki farklı yetki sınıfına giriyor olabilir.
        // /appointments/with-sale gövdesinde "sale" varsa istek adisyon açıp kalem ekler →
        // randevu yetkisi yetmez, Accounting.Adisyon da gerekir. Kontrol taslağa ALMADAN ÖNCE
        // yapılır: yetkisiz personelin isteği onay kuyruğuna bile girmemeli.
        if (RequiresSalePermission(http.Request.Path.Value ?? string.Empty, body)
            && !Permissions.IsActionAllowed(currentUser.Permissions, Permissions.AccountingAdisyon))
        {
            await WriteForbiddenAsync(http,
                "Randevuyla birlikte satış yapma (adisyon açma) yetkiniz yok. Randevuyu satışsız oluşturabilir ya da kurum yöneticinizden yetki isteyebilirsiniz.");
            return;
        }

        var payload = JsonSerializer.Serialize(new ReplayPayload(
            http.Request.Method,
            http.Request.Path.Value ?? string.Empty,
            http.Request.QueryString.Value ?? string.Empty,
            http.Request.ContentType,
            body,
            tenantContext.BranchId?.ToString()));

        var (title, summary) = Describe(http.Request.Method, http.Request.Path.Value ?? string.Empty);
        var requestedByName = currentUser.Email ?? "Personel";

        var createReq = new CreatePendingOperationRequest(PendingOperationType.HttpReplay, title, summary, payload);
        var result = await pendingOps.CreateAsync(tenantId, tenantContext.BranchId, currentUser.UserId ?? Guid.Empty, requestedByName, createReq, http.RequestAborted);

        // Onaya alma BAŞARISIZ olduysa "gönderildi" DEME — gerçek hatayı dön; aksi halde işlem sessizce kaybolur
        // (kullanıcı onaya gittiğini sanır ama kayıt oluşmamıştır).
        if (!result.IsSuccess)
        {
            http.Response.StatusCode = StatusCodes.Status400BadRequest;
            var errorEnvelope = ApiResponse<object>.Fail(
                result.Error.Code,
                $"İşlem onaya alınamadı: {result.Error.Message}",
                http.TraceIdentifier);
            await http.Response.WriteAsJsonAsync(errorEnvelope, http.RequestAborted);
            return;
        }

        http.Response.StatusCode = StatusCodes.Status200OK;
        var envelope = ApiResponse<object>.Ok(new
        {
            pendingApproval = true,
            message = "İşlem onaya gönderildi. Kurum yöneticisi onayladığında geçerli olacak.",
            pendingOperationId = result.Value?.Id,
            title,
        }, http.TraceIdentifier);
        await http.Response.WriteAsJsonAsync(envelope, http.RequestAborted);
    }

    private static bool IsStaffWrite(HttpContext http, ICurrentUser currentUser)
    {
        if (!currentUser.IsAuthenticated || currentUser.Role != UserRole.Staff) return false;
        // ONAYLANMIŞ REPLAY YENİDEN TASLAĞA ALINMAZ. Replay artık isteği AÇAN personelin kapsamıyla
        // (yani Staff rolüyle) çalışıyor; bu işaret olmasaydı kapı onaylanan isteği tekrar kuyruğa
        // koyar ve işlem hiçbir zaman uygulanmazdı. Claim'i yalnız sunucunun kendi imzaladığı,
        // kısa ömürlü kapsam token'ı taşır (bkz. IApprovalRequesterScope).
        if (http.User?.HasClaim(c => c.Type == IApprovalReplayer.ReplayClaimType) == true) return false;
        var method = http.Request.Method;
        return HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);
    }

    /// <summary>
    /// Randevu durum değişikliği yolları. <c>/complete</c> de buraya dâhildir: tamamlama +
    /// tahsilatın atomik hâlidir, ayrı ayrı çağrıldığında (<c>/status</c> + tahsilat ucu) zaten
    /// muaf olan iki işlemin birleşimidir — atomikliği seçmek personeli onaya düşürmemeli.
    /// </summary>
    private static bool IsAppointmentStatusPath(string path) =>
        path.StartsWith("/api/admin/appointments/", StringComparison.OrdinalIgnoreCase)
        && (path.EndsWith("/status", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/complete", StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// İstek gövdesi KATALOG SATIŞI içeriyor mu? (<c>POST /api/admin/appointments/with-sale</c>)
    /// <para>
    /// Atomik uç randevu + satışı tek işlemde yapar; satış kısmı adisyon açıp kalem eklediği için
    /// eski akıştaki <c>Accounting.Adisyon</c> izni burada da zorunludur. Gövde çözümlenemezse
    /// GÜVENLİ TARAF seçilir (izin şart koşulur) — bozuk JSON yetki atlamaya dönüşmemeli.
    /// </para>
    /// </summary>
    private static bool RequiresSalePermission(string path, string body)
    {
        if (!path.EndsWith("/with-sale", StringComparison.OrdinalIgnoreCase)) return false;
        if (string.IsNullOrWhiteSpace(body)) return false;

        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return true;
            foreach (var property in doc.RootElement.EnumerateObject())
            {
                // Gövde camelCase ("sale") gelir; büyük harfli gönderimler de kapsansın.
                if (!string.Equals(property.Name, "sale", StringComparison.OrdinalIgnoreCase)) continue;
                return property.Value.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined);
            }
            return false;
        }
        catch (JsonException)
        {
            return true;
        }
    }

    /// <summary>Adisyon onay ucu — muaf listedeki tek istisna, yönetici onayına gider.</summary>
    private static bool IsAdisyonApprovePath(string path) =>
        path.StartsWith("/api/admin/adisyonlar/", StringComparison.OrdinalIgnoreCase)
        && path.EndsWith("/approve", StringComparison.OrdinalIgnoreCase);

    private static async Task WriteForbiddenAsync(HttpContext http, string message)
    {
        http.Response.StatusCode = StatusCodes.Status403Forbidden;
        await http.Response.WriteAsJsonAsync(
            ApiResponse<object>.Fail("Forbidden", message, http.TraceIdentifier), http.RequestAborted);
    }

    /// <summary>
    /// Yol + method'tan gerekli İŞLEM izni anahtarı (Permissions.*). null → aksiyon izni tanımlı değil,
    /// yalnız onay kapısı işler. Adisyon uçları muaf listede olduğundan burada görünmez;
    /// onların izni AdisyonEndpoints'te endpoint filtresiyle uygulanır.
    /// </summary>
    private static string? RequiredAction(string method, string path)
    {
        bool Is(string prefix) => path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        bool Has(string part) => path.Contains(part, StringComparison.OrdinalIgnoreCase);

        if (Is("/api/admin/customers"))
        {
            if (Has("/blacklist") || Has("/vip")) return Permissions.CustomersTags;
            if (HttpMethods.IsDelete(method) && !Has("/treatment-photos")) return Permissions.CustomersDelete;
            return Permissions.CustomersManage; // müşteri kartı + konsültasyon + tedavi günlüğü
        }
        if (Is("/api/admin/appointments"))
        {
            // OKUMA İŞLEM İZNİNE TABİ DEĞİLDİR. Bu eşleme YAZMA işlemlerinin yetki sınıfını verir;
            // randevu SAYFASINI görme hakkı zaten uç grubundaki RequirePermission(Appointments)
            // ile ayrıca kapıdan geçiyor. Ayrım yapılmadığı için, kendisine yalnız "durum
            // güncelleme" yetkisi verilmiş personel randevu LİSTESİNİ bile açamıyordu (GET de
            // Appointments.Create istiyordu) — verilen yetki fiilen kullanılamaz hâldeydi.
            if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method)) return null;

            // RANDEVU YOLU TEK, YETKİ SINIFI ÜÇ.
            //
            // SOMUT AÇIK: bütün randevu yazmaları için Appointments.Create isteniyordu. Yalnızca
            // "durum güncelleme" (Tamamlandı/İptal/Gelmedi) yetkisi verilmiş personel, kendisine
            // AÇIKÇA verilmiş bu işlemi yapamıyor, 403 alıyordu; aynı şekilde yalnız "yanlış
            // tamamlamayı geri alma" yetkisi olan personel de kapıya takılıyordu. Yol artık işin
            // gerçek yetki sınıfına eşlenir — kapının önündeki özel durum kontrolüne gerek kalmaz
            // (ve replay yolunda da aynı kural işler).
            if (IsAppointmentStatusPath(path)) return Permissions.AppointmentsStatus;
            if (Has("/void-completion")) return Permissions.AppointmentsVoidCompletion;
            return Permissions.AppointmentsCreate;
        }
        // Bekleme kaydını randevuya çevirmek gerçek randevu açar → ayrı (daha dar) yetki.
        if (Is("/api/admin/waitlist"))
            return Has("/schedule") || Has("/book") ? Permissions.WaitlistConvert : Permissions.WaitlistManage;
        if (Is("/api/admin/services") || Is("/api/admin/packages") || Is("/api/admin/service-categories")
            || Is("/api/admin/campaigns") || Is("/api/admin/loyalty"))
            return HttpMethods.IsDelete(method) ? Permissions.ServicesDelete : Permissions.ServicesManage;
        if (Is("/api/admin/gift-cards")) return Permissions.GiftCardsManage;
        if (Is("/api/admin/products")) return HttpMethods.IsDelete(method) ? Permissions.StockDelete : Permissions.StockManage;
        if (Is("/api/admin/stock-movements")) return Permissions.StockMovements;
        if (Is("/api/admin/cash/closing")) return Permissions.CashClosingClose;
        if (Is("/api/admin/cash-flow")) return Permissions.CashRegisterEntry;
        if (Is("/api/admin/accounts")) return Has("/payments") ? Permissions.AccountingCollect : Permissions.AccountingAccounts;
        if (Is("/api/admin/expenses") || Is("/api/admin/expense-categories")) return Permissions.AccountingExpenses;
        if (Is("/api/admin/notification-templates")) return Permissions.NotificationsTemplates;
        if (Is("/api/admin/notifications") || Is("/api/admin/whatsapp")) return Permissions.NotificationsSend;
        return null;
    }

    private static bool ShouldGate(HttpContext http, ICurrentUser currentUser)
    {
        if (!IsStaffWrite(http, currentUser)) return false;

        var path = http.Request.Path.Value ?? string.Empty;
        if (!path.StartsWith("/api/admin/", StringComparison.OrdinalIgnoreCase)) return false;

        // ADİSYON ONAYI KAPIDAN GEÇER. Adisyonun geri kalanı (açma, kalem, tahsilat) muaftır:
        // personel fişi serbestçe hazırlar. Ama ONAY parayı cariye ve kasaya işler — bu, yöneticinin
        // kararıdır. Uç zaten Staff'a 403 dönüyordu; kapı devreye girmeyince satış "onaya gitti"
        // sanılıp Onaylar sayfasında hiç görünmüyordu. Artık HttpReplay olarak kuyruğa alınır ve
        // yönetici onaylayınca onun token'ıyla replay edilip gerçekten onaylanır.
        if (IsAdisyonApprovePath(path)) return true;

        foreach (var prefix in ExemptPrefixes)
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;

        // Randevu durum değişikliği (Tamamlandı/İptal/Gelmedi/Onaylandı) onay kapısından muaf —
        // personel direkt uygular; rutin operasyon, onay yığılması/tamamlanamaz hatası oluşmasın.
        // (İşlem izni kontrolü InvokeAsync başında ayrıca yapılır.)
        if (IsAppointmentStatusPath(path)) return false;

        return true;
    }

    /// <summary>Yol + method'tan kullanıcı dostu başlık üretir (onaylar sayfasında okunur olsun).</summary>
    private static (string Title, string Summary) Describe(string method, string path)
    {
        // Nested kaynaklar segments[2]'yi gölgeler (ör. customers/{id}/treatment-photos) — özel olarak etiketle.
        if (path.Contains("/treatment-photos", StringComparison.OrdinalIgnoreCase))
        {
            var photoAction = method.ToUpperInvariant() == "DELETE" ? "silme" : "ekleme";
            return ($"İşlem fotoğrafı {photoAction}", $"{method} {path}");
        }
        if (IsAdisyonApprovePath(path))
            return ("Adisyon onayı — satışı cariye ve kasaya işler", $"{method} {path}");
        if (path.Contains("/consultation", StringComparison.OrdinalIgnoreCase))
            return ("Müşteri bilgi ve onay formu güncelleme", $"{method} {path}");
        if (path.Contains("/whatsapp/reminder", StringComparison.OrdinalIgnoreCase))
            return ("WhatsApp hatırlatma gönderme", $"{method} {path}");
        if (path.Contains("/whatsapp/settings", StringComparison.OrdinalIgnoreCase))
            return ("WhatsApp ayarı güncelleme", $"{method} {path}");
        if (path.Contains("/blacklist", StringComparison.OrdinalIgnoreCase))
            return ("Kara liste güncelleme", $"{method} {path}");
        if (path.Contains("/passive-threshold", StringComparison.OrdinalIgnoreCase))
            return ("Pasif müşteri eşiği güncelleme", $"{method} {path}");

        // /api/admin/<area>/... → alan etiketi
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var area = segments.Length >= 3 ? segments[2] : "kayıt";
        var label = area switch
        {
            "customers" => "Müşteri",
            "appointments" => "Randevu",
            "services" => "Hizmet",
            "packages" => "Paket",
            "products" => "Ürün",
            "stock-movements" => "Stok hareketi",
            "accounts" => "Cari hesap",
            "expenses" => "Gider",
            "expense-categories" => "Gider kategorisi",
            "service-categories" => "Hizmet kategorisi",
            "notification-templates" => "Bildirim şablonu",
            "campaigns" => "Kampanya",
            "loyalty" => "Sadakat puanı",
            "branches" => "Şube",
            "staff" => "Personel",
            "schedule" => "Çizelge/İzin",
            _ => "Kayıt",
        };
        var action = method.ToUpperInvariant() switch
        {
            "POST" => "oluşturma",
            "PUT" => "güncelleme",
            "PATCH" => "güncelleme",
            "DELETE" => "silme",
            _ => "işlemi",
        };
        return ($"{label} {action}", $"{method} {path}");
    }
}
