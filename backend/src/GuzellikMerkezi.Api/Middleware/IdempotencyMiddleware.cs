using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Middleware;

/// <summary>
/// Idempotent yazma desteği: <c>Idempotency-Key</c> header'ı taşıyan /api/admin yazma istekleri
/// bir kez işlenir; aynı anahtar (aynı kullanıcı) tekrar geldiğinde endpoint YENİDEN çalıştırılmaz,
/// ilk yanıt aynen döndürülür. Masaüstü çevrimdışı kuyruğu (outbox) bağlantı kesintisinde yarıda
/// kalan tekrar oynatmaların çift kayıt üretmemesi için bunu kullanır. Header'sız istekler etkilenmez.
/// ActivityAudit + onay kapısından ÖNCE (dışta) durur: tekrar oynatma kısa devre olduğunda
/// audit/taslak da mükerrer üretilmez; taze istekler normal akıştan geçer ve nihai yanıt saklanır.
///
/// <para>
/// SIRA KRİTİK: kalıcı kayıt yanıt istemciye YAZILMADAN ÖNCE tamamlanır. Eskiden tersiydi —
/// buffer'lanmış yanıt önce sokete kopyalanıyor, kayıt sonra yazılıyordu. Kopyalama sırasında
/// bağlantı koparsa istisna oluşuyor, <c>finally</c> tamamlanmamış rezervasyonu SİLİYOR ve aynı
/// anahtarla gelen tekrar denemesi mutasyonu (satış/tahsilat/silme) İKİNCİ KEZ uyguluyordu.
/// Artık yanıtın yazılamaması kalıcı kaydı etkilemez: tekrar denemesi saklanan yanıtı görür.
/// </para>
/// </summary>
public sealed class IdempotencyMiddleware
{
    private readonly RequestDelegate _next;

    private static readonly string[] WriteMethods = { "POST", "PUT", "PATCH", "DELETE" };

    /// <summary>
    /// Sonucu KESİNLEŞMEMİŞ isteklerin yanıt başlığı ("in-flight" / "outcome-unknown").
    /// Onay replay'i (<c>HttpApprovalReplayer</c>) bu başlığı gören 409'u "kesin başarısız" değil
    /// "sonuç bilinmiyor" sayar; aksi hâlde işlemi tekrar uygulamayı deneyebilirdi.
    /// </summary>
    public const string StatusHeader = "Idempotency-Status";

    private const string InFlightBody =
        "{\"success\":false,\"error\":{\"code\":\"IdempotencyInFlight\",\"message\":\"Aynı istek şu anda işleniyor. Lütfen birkaç saniye sonra tekrar deneyin.\"}}";

    private const string OutcomeUnknownBody =
        "{\"success\":false,\"error\":{\"code\":\"IdempotencyOutcomeUnknown\",\"message\":\"Bu isteğin sonucu doğrulanamadı (sunucu hatası ya da bağlantı kesintisi). İşlem uygulanmış olabilir; kaydı kontrol edin, gerekiyorsa yeni bir istek gönderin.\"}}";

    private const string KeyReuseBody =
        "{\"success\":false,\"error\":{\"code\":\"IdempotencyKeyReuse\",\"message\":\"Bu Idempotency-Key başka bir istek için kullanılmış. Aynı anahtarı farklı bir uç ya da farklı içerikle gönderemezsiniz; yeni istek için yeni bir anahtar üretin.\"}}";

    /// <summary>
    /// Gövde tamponlama eşiği: bu boyutu aşan istekler diske taşar (bellekte şişmez).
    /// Fotoğraf/data-URL taşıyan uçlar için gereklidir.
    /// </summary>
    private const int BodyBufferThreshold = 64 * 1024;

    public IdempotencyMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext http, ICurrentUser currentUser, GuzellikDbContext db)
    {
        var key = http.Request.Headers["Idempotency-Key"].ToString().Trim();
        var path = http.Request.Path.Value ?? string.Empty;
        if (key.Length is 0 or > 64
            || !WriteMethods.Contains(http.Request.Method)
            || !path.StartsWith("/api/admin", StringComparison.OrdinalIgnoreCase)
            || currentUser.UserId is not Guid userId)
        {
            await _next(http);
            return;
        }

        var tenantId = currentUser.TenantId ?? Guid.Empty;

        // SİSTEM ANAHTARLARI KULLANICIYA DEĞİL İŞLEME BAĞLIDIR.
        // Onay replay'i "sys:" ön ekli, bekleyen işlem Id'sinden türetilmiş kararlı bir anahtar
        // gönderir. Normal anahtarlar (TenantId, UserId, Key) ile kapsanır; ama onayı A yönetici
        // başlatıp yanıt kaybolduktan sonra B yönetici tekrar denerse kullanıcı farklı olduğu için
        // koruma ıskalanır ve iş İKİNCİ KEZ uygulanırdı. Bu anahtarlarda kapsam kurum düzeyidir.
        var scopeUserId = key.StartsWith("sys:", StringComparison.Ordinal) ? Guid.Empty : userId;

        // İSTEĞİN PARMAK İZİ (metot + yol + sorgu + gövde). Anahtar istemcinin ürettiği serbest bir
        // dizedir; tek başına "aynı istek" anlamına gelmez. Aşağıda saklanan kayıtla karşılaştırılır.
        var fingerprint = await ComputeFingerprintAsync(http);

        var existing = await db.ProcessedClientRequests.AsNoTracking()
            .FirstOrDefaultAsync(
                x => x.TenantId == tenantId && x.UserId == scopeUserId && x.IdempotencyKey == key,
                http.RequestAborted);
        if (existing is not null)
        {
            // ANAHTAR YENİDEN KULLANIMI AÇIKÇA REDDEDİLİR.
            //
            // Eskiden yalnız anahtara bakılıyordu: aynı anahtar BAŞKA bir uca ya da başka bir
            // gövdeyle geldiğinde eski ve alakasız yanıt geri oynatılıyor, YENİ mutasyon sessizce
            // atlanıyordu. Kullanıcı "kaydedildi" görüyor, hiçbir şey yazılmıyordu. Parmak izi
            // eşleşmiyorsa istek 409 ile durur — sessiz atlama yerine görünür hata.
            // Eski kayıtlarda alan boştur (geçiş); orada eski davranış korunur.
            if (existing.RequestFingerprint is { Length: > 0 } stored
                && !string.Equals(stored, fingerprint, StringComparison.Ordinal))
            {
                await WriteKeyReuseAsync(http);
                return;
            }

            // Tamamlanmış kayıt → ilk yanıt aynen döner.
            // Tamamlanmamış kayıt (StatusCode = 0) İSE ASLA "yanıt" olarak oynatılmaz: eskiden bu
            // ayrım yoktu ve durum kodu 0 olan bir rezervasyon yanıt sanılıp geçersiz yanıt üretiyordu.
            if (!existing.IsPending) await ReplayAsync(http, existing);
            else await WriteUnresolvedAsync(http, existing);
            return;
        }

        // ANAHTARI ÖNCE REZERVE ET. Kayıt eskiden yalnız iş BİTTİKTEN sonra ekleniyordu: aynı
        // anahtarla eşzamanlı gelen iki istek (çift tıklama, outbox'ın paralel oynatması, retry
        // ile orijinalin yarışması) yukarıdaki ön kontrolden BİRLİKTE geçip işi iki kez yapıyordu
        // — iki ayrı tahsilat/mutasyon. Unique indeks (TenantId, UserId, IdempotencyKey) ikinci
        // insert'i eler; böylece işi yalnızca bir istek yapar.
        var reservation = new ProcessedClientRequest(
            tenantId, scopeUserId, key, http.Request.Method, path, 0, null, null, fingerprint);
        db.ProcessedClientRequests.Add(reservation);
        try
        {
            await db.SaveChangesAsync(http.RequestAborted);
        }
        catch (DbUpdateException)
        {
            db.Entry(reservation).State = EntityState.Detached;

            // Yarışı kaybettik. İlk istek bittiyse onun yanıtını aynen döndür; hâlâ işliyorsa
            // istemciye "tekrar dene" de — işi ikinci kez YAPMA.
            var winner = await db.ProcessedClientRequests.AsNoTracking()
                .FirstOrDefaultAsync(
                    x => x.TenantId == tenantId && x.UserId == scopeUserId && x.IdempotencyKey == key,
                    http.RequestAborted);
            // Yarışı kazanan BAŞKA bir istekse (aynı anahtar, farklı içerik) yanıtını oynatmak
            // yanlış olurdu — yukarıdaki kuralın aynısı burada da uygulanır.
            if (winner?.RequestFingerprint is { Length: > 0 } winnerPrint
                && !string.Equals(winnerPrint, fingerprint, StringComparison.Ordinal))
            {
                await WriteKeyReuseAsync(http);
                return;
            }
            if (winner is not null && !winner.IsPending) await ReplayAsync(http, winner);
            else await WriteUnresolvedAsync(http, winner);
            return;
        }

        // Yanıtı BELLEĞE yakala. İstemciye yazma, kalıcı kayıt tamamlanana kadar ERTELENİR.
        var originalBody = http.Response.Body;
        await using var buffer = new MemoryStream();
        http.Response.Body = buffer;

        var finalized = false;
        var definiteRejection = false;
        try
        {
            try
            {
                await _next(http);
            }
            catch (Exception ex) when (IsDefiniteRejection(ex))
            {
                // ValidationException / DomainException = iş kuralı reddi. Mutasyon transaction'ı
                // commit edilmeden çözülür (rollback) → hiçbir şey uygulanmamıştır. Bu tek durumda
                // rezervasyonu serbest bırakmak güvenlidir; anahtar dürüst bir tekrar denemesine açık kalır.
                definiteRejection = true;
                throw;
            }
            finally
            {
                // Yanıt gövdesini ERKEN geri ver: istisna dışarıdaki ExceptionHandlingMiddleware'e
                // ulaştığında hata yanıtını gerçek sokete yazabilmeli.
                http.Response.Body = originalBody;
            }

            buffer.Position = 0;
            string bodyText;
            // İstek iptal edilmiş olabilir (istemci gitti); bellekten okuma ve kayıt bundan
            // ETKİLENMEMELİ → CancellationToken.None.
            using (var reader = new StreamReader(buffer, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true))
            {
                bodyText = await reader.ReadToEndAsync(CancellationToken.None);
            }

            // 5xx saklanmaz: sonucu belirsizdir (commit edip sonra patlamış olabilir).
            // 2xx/4xx saklanır: iş kuralı reddi (409 vb.) da deterministik kalmalı.
            if (http.Response.StatusCode < 500)
            {
                finalized = await FinalizeAsync(db, reservation.Id,
                    http.Response.StatusCode, http.Response.ContentType, bodyText);
            }
        }
        finally
        {
            http.Response.Body = originalBody;
            // SONUÇ BİLİNMİYORSA REZERVASYONU SİLME. 5xx ya da beklenmeyen istisnada endpoint
            // commit etmiş olabilir; kaydı silmek aynı anahtarla gelen tekrarın mutasyonu İKİNCİ KEZ
            // uygulamasına izin verirdi. Kayıt "çözülmemiş" kalır ve tekrarlar 409 alır — işlemin
            // uygulanıp uygulanmadığını insan doğrular. Yalnız KESİN reddedilen istekte serbest bırakılır.
            if (!finalized)
            {
                if (definiteRejection) await ReleaseAsync(db, reservation.Id);
                else await MarkOutcomeUnknownAsync(db, reservation.Id);
            }
        }

        // BURADAN SONRASI: kalıcı kayıt COMMIT EDİLDİ. Yanıtın yazılamaması (bağlantı koptu)
        // artık kaydı etkilemez; tekrar denemesi saklanan yanıtı görür, iş yeniden yapılmaz.
        buffer.Position = 0;
        await buffer.CopyToAsync(originalBody, http.RequestAborted);
    }

    /// <summary>
    /// Hiçbir şey uygulanmadığı KESİN olan hata türleri. ExceptionHandlingMiddleware bunları 400'e
    /// çevirir; mutasyonlar transaction içinde çalıştığından commit edilmeden geri alınırlar.
    /// </summary>
    private static bool IsDefiniteRejection(Exception ex) =>
        ex is FluentValidation.ValidationException or DomainException;

    /// <summary>
    /// İsteğin KANONİK parmak izi: metot + yol + sorgu dizesi + gövde (SHA-256, hex).
    ///
    /// <para>
    /// Gövde tamponlanır ve konum başa alınır — sonraki middleware/endpoint aynı gövdeyi normal
    /// şekilde okur. Eşik üstü gövdeler diske taşar; fotoğraf/data-URL taşıyan uçlarda bellek şişmez.
    /// </para>
    /// </summary>
    private static async Task<string> ComputeFingerprintAsync(HttpContext http)
    {
        http.Request.EnableBuffering(BodyBufferThreshold);

        using var sha = System.Security.Cryptography.SHA256.Create();
        var header = Encoding.UTF8.GetBytes(
            $"{http.Request.Method}\n{http.Request.Path.Value}\n{http.Request.QueryString.Value}\n");
        sha.TransformBlock(header, 0, header.Length, null, 0);

        var buffer = new byte[8192];
        int read;
        while ((read = await http.Request.Body.ReadAsync(buffer, CancellationToken.None)) > 0)
            sha.TransformBlock(buffer, 0, read, null, 0);
        sha.TransformFinalBlock([], 0, 0);

        http.Request.Body.Position = 0;
        return Convert.ToHexString(sha.Hash!);
    }

    /// <summary>Aynı anahtarın FARKLI bir istek için kullanılması — sessiz atlama yerine 409.</summary>
    private static async Task WriteKeyReuseAsync(HttpContext http)
    {
        http.Response.StatusCode = StatusCodes.Status409Conflict;
        http.Response.ContentType = "application/json; charset=utf-8";
        http.Response.Headers[StatusHeader] = "key-reuse";
        await http.Response.WriteAsync(KeyReuseBody, http.RequestAborted);
    }

    private static async Task ReplayAsync(HttpContext http, ProcessedClientRequest record)
    {
        http.Response.StatusCode = record.StatusCode;
        http.Response.Headers["Idempotency-Replayed"] = "true";
        if (!string.IsNullOrEmpty(record.ContentType)) http.Response.ContentType = record.ContentType;
        if (!string.IsNullOrEmpty(record.ResponseBody))
            await http.Response.WriteAsync(record.ResponseBody, http.RequestAborted);
    }

    /// <summary>
    /// Sonucu kesinleşmemiş anahtar için 409. İki hâli ayırırız:
    /// <list type="bullet">
    /// <item>in-flight — rezervasyon taze, istek muhtemelen HÂLÂ işleniyor (çift tıklama).</item>
    /// <item>outcome-unknown — istek 5xx/istisna ile bitti, uygulanmış OLABİLİR.</item>
    /// </list>
    /// İkisinde de yanıt aynı sınıftadır: <b>işi tekrar yapma</b>.
    /// </summary>
    private static async Task WriteUnresolvedAsync(HttpContext http, ProcessedClientRequest? record)
    {
        // Rezervasyon oluşturulurken UpdatedAtUtc null'dır; "sonuç bilinmiyor" damgası onu doldurur.
        var outcomeUnknown = record is { UpdatedAtUtc: not null };
        http.Response.StatusCode = StatusCodes.Status409Conflict;
        http.Response.ContentType = "application/json; charset=utf-8";
        http.Response.Headers[StatusHeader] = outcomeUnknown ? "outcome-unknown" : "in-flight";
        await http.Response.WriteAsync(outcomeUnknown ? OutcomeUnknownBody : InFlightBody, http.RequestAborted);
    }

    /// <summary>
    /// Rezervasyonu gerçek yanıtla tamamlar; kaydın kalıcı olup olmadığını döner. Satır yeniden
    /// okunur: endpoint akışı bu istek sırasında <c>ChangeTracker</c>'ı temizlemiş olabilir ve
    /// izlenmeyen varlık üzerinden yapılan güncelleme sessizce kaydedilmezdi.
    /// </summary>
    private static async Task<bool> FinalizeAsync(GuzellikDbContext db, Guid reservationId, int statusCode, string? contentType, string? body)
    {
        try
        {
            var row = await db.ProcessedClientRequests.FirstOrDefaultAsync(x => x.Id == reservationId, CancellationToken.None);
            if (row is null) return false;
            row.Complete(statusCode, contentType, body);
            await db.SaveChangesAsync(CancellationToken.None);
            return true;
        }
        catch
        {
            // Kayıt tutulamadı → rezervasyon "çözülmemiş" kalır ve tekrarlar 409 alır.
            // Yanıt yine de istemciye gider: mutasyon gerçekleşti, sonucu göstermemek daha kötü olurdu.
            return false;
        }
    }

    /// <summary>
    /// Sonucu belirsiz kalan rezervasyonu DAMGALAR (silmez): <c>UpdatedAtUtc</c> dolar, <c>StatusCode</c>
    /// 0 kalır. Böylece aynı anahtarla gelen tekrar "işleniyor" değil "sonuç doğrulanamadı" yanıtı alır.
    /// Ham SQL kullanılır: değişiklik izleyicisine dokunmaz (izleyicide endpoint'in varlıkları duruyor
    /// olabilir ve <c>SaveChanges</c> onları da yazardı) ve takma ad üretmez (bkz. <see cref="ReleaseAsync"/>).
    /// </summary>
    private static async Task MarkOutcomeUnknownAsync(GuzellikDbContext db, Guid reservationId)
    {
        try
        {
            if (db.Database.IsRelational())
            {
                await db.Database.ExecuteSqlRawAsync(
                    "UPDATE processed_client_requests SET UpdatedAtUtc = {0} WHERE Id = {1} AND StatusCode = 0",
                    new object[] { DateTime.UtcNow, reservationId.ToString() }, CancellationToken.None);
                return;
            }

            // InMemory (birim testleri): ExecuteUpdate yok → izleyici üzerinden damgala.
            var row = await db.ProcessedClientRequests.FirstOrDefaultAsync(x => x.Id == reservationId, CancellationToken.None);
            if (row is null || !row.IsPending) return;
            row.Touch();
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch
        {
            // Damgalanamadıysa kayıt yine de duruyor; tekrar "işleniyor" (409) yanıtı alır — güvenli taraf.
        }
    }

    /// <summary>
    /// KESİN reddedilen isteğin rezervasyonunu GERÇEKTEN siler (hiçbir şey uygulanmadı).
    /// <para>
    /// Soft-delete yetmez: satır tabloda kalır ve unique indeks (TenantId, UserId, IdempotencyKey)
    /// aynı anahtarla yapılacak DÜRÜST bir tekrar denemesini kalıcı olarak 409'a düşürürdü.
    /// </para>
    /// <para>
    /// HAM SQL — <c>ExecuteDeleteAsync</c> DEĞİL: EF sağlayıcısı tek tablolu silmeyi
    /// <c>DELETE FROM tablo AS t WHERE …</c> olarak üretir; takma adı yalnız MySQL 8 kabul eder,
    /// CANLI MariaDB reddeder (lokalde sessizce çalışır, canlıda anahtar kilitli kalırdı).
    /// Kodda yerleşik desen: <c>BackgroundJobMaintenance.PurgeSucceededAsync</c>, <c>AuditLogService</c>.
    /// Ham SQL ayrıca değişiklik izleyicisine hiç dokunmaz — bu noktada izleyicide endpoint'in
    /// varlıkları duruyor olabilir ve global <c>HardDeleteEnabled</c> bayrağını açmak onları da
    /// gerçek silmeye çevirme riski taşırdı.
    /// </para>
    /// </summary>
    private static async Task ReleaseAsync(GuzellikDbContext db, Guid reservationId)
    {
        try
        {
            if (db.Database.IsRelational())
            {
                await db.Database.ExecuteSqlRawAsync(
                    "DELETE FROM processed_client_requests WHERE Id = {0} AND StatusCode = 0",
                    new object[] { reservationId.ToString() }, CancellationToken.None);
                return;
            }

            // InMemory (birim testleri): ExecuteDelete yok → izleyici üzerinden gerçek silme.
            var row = await db.ProcessedClientRequests.FirstOrDefaultAsync(x => x.Id == reservationId, CancellationToken.None);
            if (row is null || !row.IsPending) return;
            db.ProcessedClientRequests.Remove(row);
            db.HardDeleteEnabled = true;
            try { await db.SaveChangesAsync(CancellationToken.None); }
            finally { db.HardDeleteEnabled = false; }
        }
        catch
        {
            // En kötü durumda satır "çözülmemiş" kalır; bu yalnız o anahtarın tekrarını bloklar,
            // veri bütünlüğünü bozmaz.
        }
    }
}
