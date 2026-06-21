namespace GuzellikMerkezi.Domain.Enums;

public enum NotificationChannel
{
    Sms = 0,
    WhatsApp = 1,
    Email = 2,
}

public enum NotificationTrigger
{
    /// <summary>Personelin elle gönderdiği veya toplu kampanya.</summary>
    Manual = 0,
    /// <summary>Randevudan X gün/saat önce.</summary>
    AppointmentReminder = 1,
    /// <summary>Müşterinin doğum günü.</summary>
    BirthdayGreeting = 2,
    /// <summary>Yaklaşan taksit / bekleyen ödeme.</summary>
    PaymentDue = 3,
    /// <summary>Tek seferlik promosyon.</summary>
    Campaign = 4,
    /// <summary>Uzun süredir gelmeyen (pasif) müşteriyi geri kazanma.</summary>
    WinBack = 5,
}

public enum NotificationTemplateStatus
{
    Draft = 0,
    Active = 1,
    /// <summary>WhatsApp şablonları Meta onayında bekler.</summary>
    PendingApproval = 2,
}

public enum NotificationLogStatus
{
    /// <summary>Kuyruğa alındı, gönderim bekliyor.</summary>
    Queued = 0,
    /// <summary>Provider'a başarıyla iletildi.</summary>
    Sent = 1,
    /// <summary>Provider hatası ya da geçersiz alıcı.</summary>
    Failed = 2,
}
