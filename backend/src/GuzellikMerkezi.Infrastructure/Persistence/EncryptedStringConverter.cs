using GuzellikMerkezi.Application.Abstractions;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// EF Core value converter — string property'leri at-rest AES-256-GCM ile şifreler.
/// Provider (DB) ↔ Model (kod) arasında şeffaf çalışır:
/// <list type="bullet">
///   <item>Kod tarafında: plaintext string</item>
///   <item>DB tarafında: <c>ENC:v1:base64(nonce|cipher|tag)</c></item>
/// </list>
/// Eski plaintext değerler okunabilir kalır (IsEncrypted false → aynen dön).
/// </summary>
public sealed class EncryptedStringConverter : ValueConverter<string, string>
{
    public EncryptedStringConverter(IEncryptionService encryption)
        : base(
            v => encryption.Encrypt(v) ?? string.Empty,
            v => encryption.Decrypt(v) ?? string.Empty)
    {
    }
}

/// <summary>
/// Nullable varyant — <c>string?</c> property'ler için.
/// </summary>
public sealed class NullableEncryptedStringConverter : ValueConverter<string?, string?>
{
    public NullableEncryptedStringConverter(IEncryptionService encryption)
        : base(
            v => v == null ? null : encryption.Encrypt(v),
            v => v == null ? null : encryption.Decrypt(v))
    {
    }
}
