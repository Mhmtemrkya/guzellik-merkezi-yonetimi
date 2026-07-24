// KVKK aydınlatma metni için markalı PDF üretimi (pdfmake).
// - Üstte kurum logosu (yüklenmişse) + kurum adı
// - BeautyAsist marka imzası (üst şerit + alt bilgi)
// - Metin; numaralı başlıklar, madde imleri ve paragraflar olarak biçimlenir
import pdfMakeOrig from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { TDocumentDefinitions, Content, StyleDictionary, Margins } from 'pdfmake/interfaces'

const m = (top: number, right: number, bottom: number, left: number): Margins => [top, right, bottom, left]

type VfsShape = { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }
const vfsCandidate = pdfFonts as unknown as VfsShape
const vfs = vfsCandidate.pdfMake?.vfs || vfsCandidate.vfs || {}
interface PdfMakeRuntime {
  vfs: Record<string, string>
  createPdf: (def: TDocumentDefinitions) => { download: (filename: string) => void }
}
const pdfMake = pdfMakeOrig as unknown as PdfMakeRuntime
pdfMake.vfs = vfs

const COLORS = {
  burgundy: '#2F1724',
  roseGold: '#D48AA7',
  rose: '#F0AAC2',
  cream: '#FFF4F8',
  ink: '#2F1724',
  inkSoft: '#666666',
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function trDate(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

// data:image/... URL'sinin pdfmake tarafından desteklenen bir tür olup olmadığını kaba kontrol
function isRenderableImage(data: string | null | undefined): data is string {
  return !!data && /^data:image\/(png|jpe?g|gif|bmp)/i.test(data)
}

// Metni pdfmake içeriğine dönüştür: "1. BAŞLIK" → başlık, "• madde" → madde imi, diğer → paragraf
function textToContent(text: string): Content[] {
  const out: Content[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let bulletBuffer: string[] = []

  const flushBullets = (): void => {
    if (bulletBuffer.length) {
      out.push({ ul: bulletBuffer.map((b) => ({ text: b, style: 'bullet' })), margin: m(0, 0, 6, 6) })
      bulletBuffer = []
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushBullets()
      continue
    }
    if (line.startsWith('•') || line.startsWith('-')) {
      bulletBuffer.push(line.replace(/^[•-]\s*/, ''))
      continue
    }
    flushBullets()
    // Numaralı başlık: "1. METİN" — genelde tümü büyük harf
    if (/^\d+\.\s/.test(line)) {
      out.push({ text: line, style: 'heading', margin: m(8, 0, 4, 0) })
    } else {
      out.push({ text: line, style: 'para', margin: m(0, 0, 6, 0) })
    }
  }
  flushBullets()
  return out
}

export interface KvkkPdfOptions {
  institutionName: string
  text: string
  logoData?: string | null
}

export function generateKvkkPdf(options: KvkkPdfOptions): void {
  const content: Content[] = []

  // ---- Başlık bloğu: logo (varsa) + kurum adı + marka ----
  const headerStack: Content[] = [
    { text: options.institutionName || 'Kurum', style: 'orgName' },
    { text: 'Kişisel Verilerin Korunması Aydınlatma Metni', style: 'docKind', margin: m(0, 2, 0, 0) },
  ]

  if (isRenderableImage(options.logoData)) {
    content.push({
      columns: [
        { image: options.logoData, fit: [70, 70], width: 70 },
        { stack: headerStack, margin: m(6, 0, 0, 12) },
      ],
      columnGap: 4,
      margin: m(0, 0, 0, 8),
    })
  } else {
    content.push({ stack: headerStack, margin: m(0, 0, 0, 8) })
  }

  // Rose-gold ayraç
  content.push({ canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 1.4, color: COLORS.roseGold }], margin: m(0, 0, 0, 4) })
  content.push({
    columns: [
      { text: 'BeautyAsist ile hazırlanmıştır', style: 'meta' },
      { text: `Düzenlenme: ${trDate(new Date())}`, style: 'meta', alignment: 'right' },
    ],
    margin: m(0, 0, 0, 12),
  })

  // ---- Metin ----
  content.push(...textToContent(options.text))

  // ---- İmza alanı ----
  content.push({
    columns: [
      { stack: [{ text: 'Müşteri Ad Soyad', style: 'signLabel' }, { text: '\n__________________________', style: 'signLine' }] },
      { stack: [{ text: 'Tarih & İmza', style: 'signLabel' }, { text: '\n__________________________', style: 'signLine' }] },
    ],
    columnGap: 24,
    margin: m(24, 0, 0, 0),
  })

  const styles: StyleDictionary = {
    orgName: { fontSize: 18, bold: true, color: COLORS.burgundy },
    docKind: { fontSize: 10, color: COLORS.roseGold, bold: true },
    meta: { fontSize: 8, color: COLORS.inkSoft, italics: true },
    heading: { fontSize: 10.5, bold: true, color: COLORS.burgundy },
    para: { fontSize: 9.5, color: COLORS.ink, lineHeight: 1.25 },
    bullet: { fontSize: 9.5, color: COLORS.ink, lineHeight: 1.2 },
    signLabel: { fontSize: 8.5, color: COLORS.inkSoft, bold: true },
    signLine: { fontSize: 9, color: COLORS.ink },
  }

  const docDefinition: TDocumentDefinitions = {
    info: {
      title: `${options.institutionName} - KVKK Aydınlatma Metni`,
      author: options.institutionName,
      subject: 'KVKK Aydınlatma ve Açık Rıza Metni',
      creator: 'BeautyAsist',
    },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 46] as [number, number, number, number],
    content,
    styles,
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: COLORS.ink },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `${options.institutionName} · KVKK Aydınlatma Metni`, fontSize: 7.5, color: COLORS.inkSoft, italics: true, margin: m(40, 0, 0, 0) },
        { text: `BeautyAsist · Sayfa ${currentPage}/${pageCount}`, fontSize: 7.5, color: COLORS.inkSoft, alignment: 'right', margin: m(0, 0, 40, 0) },
      ],
      margin: m(0, 14, 0, 0),
    }),
  }

  const safe = (options.institutionName || 'Kurum').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'Kurum'
  pdfMake.createPdf(docDefinition).download(`${safe}-KVKK-Aydinlatma-${todayIso()}.pdf`)
}
