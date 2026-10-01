using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// ÜCRETSİZ KULLANIM MODU (<c>Billing:FreeMode</c>, varsayılan <c>true</c>).
/// </summary>
/// <remarks>
/// <para>
/// Paket satışı ŞİMDİLİK kapalıdır: kurumlar kayıt olur ve süresiz, ücretsiz kullanır. Satış
/// akışı (planlar, ödeme, abonelik dönemi) koddan sökülmedi, yalnız bu bayrağın arkasına alındı;
/// satış açılacağı gün <c>Billing__FreeMode=false</c> ile eski davranış geri gelir.
/// </para>
/// <para>Açıkken:</para>
/// <list type="bullet">
///   <item>Self-servis kayıt kurumu <b>Aktif</b> ve bitiş tarihi OLMADAN açar (deneme sayacı yok).</item>
///   <item>Mevcut deneme kurumlarının süresi dolsa da askıya ALINMAZ (giriş, middleware, arka plan tarayıcı).</item>
///   <item>Ücretli abonelik kuralları DEĞİŞMEZ; platformdan elle verilmiş bir dönem yine işler.</item>
/// </list>
/// </remarks>
public static class BillingMode
{
    public const string ConfigKey = "Billing:FreeMode";

    /// <summary>Ayar yoksa/okunamazsa ÜCRETSİZ sayılır — canlıda ayar unutulsa da kimse kilitlenmez.</summary>
    public static bool IsFree(IConfiguration? configuration)
    {
        var raw = configuration?[ConfigKey];
        return !bool.TryParse(raw, out var value) || value;
    }
}
