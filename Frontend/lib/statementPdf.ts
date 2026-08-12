import type { Content, Margins, StyleDictionary, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'
import { createPdf } from '@/lib/pdfMake'
import { formatAmount, formatDocDate, turkishAmountInWords, type StatementRow } from '@/lib/accountStatement'

/**
 * CARİ HESAP EKSTRESİ — yazdırılabilir belge.
 *
 * Ekrandaki belge ile BİREBİR aynı düzen: kurum başlığı, cari bilgi ızgarası, Tarih / İşlem Türü /
 * Açıklama / Borç / Alacak / Bakiye tablosu, toplam + bakiye bandı, tutarın yazıyla okunuşu.
 * Rakamlar `buildAccountStatement`ten hazır gelir — bu dosya HESAP YAPMAZ, yalnız dizer
 * (iki yerde hesap yapılsaydı ekran ile kâğıt ayrı rakam yazabilirdi).
 */

const mg = (top: number, right: number, bottom: number, left: number): Margins => [top, right, bottom, left]

const COLORS = {
  ink: '#241C21',
  soft: '#5D4C55',
  muted: '#7A6873',
  line: '#DED5DA',
  band: '#F4EFF1',
  zebra: '#FBF8F9',
  plum: '#A5556E',
  debt: '#9F1239',
  credit: '#15694A',
}

export interface StatementPdfInstitution {
  name: string
  phone?: string | null
  email?: string | null
  taxNumber?: string | null
  taxOffice?: string | null
  branch?: string | null
}

export interface StatementPdfCustomer {
  code: string
  name: string
  phone?: string | null
  saleCount: number
}

export interface StatementPdfData {
  institution: StatementPdfInstitution
  customer: StatementPdfCustomer
  /** "18.06.2026 - 01.04.2027" */
  periodLabel: string
  /** "11.08.2026 17:30" */
  issuedAt: string
  rows: StatementRow[]
  totalDebit: number
  totalCredit: number
  closing: number
}

/** Belgenin sol/sağ bilgi bloğu: "Etiket : Değer" satırları. */
function infoColumn(entries: [string, string][]): Content {
  return {
    table: {
      widths: [72, 6, '*'],
      body: entries.map(([label, value]) => ([
        { text: label, style: 'infoLabel' },
        { text: ':', style: 'infoLabel' },
        { text: value || '—', style: 'infoValue' },
      ])),
    },
    layout: 'noBorders',
  }
}

export function generateAccountStatementPdf(
  data: StatementPdfData,
  action: 'download' | 'print' | 'open' = 'download',
): void {
  const { institution, customer } = data

  const head: TableCell[] = [
    { text: 'Tarih', style: 'th' },
    { text: 'İşlem Türü', style: 'th' },
    { text: 'Açıklama', style: 'th' },
    { text: 'Borç (TL)', style: 'th', alignment: 'right' },
    { text: 'Alacak (TL)', style: 'th', alignment: 'right' },
    { text: 'Bakiye (TL)', style: 'th', alignment: 'right' },
  ]

  const body: TableCell[][] = [head]

  if (data.rows.length === 0) {
    body.push([
      {
        text: 'Bu dönemde hareket bulunmuyor.',
        colSpan: 6, alignment: 'center', color: COLORS.muted, margin: mg(0, 10, 0, 10),
      },
      {}, {}, {}, {}, {},
    ])
  }

  data.rows.forEach((row, index) => {
    const fill = index % 2 === 1 ? COLORS.zebra : undefined
    body.push([
      { text: formatDocDate(row.date), style: 'td', fillColor: fill },
      { text: row.type, style: 'td', fillColor: fill },
      { text: row.description, style: 'td', fillColor: fill },
      { text: formatAmount(row.debit), style: 'tdNum', alignment: 'right', fillColor: fill },
      { text: formatAmount(row.credit), style: 'tdNum', alignment: 'right', fillColor: fill },
      { text: formatAmount(row.balance), style: 'tdNumBold', alignment: 'right', fillColor: fill },
    ])
  })

  // TOPLAM: yalnız borç/alacak sütunları toplanır — bakiye zaten son satırda yazılıdır.
  body.push([
    { text: '', border: [false, true, false, false], borderColor: [COLORS.line, COLORS.line, COLORS.line, COLORS.line] },
    { text: '' },
    { text: 'Toplam', style: 'totalLabel', alignment: 'right' },
    { text: formatAmount(data.totalDebit), style: 'totalValue', alignment: 'right' },
    { text: formatAmount(data.totalCredit), style: 'totalValue', alignment: 'right' },
    { text: '' },
  ])

  const closingDebt = data.closing >= 0
  body.push([
    { text: '' },
    { text: '' },
    { text: '' },
    { text: '' },
    { text: 'Bakiye', style: 'totalLabel', alignment: 'right' },
    {
      text: `${formatAmount(Math.abs(data.closing))} TL`,
      style: 'balanceValue',
      alignment: 'right',
      color: closingDebt ? COLORS.debt : COLORS.credit,
    },
  ])

  const content: Content[] = [
    // ---------- KURUM BAŞLIĞI ----------
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: institution.name || 'Kurum', style: 'brand' },
            ...(institution.branch ? [{ text: institution.branch, style: 'brandSub' }] : []),
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: (institution.name || 'Kurum').toLocaleUpperCase('tr'), style: 'orgName', alignment: 'right' },
            ...(institution.phone ? [{ text: `Tel: ${institution.phone}`, style: 'orgLine', alignment: 'right' as const }] : []),
            ...(institution.email ? [{ text: institution.email, style: 'orgLine', alignment: 'right' as const }] : []),
            ...(institution.taxNumber
              ? [{ text: `VKN: ${institution.taxNumber}${institution.taxOffice ? ` · ${institution.taxOffice}` : ''}`, style: 'orgLine', alignment: 'right' as const }]
              : []),
          ],
        },
      ],
      margin: mg(0, 0, 0, 8),
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.6, lineColor: COLORS.plum }] },

    // ---------- BAŞLIK ----------
    { text: 'CARİ HESAP EKSTRESİ', style: 'docTitle', alignment: 'center', margin: mg(0, 16, 0, 14) },

    // ---------- CARİ BİLGİLERİ ----------
    {
      columns: [
        infoColumn([
          ['Cari Kodu', customer.code],
          ['Adı Soyadı', customer.name],
          ['Telefon', customer.phone || '—'],
          ['Kayıtlı Satış', `${customer.saleCount} satış`],
        ]),
        infoColumn([
          ['Tarih Aralığı', data.periodLabel],
          ['Düzenleme Tarihi', data.issuedAt],
          ['Para Birimi', 'TL'],
        ]),
      ],
      columnGap: 18,
      margin: mg(0, 0, 0, 14),
    },

    // ---------- HAREKETLER ----------
    {
      table: { headerRows: 1, widths: [52, 62, '*', 62, 62, 68], body },
      layout: {
        hLineWidth: (i: number) => (i === 0 || i === 1 || i === body.length ? 0.8 : 0.4),
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i === 1 ? COLORS.plum : COLORS.line),
        paddingTop: () => 5,
        paddingBottom: () => 5,
        paddingLeft: () => 6,
        paddingRight: () => 6,
      },
    },

    // ---------- YAZIYLA ----------
    {
      text: [
        { text: 'Yalnız ', style: 'wordsLabel' },
        { text: turkishAmountInWords(Math.abs(data.closing)) || '—', style: 'wordsValue' },
        { text: closingDebt ? '' : ' (müşteri alacaklı)', style: 'wordsLabel' },
      ],
      margin: mg(0, 16, 0, 0),
    },
    { text: 'Not: Bu belge bilgilendirme amaçlıdır.', style: 'note', margin: mg(0, 8, 0, 0) },
  ]

  const styles: StyleDictionary = {
    brand: { fontSize: 15, bold: true, color: COLORS.ink },
    brandSub: { fontSize: 8.5, color: COLORS.muted, margin: mg(0, 2, 0, 0) },
    orgName: { fontSize: 10, bold: true, color: COLORS.ink },
    orgLine: { fontSize: 8, color: COLORS.muted, margin: mg(0, 1.5, 0, 0) },
    docTitle: { fontSize: 15, bold: true, color: COLORS.ink, characterSpacing: 0.6 },
    infoLabel: { fontSize: 8.5, color: COLORS.muted, margin: mg(0, 2, 0, 2) },
    infoValue: { fontSize: 9, color: COLORS.ink, bold: true, margin: mg(0, 2, 0, 2) },
    th: { fontSize: 8.5, bold: true, color: COLORS.ink, fillColor: COLORS.band },
    td: { fontSize: 8.5, color: COLORS.soft },
    tdNum: { fontSize: 8.5, color: COLORS.ink },
    tdNumBold: { fontSize: 8.5, bold: true, color: COLORS.ink },
    totalLabel: { fontSize: 9, bold: true, color: COLORS.ink },
    totalValue: { fontSize: 9, bold: true, color: COLORS.ink },
    balanceValue: { fontSize: 11, bold: true },
    wordsLabel: { fontSize: 8.5, color: COLORS.muted },
    wordsValue: { fontSize: 9.5, bold: true, color: COLORS.ink },
    note: { fontSize: 8, color: COLORS.muted },
  }

  const definition: TDocumentDefinitions = {
    info: {
      title: `Cari Hesap Ekstresi — ${customer.name}`,
      author: institution.name || 'BeautyAsist',
      subject: `Cari hesap ekstresi (${data.periodLabel})`,
      creator: 'BeautyAsist',
    },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 46],
    content,
    styles,
    defaultStyle: { font: 'Roboto', fontSize: 9, color: COLORS.ink },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: `${institution.name || 'BeautyAsist'} • Cari Hesap Ekstresi • ${customer.code}`,
          fontSize: 7.5, color: COLORS.muted, margin: mg(40, 0, 0, 0),
        },
        {
          text: `Sayfa ${currentPage} / ${pageCount}`,
          fontSize: 7.5, color: COLORS.muted, alignment: 'right', margin: mg(0, 0, 40, 0),
        },
      ],
      margin: mg(0, 14, 0, 0),
    }),
  }

  const doc = createPdf(definition)
  if (action === 'print') doc.print()
  else if (action === 'open') doc.open()
  else {
    const stamp = new Date()
    const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`
    doc.download(`Cari-Hesap-Ekstresi-${customer.code}-${day}.pdf`)
  }
}
