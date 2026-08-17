namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Çalışma ortamı — yalnızca "geliştirme mi?" sorusu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı soyutlama?</b> Infrastructure katmanı <c>Microsoft.Extensions.Hosting</c>'e
/// referans vermiyor (yalnız Configuration.Abstractions var), dolayısıyla <c>IHostEnvironment</c>
/// oraya sızdırılamaz. Doğrudan <c>IConfiguration["ASPNETCORE_ENVIRONMENT"]</c> okumak ise
/// testlerde kolayca sahtelenemeyen, sessizce yanlış cevap verebilen bir bağ olurdu.
/// </para>
/// <para>
/// KULLANIM SINIRI: bu bayrak yalnızca <b>geliştirme kolaylığı</b> için kullanılır (ör. doğrulama
/// kodunu yanıtta döndürmek, sağlayıcısız simülasyonu teslimat saymak). Güvenlik kararı
/// <b>asla</b> buna bağlanmaz — ortam değişkeni yanlış ayarlanırsa canlıda kapı açılırdı.
/// </para>
/// </remarks>
public interface IAppEnvironment
{
    bool IsDevelopment { get; }
}
