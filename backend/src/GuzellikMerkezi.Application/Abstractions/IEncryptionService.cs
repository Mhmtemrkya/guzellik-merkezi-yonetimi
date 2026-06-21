namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Hassas alanların at-rest şifrelenmesi için kullanılır.
/// Storage formatı: <c>ENC:v1:base64(nonce|ciphertext|tag)</c>.
/// Plaintext başına benzersiz nonce kullanılır — aynı değer iki farklı satırda farklı ciphertext üretir.
/// </summary>
public interface IEncryptionService
{
    /// <summary>Plaintext değeri şifreler ve <c>ENC:v1:...</c> string'i döner. Null/empty değer aynen geri döner.</summary>
    string? Encrypt(string? plaintext);

    /// <summary>Şifreli değeri çözer. <c>ENC:v1:</c> ön ekiyle başlamayan değerler aynen geri döner (eski plaintext kayıtlar için).</summary>
    string? Decrypt(string? ciphertext);

    /// <summary>String'in zaten şifrelenmiş formatta olup olmadığını söyler.</summary>
    bool IsEncrypted(string? value);
}
