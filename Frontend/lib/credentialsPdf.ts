// Giriş bilgileri "kimlik kartı" PDF'i — hem personel hem kurum yöneticisi için generic.
// Premium tasarım: full-bleed bordo başlık, rose-gold aksanlar, vurgulu şifre çipi.
// pdfmake kullanılır — Türkçe karakter desteği için (Roboto vfs).
import pdfMakeOrig from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { TDocumentDefinitions, Content, Margins } from 'pdfmake/interfaces'

type VfsShape = { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }
const vfsCandidate = pdfFonts as unknown as VfsShape
const vfs = vfsCandidate.pdfMake?.vfs || vfsCandidate.vfs || {}
interface PdfMakeRuntime {
  vfs: Record<string, string>
  createPdf: (def: TDocumentDefinitions) => { download: (filename: string) => void }
}
const pdfMake = pdfMakeOrig as unknown as PdfMakeRuntime
pdfMake.vfs = vfs

// Güncel Armonessa paleti: bordo + rose-gold + krem.
const COLORS = {
  burgundy: '#2F1724',
  burgundyDeep: '#1E0E17',
  rose: '#C85776',
  roseGold: '#D48AA7',
  roseSoft: '#F0AAC2',
  cream: '#FFF7FA',
  creamCard: '#FFF0F5',
  creamNote: '#FBE9F0',
  ink: '#2F1724',
  inkSoft: '#8A6E7B',
  line: '#EAD3DD',
}

// pdfmake margin formatı: [left, top, right, bottom]
const m = (left: number, top: number, right: number, bottom: number): Margins => [left, top, right, bottom]

// A4 (pt)
const PAGE_W = 595.28
const SIDE = 44 // içerik yan boşluğu
const BODY_W = PAGE_W - SIDE * 2 // 507.28
const CARD_INNER = BODY_W - 40 // kart iç genişliği (cell padding 20+20)

export interface CredentialsPdfData {
  /** Banner ana başlığı, örn. 'PERSONEL GİRİŞ BİLGİLERİ' */
  heading: string
  /** Kişi bilgi kutusundaki etiket, örn. 'PERSONEL' / 'YÖNETİCİ' */
  subjectLabel: string
  personName: string
  email: string
  initialPassword: string
  tenantName: string
  branchName?: string | null
  /** Opsiyonel ikinci satır (örn. görev/ünvan) etiket + değer */
  roleLineLabel?: string
  roleLine?: string | null
  permissions?: Array<{ key: string; label: string }>
  /** İndirilen dosya adının kök kısmı (varsayılan: personName) */
  filenameBase?: string
}

function trDateTime(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

function slugFilename(name: string): string {
  return name
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function generateCredentialsPdf(data: CredentialsPdfData): void {
  const issuedAt = new Date()
  const content: Content[] = []

  // 0) Dekoratif köşe çemberi — eskiden pageMargins `background: { canvas }` ile çiziliyordu;
  // pdfmake 0.3.x tarayıcıda bu kullanımı `e.forEach is not a function` ile patlatıyordu.
  // Aynı çizimi içeriğin içinde `absolutePosition` ile veriyoruz (akışı etkilemez, ilk eleman = en altta).
  content.push({
    canvas: [{ type: 'ellipse', x: PAGE_W, y: 842, r1: 150, r2: 150, color: COLORS.creamNote }],
    absolutePosition: { x: 0, y: 0 },
  })

  // 1) Üst ince rose-gold şerit (full-bleed)
  content.push({ canvas: [{ type: 'rect', x: 0, y: 0, w: PAGE_W, h: 5, color: COLORS.rose }], margin: m(0, 0, 0, 0) })

  // 2) Başlık bandı (full-bleed bordo)
  content.push({
    table: {
      widths: ['*'],
      body: [[
        {
          stack: [
            { text: 'ARMONESSA', fontSize: 12, bold: true, color: COLORS.roseGold, characterSpacing: 6 },
            { text: 'BEAUTY & WELLNESS TECHNOLOGY', fontSize: 6.5, color: COLORS.roseSoft, characterSpacing: 2.4, margin: m(0, 3, 0, 0) },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 64, y2: 0, lineWidth: 1, lineColor: COLORS.roseGold }], margin: m(0, 13, 0, 13) },
            { text: data.heading, fontSize: 22, bold: true, color: COLORS.cream, characterSpacing: 0.4 },
            { text: data.tenantName, fontSize: 12, italics: true, color: COLORS.roseGold, margin: m(0, 6, 0, 0) },
          ],
          fillColor: COLORS.burgundy,
          margin: m(SIDE, 30, SIDE, 32),
        },
      ]],
    },
    layout: 'noBorders',
    margin: m(0, 0, 0, 0),
  })

  // 3) Meta satırı
  content.push({
    columns: [
      { text: 'Bu belge yalnızca bir kez oluşturulur.', fontSize: 8, italics: true, color: COLORS.inkSoft },
      { text: trDateTime(issuedAt), fontSize: 8, color: COLORS.inkSoft, alignment: 'right' },
    ],
    margin: m(SIDE, 20, SIDE, 16),
  })

  // 4) Kişi bloğu
  const roleBranch = [data.roleLine, data.branchName].filter(Boolean).join('   ·   ')
  content.push({
    stack: [
      { text: data.subjectLabel, fontSize: 8, bold: true, color: COLORS.rose, characterSpacing: 3 },
      { text: data.personName, fontSize: 19, bold: true, color: COLORS.burgundy, margin: m(0, 5, 0, 0) },
      ...(roleBranch ? [{ text: roleBranch, fontSize: 10.5, color: COLORS.inkSoft, margin: m(0, 3, 0, 0) }] : []),
    ],
    margin: m(SIDE, 4, SIDE, 14),
  })
  content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: BODY_W, y2: 0, lineWidth: 0.8, lineColor: COLORS.line }], margin: m(SIDE, 0, SIDE, 18) })

  // 5) Giriş bilgileri kartı (vurgulu)
  content.push({
    table: {
      widths: ['*'],
      body: [[
        {
          stack: [
            { text: 'GİRİŞ BİLGİLERİ', fontSize: 8.5, bold: true, color: COLORS.rose, characterSpacing: 3 },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CARD_INNER, y2: 0, lineWidth: 0.8, lineColor: COLORS.line }], margin: m(0, 11, 0, 15) },
            {
              columns: [
                { width: 92, text: 'E-POSTA', fontSize: 8, bold: true, color: COLORS.inkSoft, characterSpacing: 1, margin: m(0, 3, 0, 0) },
                { text: data.email, fontSize: 13, bold: true, color: COLORS.burgundy },
              ],
              margin: m(0, 0, 0, 16),
            },
            { text: 'GEÇİCİ ŞİFRE', fontSize: 8, bold: true, color: COLORS.inkSoft, characterSpacing: 1, margin: m(0, 0, 0, 6) },
            {
              table: { widths: ['auto'], body: [[{ text: data.initialPassword, fontSize: 17, bold: true, color: COLORS.cream, fillColor: COLORS.burgundy, characterSpacing: 2, margin: m(18, 10, 18, 10) }]] },
              layout: 'noBorders',
            },
            { text: 'İlk girişte bu şifreyi değiştirmeniz istenecektir.', fontSize: 8.5, italics: true, color: COLORS.inkSoft, margin: m(0, 9, 0, 0) },
          ],
          fillColor: COLORS.creamCard,
          margin: m(20, 20, 20, 20),
        },
      ]],
    },
    layout: { hLineWidth: () => 1.2, vLineWidth: () => 1.2, hLineColor: () => COLORS.roseGold, vLineColor: () => COLORS.roseGold },
    margin: m(SIDE, 0, SIDE, 20),
  })

  // 6) Yetkiler (varsa) — iki kolon
  if (data.permissions && data.permissions.length > 0) {
    const labels = data.permissions.map((p) => p.label)
    const half = Math.ceil(labels.length / 2)
    content.push({
      stack: [
        { text: 'TANIMLI YETKİLER', fontSize: 8.5, bold: true, color: COLORS.rose, characterSpacing: 3, margin: m(0, 0, 0, 8) },
        {
          columns: [
            { ul: labels.slice(0, half), fontSize: 10, color: COLORS.ink, markerColor: COLORS.roseGold },
            half < labels.length
              ? { ul: labels.slice(half), fontSize: 10, color: COLORS.ink, markerColor: COLORS.roseGold }
              : { text: '' },
          ],
          columnGap: 24,
        },
      ],
      margin: m(SIDE, 0, SIDE, 20),
    })
  }

  // 7) Güvenlik notu — sol aksan barlı
  content.push({
    table: {
      widths: [3, '*'],
      body: [[
        { text: '', fillColor: COLORS.roseGold },
        {
          stack: [
            { text: 'GÜVENLİK', fontSize: 8, bold: true, color: COLORS.rose, characterSpacing: 2, margin: m(0, 0, 0, 5) },
            {
              ul: [
                'İlk girişten sonra şifrenizi mecburen değiştirmeniz gerekir.',
                'Bu belgeyi güvenli bir yerde saklayın, kimseyle paylaşmayın.',
                'Şifrenizi unutursanız yöneticinizden yeni şifre talep edin.',
              ],
              fontSize: 9,
              color: COLORS.inkSoft,
              markerColor: COLORS.roseGold,
            },
          ],
          fillColor: COLORS.cream,
          margin: m(14, 12, 14, 12),
        },
      ]],
    },
    layout: 'noBorders',
    margin: m(SIDE, 0, SIDE, 22),
  })

  // 8) Footer
  content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: BODY_W, y2: 0, lineWidth: 0.8, lineColor: COLORS.line }], margin: m(SIDE, 4, SIDE, 8) })
  content.push({
    columns: [
      { text: 'ARMONESSA', fontSize: 8, bold: true, color: COLORS.roseGold, characterSpacing: 2 },
      { text: 'Güzellik Merkezi Yönetim Sistemi', fontSize: 8, color: COLORS.inkSoft, alignment: 'right' },
    ],
    margin: m(SIDE, 0, SIDE, 0),
  })

  const docDefinition: TDocumentDefinitions = {
    info: {
      title: `${data.personName} - Giriş Bilgileri`,
      author: 'Armonessa',
      subject: data.tenantName,
    },
    pageSize: 'A4',
    pageMargins: [0, 0, 0, 40],
    // NOT: `background: { canvas }` KULLANMA — pdfmake 0.3.x'te tarayıcıda crash ediyor.
    // Dekoratif köşe çemberi yukarıda content'in ilk elemanı olarak absolutePosition ile çiziliyor.
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10, color: COLORS.ink },
  }

  const base = data.filenameBase || data.personName
  const filename = `Armonessa-${slugFilename(base)}-giris-bilgileri.pdf`
  pdfMake.createPdf(docDefinition).download(filename)
}
