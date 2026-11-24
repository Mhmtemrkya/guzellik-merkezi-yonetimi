using GuzellikMerkezi.Domain.Assistant;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Gerçek kullanıcı cümleleriyle veri sorusu değerlendirmesi (kural motoru — yapay zekâ kapalıyken de çalışan katman).
/// İlk iki satır kullanıcının bildirdiği hatalardır ("sayfaya aktarıyor, orada göstermesi gerekiyor"). Türkçe ekler
/// (geliri, gelirlerini, cirosu, kazancımız) ve gündelik yazım; ayrıca gelir sanılmaması gereken fiil kullanımları.
/// </summary>
public sealed class AssistantDataQuestionEvalTests
{
    private static readonly DateTime Now = new(2026, 11, 20, 14, 0, 0);

    private static AssistantParse R(string message) => AssistantIntentResolver.Resolve(message, nowLocal: Now);

    [Theory]
    // ── Kullanıcının bildirdiği ──
    [InlineData("ocak ayı gelirlerini göster", AssistantIntent.Revenue)]
    [InlineData("bugünün geliri ne", AssistantIntent.Revenue)]
    // ── Gelir / ciro / tahsilat ──
    [InlineData("bugün ne kadar kazandık", AssistantIntent.Revenue)]
    [InlineData("dünkü cirom", AssistantIntent.Revenue)]
    [InlineData("geçen haftanın cirosu ne kadardı", AssistantIntent.Revenue)]
    [InlineData("bu ay kasaya ne kadar para girdi", AssistantIntent.Revenue)]
    [InlineData("2025 yılı toplam gelirimiz", AssistantIntent.Revenue)]
    [InlineData("şubat gelirleri", AssistantIntent.Revenue)]
    [InlineData("son 7 günün tahsilatı", AssistantIntent.Revenue)]
    [InlineData("bugünkü hasılat", AssistantIntent.Revenue)]
    [InlineData("kasa durumu ne", AssistantIntent.Revenue)]
    [InlineData("bu ay ciro nasıl", AssistantIntent.Revenue)]
    [InlineData("geliri göster", AssistantIntent.Revenue)]
    [InlineData("yılbaşından beri kazancımız", AssistantIntent.Revenue)]
    // ── Gider / kâr / satış / ödeme yöntemi ──
    [InlineData("geçen ayın giderleri", AssistantIntent.Expenses)]
    [InlineData("bu ay ne kadar masraf yaptık", AssistantIntent.Expenses)]
    [InlineData("kirada ne kadar harcadık bu yıl", AssistantIntent.Expenses)]
    [InlineData("bu ayın kârı ne kadar", AssistantIntent.Profit)]
    [InlineData("geçen ay kâr mı zarar mı ettik", AssistantIntent.Profit)]
    [InlineData("net kazancımız ne", AssistantIntent.Profit)]
    [InlineData("kar marjımız", AssistantIntent.Profit)]
    [InlineData("dün ne kadar satış yaptık", AssistantIntent.Sales)]
    [InlineData("bu ay kaç paket sattık", AssistantIntent.Sales)]
    [InlineData("bugün nakit ne kadar aldık", AssistantIntent.PaymentMethods)]
    [InlineData("bu ay kredi kartıyla ne kadar tahsilat var", AssistantIntent.PaymentMethods)]
    [InlineData("ödeme yöntemlerine göre dağılım", AssistantIntent.PaymentMethods)]
    // ── Alacak / taksit ──
    [InlineData("müşterilerin toplam borcu", AssistantIntent.Receivables)]
    [InlineData("borçlu müşteriler kimler", AssistantIntent.Receivables)]
    [InlineData("alacaklarımız ne kadar", AssistantIntent.Receivables)]
    [InlineData("vadesi geçen taksitler", AssistantIntent.OverdueInstallments)]
    // ── Hizmet / personel / şube ──
    [InlineData("en çok satan hizmetler", AssistantIntent.TopServices)]
    [InlineData("ocakta en popüler paket hangisi", AssistantIntent.TopServices)]
    [InlineData("en çok yapılan işlem ne", AssistantIntent.TopServices)]
    [InlineData("personel performansı bu ay", AssistantIntent.TopStaff)]
    [InlineData("en çok ciro yapan personel kim", AssistantIntent.TopStaff)]
    [InlineData("geçen ay personellerin primleri", AssistantIntent.TopStaff)]
    [InlineData("şubeleri karşılaştır", AssistantIntent.Branches)]
    [InlineData("hangi şube daha çok kazandı", AssistantIntent.Branches)]
    // ── Müşteriler ──
    [InlineData("bu ay kaç yeni müşteri geldi", AssistantIntent.NewCustomers)]
    [InlineData("toplam kaç müşterimiz var", AssistantIntent.CustomerCount)]
    [InlineData("müşteri sayımız", AssistantIntent.CustomerCount)]
    [InlineData("en çok harcayan müşteriler", AssistantIntent.TopCustomers)]
    [InlineData("en sadık müşterimiz kim", AssistantIntent.TopCustomers)]
    [InlineData("uzun süredir gelmeyen müşteriler", AssistantIntent.PassiveCustomers)]
    [InlineData("pasif müşteriler", AssistantIntent.PassiveCustomers)]
    [InlineData("bugün doğum günü olan var mı", AssistantIntent.Birthdays)]
    [InlineData("bu ay doğum günü olanlar", AssistantIntent.Birthdays)]
    [InlineData("geçen ay gelmeyen müşteriler", AssistantIntent.NoShows)]
    // ── Randevular ──
    [InlineData("yarın kaç randevu var", AssistantIntent.AppointmentsToday)]
    [InlineData("yarınki randevular", AssistantIntent.AppointmentsToday)]
    [InlineData("dün kaç müşteri geldi", AssistantIntent.AppointmentsToday)]
    [InlineData("ocakta kaç randevu vardı", AssistantIntent.AppointmentsToday)]
    [InlineData("cumartesi randevuları", AssistantIntent.AppointmentsToday)]
    [InlineData("bugün kimler gelecek", AssistantIntent.AppointmentsToday)]
    [InlineData("geçen hafta kaç randevu yapıldı", AssistantIntent.AppointmentsToday)]
    [InlineData("bu ay iptal edilen randevular", AssistantIntent.Cancellations)]
    [InlineData("kaç iptal oldu bu hafta", AssistantIntent.Cancellations)]
    [InlineData("en yoğun saatler", AssistantIntent.BusiestTimes)]
    [InlineData("hangi gün daha yoğun", AssistantIntent.BusiestTimes)]
    [InlineData("yarın boş saat var mı", AssistantIntent.FreeSlots)]
    // ── Stok ──
    [InlineData("stok durumu", AssistantIntent.Inventory)]
    [InlineData("kaç ürünümüz var", AssistantIntent.Inventory)]
    [InlineData("en çok satan ürünler", AssistantIntent.Inventory)]
    [InlineData("biten ürünler", AssistantIntent.CriticalStock)]
    public void Resolves(string message, AssistantIntent expected) => Assert.Equal(expected, R(message).Intent);

    [Theory]
    // ── Kurum sahibi / şube yöneticisi: durum soruları ──
    [InlineData("aboneliğim ne zaman bitiyor", AssistantIntent.Subscription)]
    [InlineData("deneme süremiz ne zaman doluyor", AssistantIntent.Subscription)]
    [InlineData("whatsapp kredim ne kadar", AssistantIntent.MessagingCredits)]
    [InlineData("kaç sms hakkımız kaldı", AssistantIntent.MessagingCredits)]
    [InlineData("bugün kasa kapanışı yapıldı mı", AssistantIntent.CashClosingStatus)]
    [InlineData("gün sonu alındı mı", AssistantIntent.CashClosingStatus)]
    [InlineData("bugün kim izinli", AssistantIntent.StaffToday)]
    [InlineData("yarın kimler çalışıyor", AssistantIntent.StaffToday)]
    [InlineData("aktif kampanyalar neler", AssistantIntent.Campaigns)]
    [InlineData("kvkk onayı olmayan müşteriler", AssistantIntent.KvkkPending)]
    [InlineData("kaç aktif hediye çeki var", AssistantIntent.GiftCards)]
    [InlineData("fiyat listesi", AssistantIntent.ServicePrice)]
    [InlineData("hizmetleriniz neler", AssistantIntent.ServicePrice)]
    // ── Personel: kendisi ──
    [InlineData("bu ay kaç işlem yaptım", AssistantIntent.MyWork)]
    [InlineData("geçen hafta kaç müşteriye baktım", AssistantIntent.MyWork)]
    [InlineData("yarınki randevularım", AssistantIntent.AppointmentsToday)]
    [InlineData("yıldız puanım kaç", AssistantIntent.MyRating)]
    // ── Müşteri: kendisi ──
    [InlineData("borcum ne kadar", AssistantIntent.MyDebt)]
    [InlineData("taksitlerim ne zaman", AssistantIntent.MyDebt)]
    [InlineData("sadakat puanım kaç", AssistantIntent.Loyalty)]
    [InlineData("hediye çekim var mı", AssistantIntent.GiftCards)]
    [InlineData("salonun adresi ne", AssistantIntent.SalonInfo)]
    [InlineData("kaçta açılıyorsunuz", AssistantIntent.SalonInfo)]
    [InlineData("salon nerede", AssistantIntent.SalonInfo)]
    [InlineData("telefon numaranız ne", AssistantIntent.SalonInfo)]
    [InlineData("kalan seansım kaç", AssistantIntent.RemainingSessions)]
    public void RoleStatusQuestions(string message, AssistantIntent expected) => Assert.Equal(expected, R(message).Intent);

    [Theory]
    // Ciro sorusu fiyat sorusu sanılmaz; fiyat sorusu ciro sanılmaz.
    [InlineData("bugün kaç TL kazandık", AssistantIntent.Revenue)]
    [InlineData("lazer kaç TL", AssistantIntent.ServicePrice)]
    [InlineData("en çok çalışan personel", AssistantIntent.TopStaff)]
    public void Disambiguation(string message, AssistantIntent expected) => Assert.Equal(expected, R(message).Intent);

    [Theory]
    // "gelir" = gelmek fiili: gelir sorusu değildir.
    [InlineData("yarın gelirim")]
    [InlineData("müşteri kaçta gelir")]
    [InlineData("saat 3'te gelir misiniz")]
    [InlineData("eşim de gelirse olur mu")]
    public void ComingVerb_IsNotRevenue(string message) => Assert.NotEqual(AssistantIntent.Revenue, R(message).Intent);

    [Theory]
    // Bir şey YAPMA isteği veri sorusu değildir (yardım makalesine gider).
    [InlineData("yarın için randevu almak istiyorum")]
    [InlineData("randevumu iptal etmek istiyorum")]
    [InlineData("gider eklemek istiyorum")]
    [InlineData("satış yapmak istiyorum")]
    [InlineData("yeni kayıt açmak istiyorum")]
    [InlineData("taslakları onaylamam lazım")]
    [InlineData("yarınki randevumu cumaya alabilir miyim")]
    public void ActionRequest_IsNotData(string message) => Assert.False(AssistantIntentCatalog.IsData(R(message).Intent), message);

    [Theory]
    [InlineData("kara listeye nasıl eklerim", AssistantIntent.HowTo)]
    [InlineData("gider nasıl girilir", AssistantIntent.HowTo)]
    [InlineData("doğum günü mesajı nasıl ayarlanır", AssistantIntent.HowTo)]
    [InlineData("şube nasıl eklenir", AssistantIntent.HowTo)]
    public void HowTo_StillWins(string message, AssistantIntent expected) => Assert.Equal(expected, R(message).Intent);

    [Fact]
    public void ReportedQuestions_CarryTheRightPeriod()
    {
        var january = R("ocak ayı gelirlerini göster").Range!;
        Assert.Equal((new DateTime(2026, 1, 1), new DateTime(2026, 2, 1)), (january.From, january.To));
        var today = R("bugünün geliri ne").Range!;
        Assert.Equal((new DateTime(2026, 11, 20), new DateTime(2026, 11, 21)), (today.From, today.To));
        // Randevu ileriye bakar: "aralıkta" bu yılın Aralığı; ciro geriye bakar: geçen Aralık.
        Assert.Equal(2026, R("aralıkta kaç randevu var").Range!.From.Year);
        Assert.Equal(2025, R("aralık cirosu").Range!.From.Year);
    }
}
