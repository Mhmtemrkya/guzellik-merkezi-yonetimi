namespace GuzellikMerkezi.Application.Common;

public sealed record Error(string Code, string Message)
{
    public static readonly Error None = new("None", string.Empty);
    public static Error Validation(string message) => new("Validation", message);
    public static Error NotFound(string message) => new("NotFound", message);
    public static Error Unauthorized(string message = "Yetkisiz işlem.") => new("Unauthorized", message);
    /// <summary>Kimlik doğru ama YETKİ yok (403). Onay kapısıyla aynı sözleşme.</summary>
    public static Error Forbidden(string message) => new("Forbidden", message);
    public static Error Conflict(string message) => new("Conflict", message);
    /// <summary>Personelin o saatte uygun yeri yok (409) — frontend bunu "bekleme listesine ekle?" için ayırt eder.</summary>
    public static Error SlotFull(string message) => new("SlotFull", message);
    /// <summary>Adisyon silinirken satılan seanslardan biri kullanılmış (400) — frontend bunu "zorla sil?" için ayırt eder.</summary>
    public static Error SessionUsed(string message) => new("AdisyonSessionUsed", message);

    /// <summary>
    /// Yeni şube ücretli ve istek onaylanmış tutarı taşımıyor ya da tutar değişti (409). İstemci şube
    /// teklifini (GET /api/admin/billing/branch-quote) gösterip onaylatmalı — ücret ASLA sessizce çekilmez.
    /// </summary>
    public static Error BranchChargeRequired(string message) => new("BranchChargeRequired", message);

    /// <summary>Önceki şube ödemesinin sonucu sağlayıcıdan henüz kesin alınamadı (409) — ikinci çekim yapılmaz.</summary>
    public static Error BranchChargePending(string message) => new("BranchChargePending", message);

    /// <summary>
    /// Ödenmiş dijital onam kademesi doldu (409): bir sonraki imza, bedeli ÖDENMEMİŞ bir kademeye düşer.
    /// Mesaj NÖTR tutulur (satın alma çağrısı içermez) — iOS'ta App Store 3.1.1 gereği; istemci makine
    /// kodunu görüp yükseltme düğmesini yalnız satın almaya izin verilen yüzeyde ekler.
    /// </summary>
    public static Error ConsentLimitReached(string message) => new("ConsentLimitReached", message);

    /// <summary>Onam kademesi yükseltme tutarı onaylanmadı ya da değişti (409) — hiçbir şey yazılmadı.</summary>
    public static Error ConsentUpgradeRequired(string message) => new("ConsentUpgradeRequired", message);

    /// <summary>
    /// Ödenmiş MÜŞTERİ kademesi doldu (409): yeni müşteri bedeli ödenmemiş bir kademeye düşer. Mesaj NÖTR
    /// (bkz. <see cref="ConsentLimitReached"/>); salon müşterisine gösterilen yollarda faturalama içeriği yok.
    /// </summary>
    public static Error CustomerLimitReached(string message) => new("CustomerLimitReached", message);

    /// <summary>Müşteri kademesi yükseltme tutarı onaylanmadı ya da değişti (409) — hiçbir şey yazılmadı.</summary>
    public static Error CustomerUpgradeRequired(string message) => new("CustomerUpgradeRequired", message);

    /// <summary>
    /// Kartsız kurumun şube talebi alındı, şube FATURA ÖDENİNCE açılacak (409 — oluşturulmadı ama hata
    /// değil; istemci bilgi olarak gösterir).
    /// </summary>
    public static Error BranchAwaitingPayment(string message) => new("BranchAwaitingPayment", message);

    /// <summary>
    /// Müşteri KAYDI yarıda: telefon doğrulandı, sıra e-posta kodunda (400).
    /// </summary>
    /// <remarks>
    /// Hata gibi taşınır çünkü akış tamamlanmadı ve oturum üretilmedi; ama istemci bunu bir
    /// ARIZA olarak değil BİR SONRAKİ ADIM olarak gösterir. Ayırt edilebilir bir kod olmadan
    /// istemcinin mesajı metinden tanıması gerekirdi — çeviri ya da ufak bir düzeltme o eşleşmeyi
    /// sessizce bozardı.
    /// </remarks>
    public static Error EmailStageRequired(string maskedEmail) => new("CustomerEmailStage", maskedEmail);
}
