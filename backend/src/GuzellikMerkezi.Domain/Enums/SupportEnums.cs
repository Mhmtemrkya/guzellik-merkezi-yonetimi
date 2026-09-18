namespace GuzellikMerkezi.Domain.Enums;

/// <summary>
/// Destek talebinin yaşam döngüsü.
/// </summary>
/// <remarks>
/// <b>"Kapalı" ve "Çözüldü" AYRI durumlardır.</b> Çözüldü, platformun "bu iş bitti" beyanıdır ve
/// talep sahibi hâlâ yanıt yazıp konuyu yeniden açabilir. Kapalı ise son noktadır. İkisini tek
/// duruma indirmek, çözüldü sanılan bir talebe gelen "hayır, hâlâ sorun var" yanıtının hiçbir
/// yere düşmemesi demekti.
/// </remarks>
public enum SupportTicketStatus
{
    /// <summary>Yeni geldi, kimse bakmadı.</summary>
    Open = 0,

    /// <summary>Platform ekibi üstlendi, üzerinde çalışılıyor.</summary>
    InProgress = 1,

    /// <summary>Platform yanıt yazdı, talep sahibinden bilgi bekleniyor.</summary>
    WaitingCustomer = 2,

    /// <summary>Çözüldü — talep sahibi yanıt yazarsa yeniden açılır.</summary>
    Resolved = 3,

    /// <summary>Kapatıldı; son nokta.</summary>
    Closed = 4,
}

/// <summary>Talebin aciliyeti — platform kuyruğu buna göre sıralanır.</summary>
public enum SupportTicketPriority
{
    Low = 0,
    Normal = 1,
    High = 2,

    /// <summary>İş duruyor: kasa kapanmıyor, giriş yapılamıyor, ödeme alınamıyor.</summary>
    Urgent = 3,
}

/// <summary>
/// Talebin konusu. Sınıflandırma, doğru ekibe yönlendirmenin ve tekrar eden sorunları
/// saymanın tek yoludur; serbest metinden bu çıkarılamaz.
/// </summary>
public enum SupportTicketCategory
{
    /// <summary>Sınıflandırılamayan / genel soru.</summary>
    General = 0,

    /// <summary>Hata bildirimi — bir şey çalışmıyor.</summary>
    Bug = 1,

    /// <summary>Fatura, abonelik, ödeme.</summary>
    Billing = 2,

    /// <summary>Özellik isteği.</summary>
    Feature = 3,

    /// <summary>Hesap, kullanıcı, yetki.</summary>
    Account = 4,

    /// <summary>Kurulum, veri aktarımı, eğitim.</summary>
    Onboarding = 5,
}

/// <summary>
/// Bir mesajı KİM yazdı?
/// </summary>
/// <remarks>
/// Rol adı değil TARAF tutulur. Talep sahibi kurumdan ayrılabilir, hesabı kapanabilir ya da
/// talep hiç oturum açmamış bir ziyaretçiden gelmiş olabilir; mesajın hangi taraftan geldiği
/// bunların hiçbirine bağlı olmamalıdır.
/// </remarks>
public enum SupportAuthorSide
{
    /// <summary>Talebi açan taraf (kurum kullanıcısı ya da ziyaretçi).</summary>
    Requester = 0,

    /// <summary>Platform destek ekibi.</summary>
    Platform = 1,

    /// <summary>Sistem notu (durum değişikliği vb.) — kimse yazmadı.</summary>
    System = 2,
}
