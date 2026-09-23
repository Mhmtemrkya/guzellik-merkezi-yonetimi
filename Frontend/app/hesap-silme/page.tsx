import type { Metadata } from 'next'
import LegalPage, { LegalFacts, LegalList, LegalSection, MailLink } from '@/components/legal/LegalPage'
import { company } from '@/lib/legal/company'

/**
 * HESAP SİLME TALEBİ — Google Play zorunlu sayfası.
 *
 * Play Console "Data safety" formu, uygulama içi silme yolunun YANINDA herkese açık bir
 * URL ister: inceleyen kişi uygulamayı kurmadan, hesap açmadan, giriş yapmadan silmenin
 * nasıl talep edildiğini ve NEyin silinip neyin saklandığını okuyabilmelidir. Bu yüzden
 * sayfa `/panel` altında değil, kök rotada ve kimlik doğrulaması olmadan yayındadır.
 *
 * Metindeki her iddia koddan doğrulanmıştır — uydurma yoktur:
 *   - 30 günlük bekleme  → AccountDeletionService.DefaultGraceDays
 *   - kurum silme ertelenir → TenantDeletionBackgroundService + TenantPurge
 *   - müşteri silme anında ama SATIR SİLİNMEZ, anonimleştirilir → Customer.Anonymize
 *   - denetim kaydı korunur → audit_logs, TenantPurge'ün koruduğu tablo
 * Süre veya davranış değişirse ÖNCE o kaynak, sonra bu sayfa güncellenmelidir.
 */
export const metadata: Metadata = {
  title: 'Hesap Silme Talebi — BeautyAsist',
  description:
    'BeautyAsist hesabınızı ve verilerinizi nasıl sileceğiniz, hangi verilerin silindiği, hangilerinin yasal olarak saklandığı ve 30 günlük bekleme süresi hakkında bilgi.',
}

export default function HesapSilmePage() {
  return (
    <LegalPage
      eyebrow="Hesap ve veri"
      title="Hesap Silme Talebi"
      intro={
        <>
          Bu sayfa, <strong>{company.brand}</strong> hesabınızın ve ilgili verilerin nasıl
          silineceğini açıklar. Silme talebini <strong>uygulama içinden</strong> ya da{' '}
          <strong>e-posta ile</strong> oluşturabilirsiniz; ikisi de aynı sonucu doğurur.
          Aşağıda hangi verilerin silindiğini, hangilerinin yasal zorunluluk nedeniyle
          saklandığını ve ne kadar süre içinde uygulandığını bulacaksınız.
        </>
      }
    >
      <LegalSection title="1. Hangi hesabı siliyorsunuz?">
        <p>
          Uygulamada iki farklı hesap türü vardır ve silme davranışları birbirinden farklıdır.
          Aşağıdaki adımlardan size uyanı izleyin.
        </p>
        <LegalFacts
          rows={[
            {
              label: 'İşletme hesabı',
              value: (
                <>
                  Güzellik merkezi / klinik sahibi ya da yöneticisi olarak kullanıyorsanız.
                  Silme <strong>30 gün sonra</strong> uygulanır, bu süre içinde geri alınabilir.
                </>
              ),
            },
            {
              label: 'Müşteri hesabı',
              value: (
                <>
                  Bir güzellik merkezinden randevu alan kişi olarak kullanıyorsanız. Silme{' '}
                  <strong>anında</strong> uygulanır ve geri alınamaz.
                </>
              ),
            },
          ]}
        />
      </LegalSection>

      <LegalSection title="2. Uygulama içinden silme">
        <p>
          <strong>İşletme hesabı:</strong> Panel → <em>Ayarlar</em> → sayfanın en altındaki{' '}
          <em>Hesabımı sil</em> bölümü. Talebi onaylamak için şifrenizi ve bir onay metnini
          girmeniz istenir — tek tıkla silinmez.
        </p>
        <p>
          <strong>Müşteri hesabı:</strong> Mobil uygulamada müşteri portalı →{' '}
          <em>Hesabımı sil</em>. Aynı onay adımları geçerlidir.
        </p>
      </LegalSection>

      <LegalSection title="3. E-posta ile silme (hesabınıza erişemiyorsanız)">
        <p>
          Uygulamayı kaldırdıysanız veya hesabınıza giriş yapamıyorsanız, talebinizi{' '}
          <MailLink /> adresine gönderebilirsiniz. Kimliğinizi doğrulayabilmemiz için
          e-postada şunları belirtin:
        </p>
        <LegalList
          items={[
            'Hesapta kayıtlı ad-soyad,',
            'Hesapta kayıtlı telefon numarası veya e-posta adresi,',
            'İşletme hesabıysa merkezin/kliniğin adı,',
            'Talebinizin "hesap silme" olduğunu açıkça belirten bir cümle.',
          ]}
        />
        <p>
          Talebinizi aldıktan sonra kimlik doğrulamasını tamamlar ve{' '}
          <strong>en geç 30 gün içinde</strong> işleme alırız. Doğrulama yapılamazsa hesabı
          silemeyiz — bu, başkasının sizin hesabınızı sildirmesini önleyen bir korumadır.
        </p>
      </LegalSection>

      <LegalSection title="4. İşletme hesabında ne olur?">
        <p>
          Talep anında <strong>uygulanmaz</strong>. Önce kaydedilir ve{' '}
          <strong>30 günlük bekleme süresi</strong> başlar. Bu süre boyunca paneliniz normal
          çalışır; verilerinizi Raporlar sayfasından dışa aktarabilir ve talebinizi tek tıkla
          geri alabilirsiniz. Süre dolduğunda kurumunuz ve verisi kalıcı olarak silinir.
        </p>
        <p>Bekleme süresi bilinçlidir: muhasebe verisini dışa aktarmak, mali müşavire danışmak ve
          yanlış tıklamadan dönmek için makul bir süre bırakır.</p>
        <p>Süre dolduğunda silinenler:</p>
        <LegalList
          items={[
            'Kurum kaydı, şubeler ve tüm kullanıcı (personel) hesapları,',
            'Müşteri kayıtları, randevular, seanslar ve tedavi günlüğü fotoğrafları,',
            'Paket/hizmet satışları, stok, kasa ve finans kayıtları,',
            'Bildirim token’ları ve oturum kayıtları.',
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Müşteri hesabında ne olur?">
        <p>
          Silme <strong>anında</strong> uygulanır ve geri alınamaz. Hesabınız kapanır, bir daha
          giriş yapamazsınız.
        </p>
        <p>
          Kişisel verileriniz silinir: <strong>ad-soyad, telefon, e-posta, doğum tarihi,
          cinsiyet, notlar ve fotoğrafınız</strong> kayıttan kaldırılır ve kayıt
          anonimleştirilir.
        </p>
        <p>
          Kayıt satırının kendisi silinmez, anonim hâle getirilir. Bunun nedeni, kaydın geçmiş
          randevu, adisyon ve tahsilat kayıtlarının bağlandığı düğüm olmasıdır; tamamen
          silinmesi işletmenin kapanmış kasa ve tahsilat defterini dayanaksız bırakırdı.
          Anonimleştirmeden sonra bu kayıtlar <strong>sizinle ilişkilendirilemez</strong>.
        </p>
      </LegalSection>

      <LegalSection title="6. Silinmeyen veriler ve saklama süresi">
        <p>
          Bazı kayıtları yasal yükümlülük nedeniyle silemeyiz. Bunlar pazarlama için
          kullanılmaz ve erişim yalnızca zorunlu hâllerle sınırlıdır:
        </p>
        <LegalFacts
          rows={[
            {
              label: 'Fatura ve mali kayıtlar',
              value:
                'Vergi Usul Kanunu ve Türk Ticaret Kanunu uyarınca saklanır (kural olarak 5–10 yıl). Abonelik faturaları ve ödeme kayıtları bu kapsamdadır.',
            },
            {
              label: 'Denetim (audit) kayıtları',
              value:
                'Silme talebinin kendisi dâhil güvenlik kayıtları korunur; böylece bir hesabın ne zaman ve kimin talebiyle silindiği sonradan doğrulanabilir.',
            },
            {
              label: 'Anonimleştirilmiş işlem kayıtları',
              value:
                'Randevu ve tahsilat geçmişi kimliksiz biçimde kalır. Bu kayıtlar artık bir kişiye bağlanamaz.',
            },
          ]}
        />
        <p>
          Saklama süresi dolan kayıtlar silinir veya geri döndürülemez şekilde
          anonimleştirilir. Ayrıntılar için{' '}
          <a className="font-medium text-[#EF6F94] underline underline-offset-2" href="/gizlilik">
            Gizlilik Politikası
          </a>{' '}
          sayfamıza bakabilirsiniz.
        </p>
      </LegalSection>

      <LegalSection title="7. Sorularınız için">
        <p>
          Silme süreciyle ilgili her türlü soru için <MailLink /> adresinden bize
          ulaşabilirsiniz. Destek saatlerimiz: {company.supportHours}.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
