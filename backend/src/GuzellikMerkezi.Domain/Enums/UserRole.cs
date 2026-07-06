namespace GuzellikMerkezi.Domain.Enums;

public enum UserRole
{
    PlatformAdmin = 1,
    InstitutionOwner = 2,
    BranchManager = 3,
    Staff = 4,
    /// <summary>Mobil/online randevu portalına telefon + TC ile giren müşteri. Yönetim ekranlarına erişemez.</summary>
    Customer = 5
}
