// KVKK aydınlatma + açık rıza metni.
// Kurum yöneticisi Ayarlar sayfasından düzenleyebilir; boş bırakılırsa aşağıdaki
// yerleşik varsayılan metin, kurum adı yerleştirilerek gösterilir.
//
// İçerik sistemin gerçek veri işleme kapsamına göre hazırlanmıştır: müşteri kimlik &
// iletişim bilgileri, doğum tarihi (doğum günü kampanyası), tedavi öncesi/sonrası
// fotoğraflar, konsültasyon/anamnez (özel nitelikli sağlık verisi), randevu geçmişi,
// cari hesap & ödeme kayıtları, WhatsApp/SMS/e-posta bildirimleri, sadakat programı.

export const KVKK_TENANT_PLACEHOLDER = '{KURUM}'

export const DEFAULT_KVKK_TEXT = `${KVKK_TENANT_PLACEHOLDER} — KİŞİSEL VERİLERİN KORUNMASI AYDINLATMA METNİ VE AÇIK RIZA BEYANI

1. VERİ SORUMLUSU
6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca, kişisel verileriniz veri sorumlusu sıfatıyla ${KVKK_TENANT_PLACEHOLDER} ("Kurum") tarafından aşağıda açıklanan kapsamda işlenmektedir.

2. İŞLENEN KİŞİSEL VERİLER
Kurum tarafından sunulan güzellik, bakım ve estetik hizmetleri kapsamında aşağıdaki kişisel verileriniz işlenebilir:
• Kimlik ve iletişim bilgileri: ad soyad, telefon numarası, e-posta adresi, doğum tarihi, cinsiyet.
• Görsel veriler: profil fotoğrafı ile hizmet öncesi/sonrası (tedavi günlüğü) fotoğrafları.
• Sağlık bilgileri (özel nitelikli): konsültasyon/anamnez formunda beyan ettiğiniz cilt tipi, alerjiler, kullanılan ilaçlar, kronik rahatsızlıklar, gebelik durumu ve uygulamaya etki eden diğer sağlık bilgileri.
• İşlem ve finans bilgileri: randevu geçmişi, alınan hizmet/paket kayıtları, cari hesap, ödeme ve taksit bilgileri.
• Pazarlama ve iletişim tercihleri: bildirim (WhatsApp/SMS/e-posta) izinleri ve sadakat programı kayıtları.

3. KİŞİSEL VERİLERİN İŞLENME AMAÇLARI
Verileriniz; hizmetin planlanması ve sunulması, randevu oluşturma ve hatırlatma, hizmet güvenliğinin ve uygunluğunun (kontrendikasyon) değerlendirilmesi, satış ve tahsilat süreçlerinin yürütülmesi, yasal yükümlülüklerin yerine getirilmesi, memnuniyetin ölçülmesi ile izin vermeniz halinde kampanya ve bilgilendirmelerin iletilmesi amaçlarıyla işlenir.

4. İŞLEMENİN HUKUKİ SEBEPLERİ
Kişisel verileriniz KVKK'nın 5. maddesi kapsamında; bir sözleşmenin kurulması/ifası, hukuki yükümlülük, meşru menfaat ve gerektiğinde açık rızanız hukuki sebeplerine dayanılarak işlenir. Sağlık verileri gibi özel nitelikli kişisel verileriniz KVKK'nın 6. maddesi uyarınca yalnızca açık rızanızla işlenir.

5. VERİLERİN AKTARILMASI
Kişisel verileriniz; hizmetin sunulması için zorunlu olduğu ölçüde yetkili kamu kurum ve kuruluşlarına, mali müşavir/muhasebe hizmeti sağlayıcılarına ve iş süreçlerini yürüten teknik hizmet (yazılım/bulut, mesajlaşma) sağlayıcılarına, KVKK'nın 8. ve 9. maddelerindeki şartlara uygun olarak aktarılabilir. Verileriniz bu amaçlar dışında üçüncü kişilerle paylaşılmaz.

6. SAKLAMA SÜRESİ
Kişisel verileriniz, işleme amacının gerektirdiği süre ile ilgili mevzuatta öngörülen zamanaşımı ve saklama süreleri boyunca muhafaza edilir; sürenin sona ermesiyle silinir, yok edilir veya anonim hale getirilir.

7. İLGİLİ KİŞİNİN HAKLARI
KVKK'nın 11. maddesi uyarınca; verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, işlenme amacını öğrenme, düzeltilmesini/silinmesini isteme, işlenmesine itiraz etme ve zararın giderilmesini talep etme haklarına sahipsiniz. Taleplerinizi Kurum'a iletebilirsiniz.

8. AÇIK RIZA BEYANI
Yukarıdaki aydınlatma metnini okudum ve anladım. Kimlik, iletişim, görsel, işlem ve finans bilgilerim ile özel nitelikli sağlık verilerimin (konsültasyon/anamnez ve öncesi/sonrası fotoğraflar dahil) belirtilen amaçlarla işlenmesine ve gerekli hallerde aktarılmasına açık rıza veriyorum. Ayrıca tarafıma kampanya ve bilgilendirme amaçlı elektronik ileti (WhatsApp/SMS/e-posta) gönderilmesine izin veriyorum.`

/** Kurum adını yerleştirerek gösterilecek nihai metni döndürür. */
export function resolveKvkkText(custom: string | null | undefined, institutionName: string | null | undefined): string {
  const base = custom && custom.trim().length > 0 ? custom : DEFAULT_KVKK_TEXT
  const name = (institutionName || '').trim() || 'Kurumumuz'
  return base.split(KVKK_TENANT_PLACEHOLDER).join(name)
}

/** Ayarlar düzenleyicisinde textarea'ya konacak başlangıç değeri (özel yoksa varsayılan şablon). */
export function kvkkEditorInitial(custom: string | null | undefined): string {
  return custom && custom.trim().length > 0 ? custom : DEFAULT_KVKK_TEXT
}
