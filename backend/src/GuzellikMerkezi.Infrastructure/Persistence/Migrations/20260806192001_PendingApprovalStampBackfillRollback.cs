using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GuzellikMerkezi.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// İPTAL EDİLMİŞ YETKİYİ GERİ GETİREN BACKFILL'İ GERİ ALIR.
    ///
    /// <para>
    /// <c>20260806103109_ApprovalStampExpenseReversalPaymentLink</c>, kolonu eklerken kuyrukta
    /// bekleyen isteklere istek sahibinin O ANDAKİ (yani MIGRATION ANINDAKİ) güvenlik damgasını
    /// yazıyordu. Bu, korumayı tam tersine çevirir: istek gönderildikten SONRA parola sıfırlanmış,
    /// zorunlu çıkış yapılmış ya da yetkisi geri alınmış bir personelin bekleyen isteği, backfill
    /// sayesinde "damga eşleşiyor" durumuna gelir ve onaylandığında UYGULANABİLİRDİ — tam da bu
    /// alanın engellemesi gereken senaryo.
    /// </para>
    /// <para>
    /// DOĞRU DEĞER BOŞTUR. Kolon eklenmeden önce oluşmuş bir isteğin damgası BİLİNMİYOR ve
    /// bilinemez; <c>ApprovalRequesterScope</c> boş damgayı zaten FAIL-CLOSED işler ("damga kayıtlı
    /// değil; işlemi reddedip personelden yeniden göndermesini isteyin"). Bu migration, karara
    /// bağlanmamış (Pending/Processing) satırların damgasını NULL'a döndürür.
    /// </para>
    /// <para>
    /// ETKİ: bu sürüme geçerken kuyrukta bekleyen onaylar uygulanamaz hâle gelir; yönetici onları
    /// reddeder, personel yeniden gönderir (yeni istek gerçek damgayı taşır). Bilinmeyen bir yetki
    /// durumuyla para/stok hareketi uygulamaktansa istenen davranış budur. Karara bağlanmış
    /// (Approved/Rejected) satırlara DOKUNULMAZ — onların damgası zaten kullanılmaz.
    /// </para>
    /// <para>
    /// NEDEN AYRI MIGRATION: uygulanmış migration'ların gövdesi değiştirilemez (H15). Eski
    /// kurulumlar aynı MigrationId'yi uygulamış sayar ve düzeltilmiş SQL'i hiç görmezdi; düzeltme
    /// her zaman ileri yönlü YENİ bir migration olmalıdır.
    /// </para>
    /// </summary>
    public partial class PendingApprovalStampBackfillRollback : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE `pending_operations` " +
                "SET `RequesterSecurityStampUtc` = NULL " +
                "WHERE `Status` IN ('Pending', 'Processing');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // GERİ ALINAMAZ (ve alınmamalı). Silinen değerler zaten HATALIYDI: istek anına değil
            // migration anına aitlerdi. Geri yazmak, iptal edilmiş yetkiyi yeniden geçerli gösteren
            // durumu geri getirirdi. Şema değişikliği olmadığı için Down'un yapacağı bir şey yoktur.
        }
    }
}
