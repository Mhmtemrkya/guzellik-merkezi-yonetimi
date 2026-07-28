using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Onam formu şablonunun bir KATALOG KALEMİNE bağı: hizmet <b>veya</b> paket.
///
/// Bir kaleme birden çok form, bir form birden çok kaleme bağlanabilir. Randevu tamamlanırken
/// ve müşteri/cari/adisyon uyarılarında "bu kişinin imzalaması gereken formlar" bu tablodan çıkar:
///  • hizmet bağı  → müşterinin o hizmete randevusu/seansı varsa gerekli olur,
///  • paket bağı   → müşteri o paketi SATIN ALDIYSA gerekli olur.
///
/// İki alan da nullable'dır ama <b>tam olarak biri</b> dolu olmalıdır (ctor bunu zorlar).
/// </summary>
public sealed class ServiceConsentForm : Entity
{
    private ServiceConsentForm() { }

    private ServiceConsentForm(Guid tenantId, Guid consentFormTemplateId, Guid? serviceDefinitionId, Guid? servicePackageId)
    {
        if (serviceDefinitionId.HasValue == servicePackageId.HasValue)
            throw new DomainException("Onam formu bağı ya hizmete ya pakete olmalı.");
        TenantId = tenantId;
        ConsentFormTemplateId = consentFormTemplateId;
        ServiceDefinitionId = serviceDefinitionId;
        ServicePackageId = servicePackageId;
    }

    public static ServiceConsentForm ForService(Guid tenantId, Guid serviceDefinitionId, Guid consentFormTemplateId) =>
        new(tenantId, consentFormTemplateId, serviceDefinitionId, null);

    public static ServiceConsentForm ForPackage(Guid tenantId, Guid servicePackageId, Guid consentFormTemplateId) =>
        new(tenantId, consentFormTemplateId, null, servicePackageId);

    public Guid TenantId { get; private set; }

    /// <summary>Hizmet bağı (paket bağıysa null).</summary>
    public Guid? ServiceDefinitionId { get; private set; }
    public ServiceDefinition? ServiceDefinition { get; private set; }

    /// <summary>Paket bağı (hizmet bağıysa null).</summary>
    public Guid? ServicePackageId { get; private set; }
    public ServicePackage? ServicePackage { get; private set; }

    public Guid ConsentFormTemplateId { get; private set; }
    public ConsentFormTemplate? ConsentFormTemplate { get; private set; }
}
