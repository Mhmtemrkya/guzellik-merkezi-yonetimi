# Giriş bilgileri belgesi — tasarım kaynağı

`lib/credentialsPdfDoc.ts` bu üç görselden ölçülerek kuruldu. Görseller **1062 × 1555 px**;
A4 punto'suna çevrim: **1 px = 0.5605 pt**. Koddaki yorumlarda geçen px değerleri buradan gelir.

| Dosya | Ne |
| --- | --- |
| `form-yonetici-dolu.png` | Kurum yöneticisi belgesi, örnek veriyle dolu (hedef görünüm) |
| `form-bos.png` | Aynı belgenin boş hâli — kutu/kart sınırlarını ölçmek için |
| `form-personel-bos.png` | Başlık ve kişi etiketi olmayan nötr taban (personel varyantı bundan türer) |

Belge şablonun **üzerine çizilmez**, pdfmake ile yeniden kurulur: şablondaki başlık görsele
gömülü ve personel varyantında değişmesi gerekiyor; ayrıca e-posta ile şifrenin PDF'ten
kopyalanabilmesi isteniyor (görsel basılan sayfada metin seçilemezdi).

Şablondan yalnız iki marka izi görsel olarak taşındı — projede yazı tipi/vektör karşılığı yok:
`public/credentials/beautyasist-wordmark.png` (serif logotip, pembe zeminiyle kırpıldı) ve
`public/credentials/maydanoz-yazilim.png` (lacivert zeminden saydamlaştırıldı).

Ölçü değiştirdikten sonra **görsel doğrulama**: `node tools/render-credentials-pdf.mjs <dizin>`
üç senaryoyu (yönetici, personel, uzun ad + logosuz) PDF olarak üretir.
