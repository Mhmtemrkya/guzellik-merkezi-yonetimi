using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.CustomerAccounts;

public interface ICustomerAccountService
{
    /// <summary>
    /// Cari (satış) listesi. <paramref name="customerId"/> müşteri kartı için,
    /// <paramref name="serviceDefinitionId"/> / <paramref name="servicePackageId"/> ise katalog
    /// (hizmet / paket) kartındaki satış paneli için süzer. Süzgeç verildiğinde satırlar seans,
    /// kalem ve satış durumu ile zenginleştirilir.
    /// </summary>
    Task<Result<PagedResult<CustomerAccountDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default, Guid? customerId = null, Guid? serviceDefinitionId = null, Guid? servicePackageId = null, string? category = null);
    Task<Result<CustomerAccountDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> CreateAsync(Guid tenantId, CreateCustomerAccountRequest request, CancellationToken cancellationToken = default);

    /// <summary>Geçmiş yıllarda yapılmış satışı sisteme elle işler (tahsilat + taksit + kullanılmış seans dahil).</summary>
    Task<Result<CustomerAccountDto>> CreateHistoricalAsync(Guid tenantId, CreateHistoricalSaleRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Satışı iptal eder: cari kaydı taksit/tahsilat/seanslarıyla birlikte canlı tablolardan SİLİNİR
    /// ve tam kopyası <c>cancelled_sales</c> arşivine taşınır (finansal iz kaybolmaz, yer değiştirir).
    /// Bağlı adisyon da iptale çekilir. Dönen DTO silinmeden önceki son hâldir.
    /// </summary>
    Task<Result<CustomerAccountDto>> CancelSaleAsync(Guid tenantId, Guid id, CancelSaleRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Yanlış iptal edilen satışı geri alır: arşivdeki snapshot'tan cari, taksitler, tahsilatlar ve
    /// seans bakiyeleri AYNI Id'lerle yeniden kurulur; adisyonlar iptalden ÖNCEKİ statülerine döner.
    /// <paramref name="id"/> hem arşiv kaydının hem de silinen carinin Id'si olabilir.
    /// <paramref name="request"/> boşsa iade kasa hareketi korunur (bkz. <see cref="RestoreSaleRequest"/>).
    /// </summary>
    Task<Result<CustomerAccountDto>> RestoreSaleAsync(Guid tenantId, Guid id, RestoreSaleRequest? request = null, CancellationToken cancellationToken = default);

    /// <summary>İptal arşivi — "İptal Edilenler" ekranının kaynağı (geri alınmışlar hariç).</summary>
    Task<Result<IReadOnlyCollection<CancelledSaleDto>>> ListCancelledAsync(Guid tenantId, Guid? customerId = null, Guid? servicePackageId = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// CANLI + ARŞİV, TEK ANLIK GÖRÜNTÜDEN. İstemci bunları iki AYRI istekle çekiyordu ve iki
    /// istek arasında bir satış iptal edilirse aynı satış hem canlıda hem arşivde görünüp ÇİFT
    /// sayılabiliyor, ters sırada ise HİÇBİRİNDE görünmeyip kayboluyordu (1.000 TL satış /
    /// 400 TL iadede 2.000 brüt · 1.600 tahsilat gibi imkânsız rakamlar).
    /// <para>
    /// İki sorgu TEK transaction içinde çalışır; MySQL REPEATABLE READ altında ikisi de aynı anı
    /// görür. Yarış penceresi kapanır.
    /// </para>
    /// <para>
    /// <b>LİSTE TAMDIR — SESSİZCE KESİLMEZ.</b> Canlı satışların TAMAMI döner:
    /// <paramref name="request"/> sayfa boyutu yok sayılır (imzada geriye uyumluluk için durur),
    /// sayfalar aynı transaction içinde toplanır. İstemciler tek sayfa (<c>pageSize=500</c>)
    /// istiyordu ve daha fazla satışı olan müşteride liste SESSİZCE kesiliyordu — üstelik panelin
    /// para özetleri bu eksik listeden hesaplanıyordu. Üst güvenlik sınırı aşılırsa liste
    /// kesilmez, istek <c>Conflict</c> ile REDDEDİLİR: para ekranında eksik liste, hata
    /// mesajından tehlikelidir.
    /// </para>
    /// <para>
    /// <paramref name="customerId"/> yalnızca KAPSAM daraltır (müşteri kartı ↔ Ön Muhasebe cari
    /// tablosu); iki yolda da tamlık garantisi aynıdır.
    /// </para>
    /// </summary>
    Task<Result<CustomerAccountsWithArchiveDto>> ListWithArchiveAsync(
        Guid tenantId, PageRequest request, Guid? customerId = null, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> UpdateAsync(Guid tenantId, Guid id, UpdateCustomerAccountRequest request, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> RescheduleAsync(Guid tenantId, Guid id, RescheduleAccountRequest request, CancellationToken cancellationToken = default);
    Task<Result<CustomerAccountDto>> RegisterPaymentAsync(Guid tenantId, Guid id, RegisterAccountPaymentRequest request, CancellationToken cancellationToken = default);

    // NOT: DeleteAsync BİLEREK YOK. Cariyi soft-delete etmek satışı sonlandırmaz; tahsilat arşivi,
    // iade, adisyon geri alma, paket seansı ve iptal snapshot'ı atlanır ve satış aggregate'i
    // parçalanır. Satışı sonlandırmanın tek yolu CancelSaleAsync'tir.

    /// <summary>Müşterinin paketlerindeki hizmet-bazlı kalan seans bakiyeleri.</summary>
    Task<Result<IReadOnlyCollection<CustomerPackageSessionDto>>> GetCustomerSessionsAsync(Guid tenantId, Guid customerId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Pano "Paket Raporu": paket satışı, yapılacak seans ve ay ay taksit takvimi.
    /// <paramref name="fromUtc"/>/<paramref name="toUtc"/> verilirse rapor, o aralıkta (satış tarihi =
    /// cari/adisyon oluşturma) açılmış paketlere göre süzülür (günlük/aylık/yıllık dönem filtresi).
    /// </summary>
    /// <summary>
    /// Pano Paket Raporu. Dönem (fromUtc/toUtc) ve kategori süzgeçleri BİRLİKTE uygulanır.
    /// <para>
    /// <paramref name="servicePackageId"/> / <paramref name="serviceDefinitionId"/>: rapor TEK bir
    /// pakete ya da TEK bir hizmete daraltılır ("Satış Detayı > Müşteri Detayı" seçicisi). Kategori
    /// süzgeciyle aynı mekanizma, tek elemanlı kümeyle çalışır.
    /// </para>
    /// </summary>
    Task<Result<AccountReportDto>> GetReportAsync(Guid tenantId, int months, DateTime? fromUtc = null, DateTime? toUtc = null, string? category = null, string? subCategory = null, Guid? servicePackageId = null, Guid? serviceDefinitionId = null, CancellationToken cancellationToken = default);

    /// <summary>Pano "Hizmet Raporu" kartları — paket raporundan ayrı, kategori HİZMETİN kategorisidir.</summary>
    Task<Result<ServiceReportDto>> GetServiceReportAsync(Guid tenantId, DateTime? fromUtc = null, DateTime? toUtc = null, string? category = null, string? subCategory = null, CancellationToken cancellationToken = default);
}
