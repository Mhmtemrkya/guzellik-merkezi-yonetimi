using MySql.Data.MySqlClient;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// BAĞLANTI DİZESİNİN GÜVENLİ HÂLE GETİRİLMESİ.
///
/// <para>
/// KARAKTER SETİ ZORUNLU OLARAK utf8mb4. Sütunlar zaten utf8mb4 ama BAĞLANTI karakter seti
/// sunucunun varsayılanından geliyordu; MariaDB kurulumlarında bu sıklıkla utf8mb3/latin1'dir.
/// Sonuç sessiz veri bozulmasıydı: "Cilt Bakımı" veritabanına "Cilt Bakimi" olarak yazılıyor,
/// Türkçe'ye özgü harfler (ı, ş, ğ, İ) kayboluyordu. Hata yalnız sunucu varsayılanı yanlış olan
/// makinelerde göründüğü için geliştirme ortamında (MySQL 8, varsayılanı utf8mb4) hiç fark
/// edilmiyordu — canlıda ise müşteri adları kalıcı olarak bozulurdu.
/// </para>
/// <para>
/// Açıkça ayarlanmış bir değer varsa DOKUNULMAZ: operatörün bilinçli tercihi ezilmemeli.
/// </para>
/// </summary>
public static class MySqlConnectionStrings
{
    public const string RequiredCharacterSet = "utf8mb4";

    /// <summary>Karakter seti verilmemişse utf8mb4 ekler; verilmişse olduğu gibi bırakır.</summary>
    public static string EnsureUtf8Mb4(string connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString)) return connectionString;

        try
        {
            var builder = new MySqlConnectionStringBuilder(connectionString);
            if (string.IsNullOrWhiteSpace(builder.CharacterSet))
                builder.CharacterSet = RequiredCharacterSet;
            return builder.ConnectionString;
        }
        catch (ArgumentException)
        {
            // Ayrıştırılamayan dize burada düzeltilemez; sağlayıcı kendi hatasını versin.
            return connectionString;
        }
    }
}
