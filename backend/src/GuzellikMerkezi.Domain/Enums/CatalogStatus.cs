namespace GuzellikMerkezi.Domain.Enums;

/// <summary>Hizmet ve paket yayın durumu (Taslak → Yayında akışı + Pasif/Arşiv).</summary>
public enum CatalogStatus
{
    /// <summary>Yayında — randevu/satış listelerinde görünür.</summary>
    Active = 0,
    /// <summary>Taslak — henüz yayınlanmadı, listede gizli.</summary>
    Draft = 1,
    /// <summary>Pasif — geçici olarak kapatıldı.</summary>
    Passive = 2,
    /// <summary>Arşiv — kullanım dışı, geçmiş kayıtlarda kalır.</summary>
    Archived = 3,
}
