/**
 * Giriş bilgileri belgesini TARAYICISIZ render eder — tasarım doğrulaması içindir.
 *
 * `npx tsc` yerleşim hakkında hiçbir şey söylemez: taşan metin, kartın dışına düşen çip ya da
 * ikinci sayfaya kayan alt bant derleyiciden geçer. Bu betik gerçek bir PDF üretir; çıktı
 * `FORM BA.png` ile yan yana karşılaştırılır.
 *
 * Kullanım:  node tools/render-credentials-pdf.mjs <çıktı-dizini>
 * Üretilenler: yonetici.pdf, personel.pdf, uzun-ad.pdf
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
// pdfmake 0.3.x sunucu API'si: tekil örnek, `fonts` atanır ve `createPdf` PDFKit belgesi döndürür.
const pdfmake = require_('pdfmake')

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = process.argv[2] || join(here, '.render-out')
mkdirSync(outDir, { recursive: true })

// Yerleşim modülü TypeScript; tek dosyalık bir bundle'a çevrilip içeri alınır.
const bundle = await build({
  entryPoints: [join(root, 'lib', 'credentialsPdfDoc.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})
const modUrl = 'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
const { buildCredentialsDoc } = await import(modUrl)

const dataUrl = (rel, mime = 'image/png') =>
  `data:${mime};base64,${readFileSync(join(root, 'public', rel)).toString('base64')}`

const assets = {
  templateBase: dataUrl('credentials/form-base.png'),
}

const fonts = {
  Roboto: {
    normal: join(root, 'node_modules/pdfmake/build/fonts/Roboto/Roboto-Regular.ttf'),
    bold: join(root, 'node_modules/pdfmake/build/fonts/Roboto/Roboto-Medium.ttf'),
    italics: join(root, 'node_modules/pdfmake/build/fonts/Roboto/Roboto-Italic.ttf'),
    bolditalics: join(root, 'node_modules/pdfmake/build/fonts/Roboto/Roboto-MediumItalic.ttf'),
  },
}
pdfmake.fonts = fonts
pdfmake.setLocalAccessPolicy(() => true)
pdfmake.setUrlAccessPolicy(() => false)

// Kurum logosu yerine örnek bir kare (gerçek logo verilmediğinde kutunun hiç çizilmediğini de
// ayrıca sınamak için "uzun-ad" senaryosunda logo verilmiyor).
const sampleLogo = dataUrl('logo.png')

const cases = [
  ['yonetici', {
    heading: 'KURUM YÖNETİCİSİ GİRİŞ BİLGİLERİ',
    subjectLabel: 'YÖNETİCİ',
    personName: 'Burcu BOZKIR',
    email: 'burcubozkir94@gmail.com',
    initialPassword: '75zpnD7P@e',
    tenantName: 'Burcu Bozkır Beauty',
    branchName: 'Merkez Şube',
    logoDataUrl: sampleLogo,
  }],
  ['personel', {
    heading: 'PERSONEL GİRİŞ BİLGİLERİ',
    subjectLabel: 'PERSONEL',
    personName: 'Ayşe KAYA',
    email: 'ayse.kaya@burcu-bozkir-beauty.beautyasist.app',
    initialPassword: 'Xk4mQ2Rt@9',
    tenantName: 'Burcu Bozkır Beauty',
    branchName: 'Merkez Şube',
    roleLine: 'Cilt Bakım Uzmanı',
    logoDataUrl: sampleLogo,
    permissions: [
      { key: 'a', label: 'Randevular' }, { key: 'b', label: 'Müşteriler' },
      { key: 'c', label: 'Adisyon' }, { key: 'd', label: 'Paket & Hizmet' },
      { key: 'e', label: 'Stok' }, { key: 'f', label: 'Ön Muhasebe' },
      { key: 'g', label: 'Raporlar' }, { key: 'h', label: 'Çizelge' },
      { key: 'i', label: 'Bekleme Listesi' }, { key: 'j', label: 'Hediye Çeki' },
    ],
  }],
  ['uzun-ad', {
    heading: 'KURUM YÖNETİCİSİ GİRİŞ BİLGİLERİ',
    subjectLabel: 'YÖNETİCİ',
    personName: 'Ayşegül Hümeyra Karaosmanoğlu',
    email: 'aysegul.humeyra.karaosmanoglu@cok-uzun-kurum-adi.beautyasist.app',
    initialPassword: 'Qw9!zXp2@Lm',
    tenantName: 'Nişantaşı Güzellik ve Estetik Merkezi Anonim Şirketi',
    branchName: 'Nişantaşı Merkez Şube',
    // Logo YOK: beyaz kutunun hiç çizilmediği doğrulanır.
  }],
]

for (const [name, data] of cases) {
  const doc = buildCredentialsDoc(data, assets, 'https://beautyasist.com/login')
  const file = join(outDir, `${name}.pdf`)
  // OutputDocumentServer.write(): akışı dosyaya boşaltır ve söz döndürür.
  await pdfmake.createPdf(doc).write(file)
  console.log('yazıldı:', file)
}
