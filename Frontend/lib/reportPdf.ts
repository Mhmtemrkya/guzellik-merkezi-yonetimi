// pdfmake — built-in Roboto fontu Türkçe karakterleri (ı, ş, ç, ğ, ü, ö, İ, Ş, Ç, Ğ, Ü, Ö) destekler.
// jsPDF'teki Latin-1 encoding sorununu önlemek için bu kütüphaneye geçildi.
import pdfMakeOrig from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { TDocumentDefinitions, Content, TableCell, StyleDictionary, Margins } from 'pdfmake/interfaces'

// Margin helper (TypeScript tuple zorunluluğu için)
const m = (top: number, right: number, bottom: number, left: number): Margins => [top, right, bottom, left]

// vfs_fonts'un farklı sürüm shape'i: bazı sürümlerde { pdfMake: { vfs } } bazılarında direkt vfs
type VfsShape = { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }
const vfsCandidate = pdfFonts as unknown as VfsShape
const vfs = vfsCandidate.pdfMake?.vfs || vfsCandidate.vfs || {}

interface PdfMakeRuntime {
  vfs: Record<string, string>
  createPdf: (def: TDocumentDefinitions) => { download: (filename: string) => void }
}
const pdfMake = pdfMakeOrig as unknown as PdfMakeRuntime
pdfMake.vfs = vfs

// ---------------------------------------------------------------------------
// Brand palette
// ---------------------------------------------------------------------------

const COLORS = {
  burgundy: '#2F1724',
  burgundyDark: '#160B12',
  roseGold: '#D48AA7',
  rose: '#F0AAC2',
  cream: '#FFF4F8',
  creamSoft: '#FFEDF3',
  ink: '#2F1724',
  inkSoft: '#666666',
  emerald: '#065F46',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trDate(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

function trDateTime(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTL(value: number | string | null | undefined): string {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(amount)
}

// ---------------------------------------------------------------------------
// Types (public API aynı kalsın)
// ---------------------------------------------------------------------------

export type PdfCellValue = string | number | boolean | Date | null | undefined

export type PdfColumnType = 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'percent' | 'boolean'

export interface PdfColumn<T> {
  header: string
  type?: PdfColumnType
  align?: 'left' | 'center' | 'right'
  width?: number
  accessor: (row: T) => PdfCellValue
}

export interface PdfSection<T> {
  title: string
  subtitle?: string
  rows: T[]
  columns: PdfColumn<T>[]
  totals?: Partial<Record<string, PdfCellValue>>
}

export interface PdfStatBlock {
  label: string
  value: string
  hint?: string
}

export interface PdfReportOptions {
  filenameBase: string
  title: string
  context: string
  periodLabel: string
  stats?: PdfStatBlock[]
  sections: PdfSection<unknown>[]
}

function formatCell(type: PdfColumnType | undefined, value: PdfCellValue): string {
  if (value === null || value === undefined || value === '') return ''
  switch (type) {
    case 'currency':
      return formatTL(typeof value === 'number' ? value : Number(value))
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value)
      return new Intl.NumberFormat('tr-TR').format(n)
    }
    case 'percent': {
      const n = typeof value === 'number' ? value : Number(value)
      return `%${n.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`
    }
    case 'date':
      return trDate(value as Date | string)
    case 'datetime':
      return trDateTime(value as Date | string)
    case 'boolean':
      return value === true || value === 'true' || value === 1 ? 'Evet' : 'Hayır'
    default:
      return String(value)
  }
}

function cellAlign(col: PdfColumn<unknown>): 'left' | 'center' | 'right' {
  if (col.align) return col.align
  if (col.type === 'currency' || col.type === 'number' || col.type === 'percent') return 'right'
  return 'left'
}

// ---------------------------------------------------------------------------
// PDF generator
// ---------------------------------------------------------------------------

export function generateReportPdf(options: PdfReportOptions): void {
  const content: Content[] = []

  // ============== KAPAK BLOĞU ==============
  // Burgundy bant: marka + büyük başlık
  content.push({
    table: {
      widths: ['*'],
      body: [
        [
          {
            stack: [
              { text: 'ARMONESSA', style: 'brandTag', margin: m(0, 8, 0, 4) },
              { text: options.title.toUpperCase(), style: 'reportTitle' },
              { text: options.context, style: 'contextLine', margin: m(0, 6, 0, 4) },
            ],
            fillColor: COLORS.burgundy,
            color: COLORS.cream,
          },
        ],
      ],
    },
    layout: 'noBorders',
    margin: m(0, 0, 0, 0),
  })

  // Rose-gold ince çizgi
  content.push({
    canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 1.4, color: COLORS.roseGold }],
    margin: m(0, 0, 0, 4),
  })

  // Dönem + rapor tarihi (sağa hizalı küçük metin)
  content.push({
    columns: [
      { text: `Dönem: ${options.periodLabel}`, style: 'meta' },
      { text: `Rapor tarihi: ${trDate(new Date())}`, style: 'meta', alignment: 'right' },
    ],
    margin: m(0, 0, 0, 14),
  })

  // ============== STAT KARTLARI ==============
  if (options.stats && options.stats.length > 0) {
    const cols = options.stats.length
    const cardWidth = (515 - (cols - 1) * 6) / cols

    content.push({
      columns: options.stats.map((s) => ({
        width: cardWidth,
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  { text: s.label.toUpperCase(), style: 'statLabel' },
                  { text: s.value, style: 'statValue', margin: m(0, 4, 0, 0) },
                  ...(s.hint ? [{ text: s.hint, style: 'statHint', margin: m(0, 2, 0, 0) }] : []),
                ],
                fillColor: COLORS.creamSoft,
                margin: m(10, 8, 10, 8),
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
          paddingLeft: () => 0,
          paddingRight: () => 0,
        },
      })),
      columnGap: 6,
      margin: m(0, 0, 0, 14),
    })
  }

  // ============== BÖLÜMLER (tablolar) ==============
  options.sections.forEach((section, idx) => {
    if (idx > 0) {
      content.push({ text: '', margin: m(0, 6, 0, 0) })
    }

    // Section başlığı
    content.push({
      stack: [
        { text: section.title, style: 'sectionTitle' },
        ...(section.subtitle ? [{ text: section.subtitle, style: 'sectionSubtitle', margin: m(0, 1, 0, 0) }] : []),
      ],
      margin: m(0, 4, 0, 6),
    })

    // Tablo
    const head: TableCell[] = section.columns.map((c) => ({
      text: c.header,
      style: 'tableHeader',
      alignment: 'center',
    }))

    const body: TableCell[][] = [head]

    section.rows.forEach((row, rowIdx) => {
      const zebra = rowIdx % 2 === 1
      const cells: TableCell[] = section.columns.map((col) => ({
        text: formatCell(col.type, col.accessor(row)),
        style: 'tableBody',
        alignment: cellAlign(col),
        fillColor: zebra ? COLORS.creamSoft : COLORS.cream,
      }))
      body.push(cells)
    })

    // Toplam satırı
    if (section.totals) {
      const totalCells: TableCell[] = section.columns.map((col) => {
        const key = col.header
        const val = section.totals?.[key]
        const text = val !== undefined && val !== null ? formatCell(col.type, val) : ''
        return {
          text: text || (section.columns.indexOf(col) === 0 ? 'TOPLAM' : ''),
          style: 'tableFooter',
          alignment: cellAlign(col),
        }
      })
      body.push(totalCells)
    }

    // Sütun genişlikleri
    const widths: (string | number)[] = section.columns.map((col) => {
      if (col.width) return col.width
      // Auto width — pdfmake için '*' karakteri
      return '*'
    })

    if (section.rows.length === 0) {
      body.push([
        {
          text: 'Bu dönemde kayıt bulunmuyor.',
          colSpan: section.columns.length,
          alignment: 'center',
          italics: true,
          color: COLORS.inkSoft,
          margin: m(0, 8, 0, 8),
        },
        ...new Array(section.columns.length - 1).fill({}),
      ])
    }

    content.push({
      table: { headerRows: 1, widths, body, dontBreakRows: true },
      layout: {
        hLineWidth: () => 0.3,
        vLineWidth: () => 0.3,
        hLineColor: () => '#EDD7E0',
        vLineColor: () => '#F3DDE6',
        paddingTop: () => 4,
        paddingBottom: () => 4,
        paddingLeft: () => 5,
        paddingRight: () => 5,
      },
      margin: m(0, 0, 0, 4),
    })
  })

  // ============== DOCUMENT DEFINITION ==============
  const styles: StyleDictionary = {
    brandTag: {
      fontSize: 9,
      bold: true,
      color: COLORS.rose,
      characterSpacing: 4,
    },
    reportTitle: {
      fontSize: 22,
      bold: true,
      color: COLORS.cream,
      characterSpacing: 1,
    },
    contextLine: {
      fontSize: 9.5,
      color: COLORS.rose,
      italics: true,
    },
    meta: {
      fontSize: 8.5,
      color: COLORS.inkSoft,
      italics: true,
    },
    statLabel: {
      fontSize: 7.5,
      color: COLORS.inkSoft,
      bold: true,
      characterSpacing: 1,
    },
    statValue: {
      fontSize: 14,
      color: COLORS.burgundy,
      bold: true,
    },
    statHint: {
      fontSize: 7,
      color: COLORS.inkSoft,
      italics: true,
    },
    sectionTitle: {
      fontSize: 11.5,
      color: COLORS.burgundy,
      bold: true,
    },
    sectionSubtitle: {
      fontSize: 8.5,
      color: COLORS.inkSoft,
      italics: true,
    },
    tableHeader: {
      fontSize: 9,
      bold: true,
      color: COLORS.cream,
      fillColor: COLORS.burgundy,
    },
    tableBody: {
      fontSize: 8.5,
      color: COLORS.ink,
    },
    tableFooter: {
      fontSize: 9,
      bold: true,
      color: COLORS.cream,
      fillColor: COLORS.burgundy,
    },
  }

  const docDefinition: TDocumentDefinitions = {
    info: {
      title: options.title,
      author: 'Armonessa',
      subject: options.context,
      creator: 'Armonessa Güzellik Merkezi Yönetimi',
    },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50] as [number, number, number, number],
    content,
    styles,
    defaultStyle: {
      font: 'Roboto', // pdfmake default — Türkçe karakterleri tam destekler
      fontSize: 9,
      color: COLORS.ink,
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Armonessa - ${options.context}`, fontSize: 7.5, color: COLORS.inkSoft, italics: true, margin: m(40, 0, 0, 0) },
        { text: `Sayfa ${currentPage}/${pageCount}`, fontSize: 7.5, color: COLORS.inkSoft, alignment: 'right', margin: m(0, 0, 40, 0) },
      ],
      margin: m(0, 16, 0, 0),
    }),
  }

  const filename = `Armonessa-${options.filenameBase}-${todayIso()}.pdf`
  pdfMake.createPdf(docDefinition).download(filename)
}
