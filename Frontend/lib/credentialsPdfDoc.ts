// Giriş bilgileri belgesinin YERLEŞİMİ — pdfmake çalışma zamanından bağımsız.
//
// ŞABLON ZEMİNDİR, YENİDEN ÇİZİLMEZ.
//
// Belge önce pdfmake ile "tasarıma benzer" biçimde yeniden kuruluyordu; bant, kartlar, çizgiler
// ve alt bant elle çiziliyordu. Sonuç yaklaşıktı: sayfa oranı A4 (0.707) iken tasarım 0.683,
// başlık fontu tasarımda başka bir sans iken elimizde yalnız Roboto var, kart yuvarlaklıkları ve
// alt bant ölçüleri gözle görülür biçimde kayıyordu. Belgenin tasarımın BİREBİR aynısı olması
// istendiği için tasarım dosyasının KENDİSİ tam sayfa zemin olarak basılır; üzerine yalnız
// değişken alanlar yazılır. Bant, kartlar, çizgiler, şifre kutusu, Maydanoz ve Ba logoları,
// serif logotip — hepsi tasarımın kendisidir, dolayısıyla birebirdir.
//
// SAYFA BOYUTU TASARIMIN ORANIDIR (A4 DEĞİL): 1062 × 1555 px → 595.28 × 871.4 pt. A4'e
// sığdırmak zemini ya kırpardı ya da kenarlarda beyaz bırakırdı; ikisi de "birebir" değil.
//
// İKİ ŞABLON:
//   • form-yonetici.png — "KURUM YÖNETİCİSİ GİRİŞ BİLGİLERİ" ve "YÖNETİCİ" zemine BASILI.
//   • form-personel.png — başlık ve kişi etiketi YOK; personel varyantında bu ikisini biz yazarız.
//
// E-posta ve şifre GERÇEK METİNDİR (zemine gömülü değil): PDF'ten seçilip kopyalanabilir.
//
// Koordinatlar 1062 × 1555 px'lik tasarımdan piksel ölçülüp `px()` ile punto'ya çevrilir;
// değiştirmeden önce `design/credentials/` altındaki kaynaklara bakın.
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces'

/** Tasarım tuvali (px) ve sayfa ölçüsü (pt). */
const DESIGN_W = 1062
const DESIGN_H = 1555
export const PAGE_W = 595.28
export const PAGE_H = Math.round((DESIGN_H / DESIGN_W) * PAGE_W * 10) / 10 // 871.4

/** Tasarım pikselini sayfa punto'suna çevirir (1 px = 0.5605 pt). */
const px = (v: number): number => Math.round((v * PAGE_W / DESIGN_W) * 10) / 10

/** Şablondan pipetle alınan renkler — üzerine yazdığımız metinler bunlarla uyumlu olmalı. */
const INK = '#381628'
const INK_SOFT = '#6E5460'
const WHITE = '#FFFFFF'

export interface CredentialsPdfData {
  /** Banda basılan ana başlık. Yönetici şablonunda ZEMİNDE basılıdır, yazılmaz. */
  heading: string
  /** Kişi bloğunun üst etiketi ('YÖNETİCİ' / 'PERSONEL'). Yönetici şablonunda zemindedir. */
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
   * Yoksa şablondaki beyaz kutu boş kalır (kutu zeminde basılı olduğu için gizlenemez).
   */
  logoDataUrl?: string | null
  /**
   * Panele giriş adresi. Varsayılan yayın adresidir; `window.location.origin` KULLANILMAZ —
   * belge indirilip aylarca saklanır, panelin o anki adresi (localhost) ölü bağlantı olurdu.
   */
  loginUrl?: string
  /** İndirilen dosya adının kök kısmı (varsayılan: personName) */
  filenameBase?: string
}

/** Belgeye gömülecek şablonlar (data-URL). Şablon inmezse belge zeminsiz çıkar. */
export interface CredentialsPdfAssets {
  /** Kurum yöneticisi şablonu (`/credentials/form-yonetici.png`). */
  templateOwner?: string | null
  /** Personel şablonu (`/credentials/form-personel.png`). */
  templateStaff?: string | null
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
 * PUNTOLAR TASARIMDAN GERİ HESAPLANDI: her alanın tasarımdaki metin genişliği ölçülüp aynı
 * genişliği veren punto seçildi (kurum adı 284 px, kişi adı 339 px, şube 128 px, e-posta 351 px).
 * Gözle "yakın" seçilen puntolar belgeyi tasarımdan gözle görülür biçimde küçük gösteriyordu.
 */

/**
 * Metni verilen genişliğe sığdıracak puntoyu seçer (punto başına ~0.52 em ortalama genişlik).
 *
 * NEDEN KESTİRİM: yazdığımız değerler zeminde BASILI kutuların içine oturmak zorunda; kutuyu
 * büyütme şansımız yok. Uzun kurum adı / e-posta puntoyu kademeli küçülterek sığar.
 */
function fitFontSize(text: string, maxWidth: number, base: number, min: number, factor = 0.52): number {
  let size = base
  while (size > min && text.length * size * factor > maxWidth) size -= 0.5
  return size
}

/** Mutlak konumlu içerik — zemindeki alanın üstüne yazar, akışa girmez. */
function at(x: number, y: number, content: Record<string, unknown>): Content {
  return { ...content, absolutePosition: { x, y } } as unknown as Content
}

export function buildCredentialsDoc(
  data: CredentialsPdfData,
  assets: CredentialsPdfAssets,
  fallbackLoginUrl: string,
): TDocumentDefinitions {
  const link = data.loginUrl || fallbackLoginUrl
  const meta = [data.roleLine, data.branchName].filter(Boolean).join('   ·   ')
  /** Personel belgesinde başlık ve kişi etiketi zeminde YOK — bizim yazmamız gerekir. */
  const isStaff = data.subjectLabel !== 'YÖNETİCİ'
  const template = isStaff ? assets.templateStaff : assets.templateOwner

  const content: Content[] = []

  // ---- Zemin: tasarımın kendisi, tam sayfa ---------------------------------------------------
  if (template) {
    content.push({ image: template, width: PAGE_W, absolutePosition: { x: 0, y: 0 } })
  }

  // ---- Personel varyantında zeminde olmayan iki metin ----------------------------------------
  if (isStaff) {
    // Başlık — tasarımda 74 px sol, 236 px üst.
    content.push(at(px(74), px(232), {
      text: data.heading,
      fontSize: fitFontSize(data.heading, px(620), 17, 13),
      bold: true,
      color: INK,
    }))
    // Kişi etiketi — 41 px sol, 491 px üst.
    content.push(at(px(41), px(489), {
      text: data.subjectLabel,
      fontSize: 20,
      bold: true,
      characterSpacing: 5,
      color: INK,
    }))
  }

  // ---- Kurum adı (bandın içinde, başlığın altında; tasarımda 71 px × 291 px) ------------------
  content.push(at(px(71), px(288), {
    text: data.tenantName,
    fontSize: fitFontSize(data.tenantName, px(620), 18.5, 11),
    italics: true,
    color: INK,
    width: px(620),
  }))

  // ---- Kurum logosu: şablondaki beyaz kutunun içine (728..978 px × 160..418 px) ---------------
  if (data.logoDataUrl) {
    content.push(at(px(742), px(174), {
      image: data.logoDataUrl,
      fit: [px(222), px(230)],
      alignment: 'center',
      width: px(222),
    }))
  }

  // ---- Kişi bilgileri (552 px ve 603 px) ------------------------------------------------------
  content.push(at(px(42), px(545), {
    text: data.personName,
    fontSize: fitFontSize(data.personName, px(620), 27, 14),
    characterSpacing: 1.5,
    color: INK,
    width: px(620),
  }))
  if (meta) {
    content.push(at(px(43), px(599), { text: meta, fontSize: 12.7, color: INK_SOFT, width: px(620) }))
  }

  // ---- Giriş bilgileri kartındaki değerler ----------------------------------------------------
  // E-posta: etiket zeminde 92..237 px; değer 243 px'ten başlar.
  content.push(at(px(245), px(776), {
    text: data.email,
    fontSize: fitFontSize(data.email, px(600), 16.5, 9.5),
    color: INK,
    width: px(590),
  }))

  /*
   * Şifre: zemindeki koyu kutunun (280..469 px × 828..867 px) içine BEYAZ yazılır.
   *
   * SOLA DAYALI: tasarımda metin kutunun sol kenarından 2 px içeriden başlıyor ve kutuyu
   * neredeyse dolduruyor. `alignment: 'center'` DENENDİ ve OLMADI — mutlak konumlu düğümde
   * pdfmake hizalamayı verdiğimiz kutuya değil sayfaya göre yapıp metni kutunun dışına attı.
   * KATSAYI 0.78: kalın Roboto'nun gerçek ortalama karakter genişliği ölçüldü. Varsayılan 0.52
   * ile 11 karakterlik bir şifre 16 punto'da hiç küçülmeden çizilip çipi ~90 px aşıyordu (canlı
   * çıktıda iki yandan kırpılmış görünüyordu). Sığmak, kutuyu doldurmaktan önce gelir.
   */
  content.push(at(px(296), px(833), {
    text: data.initialPassword,
    fontSize: fitFontSize(data.initialPassword, px(177), 14, 7, 0.78),
    bold: true,
    color: WHITE,
  }))

  // Giriş linki: "SİSTEME GİRİŞ LİNKİ:" zeminde 97..420 px; değer hemen sağından.
  content.push(at(px(432), px(929), {
    text: link,
    fontSize: fitFontSize(link, px(430), 13, 8.5),
    color: INK,
    link,
    decoration: 'underline',
    width: px(420),
  }))

  // ---- Yetkiler (personel belgesi) — İKİNCİ SAYFADA -------------------------------------------
  // Tasarımda böyle bir alan yok; personel belgesinin taşıdığı bilgi de kaybolamaz. Zemin
  // bozulmasın diye ayrı sayfaya yazılır.
  if (data.permissions && data.permissions.length > 0) {
    const labels = data.permissions.map((p) => p.label)
    const cols = labels.length > 6 ? 3 : 2
    const per = Math.ceil(labels.length / cols)
    const slices = Array.from({ length: cols }, (_, i) => labels.slice(i * per, (i + 1) * per))

    content.push({ text: '', pageBreak: 'before' })
    content.push(at(px(44), px(90), {
      text: 'TANIMLI YETKİLER',
      fontSize: 17,
      bold: true,
      characterSpacing: 2.5,
      color: INK,
    }))
    content.push(at(px(44), px(132), {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: px(477), y2: 0, lineWidth: 0.9, lineColor: INK }],
    }))
    content.push(at(px(44), px(160), {
      columns: slices.map((slice) =>
        slice.length > 0
          ? { ul: slice, fontSize: 10.5, lineHeight: 1.35, color: INK, markerColor: INK }
          : { text: '' },
      ),
      columnGap: px(26),
      width: px(842),
    }))
    content.push(at(px(44), px(160) + per * 15 + 26, {
      text: `${data.personName} · ${data.tenantName}`,
      fontSize: 10,
      color: INK_SOFT,
    }))
  }

  return {
    info: {
      title: `${data.personName} - Giriş Bilgileri`,
      author: 'BeautyAsist',
      subject: data.tenantName,
    },
    // Sayfa TASARIMIN oranında (A4 değil) — zemin kırpılmasın, kenarda beyaz kalmasın.
    pageSize: { width: PAGE_W, height: PAGE_H },
    pageMargins: [0, 0, 0, 0],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10, color: INK },
  }
}
