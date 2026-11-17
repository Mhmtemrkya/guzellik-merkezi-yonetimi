using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.WhatsApp;

/// <summary>Kurum yöneticisinin gördüğü WhatsApp ayarı: bağlantı DURUMU (salt-okunur, platform bağlar) + içerik + faturalama tercihleri.</summary>
public sealed record WhatsAppSettingsDto(
    bool Enabled,
    string? PhoneNumberId,
    string? DisplayPhoneNumber,
    string ConnectionStatus,
    bool IsConnected,
    string? BusinessAccountId,
    string? ReminderTemplate,
    string Provider,
    string WebhookUrl,
    bool MarketingEnabled,
    bool AllowWalletOverage,
    decimal? MonthlySpendCapCredits,
    // Meta onaylı şablon adları — 24 saat penceresi kapalıyken serbest metin İLETİLMEZ.
    string? KvkkTemplateName = null,
    string? ReminderTemplateName = null,
    string TemplateLanguageCode = "tr",
    string? WaitlistOfferTemplateName = null,
    string? WaitlistActivatedTemplateName = null,
    string? RatingTemplateName = null,
    // Tek yönlü bildirimlerin kanalı (WhatsApp / Sms).
    NotificationChannel RatingLinkChannel = NotificationChannel.WhatsApp,
    NotificationChannel WaitlistActivatedChannel = NotificationChannel.WhatsApp,
    NotificationChannel KvkkChannel = NotificationChannel.WhatsApp);

/// <summary>
/// Kurum yöneticisi yalnızca içeriği, faturalama tercihlerini ve tek yönlü bildirim kanallarını
/// kaydeder. Bağlantı VE Meta onaylı şablon adları platformdadır (<see cref="BindWhatsAppConnectionRequest"/>):
/// mağazadaki eski mobil sürüm şablon adlarını hâlâ gönderir — bu kayıtta alan YOKTUR, sessizce yok sayılır.
/// Kanal alanları boş gelirse MEVCUT değer korunur — eski istemci (kanal alanlarını bilmeyen mobil
/// sürüm) kaydettiğinde seçim sıfırlanmasın.
/// </summary>
public sealed record SaveWhatsAppSettingsRequest(
    string? ReminderTemplate,
    bool MarketingEnabled = false,
    bool AllowWalletOverage = false,
    decimal? MonthlySpendCapCredits = null,
    NotificationChannel? RatingLinkChannel = null,
    NotificationChannel? WaitlistActivatedChannel = null,
    NotificationChannel? KvkkChannel = null,
    /// <summary>
    /// Tavanın birimi. Yeni istemciler "Credits" gönderir. Boşsa istek, tavanı ₺ olarak
    /// (<c>monthlySpendCapTry</c>) gönderen ESKİ istemcidendir (mağazadaki mobil sürüm) ve
    /// <see cref="MonthlySpendCapCredits"/> hiç gelmez — o durumda mevcut tavan KORUNUR, sessizce silinmez.
    /// </summary>
    string? SpendCapUnit = null);

public sealed record ReminderResultDto(
    bool Sent,
    bool Simulated,
    string ToPhone,
    string Body,
    string? ProviderMessageId,
    string? Error);

public sealed record WhatsAppMessageDto(
    Guid Id,
    Guid? AppointmentId,
    Guid? CustomerId,
    WhatsAppMessageDirection Direction,
    string Phone,
    string Body,
    WhatsAppMessageStatus Status,
    WhatsAppReplyIntent Intent,
    string? ProviderMessageId,
    string? ErrorMessage,
    DateTime CreatedAtUtc,
    WhatsAppMessageCategory Category,
    WhatsAppBillingSource BillingSource,
    decimal ChargedCredits);

// --- Platform tarafı: bağlantı yönetimi ---

/// <summary>Platform admin'in "WhatsApp Bağlantıları" ekranında bir kurumun bağlantı durumu.</summary>
public sealed record WhatsAppConnectionDto(
    Guid TenantId,
    string TenantName,
    string? PlanName,
    string? PhoneNumberId,
    string? BusinessAccountId,
    string? DisplayPhoneNumber,
    string ConnectionStatus,
    bool IsConnected,
    bool HasTokenOverride,
    string WebhookUrl,
    // Meta onaylı şablon adları — Meta Business Manager platformun olduğu için platform yönetir.
    string? KvkkTemplateName = null,
    string? ReminderTemplateName = null,
    string TemplateLanguageCode = "tr",
    string? WaitlistOfferTemplateName = null,
    string? WaitlistActivatedTemplateName = null,
    string? RatingTemplateName = null);

/// <summary>
/// Platform: kurum numarasını bağlar. Şablon adlarında <c>null</c> = MEVCUT korunur (alanları bilmeyen
/// istemci, ör. yalnız durumu değiştiren kayıt, şablonları silmesin); boş metin = temizle.
/// </summary>
public sealed record BindWhatsAppConnectionRequest(
    string? PhoneNumberId,
    string? BusinessAccountId,
    string? DisplayPhoneNumber,
    string ConnectionStatus,
    string? VerifyToken,
    string? AccessTokenOverride,
    string? KvkkTemplateName = null,
    string? ReminderTemplateName = null,
    string? TemplateLanguageCode = null,
    string? WaitlistOfferTemplateName = null,
    string? WaitlistActivatedTemplateName = null,
    string? RatingTemplateName = null);

/// <summary>
/// Hediye kartı gönderimi. <paramref name="PdfBase64"/> istemcide üretilen kartın PDF'idir
/// (veri-URL öneki olmadan ham base64).
/// </summary>
public sealed record SendGiftCardRequest(
    Guid GiftCardId,
    /// <summary>Alıcı numarası. Boşsa karta bağlı müşterinin kayıtlı numarası kullanılır.</summary>
    string? Phone,
    string PdfBase64);

public sealed record SendTestMessageRequest(string ToPhone, string? Text);
