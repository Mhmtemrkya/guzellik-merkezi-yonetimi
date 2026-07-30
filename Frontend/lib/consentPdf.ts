// Onam formu PDF'i (pdfmake) — KVKK metniyle aynı markalı dil.
//
// İki kullanım vardır:
//  • Şablon önizlemesi: boş form, ıslak imza için çizgili alan (henüz müşteri yok).
//  • İmzalı belge: müşteri adı, işaretlenen onay maddeleri, imza görseli, tarih/saat ve
//    cihaz bilgisi basılır — "müşterinin dosyasına eklenen" nüsha budur.
import pdfMakeOrig from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { TDocumentDefinitions, Content, StyleDictionary, Margins } from 'pdfmake/interfaces'
import type { ConsentAnswer, ConsentQuestion } from '@/lib/types'

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
  ink: '#2F1724',
  inkSoft: '#666666',
  ok: '#2F7A63',
}

function trDate(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}
function trDateTime(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isRenderableImage(data: string | null | undefined): data is string {
  return !!data && /^data:image\/(png|jpe?g|gif|bmp)/i.test(data)
}

/** Metni pdfmake içeriğine çevirir: "1. BAŞLIK" → başlık, "• madde" → madde imi, diğer → paragraf. */
function textToContent(text: string): Content[] {
  const out: Content[] = []
  let bullets: string[] = []
  const flush = (): void => {
    if (bullets.length) {
      out.push({ ul: bullets.map((b) => ({ text: b, style: 'bullet' })), margin: m(0, 0, 6, 6) })
      bullets = []
    }
  }
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    if (line.startsWith('•') || line.startsWith('-')) { bullets.push(line.replace(/^[•-]\s*/, '')); continue }
    flush()
    if (/^\d+\.\s/.test(line)) out.push({ text: line, style: 'heading', margin: m(8, 0, 4, 0) })
    else out.push({ text: line, style: 'para', margin: m(0, 0, 6, 0) })
  }
  flush()
  return out
}

/**
 * Metindeki yer tutucuları doldurur. Şablon yazarken kullanılabilecek anahtarlar:
 * {{musteri}} {{hizmet}} {{tarih}} {{kurum}} {{personel}}
 */
export function fillConsentPlaceholders(
  body: string,
  values: { customerName?: string | null; serviceName?: string | null; institutionName?: string | null; staffName?: string | null; date?: Date },
): string {
  const date = values.date ?? new Date()
  return (body || '')
    .replace(/\{\{\s*musteri\s*\}\}/gi, values.customerName || '.....................')
    .replace(/\{\{\s*hizmet\s*\}\}/gi, values.serviceName || '.....................')
    .replace(/\{\{\s*kurum\s*\}\}/gi, values.institutionName || '.....................')
    .replace(/\{\{\s*personel\s*\}\}/gi, values.staffName || '.....................')
    .replace(/\{\{\s*tarih\s*\}\}/gi, trDate(date))
}

export interface ConsentPdfOptions {
  institutionName: string
  logoData?: string | null
  title: string
  body: string
  checkItems?: string[]
  /** İmzalı belgede müşterinin işaretlediği maddeler; boşsa madde listesi kutucuklu (boş) basılır. */
  checkedItems?: string[]
  /** Evet/Hayır soruları (şablon önizlemesinde boş kutucuklu basılır). */
  questions?: ConsentQuestion[]
  /** İmzalı belgede müşterinin verdiği yanıtlar. */
  answers?: ConsentAnswer[]
  customerName?: string | null
  serviceName?: string | null
  staffName?: string | null
  staffNotes?: string | null
  /** base64 PNG imza — verilirse ıslak imza çizgisi yerine görsel basılır. */
  signatureImage?: string | null
  signedAt?: string | null
  signerName?: string | null
}

export function generateConsentPdf(options: ConsentPdfOptions): void {
  const signedAt = options.signedAt ? new Date(options.signedAt) : null
  const isSigned = Boolean(options.signatureImage || signedAt)
  const content: Content[] = []

  // ---- Başlık bloğu ----
  const headerStack: Content[] = [
    { text: options.institutionName || 'Kurum', style: 'orgName' },
    { text: options.title, style: 'docKind', margin: m(0, 2, 0, 0) },
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

  content.push({ canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 1.4, color: COLORS.roseGold }], margin: m(0, 0, 0, 4) })
  content.push({
    columns: [
      { text: 'BeautyAsist ile hazırlanmıştır', style: 'meta' },
      { text: isSigned && signedAt ? `İmza: ${trDateTime(signedAt)}` : `Düzenlenme: ${trDate(new Date())}`, style: 'meta', alignment: 'right' },
    ],
    margin: m(0, 0, 0, 10),
  })

  // ---- Bağlam kutusu (müşteri / hizmet / personel) ----
  const info: string[][] = []
  if (options.customerName) info.push(['Müşteri', options.customerName])
  if (options.serviceName) info.push(['İşlem', options.serviceName])
  if (options.staffName) info.push(['Uygulayan', options.staffName])
  if (info.length > 0) {
    content.push({
      table: {
        widths: ['auto', '*'],
        body: info.map(([k, v]) => [
          { text: k, style: 'infoKey' },
          { text: v, style: 'infoValue' },
        ]),
      },
      layout: 'noBorders',
      margin: m(0, 0, 0, 10),
    })
  }

  // ---- Metin ----
  content.push(...textToContent(options.body))

  // ---- Onay maddeleri ----
  const items = options.checkItems ?? []
  if (items.length > 0) {
    const checkedSet = new Set((options.checkedItems ?? []).map((x) => x.trim().toLocaleLowerCase('tr')))
    content.push({ text: 'Onay Maddeleri', style: 'heading', margin: m(12, 0, 4, 0) })
    content.push({
      ul: items.map((item) => {
        const checked = checkedSet.has(item.trim().toLocaleLowerCase('tr'))
        return { text: `${checked ? '[X]' : '[  ]'}  ${item}`, style: checked ? 'checkOn' : 'bullet' }
      }),
      type: 'none',
      margin: m(0, 0, 8, 2),
    })
  }

  // ---- Evet / Hayır soruları ----
  // İmzalı belgede yanıtlar, şablon önizlemesinde boş kutucuklar basılır — ıslak imzalı
  // kullanımda müşteri kâğıt üzerinde işaretleyebilsin.
  const questions = options.questions ?? []
  const answers = options.answers ?? []
  if (questions.length > 0 || answers.length > 0) {
    const rows = questions.length > 0
      ? questions.map((q) => ({ text: q.text, hit: answers.find((a) => a.id === q.id) }))
      : answers.map((a) => ({ text: a.text, hit: a }))
    content.push({ text: 'Sorular ve Yanıtlar', style: 'heading', margin: m(12, 0, 4, 0) })
    content.push({
      table: {
        widths: ['*', 'auto'],
        body: rows.map(({ text, hit }) => [
          {
            stack: [
              { text, style: 'para' },
              ...(hit?.note ? [{ text: hit.note, style: 'meta', margin: m(2, 0, 0, 0) } as Content] : []),
            ],
          },
          {
            text: hit ? (hit.answer ? 'EVET' : 'HAYIR') : '[  ] Evet   [  ] Hayır',
            style: hit ? (hit.answer ? 'answerYes' : 'answerNo') : 'bullet',
            alignment: 'right',
          },
        ]),
      },
      layout: {
        hLineWidth: (i: number, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => '#E7D6DE',
        paddingTop: () => 4,
        paddingBottom: () => 4,
        paddingLeft: () => 0,
        paddingRight: () => 0,
      },
      margin: m(0, 0, 8, 2),
    })
  }

  if (options.staffNotes) {
    content.push({ text: 'Uygulama Notları', style: 'heading', margin: m(10, 0, 4, 0) })
    content.push({ text: options.staffNotes, style: 'para', margin: m(0, 0, 8, 0) })
  }

  // ---- İmza alanı ----
  if (isRenderableImage(options.signatureImage)) {
    content.push({
      columns: [
        {
          stack: [
            { text: options.signerName || options.customerName || 'Müşteri', style: 'signLabel' },
            { image: options.signatureImage, fit: [190, 70], margin: m(4, 0, 0, 0) },
            { canvas: [{ type: 'rect', x: 0, y: 0, w: 190, h: 0.8, color: COLORS.inkSoft }], margin: m(2, 0, 0, 0) },
            { text: 'Müşteri imzası', style: 'meta', margin: m(3, 0, 0, 0) },
          ],
        },
        {
          stack: [
            { text: 'Onay bilgileri', style: 'signLabel' },
            { text: signedAt ? trDateTime(signedAt) : '—', style: 'signValue', margin: m(4, 0, 0, 0) },
            { text: 'Dijital olarak tablet üzerinden imzalanmıştır.', style: 'meta', margin: m(2, 0, 0, 0) },
          ],
        },
      ],
      columnGap: 28,
      margin: m(20, 0, 0, 0),
    })
  } else {
    content.push({
      columns: [
        { stack: [{ text: 'Müşteri Ad Soyad', style: 'signLabel' }, { text: '\n__________________________', style: 'signValue' }] },
        { stack: [{ text: 'Tarih & İmza', style: 'signLabel' }, { text: '\n__________________________', style: 'signValue' }] },
      ],
      columnGap: 24,
      margin: m(24, 0, 0, 0),
    })
  }

  const styles: StyleDictionary = {
    orgName: { fontSize: 18, bold: true, color: COLORS.burgundy },
    docKind: { fontSize: 11, color: COLORS.roseGold, bold: true },
    meta: { fontSize: 8, color: COLORS.inkSoft },
    heading: { fontSize: 10.5, bold: true, color: COLORS.burgundy },
    para: { fontSize: 9.5, color: COLORS.ink, lineHeight: 1.25 },
    bullet: { fontSize: 9.5, color: COLORS.ink, lineHeight: 1.2 },
    checkOn: { fontSize: 9.5, color: COLORS.ok, bold: true, lineHeight: 1.2 },
    answerYes: { fontSize: 9.5, color: COLORS.ok, bold: true },
    answerNo: { fontSize: 9.5, color: COLORS.roseGold, bold: true },
    infoKey: { fontSize: 8.5, color: COLORS.inkSoft, bold: true, margin: m(0, 0, 8, 0) },
    infoValue: { fontSize: 9.5, color: COLORS.ink },
    signLabel: { fontSize: 8.5, color: COLORS.inkSoft, bold: true },
    signValue: { fontSize: 9.5, color: COLORS.ink },
  }

  const docDefinition: TDocumentDefinitions = {
    info: {
      title: `${options.institutionName} - ${options.title}`,
      author: options.institutionName,
      subject: options.title,
      creator: 'BeautyAsist',
    },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 46] as [number, number, number, number],
    content,
    styles,
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: COLORS.ink },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `${options.institutionName} · ${options.title}`, fontSize: 7.5, color: COLORS.inkSoft, margin: m(40, 0, 0, 0) },
        { text: `BeautyAsist · Sayfa ${currentPage}/${pageCount}`, fontSize: 7.5, color: COLORS.inkSoft, alignment: 'right', margin: m(0, 0, 40, 0) },
      ],
      margin: m(0, 14, 0, 0),
    }),
  }

  const slug = (s: string): string => (s || '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  const name = [slug(options.customerName || ''), slug(options.title) || 'Onam-Formu', todayIso()].filter(Boolean).join('-')
  pdfMake.createPdf(docDefinition).download(`${name}.pdf`)
}
