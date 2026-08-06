using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.Stock;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// DERİN DENETİM — FAZ 4 (eşzamanlılık / tam-bir-kez).
///
/// <list type="bullet">
/// <item><b>H8</b> — Kalıcı iş kuyruğunda sahiplenme atomik değildi: iki worker aynı Pending
/// satırı okuyup ikisi de handler'ı çalıştırabiliyordu (çift WhatsApp/push/KVKK).</item>
/// <item><b>H9</b> — SMS/e-posta sağlayıcıya log satırı YAZILMADAN gidiyordu: gönderimden sonra
/// süreç çökerse iz kalmıyor, sonraki tarama aynı mesajı tekrar gönderiyordu.</item>
/// <item><b>H10</b> — Manuel stok hareketinde bakiye "oku → hesapla → yaz" ile güncelleniyordu:
/// eşzamanlı iki çıkış birbirinin yazmasını eziyor, ürün bakiyesi hareket defteriyle ayrışıyordu.</item>
/// <item><b>M5</b> — Bildirim tekilleştirmesi yalnız koddaydı; iki instance aynı bildirimi iki kez
/// yazabiliyordu.</item>
/// <item><b>M7</b> — Idempotency anahtarı isteğe bağlı değildi: aynı anahtar farklı bir uçta eski
/// yanıtı oynatıp YENİ mutasyonu sessizce atlıyordu.</item>
/// </list>
/// </summary>
public sealed class AuditRoundSevenPhase4Tests
{
    /// <summary>
    /// ASIL İDDİA: 5 stoklu üründe iki EŞZAMANLI 3'lük çıkış kaybolmaz. Ya biri reddedilir
    /// (negatif olamaz), ya ikisi de uygulanır — her hâlde <c>bakiye = açılış + Σ hareketler</c>
    /// bozulmaz. Gerçek kilit/transaction gerektiğinden iddia MariaDB'de doğrulanır.
    /// </summary>
    [MySqlFact]
    public async Task AddMovement_ConcurrentOutbound_KeepsBalanceConsistentWithLedger()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid tenantId, productId;
        const decimal opening = 5m;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Faz4 Stok", $"faz4stok-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var product = new Product(tenant.Id, branch.Id, "Serum", ProductCategory.SkinCare, "adet", 100m, 250m, opening, 1m);
            db.Products.Add(product);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            productId = product.Id;
        }

        async Task<bool> OutboundAsync(decimal qty)
        {
            await using var db = database.NewContext();
            var result = await new StockService(db, new NoopAuditLogger()).AddMovementAsync(
                tenantId, productId,
                new CreateStockMovementRequest(StockMovementType.Outbound, qty, null, null, "Eszamanli cikis", null, null));
            return result.IsSuccess;
        }

        var outcomes = await Task.WhenAll(OutboundAsync(3m), OutboundAsync(3m));

        await using (var check = database.NewContext())
        {
            var product = await check.Products.AsNoTracking().SingleAsync(p => p.Id == productId);
            var movements = await check.StockMovements.AsNoTracking()
                .Where(m => m.ProductId == productId).ToListAsync();

            // DEFTER = BAKİYE. Kaybolan güncellemede ürün 2 kalıyor ama defter −6 diyordu.
            var ledgerDelta = movements.Sum(m => m.Type == StockMovementType.Outbound ? -m.Quantity : m.Quantity);
            Assert.Equal(opening + ledgerDelta, product.CurrentStock);

            // NEGATİF BAKİYE OLUŞMADI: 5 stoktan 2×3 çıkış birlikte uygulanamaz.
            Assert.True(product.CurrentStock >= 0m, $"Stok negatife dustu: {product.CurrentStock}");
            Assert.Equal(1, outcomes.Count(ok => ok));
            Assert.Single(movements);
            Assert.Equal(opening - 3m, product.CurrentStock);
        }
    }

    // ── H8: kalıcı iş TAM BİR KEZ sahiplenilir ───────────────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: aynı iş için EŞZAMANLI iki sahiplenme denemesinde yalnız BİRİ kazanır.
    /// Kaybeden handler'ı hiç çalıştırmaz — handler'lar dış dünyaya yazdığı için (WhatsApp, push)
    /// çift çalışma müşteriye çift mesaj demekti. Koşullu UPDATE gerektirdiğinden MariaDB'de.
    /// </summary>
    [MySqlFact]
    public async Task ClaimJob_TwoConcurrentWorkers_ExactlyOneWins()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid jobId;

        await using (var db = database.NewContext())
        {
            var job = new BackgroundJob("qa.test", "{}");
            db.BackgroundJobs.Add(job);
            await db.SaveChangesAsync();
            jobId = job.Id;
        }

        async Task<bool> ClaimAsync(string token)
        {
            await using var db = database.NewContext();
            var job = await db.BackgroundJobs.SingleAsync(j => j.Id == jobId);
            return await DurableJobClaim.TryClaimAsync(db, job, token, TimeSpan.FromMinutes(5), default);
        }

        var outcomes = await Task.WhenAll(ClaimAsync("worker-a"), ClaimAsync("worker-b"));
        Assert.Equal(1, outcomes.Count(won => won));

        await using (var check = database.NewContext())
        {
            var job = await check.BackgroundJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
            Assert.Equal("Processing", job.Status);
            Assert.NotNull(job.LockToken);
            Assert.NotNull(job.LockedUntilUtc);
        }
    }

    /// <summary>
    /// KİLİDİ DOLMUŞ iş yeniden alınabilir (ölen worker kuyruğu kilitlemesin) — ama yalnız BİR
    /// kez: yeniden sahiplenme de aynı koşullu UPDATE'ten geçer.
    /// </summary>
    [MySqlFact]
    public async Task ClaimJob_ExpiredLease_IsReclaimableExactlyOnce()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid jobId;

        await using (var db = database.NewContext())
        {
            var job = new BackgroundJob("qa.test", "{}");
            job.MarkProcessing(TimeSpan.FromMinutes(5), "olen-worker");
            db.BackgroundJobs.Add(job);
            await db.SaveChangesAsync();
            jobId = job.Id;

            // Kilidi GEÇMİŞE çek: worker öldü, kira doldu.
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE background_jobs SET LockedUntilUtc = {0} WHERE Id = {1}",
                DateTime.UtcNow.AddMinutes(-1), jobId.ToString());
        }

        async Task<bool> ClaimAsync(string token)
        {
            await using var db = database.NewContext();
            var job = await db.BackgroundJobs.SingleAsync(j => j.Id == jobId);
            return await DurableJobClaim.TryClaimAsync(db, job, token, TimeSpan.FromMinutes(5), default);
        }

        var outcomes = await Task.WhenAll(ClaimAsync("yeni-a"), ClaimAsync("yeni-b"));
        Assert.Equal(1, outcomes.Count(won => won));

        await using (var check = database.NewContext())
        {
            var job = await check.BackgroundJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
            Assert.NotEqual("olen-worker", job.LockToken);
        }
    }

    /// <summary>
    /// SONUÇ JETONA KOŞULLU: kirası dolup işi başkasına kaptıran worker sonradan bitirse bile
    /// durumu YAZAMAZ. Aksi hâlde yeni sahibin çalışması görünmez olur, iş defterde tek başarı
    /// gibi dururken gerçekte iki kez çalışmış olurdu.
    /// </summary>
    [MySqlFact]
    public async Task CompleteJob_AfterLeaseStolen_DoesNotOverwriteNewOwner()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid jobId;

        await using (var db = database.NewContext())
        {
            var job = new BackgroundJob("qa.test", "{}");
            db.BackgroundJobs.Add(job);
            await db.SaveChangesAsync();
            jobId = job.Id;
        }

        // 1) A sahiplenir.
        await using (var db = database.NewContext())
        {
            var job = await db.BackgroundJobs.SingleAsync(j => j.Id == jobId);
            Assert.True(await DurableJobClaim.TryClaimAsync(db, job, "worker-a", TimeSpan.FromMinutes(5), default));
        }

        // 2) A'nın kirası dolar, B işi yeniden sahiplenir.
        await using (var db = database.NewContext())
        {
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE background_jobs SET LockedUntilUtc = {0} WHERE Id = {1}",
                DateTime.UtcNow.AddMinutes(-1), jobId.ToString());
            var job = await db.BackgroundJobs.SingleAsync(j => j.Id == jobId);
            Assert.True(await DurableJobClaim.TryClaimAsync(db, job, "worker-b", TimeSpan.FromMinutes(5), default));
        }

        // 3) A geç kalıp "başardım" yazmaya çalışır → REDDEDİLİR.
        await using (var db = database.NewContext())
        {
            var job = await db.BackgroundJobs.SingleAsync(j => j.Id == jobId);
            var wrote = await DurableJobClaim.TryCompleteAsync(db, job, "worker-a", true, null, default);
            Assert.False(wrote, "Kirasini kaybeden worker sonucu yazabildi.");
        }

        await using (var check = database.NewContext())
        {
            var job = await check.BackgroundJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
            Assert.Equal("Processing", job.Status);   // hâlâ B'de, "Succeeded" yazılmadı
            Assert.Equal("worker-b", job.LockToken);
        }

        // 4) Gerçek sahip B yazabilir.
        await using (var db = database.NewContext())
        {
            var job = await db.BackgroundJobs.SingleAsync(j => j.Id == jobId);
            Assert.True(await DurableJobClaim.TryCompleteAsync(db, job, "worker-b", true, null, default));
        }

        await using (var check = database.NewContext())
            Assert.Equal("Succeeded", (await check.BackgroundJobs.AsNoTracking().SingleAsync(j => j.Id == jobId)).Status);
    }

    /// <summary>
    /// KALP ATIŞI kilidi uzatır (uzun iş yeniden alınmasın); sahipliği kaybedince false döner.
    /// </summary>
    [MySqlFact]
    public async Task Heartbeat_ExtendsLease_AndFailsAfterOwnershipLost()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid jobId;

        await using (var db = database.NewContext())
        {
            var job = new BackgroundJob("qa.test", "{}");
            db.BackgroundJobs.Add(job);
            await db.SaveChangesAsync();
            jobId = job.Id;

            var tracked = await db.BackgroundJobs.SingleAsync(j => j.Id == jobId);
            Assert.True(await DurableJobClaim.TryClaimAsync(db, tracked, "worker-a", TimeSpan.FromMinutes(1), default));
        }

        await using (var db = database.NewContext())
        {
            var before = (await db.BackgroundJobs.AsNoTracking().SingleAsync(j => j.Id == jobId)).LockedUntilUtc;
            Assert.True(await DurableJobClaim.HeartbeatAsync(db, jobId, "worker-a", TimeSpan.FromMinutes(10), default));
            var after = (await db.BackgroundJobs.AsNoTracking().SingleAsync(j => j.Id == jobId)).LockedUntilUtc;
            Assert.True(after > before, "Kalp atisi kirayi uzatmadi.");

            // Başka jetonla kalp atışı geçmez.
            Assert.False(await DurableJobClaim.HeartbeatAsync(db, jobId, "worker-b", TimeSpan.FromMinutes(10), default));
        }
    }

    // ── H9: sağlayıcıya gitmeden ÖNCE rezerve et ─────────────────────────────────────────

    /// <summary>
    /// ASIL İDDİA: otomatik gönderim aynı (şablon + müşteri + zaman kovası) için sağlayıcıya
    /// YALNIZ BİR KEZ gider. İkinci tarama — ya da ikinci backend örneği — log satırını yazamaz ve
    /// mesajı göndermez. Benzersiz indeks gerektiği için MariaDB'de doğrulanır.
    /// </summary>
    [MySqlFact]
    public async Task AutomaticSend_SecondSweep_DoesNotCallProviderAgain()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid tenantId, templateId, customerId;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Faz4 Bildirim", $"faz4bil-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var customer = new Customer(tenant.Id, branch.Id, "BILDIRIM MUSTERI", "0555 818 91 01", null);
            db.Customers.Add(customer);
            var template = new NotificationTemplate(tenant.Id, branch.Id, "Hatirlatma",
                NotificationChannel.Sms, NotificationTrigger.AppointmentReminder, "Merhaba {ad}, randevunuz var.");
            template.Activate();
            db.NotificationTemplates.Add(template);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            templateId = template.Id;
            customerId = customer.Id;
        }

        var messaging = Substitute.For<IPlatformMessagingService>();
        messaging.SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, null, null));

        const string bucket = "202608060000";
        async Task<int> SweepAsync()
        {
            await using var db = database.NewContext();
            var service = new NotificationService(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(), messaging);
            var result = await service.SendAsync(tenantId,
                new SendNotificationRequest(templateId, new[] { customerId }, null, bucket));
            return result.IsSuccess ? result.Value!.Sent : 0;
        }

        var first = await SweepAsync();
        var second = await SweepAsync();

        Assert.Equal(1, first);
        Assert.Equal(0, second);   // ikinci tarama aynı mesajı GÖNDERMEZ

        // Sağlayıcı TAM BİR KEZ çağrıldı — asıl iddia budur.
        await messaging.Received(1).SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());

        await using (var check = database.NewContext())
        {
            var logs = await check.NotificationLogs.IgnoreQueryFilters()
                .Where(l => l.TenantId == tenantId).ToListAsync();
            Assert.Single(logs);
            Assert.Equal(NotificationLogStatus.Sent, logs[0].Status);
        }
    }

    /// <summary>
    /// KARŞIT DURUM: ELLE gönderimde kova yoktur — yönetici aynı mesajı bilerek tekrar gönderebilir.
    /// </summary>
    [MySqlFact]
    public async Task ManualSend_WithoutBucket_MayBeRepeated()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid tenantId, templateId, customerId;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Faz4 Elle", $"faz4elle-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var customer = new Customer(tenant.Id, branch.Id, "ELLE MUSTERI", "0555 919 02 12", null);
            db.Customers.Add(customer);
            var template = new NotificationTemplate(tenant.Id, branch.Id, "Kampanya",
                NotificationChannel.Sms, NotificationTrigger.Manual, "Merhaba {ad}, kampanyamız var.");
            template.Activate();
            db.NotificationTemplates.Add(template);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            templateId = template.Id;
            customerId = customer.Id;
        }

        var messaging = Substitute.For<IPlatformMessagingService>();
        messaging.SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(new MessagingTestResult(true, false, null, null));

        async Task<int> SendAsync()
        {
            await using var db = database.NewContext();
            var service = new NotificationService(db, new AlwaysAllowUsageService(), new AllowAllFeatureService(), messaging);
            var result = await service.SendAsync(tenantId,
                new SendNotificationRequest(templateId, new[] { customerId }, null));
            return result.IsSuccess ? result.Value!.Sent : 0;
        }

        Assert.Equal(1, await SendAsync());
        Assert.Equal(1, await SendAsync());   // elle tekrar gönderim ENGELLENMEZ
        await messaging.Received(2).SendSmsAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// KARŞIT DURUM: yeterli stok varken eşzamanlı iki çıkış İKİSİ DE uygulanır — kilit protokolü
    /// doğru olan işi engellemez, yalnız sıraya sokar.
    /// </summary>
    [MySqlFact]
    public async Task AddMovement_ConcurrentOutbound_WithEnoughStock_BothApply()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        Guid tenantId, productId;
        const decimal opening = 10m;

        await using (var db = database.NewContext())
        {
            var tenant = new Tenant("Faz4 Stok2", $"faz4stok2-{Guid.NewGuid():N}"[..20], "Premium", TenantStatus.Active);
            var branch = tenant.AddBranch("Merkez", "İstanbul", true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();

            var product = new Product(tenant.Id, branch.Id, "Krem", ProductCategory.SkinCare, "adet", 80m, 200m, opening, 1m);
            db.Products.Add(product);
            await db.SaveChangesAsync();

            tenantId = tenant.Id;
            productId = product.Id;
        }

        async Task<bool> OutboundAsync()
        {
            await using var db = database.NewContext();
            var result = await new StockService(db, new NoopAuditLogger()).AddMovementAsync(
                tenantId, productId,
                new CreateStockMovementRequest(StockMovementType.Outbound, 3m, null, null, "Eszamanli cikis", null, null));
            return result.IsSuccess;
        }

        var outcomes = await Task.WhenAll(OutboundAsync(), OutboundAsync());
        Assert.Equal(2, outcomes.Count(ok => ok));

        await using (var check = database.NewContext())
        {
            var product = await check.Products.AsNoTracking().SingleAsync(p => p.Id == productId);
            Assert.Equal(opening - 6m, product.CurrentStock);
            Assert.Equal(2, await check.StockMovements.AsNoTracking().CountAsync(m => m.ProductId == productId));
        }
    }
}
