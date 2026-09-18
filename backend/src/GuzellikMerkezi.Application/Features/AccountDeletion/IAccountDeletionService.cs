using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.AccountDeletion;

/// <summary>
/// HESAP SİLME — "Hesabımı sil".
///
/// <para>
/// İKİ AYRI HESAP TÜRÜ, İKİ AYRI ANLAM:
/// <list type="bullet">
///   <item>
///     <b>KURUM</b> (yönetici): tüm kurumu ve verisini siler. Geri alınamaz ve 50'den fazla
///     tabloyu kapsar, bu yüzden ANINDA OLMAZ — bekleme süresi verilir ve süre içinde
///     vazgeçilebilir (bkz. <see cref="TenantDeletionStatusDto"/>).
///   </item>
///   <item>
///     <b>MÜŞTERİ</b> (online portal): kişisel verisini siler, ANINDA. Müşteri satırı silinmez;
///     anonimleştirilir — randevu/adisyon/cari geçmişi o satıra bağlıdır ve satırın silinmesi
///     kurumun muhasebesini dayanaksız bırakırdı (bkz. Customer.Anonymize).
///   </item>
/// </list>
/// </para>
///
/// <para>
/// <b>Neden personel için yok?</b> Personel hesabı kişinin kendi hesabı değil, KURUMUN açtığı
/// bir erişimdir; kapatma yetkisi de kurumdadır (Personel sayfası). Personelin kendi erişimini
/// silmesi, kurumun kayıtlarındaki "kim yaptı" izini personelin kendi kararıyla koparması
/// olurdu.
/// </para>
/// </summary>
public interface IAccountDeletionService
{
    /// <summary>Kurumun silme talebi durumu (talep var mı, ne zaman silinecek).</summary>
    Task<Result<TenantDeletionStatusDto>> GetTenantStatusAsync(CancellationToken ct = default);

    /// <summary>
    /// Kurum silme talebini kaydeder. Kurum hemen silinmez; bekleme süresi sonunda silinir.
    /// Yalnız kurum yöneticisi çağırabilir ve PAROLASINI doğrulamak zorundadır.
    /// </summary>
    Task<Result<TenantDeletionStatusDto>> RequestTenantDeletionAsync(
        RequestTenantDeletionRequest request, CancellationToken ct = default);

    /// <summary>Silme talebini geri alır (bekleme süresi dolmadan).</summary>
    Task<Result<TenantDeletionStatusDto>> CancelTenantDeletionAsync(CancellationToken ct = default);

    /// <summary>
    /// Müşterinin kendi kişisel verisini siler (anonimleştirir) ve oturumlarını kapatır.
    /// ANINDA uygulanır ve geri alınamaz.
    /// </summary>
    Task<Result<CustomerDeletionResultDto>> DeleteMyCustomerAccountAsync(
        DeleteCustomerAccountRequest request, CancellationToken ct = default);
}

/// <param name="Password">
/// Yöneticinin kendi parolası. <b>Zorunludur:</b> açık bırakılmış bir ekranda tek tıkla tüm
/// kurumu silmek mümkün olmamalı; yeniden kimlik doğrulama, işlemi hesabın sahibine bağlar.
/// </param>
/// <param name="Confirmation">
/// Kullanıcının elle yazdığı onay metni (kurum kodu). İstemci de doğrular; sunucu SON kapıdır.
/// </param>
public sealed record RequestTenantDeletionRequest(string Password, string? Confirmation, string? Reason);

/// <param name="Confirmation">Kullanıcının elle yazdığı onay metni ("SİL").</param>
public sealed record DeleteCustomerAccountRequest(string? Confirmation, string? Reason);

/// <summary>
/// Kurum silme talebinin durumu.
/// </summary>
/// <param name="GraceDays">
/// Bekleme süresi — ekranda GÖSTERİLİR. Sunucudan gelmesi şart: istemciye sabit yazılsaydı,
/// süre değiştiğinde ekran yanlış tarihi vaat ederdi.
/// </param>
public sealed record TenantDeletionStatusDto(
    bool Pending,
    DateTime? RequestedAtUtc,
    DateTime? ScheduledAtUtc,
    string? Reason,
    int GraceDays,
    /// <summary>Onay kutusuna yazılması gereken metin (kurum kodu; yoksa kurum adı).</summary>
    string ConfirmationPhrase);

/// <summary>Müşteri hesabı silindi.</summary>
/// <param name="AnonymizedAtUtc">Kimlik bilgilerinin silindiği an.</param>
/// <remarks>
/// <b>YALNIZ OTURUMUN BAĞLI OLDUĞU KAYIT temizlenir</b> — kişinin BAŞKA kurumlardaki müşteri
/// kayıtlarına dokunulmaz. O kayıtların veri sorumlusu ilgili güzellik merkezidir (bkz.
/// Gizlilik Politikası); portal hesabından onları silmek, bir kurumun kendi defterini
/// üçüncü bir taraf üzerinden sildirmek olurdu. Kullanıcı o kayıtlar için ilgili kuruma
/// başvurur; ekranda bu açıkça yazar.
/// </remarks>
public sealed record CustomerDeletionResultDto(DateTime AnonymizedAtUtc);
