using System.Security.Cryptography;
using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using Microsoft.Extensions.Configuration;

namespace GuzellikMerkezi.Infrastructure.Security;

/// <summary>
/// AES-256-GCM ile field-level şifreleme. Storage format:
/// <c>ENC:v1:base64(nonce[12] || ciphertext || tag[16])</c>
/// </summary>
/// <remarks>
/// Servis singleton'dır → tüm eşzamanlı istekler paylaşır. <see cref="AesGcm"/> thread-safe DEĞİLDİR;
/// bu yüzden paylaşılan tek bir örnek TUTULMAZ. Yalnızca ham anahtar (<c>_key</c>) saklanır ve her
/// Encrypt/Decrypt çağrısında yerel, kısa ömürlü bir <see cref="AesGcm"/> oluşturulur. Aksi halde
/// eşzamanlı çözümlemeler birbirinin iç state'ini bozar, GCM tag doğrulaması patlar (CryptographicException)
/// ve çözülemeyen ham "ENC:v1:..." dışarı sızar. AES anahtar genişletmesi çok ucuzdur; çağrı başına
/// oluşturmanın maliyeti önemsizdir, doğruluk paylaşımdan önce gelir.
/// </remarks>
public sealed class AesGcmEncryptionService : IEncryptionService
{
    private const string Prefix = "ENC:v1:";
    private const int NonceSize = 12;
    private const int TagSize = 16;

    private readonly byte[] _key; // 32 byte

    public AesGcmEncryptionService(IConfiguration configuration)
    {
        var base64 = configuration["Encryption:MasterKeyBase64"];
        if (string.IsNullOrWhiteSpace(base64))
            throw new InvalidOperationException("Encryption:MasterKeyBase64 ayarlanmamış. appsettings veya env değişkenine 32-byte base64 anahtar ekle.");

        // Anahtar Base64 dışı bir formatta gelirse SHA-256'dan derive ederek 32 byte'a normalize ediyoruz.
        byte[] raw;
        try { raw = Convert.FromBase64String(base64); }
        catch (FormatException) { raw = Encoding.UTF8.GetBytes(base64); }

        _key = raw.Length == 32 ? raw : SHA256.HashData(raw);
    }

    public bool IsEncrypted(string? value) =>
        !string.IsNullOrEmpty(value) && value.StartsWith(Prefix, StringComparison.Ordinal);

    public string? Encrypt(string? plaintext)
    {
        if (plaintext is null) return null;
        if (plaintext.Length == 0) return string.Empty;
        if (IsEncrypted(plaintext)) return plaintext; // Çift şifrelemeyi engelle

        var plainBytes = Encoding.UTF8.GetBytes(plaintext);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cipher = new byte[plainBytes.Length];
        var tag = new byte[TagSize];

        // AesGcm thread-safe değil → çağrı başına yerel örnek (paylaşılan state yok).
        using (var aes = new AesGcm(_key, TagSize))
            aes.Encrypt(nonce, plainBytes, cipher, tag);

        // nonce || cipher || tag tek paket
        var packed = new byte[NonceSize + cipher.Length + TagSize];
        Buffer.BlockCopy(nonce, 0, packed, 0, NonceSize);
        Buffer.BlockCopy(cipher, 0, packed, NonceSize, cipher.Length);
        Buffer.BlockCopy(tag, 0, packed, NonceSize + cipher.Length, TagSize);

        return Prefix + Convert.ToBase64String(packed);
    }

    public string? Decrypt(string? ciphertext)
    {
        if (ciphertext is null) return null;
        if (ciphertext.Length == 0) return string.Empty;
        if (!IsEncrypted(ciphertext)) return ciphertext; // Eski plaintext kayıtları geri dön

        try
        {
            var payload = Convert.FromBase64String(ciphertext[Prefix.Length..]);
            if (payload.Length < NonceSize + TagSize) return ciphertext;

            var nonce = new byte[NonceSize];
            var tag = new byte[TagSize];
            var cipher = new byte[payload.Length - NonceSize - TagSize];
            Buffer.BlockCopy(payload, 0, nonce, 0, NonceSize);
            Buffer.BlockCopy(payload, NonceSize, cipher, 0, cipher.Length);
            Buffer.BlockCopy(payload, NonceSize + cipher.Length, tag, 0, TagSize);

            var plain = new byte[cipher.Length];
            // AesGcm thread-safe değil → çağrı başına yerel örnek (paylaşılan state yok).
            using (var aes = new AesGcm(_key, TagSize))
                aes.Decrypt(nonce, cipher, tag, plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch (CryptographicException)
        {
            // Anahtar değişmiş veya veri bozuk; ham değeri dön (panik atma).
            return ciphertext;
        }
    }
}
