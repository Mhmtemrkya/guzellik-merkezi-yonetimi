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
