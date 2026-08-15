using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Hediye çeki bakiyesini değiştirmenin TEK YOLU.
///
/// <para>
/// NEDEN AYRI BİR GEÇİT: <c>GiftCard.Redeem</c> / <c>UndoRedeem</c> üç ayrı yerden çağrılıyordu
/// (doğrudan kullanım ucu, adisyon onayı, iptal/geri alma). Defteri "yazmayı hatırlamak" bu
/// noktaların her birine bırakılsaydı, biri unutulduğunda defter sessizce yalan söylerdi — ki
/// bu, tam olarak defterin var olma sebebini ortadan kaldırır. Mutasyon ile kayıt burada TEK
/// çağrıya bağlandı: birini yapıp diğerini atlamak mümkün değil.
/// </para>
///
/// <para>
/// Kural makineye bağlıdır: <c>Conventions/GiftCardLedgerTests</c>, <c>.Redeem(</c> ve
/// <c>.UndoRedeem(</c> çağrılarının bu dosya dışında geçmesini reddeder.
/// </para>
///
/// <para>
/// KİLİT ÇAĞIRANDA: bu geçit satır kilidini KENDİ almaz. Her çağıran (doğrudan kullanım ucu,
/// adisyon onayı, iptal/geri alma) <c>gift_cards</c> satırını çoktan <c>RowLock.LockRowAsync</c>
/// ile kilitlemiş ve transaction açmış durumdadır; kilidi burada tekrar almak, çağıranın
/// transaction'ının içinde ikinci bir kilit sırası yaratıp kilitlenmeye (deadlock) davetiye
/// çıkarırdı. Sözleşme AÇIKÇA buradadır: bu geçit kilitsiz bir akıştan çağrılırsa koruma
/// sessizce delinir — yeni bir çağıran eklerken kilit önce alınmalıdır.
/// </para>
///
/// <para>
/// KAYIT DA MUTASYON DA AYNI <c>SaveChanges</c>'te gider, dolayısıyla bakiye düşüp defter satırı
/// kaybolamaz.
/// </para>
/// </summary>
public static class GiftCardLedger
{
    public const string DirectionRedeem = "Redeem";
    public const string DirectionUndo = "Undo";

    public const string SourceDirect = "Direct";
    public const string SourceAdisyon = "Adisyon";

    /// <summary>
    /// Çeki harca ve deftere yaz. Domain kuralları (geçerlilik, yeterli bakiye) <see cref="GiftCard.Redeem"/>
    /// içinde uygulanır; kural ihlalinde <c>DomainException</c> fırlar ve DEFTER SATIRI YAZILMAZ.
    /// </summary>
    public static void Redeem(
        GuzellikDbContext db,
        GiftCard card,
        decimal amount,
        DateTime nowUtc,
        string sourceType,
        Guid? sourceId,
        Guid? customerId,
        Guid? performedByUserId)
    {
        var balanceBefore = card.Balance;
        var usesBefore = card.UsedCount;

        card.Redeem(amount, nowUtc);

        db.GiftCardTransactions.Add(new GiftCardTransaction(
            card.TenantId,
            card.BranchId,
            card.Id,
            DirectionRedeem,
            // Kuponda "tutar" indirimin kendisidir; hediye çekinde düşen bakiyedir. İkisi de pozitif.
            card.Kind == GiftCardKind.StoredValue ? balanceBefore - card.Balance : amount,
            card.Balance - balanceBefore,
            card.UsedCount - usesBefore,
            card.Balance,
            card.UsedCount,
            sourceType,
            sourceId,
            customerId ?? card.CustomerId,
            performedByUserId,
            nowUtc));
    }

    /// <summary>
    /// Harcamayı geri al ve deftere KARŞI SATIR yaz (eski satır silinmez — defter düzeltilmez, eklenir).
    /// </summary>
    public static void Undo(
        GuzellikDbContext db,
        GiftCard card,
        decimal amount,
        DateTime nowUtc,
        string sourceType,
        Guid? sourceId,
        Guid? customerId,
        Guid? performedByUserId)
    {
        var balanceBefore = card.Balance;
        var usesBefore = card.UsedCount;

        card.UndoRedeem(amount);

        db.GiftCardTransactions.Add(new GiftCardTransaction(
            card.TenantId,
            card.BranchId,
            card.Id,
            DirectionUndo,
            card.Kind == GiftCardKind.StoredValue ? card.Balance - balanceBefore : amount,
            card.Balance - balanceBefore,
            card.UsedCount - usesBefore,
            card.Balance,
            card.UsedCount,
            sourceType,
            sourceId,
            customerId ?? card.CustomerId,
            performedByUserId,
            nowUtc));
    }
}
