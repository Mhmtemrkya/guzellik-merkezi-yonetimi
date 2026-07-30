using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Onam formu ŞABLONU — kurumun yazdığı metin (ör. "Güzellik Uygulaması Onay Formu").
/// Hizmetlere bağlanır (<see cref="ServiceConsentForm"/>); randevu tamamlanırken bu hizmetin
/// şablonları imzalı mı diye bakılır.
///
/// Şablon metni müşteri kaydına KOPYALANIR (<see cref="CustomerConsentForm"/>): şablon sonradan
/// değişse bile müşterinin imzaladığı metin aynen durur — imzalı belgenin hukuki değeri budur.
/// </summary>
public sealed class ConsentFormTemplate : Entity
{
    private ConsentFormTemplate() { }

    public ConsentFormTemplate(Guid tenantId, string title, string body, string? checkItemsJson, bool requiresSignature = true, string? questionsJson = null)
    {
        TenantId = tenantId;
        Update(title, body, checkItemsJson, requiresSignature, questionsJson);
    }

    public Guid TenantId { get; private set; }
    public string Title { get; private set; } = string.Empty;

    /// <summary>Formun tam metni. Yer tutucular doldurulur: {{musteri}}, {{hizmet}}, {{tarih}}, {{kurum}}, {{personel}}.</summary>
    public string Body { get; private set; } = string.Empty;

    /// <summary>Müşterinin işaretlemesi gereken onay maddeleri — JSON string dizisi.</summary>
    public string? CheckItemsJson { get; private set; }

    /// <summary>
    /// Müşteriye sorulacak EVET/HAYIR soruları — JSON dizisi:
    /// <c>[{ "id": "...", "text": "Hamile misiniz?", "required": true, "note": false }]</c>.
    /// Anamnez/kontrendikasyon beyanı formun kendi içinde alınabilsin diye vardır; cevaplar
    /// müşteri kaydında (<see cref="CustomerConsentForm.AnswersJson"/>) saklanır.
    /// </summary>
    public string? QuestionsJson { get; private set; }

    /// <summary>false ise form yalnız okunur/bilgilendirir; imza istenmez.</summary>
    public bool RequiresSignature { get; private set; } = true;

    public bool IsActive { get; private set; } = true;
    public int SortOrder { get; private set; }

    /// <param name="questionsJson">
    /// <c>null</c> ise sorular DEĞİŞTİRİLMEZ (alanı taşımayan kısmi güncellemeler soruları silmesin);
    /// boş dizi göndermek soruları temizler.
    /// </param>
    public void Update(string title, string body, string? checkItemsJson, bool requiresSignature, string? questionsJson = null)
    {
        if (string.IsNullOrWhiteSpace(title)) throw new DomainException("Form başlığı boş olamaz.");
        if (string.IsNullOrWhiteSpace(body)) throw new DomainException("Form metni boş olamaz.");
        Title = title.Trim();
        Body = body.Trim();
        CheckItemsJson = string.IsNullOrWhiteSpace(checkItemsJson) ? null : checkItemsJson.Trim();
        if (questionsJson is not null)
            QuestionsJson = string.IsNullOrWhiteSpace(questionsJson) || questionsJson.Trim() == "[]" ? null : questionsJson.Trim();
        RequiresSignature = requiresSignature;
        Touch();
    }

    public void SetActive(bool active)
    {
        IsActive = active;
        Touch();
    }

    public void SetSortOrder(int sortOrder)
    {
        SortOrder = sortOrder < 0 ? 0 : sortOrder;
        Touch();
    }
}
