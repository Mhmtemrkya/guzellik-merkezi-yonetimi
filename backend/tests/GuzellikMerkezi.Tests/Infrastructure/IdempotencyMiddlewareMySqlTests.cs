using System.Text;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// IDEMPOTENCY KAPISI — GERÇEK MIDDLEWARE + GERÇEK VERİTABANI + KOPAN YANIT AKIŞI.
///
/// <para>
/// Deploy blocker'ı (3 Ağu 2026, 3. tur): kalıcı kayıt yanıt istemciye YAZILDIKTAN SONRA
/// tamamlanıyordu. Yazma sırasında bağlantı koparsa istisna oluşuyor, <c>finally</c> tamamlanmamış
/// rezervasyonu siliyor ve aynı anahtarla gelen tekrar denemesi finansal mutasyonu İKİNCİ KEZ
/// uyguluyordu. Sahte (idempotent davranan) bir replayer bu hatayı GÖREMEZ; bu yüzden testler
/// gerçek <see cref="IdempotencyMiddleware"/>'i, gerçek MariaDB'yi ve yazarken istisna atan bir
/// yanıt akışını kullanır — mutasyonun kaç kez uygulandığı veritabanından sayılır.
/// </para>
/// </summary>
public sealed class IdempotencyMiddlewareMySqlTests
{
    // ---------------------------------------------------------------- yardımcılar

    /// <summary>Yazma denemesinde PATLAYAN yanıt akışı: "commit oldu, yanıt yolda kayboldu".</summary>
    private sealed class BrokenResponseStream : Stream
    {
        private static IOException Broken() => new("Bağlantı koptu (test).");

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => 0; set { } }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw Broken();
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) => throw Broken();
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default) => throw Broken();
    }

    private sealed record Seed(Guid TenantId, Guid BranchId, Guid UserId);

    private static async Task<Seed> SeedAsync(MySqlTestDatabase database)
    {
        await using var db = database.NewContext();
        var tenant = new Tenant("Idempotency QA", $"idem-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var owner = tenant.GrantAccess($"o-{Guid.NewGuid():N}"[..14] + "@qa.test", UserRole.InstitutionOwner, null, "Yönetici");
        db.TenantUsers.Add(owner);
        await db.SaveChangesAsync();

        return new Seed(tenant.Id, branch.Id, owner.Id);
    }

    private static DefaultHttpContext NewRequest(string key, Stream responseBody)
    {
        var http = new DefaultHttpContext();
        http.Request.Method = "POST";
        http.Request.Path = "/api/admin/customers";
        http.Request.Headers["Idempotency-Key"] = key;
        http.Response.Body = responseBody;
        return http;
    }

    private static TestCurrentUser Actor(Seed seed) =>
        new(UserRole.InstitutionOwner, seed.TenantId, seed.BranchId) { UserId = seed.UserId };

    /// <summary>Gerçek bir mutasyon (müşteri satırı) yazıp 200 dönen sahte endpoint.</summary>
    private static RequestDelegate MutatingEndpoint(MySqlTestDatabase database, Seed seed, Counter applied, Exception? throwAfterCommit = null) =>
        async ctx =>
        {
            var index = applied.Increment();
            await using (var opDb = database.NewContext())
            {
                opDb.Customers.Add(new Customer(seed.TenantId, seed.BranchId, $"IDEMPOTENCY MÜŞTERİ {index}", $"0555 111 22 {index:00}", null));
                await opDb.SaveChangesAsync();
            }

            if (throwAfterCommit is not null) throw throwAfterCommit;

            ctx.Response.StatusCode = StatusCodes.Status200OK;
            ctx.Response.ContentType = "application/json; charset=utf-8";
            await ctx.Response.WriteAsync($"{{\"success\":true,\"data\":{{\"index\":{index}}}}}");
        };

    private sealed class Counter
    {
        private int _value;
        public int Value => Volatile.Read(ref _value);
        public int Increment() => Interlocked.Increment(ref _value);
    }

    private static async Task<int> CustomerCountAsync(MySqlTestDatabase database, Guid tenantId)
    {
        await using var db = database.NewContext();
        return await db.Customers.CountAsync(c => c.TenantId == tenantId);
    }

    private static async Task<ProcessedClientRequest?> RecordAsync(MySqlTestDatabase database, string key)
    {
        await using var db = database.NewContext();
        return await db.ProcessedClientRequests.AsNoTracking().FirstOrDefaultAsync(x => x.IdempotencyKey == key);
    }

    // ---------------------------------------------------------------- 1) yanıt kaybı

    /// <summary>
    /// ASIL İDDİA: endpoint commit ettikten sonra YANIT YAZILAMAZSA bile kalıcı kayıt durur ve
    /// aynı anahtarla gelen tekrar denemesi endpoint'i YENİDEN ÇALIŞTIRMAZ — mutasyon tam 1 kez.
    /// </summary>
    [MySqlFact]
    public async Task LostResponseAfterCommit_Retry_DoesNotReapplyMutation()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var key = $"outbox-{Guid.NewGuid():N}";
        var applied = new Counter();
        var middleware = new IdempotencyMiddleware(MutatingEndpoint(database, seed, applied));

        // 1) İstek işlenir, mutasyon commit olur, YANIT YAZILIRKEN bağlantı kopar.
        await using (var db = database.NewContext())
        {
            var http = NewRequest(key, new BrokenResponseStream());
            await Assert.ThrowsAsync<IOException>(() => middleware.InvokeAsync(http, Actor(seed), db));
        }

        Assert.Equal(1, applied.Value);
        Assert.Equal(1, await CustomerCountAsync(database, seed.TenantId));

        // Kalıcı kayıt SİLİNMEMİŞ, gerçek yanıtla TAMAMLANMIŞ olmalı.
        var record = await RecordAsync(database, key);
        Assert.NotNull(record);
        Assert.False(record!.IsPending);
        Assert.Equal(StatusCodes.Status200OK, record.StatusCode);
        Assert.Contains("\"index\":1", record.ResponseBody);

        // 2) İstemci (outbox) aynı anahtarla tekrar dener → saklanan yanıt oynatılır, iş tekrarlanmaz.
        await using (var db = database.NewContext())
        {
            var replayBody = new MemoryStream();
            var http = NewRequest(key, replayBody);
            await middleware.InvokeAsync(http, Actor(seed), db);

            Assert.Equal(StatusCodes.Status200OK, http.Response.StatusCode);
            Assert.Equal("true", http.Response.Headers["Idempotency-Replayed"].ToString());
            Assert.Contains("\"index\":1", Encoding.UTF8.GetString(replayBody.ToArray()));
        }

        Assert.Equal(1, applied.Value);
        Assert.Equal(1, await CustomerCountAsync(database, seed.TenantId));
    }

    // ---------------------------------------------------------------- 2) sonucu bilinmeyen hata

    /// <summary>
    /// COMMIT SONRASI İSTİSNA (5xx): rezervasyon SİLİNMEZ. Tekrar denemesi işi yeniden uygulamak
    /// yerine 409 "sonuç doğrulanamadı" alır — çift tahsilat/çift satış riski kapanır.
    /// </summary>
    [MySqlFact]
    public async Task ServerErrorAfterCommit_KeepsReservation_AndRetryIsRefused()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var key = $"outbox-{Guid.NewGuid():N}";
        var applied = new Counter();
        var middleware = new IdempotencyMiddleware(
            MutatingEndpoint(database, seed, applied, new InvalidOperationException("commit sonrası patladı")));

        await using (var db = database.NewContext())
        {
            var http = NewRequest(key, new MemoryStream());
            await Assert.ThrowsAsync<InvalidOperationException>(() => middleware.InvokeAsync(http, Actor(seed), db));
        }

        Assert.Equal(1, applied.Value);
        var record = await RecordAsync(database, key);
        Assert.NotNull(record);
        Assert.True(record!.IsPending);                 // silinmedi
        Assert.NotNull(record.UpdatedAtUtc);            // "sonuç bilinmiyor" damgası

        await using (var db = database.NewContext())
        {
            var body = new MemoryStream();
            var http = NewRequest(key, body);
            await middleware.InvokeAsync(http, Actor(seed), db);

            Assert.Equal(StatusCodes.Status409Conflict, http.Response.StatusCode);
            Assert.Equal("outcome-unknown", http.Response.Headers[IdempotencyMiddleware.StatusHeader].ToString());
            Assert.Contains("IdempotencyOutcomeUnknown", Encoding.UTF8.GetString(body.ToArray()));
        }

        // İŞ TEKRARLANMADI.
        Assert.Equal(1, applied.Value);
        Assert.Equal(1, await CustomerCountAsync(database, seed.TenantId));
    }

    // ---------------------------------------------------------------- 3) hâlâ işleniyor

    /// <summary>
    /// Tamamlanmamış rezervasyon YANIT SANILIP oynatılmamalı (durum kodu 0 geçersiz yanıt üretirdi)
    /// ve endpoint ikinci kez çalıştırılmamalı.
    /// </summary>
    [MySqlFact]
    public async Task InFlightReservation_IsRefused_WithoutRunningEndpoint()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var key = $"outbox-{Guid.NewGuid():N}";
        var applied = new Counter();
        var middleware = new IdempotencyMiddleware(MutatingEndpoint(database, seed, applied));

        // Süren bir istek: anahtar rezerve edilmiş, yanıt henüz yok.
        await using (var db = database.NewContext())
        {
            db.ProcessedClientRequests.Add(new ProcessedClientRequest(
                seed.TenantId, seed.UserId, key, "POST", "/api/admin/customers", 0, null, null));
            await db.SaveChangesAsync();
        }

        await using (var db = database.NewContext())
        {
            var body = new MemoryStream();
            var http = NewRequest(key, body);
            await middleware.InvokeAsync(http, Actor(seed), db);

            Assert.Equal(StatusCodes.Status409Conflict, http.Response.StatusCode);
            Assert.Equal("in-flight", http.Response.Headers[IdempotencyMiddleware.StatusHeader].ToString());
        }

        Assert.Equal(0, applied.Value);
        Assert.Equal(0, await CustomerCountAsync(database, seed.TenantId));
    }

    // ---------------------------------------------------------------- 4) kesin ret

    /// <summary>
    /// İŞ KURALI REDDİ (DomainException → 400) hiçbir şey uygulamaz: anahtar serbest bırakılmalı,
    /// aksi hâlde dürüst bir tekrar denemesi kalıcı olarak 409'a düşerdi.
    /// </summary>
    [MySqlFact]
    public async Task DefiniteRejection_ReleasesKey_SoHonestRetryCanRun()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        var seed = await SeedAsync(database);
        var key = $"outbox-{Guid.NewGuid():N}";
        var applied = new Counter();

        var rejecting = new IdempotencyMiddleware(_ => throw new BusinessRuleException("kural reddi"));
        await using (var db = database.NewContext())
        {
            var http = NewRequest(key, new MemoryStream());
            await Assert.ThrowsAsync<BusinessRuleException>(() => rejecting.InvokeAsync(http, Actor(seed), db));
        }

        Assert.Null(await RecordAsync(database, key));

        // Aynı anahtarla dürüst tekrar: bu kez gerçekten çalışmalı.
        var working = new IdempotencyMiddleware(MutatingEndpoint(database, seed, applied));
        await using (var db = database.NewContext())
        {
            var http = NewRequest(key, new MemoryStream());
            await working.InvokeAsync(http, Actor(seed), db);
            Assert.Equal(StatusCodes.Status200OK, http.Response.StatusCode);
        }

        Assert.Equal(1, applied.Value);
        Assert.Equal(1, await CustomerCountAsync(database, seed.TenantId));
    }
}
