// Giriş bilgileri belgesinin YERLEŞİMİ — pdfmake çalışma zamanından bağımsız.
//
// TASARIM KAYNAĞI: `FORM BA.png` / `FORM 2.png` (dolu + boş şablon). Belge şablonun ÜZERİNE
// çizilmez, yeniden kurulur. Sebep: şablondaki "KURUM YÖNETİCİSİ GİRİŞ BİLGİLERİ" başlığı
// görsele gömülü; personel varyantı için metnin değişebilir olması gerekiyor. Ayrıca e-posta ve
// şifrenin PDF'ten KOPYALANABİLMESİ isteniyor — görsel basılan bir sayfada metin seçilemezdi.
//
// Şablondan yalnız iki marka izi görsel olarak taşınır (serif logotip ve Maydanoz Yazılım
// logosu); ikisi de projede yazı tipi/vektör olarak yok.
//
// Ölçüler kaynak görselden (1062×1555 px) ölçülüp A4 punto'suna çevrildi: 1 px = 0.5605 pt.
// Yorumlardaki px değerleri o ölçümlerdir; sayıları değiştirirken kaynağa bakın.
//
// NEDEN AYRI DOSYA: yerleşim tarayıcı olmadan da üretilebilsin — tasarımın şablona uyduğu
// gerçek bir PDF render edilerek doğrulandı (bkz. tools/render-credentials-pdf.mjs).
//
// ⚠️ `relativePosition` KULLANILMAZ. pdfmake onunla yalnız ÇİZİMİ kaydırır; ölçüm ve sayfalama
// düğümün ESKİ yerinde kalır. İlk denemede kart içerikleri kartın altına ölçülüp ikinci sayfaya
// taştı, tablo dolguları ve görseller hiç çizilmedi. Doğru araç NEGATİF ÜST BOŞLUK: akış imleci
// gerçekten yukarı çekilir, ölçüm ile çizim aynı yeri gösterir.
import type { TDocumentDefinitions, Content, Margins } from 'pdfmake/interfaces'

// Kaynak tasarımdan pipetle alınan renkler.
const COLORS = {
  /** Üst bandın pembesi. Serif logotip görseli bu zeminle birlikte kırpıldı — renk DEĞİŞTİRİLEMEZ. */
  band: '#E093A6',
  cardFill: '#FFEBEB',
  cardBorder: '#E093A6',
  ink: '#381628',
  inkSoft: '#6E5460',
  navy: '#001C35',
  white: '#FFFFFF',
}

// pdfmake margin formatı: [left, top, right, bottom]
const m = (left: number, top: number, right: number, bottom: number): Margins => [left, top, right, bottom]

// ---- Sayfa geometrisi (pt) ---------------------------------------------------------------
const PAGE_W = 595.28

/** Pembe bandın yüksekliği (395 px). Beyaz logo kutusu bunun ALTINA taşar — tasarımın imzası. */
const BAND_H = 221
/** Bant içeriğinin üstten boşluğu (74 px) ve sabit blok yüksekliği (kutunun taşmasıyla birlikte). */
const BAND_PAD_T = 41.5
const BAND_BLOCK_H = 193.2

const CARD_X = 24.7 // 44 px
const CARD_W = 472 // 886−44 px
const CARD_PAD_X = 20
const CARD_PAD_T = 20
const CARD_PAD_B = 18
const INNER_W = CARD_W - CARD_PAD_X * 2

/**
 * Alt bant: kaynakta 98 px (54.9 pt); tasarım A4'ten ~30 pt uzun olduğu için biraz sıkıştırıldı.
 * Sayfanın alt kenar boşluğuna TAM oturur (bkz. pageMargins) — böylece bant sayfa sonuna kadar
 * iner ve son kartla arasında beyaz bir şerit kalmaz.
 */
const FOOTER_H = 56

export interface CredentialsPdfData {
  /** Banda basılan ana başlık, örn. 'KURUM YÖNETİCİSİ GİRİŞ BİLGİLERİ' */
  heading: string
  /** Kişi bloğunun üst etiketi, örn. 'YÖNETİCİ' / 'PERSONEL' */
  subjectLabel: string
  personName: string
  email: string
  initialPassword: string
  tenantName: string
  branchName?: string | null
  /** Görev/ünvan — şube adıyla aynı satırda gösterilir. */
  roleLine?: string | null
  permissions?: Array<{ key: string; label: string }>
  /**
   * Kurum logosu (data-URL). Salon Profili'nden yüklenir; yeni kurum formunda da verilebilir.
   * Yoksa beyaz kutu HİÇ çizilmez — boş bir dikdörtgen "bozuk" görünürdü.
   */
  logoDataUrl?: string | null
  /**
   * Panele giriş adresi. Varsayılan yayın adresidir; `window.location.origin` KULLANILMAZ —
   * belge indirilip aylarca saklanır, panelin o anki adresi (localhost, önizleme) ölü bağlantı olurdu.
   */
  loginUrl?: string
  /** İndirilen dosya adının kök kısmı (varsayılan: personName) */
  filenameBase?: string
}

/** Belgeye gömülecek marka görselleri (data-URL). Hepsi opsiyoneldir — inmezse belge yine üretilir. */
export interface CredentialsPdfAssets {
  wordmark?: string | null
  maydanoz?: string | null
  badge?: string | null
}

function slugFilename(name: string): string {
  return name
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function credentialsFilename(data: CredentialsPdfData): string {
  const base = data.filenameBase || data.personName
  return `BeautyAsist-${slugFilename(base)}-giris-bilgileri.pdf`
}

/**
 * İçeriği SABİT yükseklikte bir kutuya oturtur.
 *
 * Zemin (canvas) akışta `height` kadar yer kaplar; içerik negatif üst boşlukla onun üzerine
 * çekilir ve kendi yüksekliği `heights` ile sabitlenir. Böylece akış imleci daima
 * `height − padB` ilerler: kart yükseklikleri hesaplanabilir kalır, içerik gerçek akışta
 * olduğu için tablo dolguları / görseller / madde imleri doğru çizilir ve sayfalama şaşmaz.
 */
function overlayBox(shell: Content, height: number, padTop: number, padLeft: number, innerWidth: number, inner: Content[], gapBelow: number, marginLeft: number): Content {
  return {
    stack: [
      shell,
      {
        table: {
          widths: [innerWidth],
          heights: [height - padTop - CARD_PAD_B],
          body: [[{ stack: inner, border: [false, false, false, false] }]],
        },
        layout: 'noBorders',
        margin: m(padLeft, -height + padTop, 0, 0),
      },
    ],
    margin: m(marginLeft, 0, 0, gapBelow),
  }
}

/** Yuvarlak köşeli pembe kart (tasarımın iki büyük bloğu). */
function card(height: number, inner: Content[], gapBelow: number): Content {
  const shell: Content = {
    canvas: [{
      type: 'rect',
      x: 0, y: 0, w: CARD_W, h: height, r: 14,
      color: COLORS.cardFill, lineColor: COLORS.cardBorder, lineWidth: 1.4,
    }],
  }
  return overlayBox(shell, height, CARD_PAD_T, CARD_PAD_X, INNER_W, inner, gapBelow, CARD_X)
}

/** Kart başlığı + altındaki ince çizgi (tasarımdaki desen). */
function cardTitle(text: string): Content[] {
  return [
    { text, fontSize: 17, bold: true, color: COLORS.ink, characterSpacing: 2.5 },
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: INNER_W - 32, y2: 0, lineWidth: 0.9, lineColor: COLORS.ink }],
      margin: m(4, 9, 0, 13),
    },
  ]
}

export function buildCredentialsDoc(
  data: CredentialsPdfData,
  assets: CredentialsPdfAssets,
  fallbackLoginUrl: string,
): TDocumentDefinitions {
  const { wordmark, maydanoz, badge } = assets
  const link = data.loginUrl || fallbackLoginUrl
  const meta = [data.roleLine, data.branchName].filter(Boolean).join('   ·   ')
  const content: Content[] = []
  /**
   * Yetki listesi varsa (personel belgesi) yerleşim SIKIŞTIRILIR: üç kart tek sayfaya sığsın.
   * Yönetici belgesinde kart yoktur ve boşluklar tasarımdaki ferah ölçülere döner.
   */
  const compact = Boolean(data.permissions && data.permissions.length > 0)

  // ---- 1) Üst pembe bant + marka + kurum logosu ---------------------------------------------
  const brandColumn: Content[] = [
    wordmark
      // Serif logotip — projede serif yazı tipi yok, marka izi görsel olarak taşınıyor. Görsel
      // pembe zeminiyle kırpıldı: bandın rengiyle birebir aynı olduğu için sınırı görünmez.
      ? { image: wordmark, width: 254.5 } // 454 px
      : { text: 'Beauty Asist', fontSize: 30, bold: true, color: COLORS.ink },
    // Başlık: 236 px → bandın üstünden 132 pt; logotipin altına 11 pt boşlukla oturur.
    { text: data.heading, fontSize: 17, bold: true, color: COLORS.ink, lineHeight: 1.05, margin: m(0, 11, 0, 0) },
    { text: data.tenantName, fontSize: 15, italics: true, color: COLORS.ink, margin: m(0, 9, 0, 0) },
  ]

  // Beyaz logo kutusu — bandın altına taşar. Logo yoksa HİÇ çizilmez (boş kutu "bozuk" görünürdü).
  const logoCell: Content = data.logoDataUrl
    ? {
        stack: [
          {
            canvas: [{
              type: 'rect', x: 0, y: 0, w: 140, h: 145,
              color: COLORS.white, lineColor: COLORS.cardBorder, lineWidth: 0.8,
            }],
          },
          { image: data.logoDataUrl, fit: [118, 123], alignment: 'center', margin: m(11, -134, 11, 0) },
        ],
        margin: m(0, 48.2, 0, 0), // 160 px − 74 px
      }
    : { text: '' }

  content.push({
    stack: [
      { canvas: [{ type: 'rect', x: 0, y: 0, w: PAGE_W, h: BAND_H, color: COLORS.band }] },
      {
        // SABİT YÜKSEKLİK: logo olsun olmasın bandın altındaki akış aynı yerden devam etsin.
        table: {
          widths: [355, 140],
          heights: [BAND_BLOCK_H],
          body: [[
            { stack: brandColumn, border: [false, false, false, false] },
            // Hücre kenarlığı YOK: bandın üstünde tablo çizgisi görünmemeli.
            Object.assign({ border: [false, false, false, false] }, logoCell) as Content,
          ]],
        },
        layout: 'noBorders',
        margin: m(34.8, -BAND_H + BAND_PAD_T, 0, 0), // 62 px, 74 px
      },
    ],
  })

  // ---- 2) Kişi bloğu -----------------------------------------------------------------------
  content.push({
    stack: [
      { text: data.subjectLabel, fontSize: 20, bold: true, color: COLORS.ink, characterSpacing: 5 },
      { text: data.personName, fontSize: 19, color: COLORS.ink, characterSpacing: 1.5, margin: m(0, 14, 0, 0) },
      ...(meta ? [{ text: meta, fontSize: 11.5, color: COLORS.inkSoft, margin: m(2, 8, 0, 0) }] : []),
    ],
    // 41 px sol. Dikey boşluklar tasarımdan; personel belgesinde üç kart sığsın diye sıkıştırılır.
    margin: m(23, compact ? 18 : 40, 40, compact ? 10 : 26),
  })

  // ---- 3) Giriş bilgileri kartı --------------------------------------------------------------
  content.push(card(compact ? 180 : 186, [
    ...cardTitle('GİRİŞ BİLGİLERİ'),
    {
      columns: [
        { width: 78, text: 'E-POSTA:', fontSize: 12, color: COLORS.ink, characterSpacing: 1.6, margin: m(0, 2, 0, 0) },
        { text: data.email, fontSize: 13, color: COLORS.ink },
      ],
      margin: m(4, 0, 0, 12),
    },
    {
      columns: [
        { width: 108, text: 'GEÇİCİ ŞİFRE:', fontSize: 12, color: COLORS.ink, characterSpacing: 1.6, margin: m(0, 5, 0, 0) },
        {
          /*
           * Şifre çipi — tasarımdaki koyu kutu (280..469 px × 828..867 px).
           *
           * CANVAS, TABLO DOLGUSU DEĞİL: hücre `fillColor`'ı negatif üst boşlukla kaydırılan bir
           * ağaçta ESKİ yerine boyanıyor (aynı sınıf kusur `relativePosition`'da da vardı) —
           * çip görünmüyor, beyaz şifre pembe zeminde okunmaz kalıyordu. Genişlik metinden
           * kestirilir; fazlası zararsız boşluk, azı taşmadır.
           */
          stack: [
            {
              canvas: [{
                type: 'rect', x: 0, y: 0, r: 3,
                w: Math.max(96, Math.round(data.initialPassword.length * 7.4) + 20), h: 24,
                color: COLORS.ink,
              }],
            },
            {
              text: data.initialPassword,
              fontSize: 13, bold: true, color: COLORS.white,
              margin: m(10, -19, 0, 0),
            },
          ],
        },
      ],
      margin: m(4, 0, 0, 8),
    },
    { text: 'İlk girişte şifreyi değiştirmeniz istenecektir', fontSize: 10.5, color: COLORS.inkSoft, margin: m(4, 0, 0, 12) },
    {
      text: [
        { text: 'SİSTEME GİRİŞ LİNKİ:  ', fontSize: 12, bold: true, color: COLORS.ink, characterSpacing: 1.2 },
        // Gerçek bağlantı: PDF okuyucuda tıklanabilir, metin olarak da kopyalanabilir.
        { text: link, fontSize: 11, color: COLORS.ink, link, decoration: 'underline' },
      ],
      margin: m(8, 0, 0, 0),
    },
    // Kart yüksekliği 186: tasarımdaki 331 px = 185.5 pt ile aynı hedef.
    // Kartlar arası boşluk: yönetici belgesinde tasarımdaki ferah aralık, personel belgesinde
    // (yetki kartı da var) üç kart tek sayfaya sığacak kadar dar.
  ], compact ? 6 : 62))

  // ---- 4) Yetkiler (personel belgesinde) -----------------------------------------------------
  // BU BÖLÜM KORUNDU: tasarım görselinde yok ama personel belgesinin taşıdığı bilgi kaybolamaz.
  // Aynı kart dilinde, iki kolon.
  if (data.permissions && data.permissions.length > 0) {
    const labels = data.permissions.map((p) => p.label)
    // Uzun listede ÜÇ kolon: iki kolonda 12+ yetki kartı büyütüp güvenlik kartını ikinci sayfaya
    // itiyordu. Kolon sayısı yükseklikten önce gelir — belge tek sayfada kalsın.
    const cols = labels.length > 6 ? 3 : 2
    const per = Math.ceil(labels.length / cols)
    const height = 59 + Math.round(per * 11.5) + CARD_PAD_B
    const slices = Array.from({ length: cols }, (_, i) => labels.slice(i * per, (i + 1) * per))
    content.push(card(height, [
      ...cardTitle('TANIMLI YETKİLER'),
      {
        columns: slices.map((slice) =>
          slice.length > 0
            ? { ul: slice, fontSize: 9.5, lineHeight: 1.2, color: COLORS.ink, markerColor: COLORS.cardBorder }
            : { text: '' },
        ),
        columnGap: 14,
        margin: m(4, 0, 0, 0),
      },
    ], 6))
  }

  // ---- 5) Güvenlik kartı ---------------------------------------------------------------------
  content.push(card(compact ? 120 : 140, [
    ...cardTitle('GÜVENLİK'),
    {
      ul: [
        'İlk girişten sonra şifrenizi mecburen değiştirmeniz gerekir.',
        'Bu belgeyi güvenli bir yerde saklayın, kimseyle paylaşmayın.',
        'Şifrenizi unutursanız yöneticinizden yeni şifre talep edin.',
      ],
      fontSize: compact ? 10 : 10.5,
      bold: true,
      color: COLORS.ink,
      markerColor: COLORS.ink,
      lineHeight: compact ? 1.25 : 1.4,
      margin: m(4, 0, 0, 0),
    },
  ], 0))

  // ---- 6) Alt bant (her sayfada) ---------------------------------------------------------------
  const footer = (): Content => ({
    stack: [
      { canvas: [{ type: 'rect', x: 0, y: 0, w: PAGE_W, h: FOOTER_H, color: COLORS.navy }] },
      {
        columns: [
          maydanoz ? { width: 78, image: maydanoz, fit: [78, 30] } : { width: 78, text: '' },
          {
            width: 300,
            text:
              'Beauty Asist, işletmenizi geleceğe taşıyan Maydanoz Yazılım teknolojisiyle yanınızda. '
              + 'Güzelliğin yönetimi artık daha akıllı. Beauty Asist, Maydanoz Yazılım teknolojisiyle '
              + 'işletmenizin tüm süreçlerini tek bir çatı altında kolaylaştırmak ve daha hızlı, daha '
              + 'akıllı yönetmeniz için geliştirildi.',
            fontSize: 6.2,
            bold: true,
            color: COLORS.white,
            lineHeight: 1.28,
          },
          // Rozet bandın ÜSTÜNE taşar (tasarımın imzası) — negatif üst boşluk bandın dışına çıkarır.
          badge
            ? { width: 60, image: badge, fit: [52, 52], alignment: 'right', margin: m(0, -14, 0, 0) }
            : { width: 60, text: '' },
        ],
        columnGap: 12,
        margin: m(24, -FOOTER_H + 9, 20, 0),
      },
    ],
  })

  const docDefinition: TDocumentDefinitions = {
    info: {
      title: `${data.personName} - Giriş Bilgileri`,
      author: 'BeautyAsist',
      subject: data.tenantName,
    },
    pageSize: 'A4',
    // Alt kenar boşluğu = bandın TAM yüksekliği: bant sayfa sonuna dayanır, içerik banda girmez.
    pageMargins: [0, 0, 0, FOOTER_H],
    // NOT: `background: { canvas }` KULLANMA — pdfmake 0.3.x'te tarayıcıda crash ediyor.
    content,
    footer,
    defaultStyle: { font: 'Roboto', fontSize: 10, color: COLORS.ink },
  }

  return docDefinition
}
