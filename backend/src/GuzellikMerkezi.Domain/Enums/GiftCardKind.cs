namespace GuzellikMerkezi.Domain.Enums;

/// <summary>Hediye çeki / kupon türü.</summary>
public enum GiftCardKind
{
    /// <summary>Yüzde indirim kuponu (Value = % oranı).</summary>
    Percentage = 0,

    /// <summary>Sabit tutar indirim kuponu (Value = ₺ tutar).</summary>
    FixedAmount = 1,

    /// <summary>Hediye çeki — yüklü bakiye; harcandıkça Balance düşer.</summary>
    StoredValue = 2,
}
