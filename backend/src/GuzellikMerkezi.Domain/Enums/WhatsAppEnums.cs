namespace GuzellikMerkezi.Domain.Enums;

/// <summary>Randevunun müşteri tarafından (WhatsApp yanıtıyla) onay durumu — iş akışı Status'tan bağımsız bilgi.</summary>
public enum WhatsAppConfirmationStatus
{
    None = 0,
    Pending = 1,
    Confirmed = 2,
    Declined = 3,
    RescheduleRequested = 4,
}

public enum WhatsAppMessageDirection
{
    Outbound = 0,
    Inbound = 1,
}

public enum WhatsAppMessageStatus
{
    Queued = 0,
    Sent = 1,
    Delivered = 2,
    Read = 3,
    Failed = 4,
    Received = 5,
    Simulated = 6,
}

/// <summary>Gelen yanıtın yorumlanmış niyeti.</summary>
public enum WhatsAppReplyIntent
{
    Unknown = 0,
    Confirm = 1,
    Cancel = 2,
    Reschedule = 3,
}

/// <summary>
/// Meta faturalama kategorisi. Meta ücreti kategoriye göre değişir: Utility/Authentication ucuz
/// (işlemsel), Marketing pahalı (kampanya/indirim), Service (müşteri 24s penceresi) şimdilik ücretsiz.
/// Şablon bu kategoriye kilitlenir; fiyat kategoriye göre veritabanından çözülür.
/// </summary>
public enum WhatsAppMessageCategory
{
    Utility = 0,        // randevu hatırlatma/onay, işlemsel bildirim
    Marketing = 1,      // kampanya, indirim, doğum günü teklifi
    Authentication = 2, // doğrulama/OTP kodu
    Service = 3,        // müşteri mesajına 24s içinde serbest yanıt
}

/// <summary>Bir mesajın ücretinin nereden karşılandığı — denetim ve raporlama için.</summary>
public enum WhatsAppBillingSource
{
    None = 0,        // ücretlendirilmedi (ör. gelen mesaj)
    Quota = 1,       // pakete dahil aylık kotadan (kuruma ücretsiz)
    Wallet = 2,      // ön ödemeli kontör bakiyesinden düşüldü
    Simulation = 3,  // simülasyon (gerçek gönderim yok, para hareketi yok)
}

/// <summary>Kontör cüzdanı hareket tipi (muhasebe defteri).</summary>
public enum WalletTransactionType
{
    TopUp = 0,       // kontör yükleme (kurum satın aldı / platform ekledi)
    Reserve = 1,     // gönderim anında rezervasyon (bakiyeden ayrıldı)
    Capture = 2,     // teslim onayıyla kesinleşme (rezervasyon harcandı)
    Refund = 3,      // başarısız/iptal → rezervasyon iadesi
    Adjustment = 4,  // platform manuel düzeltme (+/-)
}

/// <summary>Kurumun WhatsApp numarasının platform tarafından Meta'ya bağlanma durumu.</summary>
public enum WhatsAppConnectionStatus
{
    NotConnected = 0, // numara bağlanmadı — gönderim simülasyona düşer / engellenir
    Pending = 1,      // bilgiler girildi, doğrulama/test bekliyor
    Connected = 2,    // aktif, canlı gönderim yapılabilir
    Disabled = 3,     // platform tarafından geçici olarak durduruldu
}

/// <summary>Kurumun ek kontör satın alma talebinin durumu. Bakiye kuruma ancak ONAY sonrası eklenir.</summary>
public enum CreditPurchaseStatus
{
    Pending = 0,   // kurum talep etti, platform onayı bekleniyor
    Approved = 1,  // platform onayladı → bakiye eklendi
    Rejected = 2,  // platform reddetti
    Cancelled = 3, // kurum vazgeçti
}
